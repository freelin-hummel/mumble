import type { AppClientConnectRequest, AppClientLiveSession } from "../appClientState.js";
import { TCPControlChannel } from "./control-channel.js";
import { TCPMessageType, type ProtobufControlMessage } from "./types.js";

const DEFAULT_MUMBLE_PORT = 64738;
const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 10_000;
const VERSION_V1 = 0x010500;
const EXTENDED_VERSION_V2 = 0x0001000500000000n;

type ConnectionControls = {
  setAuthenticating: () => void;
};

type MumbleControlChannelLike = Pick<TCPControlChannel, "connect" | "disconnect" | "send" | "on" | "off">;

type MumbleSessionManagerOptions = {
  channelFactory?: () => MumbleControlChannelLike;
  bootstrapTimeoutMs?: number;
  onDisconnected?: (reason: string | null) => void;
};

type ParsedServerAddress = {
  host: string;
  port: number;
};

type DecodedChannelState = {
  channelId: number;
  parentId: number | null;
  name: string | null;
  position: number;
  isEnterRestricted: boolean | null;
  canEnter: boolean | null;
};

type DecodedUserState = {
  session: number;
  name: string | null;
  channelId: number | null;
  mute: boolean;
  deaf: boolean;
  suppress: boolean;
  selfMute: boolean;
  selfDeaf: boolean;
};

type DecodedServerSync = {
  session: number | null;
  welcomeText: string | null;
};

type DecodedReject = {
  type: number | null;
  reason: string | null;
};

type ActiveConnection = {
  channel: MumbleControlChannelLike;
  cleanup: () => void;
  bootstrapComplete: boolean;
  manualDisconnect: boolean;
  lastError: string | null;
};

type ProtoField =
  | { wireType: 0; value: bigint }
  | { wireType: 2; value: Uint8Array };

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const buildVarintFieldKey = (fieldNumber: number) => fieldNumber << 3;
const buildLengthDelimitedFieldKey = (fieldNumber: number) => (fieldNumber << 3) | 2;

const encodeVarint = (value: number | bigint) => {
  let remaining = BigInt(value);
  if (remaining < 0n) {
    throw new Error("Protocol values must be unsigned.");
  }

  const bytes: number[] = [];
  do {
    let nextByte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining > 0n) {
      nextByte |= 0x80;
    }
    bytes.push(nextByte);
  } while (remaining > 0n);
  return Uint8Array.from(bytes);
};

const encodeVarintField = (fieldNumber: number, value: number | bigint | boolean) => {
  const normalizedValue = typeof value === "boolean" ? (value ? 1 : 0) : value;
  return Buffer.concat([
    Buffer.from(encodeVarint(buildVarintFieldKey(fieldNumber))),
    Buffer.from(encodeVarint(normalizedValue))
  ]);
};

const encodeStringField = (fieldNumber: number, value: string) => {
  const encodedValue = textEncoder.encode(value);
  return Buffer.concat([
    Buffer.from(encodeVarint(buildLengthDelimitedFieldKey(fieldNumber))),
    Buffer.from(encodeVarint(encodedValue.length)),
    Buffer.from(encodedValue)
  ]);
};

const decodeProtoFields = (payload: Uint8Array) => {
  const fields = new Map<number, ProtoField[]>();
  let offset = 0;

  const pushField = (fieldNumber: number, field: ProtoField) => {
    const values = fields.get(fieldNumber) ?? [];
    values.push(field);
    fields.set(fieldNumber, values);
  };

  while (offset < payload.length) {
    let key = 0n;
    let shift = 0n;

    while (true) {
      if (offset >= payload.length) {
        throw new Error("Encountered a truncated protobuf field key.");
      }

      const byte = BigInt(payload[offset]);
      offset += 1;
      key |= (byte & 0x7fn) << shift;
      if ((byte & 0x80n) === 0n) {
        break;
      }
      shift += 7n;
    }

    const fieldNumber = Number(key >> 3n);
    const wireType = Number(key & 0x7n);

    if (wireType === 0) {
      let value = 0n;
      let valueShift = 0n;
      while (true) {
        if (offset >= payload.length) {
          throw new Error("Encountered a truncated protobuf varint.");
        }

        const byte = BigInt(payload[offset]);
        offset += 1;
        value |= (byte & 0x7fn) << valueShift;
        if ((byte & 0x80n) === 0n) {
          break;
        }
        valueShift += 7n;
      }
      pushField(fieldNumber, { wireType: 0, value });
      continue;
    }

    if (wireType === 2) {
      let length = 0n;
      let lengthShift = 0n;
      while (true) {
        if (offset >= payload.length) {
          throw new Error("Encountered a truncated protobuf length.");
        }

        const byte = BigInt(payload[offset]);
        offset += 1;
        length |= (byte & 0x7fn) << lengthShift;
        if ((byte & 0x80n) === 0n) {
          break;
        }
        lengthShift += 7n;
      }

      const normalizedLength = Number(length);
      const endOffset = offset + normalizedLength;
      if (!Number.isSafeInteger(normalizedLength) || endOffset > payload.length) {
        throw new Error("Encountered an invalid protobuf length-delimited field.");
      }

      pushField(fieldNumber, {
        wireType: 2,
        value: payload.slice(offset, endOffset)
      });
      offset = endOffset;
      continue;
    }

    if (wireType === 1) {
      offset += 8;
      continue;
    }

    if (wireType === 5) {
      offset += 4;
      continue;
    }

    throw new Error(`Unsupported protobuf wire type: ${wireType}`);
  }

  return fields;
};

const getLastVarint = (fields: Map<number, ProtoField[]>, fieldNumber: number) => {
  const field = fields.get(fieldNumber)?.at(-1);
  if (!field || field.wireType !== 0) {
    return null;
  }
  return field.value;
};

const getLastNumber = (fields: Map<number, ProtoField[]>, fieldNumber: number) => {
  const value = getLastVarint(fields, fieldNumber);
  if (value === null) {
    return null;
  }

  const normalizedValue = Number(value);
  if (!Number.isSafeInteger(normalizedValue)) {
    throw new Error(`Field ${fieldNumber} exceeds the supported numeric range.`);
  }

  return normalizedValue;
};

const getLastBoolean = (fields: Map<number, ProtoField[]>, fieldNumber: number) => {
  const value = getLastVarint(fields, fieldNumber);
  return value === null ? null : value !== 0n;
};

const getLastString = (fields: Map<number, ProtoField[]>, fieldNumber: number) => {
  const field = fields.get(fieldNumber)?.at(-1);
  if (!field || field.wireType !== 2) {
    return null;
  }
  return textDecoder.decode(field.value);
};

const encodeVersionPayload = () => Buffer.concat([
  encodeVarintField(1, VERSION_V1),
  encodeStringField(2, "mumble-electron"),
  encodeStringField(3, process.platform),
  encodeStringField(4, process.version),
  encodeVarintField(5, EXTENDED_VERSION_V2)
]);

const encodeAuthenticatePayload = (nickname: string) => Buffer.concat([
  encodeStringField(1, nickname),
  encodeVarintField(5, true),
  encodeVarintField(6, 0)
]);

const decodeChannelState = (payload: Uint8Array): DecodedChannelState => {
  const fields = decodeProtoFields(payload);
  const channelId = getLastNumber(fields, 1);
  if (channelId === null) {
    throw new Error("ChannelState did not include a channel_id.");
  }

  return {
    channelId,
    parentId: getLastNumber(fields, 2),
    name: getLastString(fields, 3),
    position: getLastNumber(fields, 9) ?? 0,
    isEnterRestricted: getLastBoolean(fields, 12),
    canEnter: getLastBoolean(fields, 13)
  };
};

const decodeUserState = (payload: Uint8Array): DecodedUserState => {
  const fields = decodeProtoFields(payload);
  const session = getLastNumber(fields, 1);
  if (session === null) {
    throw new Error("UserState did not include a session.");
  }

  return {
    session,
    name: getLastString(fields, 3),
    channelId: getLastNumber(fields, 5),
    mute: getLastBoolean(fields, 6) ?? false,
    deaf: getLastBoolean(fields, 7) ?? false,
    suppress: getLastBoolean(fields, 8) ?? false,
    selfMute: getLastBoolean(fields, 9) ?? false,
    selfDeaf: getLastBoolean(fields, 10) ?? false
  };
};

const decodeServerSync = (payload: Uint8Array): DecodedServerSync => {
  const fields = decodeProtoFields(payload);
  return {
    session: getLastNumber(fields, 1),
    welcomeText: getLastString(fields, 3)
  };
};

const decodeReject = (payload: Uint8Array): DecodedReject => {
  const fields = decodeProtoFields(payload);
  return {
    type: getLastNumber(fields, 1),
    reason: getLastString(fields, 2)
  };
};

const buildRejectErrorMessage = (reject: DecodedReject) => {
  if (reject.reason?.trim()) {
    return reject.reason.trim();
  }

  switch (reject.type) {
    case 1:
      return "The server rejected this client version.";
    case 2:
      return "The server rejected that nickname.";
    case 3:
    case 4:
      return "The server rejected the supplied credentials.";
    case 5:
      return "That nickname is already in use on the server.";
    case 6:
      return "The server is full right now.";
    case 7:
      return "The server requires a certificate to connect.";
    case 8:
      return "The server authenticator rejected this connection.";
    case 9:
      return "The server is not accepting new connections.";
    default:
      return "The server rejected this connection.";
  }
};

const deriveParticipantStatus = (participant: DecodedUserState) => (
  participant.mute || participant.deaf || participant.suppress || participant.selfMute || participant.selfDeaf
    ? "muted"
    : "live"
);

const buildSessionSnapshot = (
  nickname: string,
  channels: Map<number, DecodedChannelState>,
  participants: Map<number, DecodedUserState>,
  serverSync: DecodedServerSync
): AppClientLiveSession => {
  const channelSnapshots = new Map<string, AppClientLiveSession["channels"][number]>();

  channels.forEach((channel) => {
    channelSnapshots.set(String(channel.channelId), {
      id: String(channel.channelId),
      name: channel.name?.trim() || `Channel ${channel.channelId}`,
      parentId: channel.parentId === null ? null : String(channel.parentId),
      position: channel.position,
      permissions: {
        enter: channel.canEnter ?? !(channel.isEnterRestricted ?? false)
      }
    });
  });

  const participantSnapshots = Array.from(participants.values()).flatMap((participant) => {
    if (participant.channelId === null) {
      return [];
    }

    const channelId = String(participant.channelId);
    if (!channelSnapshots.has(channelId)) {
      channelSnapshots.set(channelId, {
        id: channelId,
        name: `Channel ${channelId}`,
        parentId: null,
        position: 0
      });
    }

    const isSelf = serverSync.session !== null && participant.session === serverSync.session;
    return [{
      id: String(participant.session),
      name: participant.name?.trim() || (isSelf ? nickname : `User ${participant.session}`),
      channelId,
      status: deriveParticipantStatus(participant),
      isSelf: isSelf ? true : undefined
    }];
  });

  const activeParticipant = participantSnapshots.find((participant) => participant.isSelf)
    ?? participantSnapshots.find((participant) => participant.name === nickname);

  return {
    channels: Array.from(channelSnapshots.values()),
    participants: participantSnapshots,
    activeChannelId: activeParticipant?.channelId ?? null,
    messages: serverSync.welcomeText?.trim()
      ? [{
        id: `server-welcome-${serverSync.session ?? "pending"}`,
        author: "Server",
        body: serverSync.welcomeText.trim(),
        channelId: null,
        sentAt: new Date().toISOString()
      }]
      : undefined
  };
};

const parseBootstrapMessage = ({
  message,
  nickname,
  channels,
  participants,
  resolve,
  reject
}: {
  message: ProtobufControlMessage;
  nickname: string;
  channels: Map<number, DecodedChannelState>;
  participants: Map<number, DecodedUserState>;
  resolve: (value: AppClientLiveSession) => void;
  reject: (reason?: unknown) => void;
}) => {
  if (message.type === TCPMessageType.ChannelState) {
    const nextChannel = decodeChannelState(message.payload);
    const previousChannel = channels.get(nextChannel.channelId);
    channels.set(nextChannel.channelId, {
      ...previousChannel,
      ...nextChannel
    });
    return null;
  }

  if (message.type === TCPMessageType.UserState) {
    const nextParticipant = decodeUserState(message.payload);
    const previousParticipant = participants.get(nextParticipant.session);
    participants.set(nextParticipant.session, {
      ...previousParticipant,
      ...nextParticipant
    });
    return null;
  }

  if (message.type === TCPMessageType.Reject) {
    reject(new Error(buildRejectErrorMessage(decodeReject(message.payload))));
    return null;
  }

  if (message.type === TCPMessageType.ServerSync) {
    const serverSync = decodeServerSync(message.payload);
    resolve(buildSessionSnapshot(nickname, channels, participants, serverSync));
  }

  return null;
};

export const parseServerAddress = (serverAddress: string): ParsedServerAddress => {
  const normalizedAddress = serverAddress.trim();
  if (!normalizedAddress) {
    throw new Error("Enter a valid server address to join voice.");
  }

  if (normalizedAddress.startsWith("[")) {
    const ipv6Match = /^\[(?<host>[^\]]+)\](?::(?<port>\d+))?$/.exec(normalizedAddress);
    if (!ipv6Match?.groups?.host) {
      throw new Error("IPv6 server addresses must use bracket notation.");
    }

    return {
      host: ipv6Match.groups.host,
      port: ipv6Match.groups.port ? Number(ipv6Match.groups.port) : DEFAULT_MUMBLE_PORT
    };
  }

  if (normalizedAddress.includes("[") || normalizedAddress.includes("]")) {
    throw new Error("IPv6 server addresses must use bracket notation.");
  }

  const separatorCount = normalizedAddress.split(":").length - 1;
  if (separatorCount === 1) {
    const [host, port] = normalizedAddress.split(":");
    if (!host?.trim()) {
      throw new Error("Enter a valid server address to join voice.");
    }

    return {
      host: host.trim(),
      port: port ? Number(port) : DEFAULT_MUMBLE_PORT
    };
  }

  return {
    host: normalizedAddress,
    port: DEFAULT_MUMBLE_PORT
  };
};

export class MumbleSessionManager {
  readonly #channelFactory: () => MumbleControlChannelLike;
  readonly #bootstrapTimeoutMs: number;
  readonly #onDisconnected?: (reason: string | null) => void;
  #activeConnection: ActiveConnection | null = null;

  constructor({
    channelFactory = () => new TCPControlChannel(),
    bootstrapTimeoutMs = DEFAULT_BOOTSTRAP_TIMEOUT_MS,
    onDisconnected
  }: MumbleSessionManagerOptions = {}) {
    this.#channelFactory = channelFactory;
    this.#bootstrapTimeoutMs = bootstrapTimeoutMs;
    this.#onDisconnected = onDisconnected;
  }

  async connect(
    request: AppClientConnectRequest,
    controls: ConnectionControls
  ): Promise<AppClientLiveSession> {
    await this.disconnect();

    const parsedAddress = parseServerAddress(request.serverAddress);
    const channel = this.#channelFactory();
    const activeConnection = this.#bindActiveConnection(channel);

    try {
      await channel.connect({
        ...parsedAddress,
        secure: true,
        rejectUnauthorized: false
      });
      await channel.send({
        type: TCPMessageType.Version,
        payload: encodeVersionPayload()
      });
      const bootstrapPromise = this.#awaitBootstrap(channel, request.nickname);
      controls.setAuthenticating();
      await channel.send({
        type: TCPMessageType.Authenticate,
        payload: encodeAuthenticatePayload(request.nickname)
      });
      const liveSession = await bootstrapPromise;
      activeConnection.bootstrapComplete = true;
      return liveSession;
    } catch (error) {
      activeConnection.manualDisconnect = true;
      await this.#closeChannel(activeConnection);
      throw error;
    }
  }

  async disconnect() {
    const activeConnection = this.#activeConnection;
    if (!activeConnection) {
      return;
    }

    activeConnection.manualDisconnect = true;
    await this.#closeChannel(activeConnection);
  }

  #bindActiveConnection(channel: MumbleControlChannelLike) {
    const activeConnection: ActiveConnection = {
      channel,
      cleanup: () => undefined,
      bootstrapComplete: false,
      manualDisconnect: false,
      lastError: null
    };

    const handleError = (error: Error) => {
      activeConnection.lastError = error.message;
    };
    const handleClose = () => {
      activeConnection.cleanup();
      if (this.#activeConnection === activeConnection) {
        this.#activeConnection = null;
      }

      if (!activeConnection.bootstrapComplete || activeConnection.manualDisconnect) {
        return;
      }

      this.#onDisconnected?.(activeConnection.lastError ?? "The server connection closed.");
    };

    channel.on("error", handleError);
    channel.on("close", handleClose);
    activeConnection.cleanup = () => {
      channel.off("error", handleError);
      channel.off("close", handleClose);
    };
    this.#activeConnection = activeConnection;
    return activeConnection;
  }

  async #closeChannel(activeConnection: ActiveConnection) {
    if (this.#activeConnection === activeConnection) {
      this.#activeConnection = null;
    }
    activeConnection.cleanup();
    try {
      await activeConnection.channel.disconnect();
    } catch {
      // Ignore close errors while cleaning up a failed or manual disconnect.
    }
  }

  #awaitBootstrap(channel: MumbleControlChannelLike, nickname: string) {
    return new Promise<AppClientLiveSession>((resolve, reject) => {
      const channels = new Map<number, DecodedChannelState>();
      const participants = new Map<number, DecodedUserState>();
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out while waiting for the server session bootstrap."));
      }, this.#bootstrapTimeoutMs);

      const cleanup = () => {
        clearTimeout(timeoutId);
        channel.off("message", handleMessage);
        channel.off("close", handleClose);
      };

      const handleClose = () => {
        cleanup();
        reject(new Error("The server connection closed during session bootstrap."));
      };

      const handleMessage = (message: ProtobufControlMessage) => {
        try {
          parseBootstrapMessage({
            message,
            nickname,
            channels,
            participants,
            resolve: (liveSession) => {
              cleanup();
              resolve(liveSession);
            },
            reject: (reason) => {
              cleanup();
              reject(reason);
            }
          });
        } catch (error) {
          cleanup();
          reject(error);
        }
      };

      channel.on("message", handleMessage);
      channel.on("close", handleClose);
    });
  }
}
