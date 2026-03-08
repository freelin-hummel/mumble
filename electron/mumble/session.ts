import { EventEmitter } from "node:events";
import type {
  AppClientChannelPermissions,
  AppClientChannelSnapshot,
  AppClientChatMessage,
  AppClientLiveSession,
  AppClientParticipantSnapshot,
  AppClientTelemetry
} from "../appClientState.js";
import { TCPControlChannel } from "./control-channel.js";
import {
  decodeControlMessage,
  encodeControlMessage,
  type AuthenticateMessage,
  type ChannelStateMessage,
  type CodecVersionMessage,
  type CryptSetupMessage,
  type PermissionQueryMessage,
  type PingMessage,
  type RejectMessage,
  type ServerConfigMessage,
  type ServerSyncMessage,
  type SupportedControlMessage,
  type TextMessage,
  type UserStateMessage,
  type VersionMessage
} from "./messages.js";
import { TCPMessageType, type ProtobufControlMessage } from "./types.js";

export interface MumbleVoiceSetupState {
  cryptSetup: CryptSetupMessage | null;
  codecVersion: CodecVersionMessage | null;
}

export interface MumbleServerSessionState {
  maxBandwidth: number | null;
  welcomeText: string | null;
  rootPermissions: bigint | null;
  allowHtml: boolean | null;
  messageLength: number | null;
  imageMessageLength: number | null;
  maxUsers: number | null;
  recordingAllowed: boolean | null;
}

export interface MumbleControlSessionState {
  selfSessionId: string | null;
  liveSession: AppClientLiveSession;
  server: MumbleServerSessionState;
  voice: MumbleVoiceSetupState;
  lastReject: RejectMessage | null;
}

export interface MumbleControlSessionEvents {
  message: [message: SupportedControlMessage];
  liveSession: [session: AppClientLiveSession];
  serverSync: [payload: ServerSyncMessage];
  reject: [payload: RejectMessage];
  voiceSetup: [voice: MumbleVoiceSetupState];
}

type MumbleControlSessionOptions = {
  channel?: TCPControlChannel | null;
  now?: () => Date;
  onLiveSession?: (session: AppClientLiveSession) => void;
};

const MAX_SESSION_MESSAGES = 100;
const PERMISSION_WRITE = 0x01;
const PERMISSION_TRAVERSE = 0x02;
const PERMISSION_ENTER = 0x04;
const PERMISSION_SPEAK = 0x08;
const PERMISSION_MUTE_DEAFEN = 0x10;
const PERMISSION_MOVE = 0x20;

const cloneBytes = (value: Uint8Array | undefined) => value ? Uint8Array.from(value) : undefined;

const cloneControlMessage = <T extends Record<string, unknown>>(value: T): T => {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
};

const toSessionId = (value: number | undefined) => (
  typeof value === "number" && Number.isInteger(value) && value >= 0
    ? String(value)
    : null
);

const toChannelId = (value: number | undefined) => (
  typeof value === "number" && Number.isInteger(value) && value >= 0
    ? String(value)
    : null
);

const normalizeText = (value: string | undefined) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : undefined;
};

const permissionsFromMask = (
  permissions: number | bigint | undefined,
  fallback?: Partial<AppClientChannelPermissions>
): Partial<AppClientChannelPermissions> => {
  if (permissions === undefined || permissions === null) {
    return fallback ?? {};
  }

  const mask = Number(permissions);
  return {
    traverse: (mask & PERMISSION_TRAVERSE) !== 0,
    enter: (mask & PERMISSION_ENTER) !== 0,
    speak: (mask & PERMISSION_SPEAK) !== 0,
    muteDeafen: (mask & PERMISSION_MUTE_DEAFEN) !== 0,
    move: (mask & PERMISSION_MOVE) !== 0,
    write: (mask & PERMISSION_WRITE) !== 0
  };
};

const resolveParticipantStatus = (payload: UserStateMessage): AppClientParticipantSnapshot["status"] => (
  payload.mute || payload.deaf || payload.suppress || payload.selfMute || payload.selfDeaf
    ? "muted"
    : "idle"
);

const cloneLiveSession = (session: AppClientLiveSession): AppClientLiveSession => ({
  channels: session.channels.map((channel) => ({
    ...channel,
    permissions: channel.permissions ? { ...channel.permissions } : undefined
  })),
  participants: session.participants.map((participant) => ({ ...participant })),
  activeChannelId: session.activeChannelId ?? null,
  messages: session.messages?.map((message) => ({ ...message })),
  telemetry: session.telemetry ? { ...session.telemetry } : undefined
});

export class MumbleControlSession extends EventEmitter<MumbleControlSessionEvents> {
  #channel: TCPControlChannel | null;
  readonly #now: () => Date;
  readonly #onLiveSession?: (session: AppClientLiveSession) => void;
  readonly #channels = new Map<string, AppClientChannelSnapshot>();
  readonly #participants = new Map<string, AppClientParticipantSnapshot>();
  readonly #messages: AppClientChatMessage[] = [];
  readonly #channelPermissions = new Map<string, Partial<AppClientChannelPermissions>>();
  #channelListener: ((message: ProtobufControlMessage) => void) | null = null;
  #selfSessionId: string | null = null;
  #lastReject: RejectMessage | null = null;
  #messageCounter = 0;
  #server: MumbleServerSessionState = {
    maxBandwidth: null,
    welcomeText: null,
    rootPermissions: null,
    allowHtml: null,
    messageLength: null,
    imageMessageLength: null,
    maxUsers: null,
    recordingAllowed: null
  };
  #voice: MumbleVoiceSetupState = {
    cryptSetup: null,
    codecVersion: null
  };

  constructor({ channel = null, now, onLiveSession }: MumbleControlSessionOptions = {}) {
    super();
    this.#now = now ?? (() => new Date());
    this.#onLiveSession = onLiveSession;

    if (channel) {
      this.attach(channel);
    }
  }

  attach(channel: TCPControlChannel): void {
    if (this.#channel === channel && this.#channelListener) {
      return;
    }

    this.detach();
    const channelListener = (message: ProtobufControlMessage) => {
      this.processControlMessage(message);
    };

    this.#channel = channel;
    this.#channelListener = channelListener;
    channel.on("message", channelListener);
  }

  detach(): void {
    if (this.#channel && this.#channelListener) {
      this.#channel.off("message", this.#channelListener);
    }

    this.#channel = null;
    this.#channelListener = null;
  }

  getState(): MumbleControlSessionState {
    return {
      selfSessionId: this.#selfSessionId,
      liveSession: this.buildLiveSession(),
      server: { ...this.#server },
      voice: {
        cryptSetup: this.#voice.cryptSetup
          ? {
            key: cloneBytes(this.#voice.cryptSetup.key),
            clientNonce: cloneBytes(this.#voice.cryptSetup.clientNonce),
            serverNonce: cloneBytes(this.#voice.cryptSetup.serverNonce)
          }
          : null,
        codecVersion: this.#voice.codecVersion ? { ...this.#voice.codecVersion } : null
      },
      lastReject: this.#lastReject ? { ...this.#lastReject } : null
    };
  }

  async sendVersion(payload: VersionMessage): Promise<void> {
    await this.sendControlMessage({
      type: TCPMessageType.Version,
      payload
    });
  }

  async sendAuthenticate(payload: AuthenticateMessage): Promise<void> {
    await this.sendControlMessage({
      type: TCPMessageType.Authenticate,
      payload
    });
  }

  async sendPing(payload: PingMessage): Promise<void> {
    await this.sendControlMessage({
      type: TCPMessageType.Ping,
      payload
    });
  }

  async sendTextMessage(payload: TextMessage): Promise<void> {
    await this.sendControlMessage({
      type: TCPMessageType.TextMessage,
      payload
    });
  }

  async sendControlMessage(message: SupportedControlMessage): Promise<void> {
    const channel = this.#channel;
    if (!channel) {
      throw new Error("Attach a TCP control channel before sending control messages.");
    }

    await channel.send(encodeControlMessage(message));
  }

  processControlMessage(message: ProtobufControlMessage | SupportedControlMessage): SupportedControlMessage {
    const decodedMessage = "payload" in message && !(message.payload instanceof Uint8Array)
      ? message
      : decodeControlMessage(message as ProtobufControlMessage);

    let shouldEmitLiveSession = false;
    let shouldEmitVoiceState = false;

    switch (decodedMessage.type) {
      case TCPMessageType.ServerSync:
        this.applyServerSync(decodedMessage.payload);
        shouldEmitLiveSession = true;
        this.emit("serverSync", cloneControlMessage(decodedMessage.payload));
        break;
      case TCPMessageType.ChannelState:
        shouldEmitLiveSession = this.applyChannelState(decodedMessage.payload);
        break;
      case TCPMessageType.ChannelRemove:
        shouldEmitLiveSession = this.applyChannelRemove(decodedMessage.payload.channelId);
        break;
      case TCPMessageType.UserState:
        shouldEmitLiveSession = this.applyUserState(decodedMessage.payload);
        break;
      case TCPMessageType.UserRemove:
        shouldEmitLiveSession = this.applyUserRemove(decodedMessage.payload.session);
        break;
      case TCPMessageType.TextMessage:
        shouldEmitLiveSession = this.applyTextMessage(decodedMessage.payload);
        break;
      case TCPMessageType.Ping:
        shouldEmitLiveSession = this.applyPing(decodedMessage.payload);
        break;
      case TCPMessageType.PermissionQuery:
        shouldEmitLiveSession = this.applyPermissionQuery(decodedMessage.payload);
        break;
      case TCPMessageType.CodecVersion:
        this.#voice = {
          ...this.#voice,
          codecVersion: { ...decodedMessage.payload }
        };
        shouldEmitVoiceState = true;
        break;
      case TCPMessageType.CryptSetup:
        this.#voice = {
          ...this.#voice,
          cryptSetup: {
            key: cloneBytes(decodedMessage.payload.key),
            clientNonce: cloneBytes(decodedMessage.payload.clientNonce),
            serverNonce: cloneBytes(decodedMessage.payload.serverNonce)
          }
        };
        shouldEmitVoiceState = true;
        break;
      case TCPMessageType.ServerConfig:
        this.#server = {
          ...this.#server,
          maxBandwidth: decodedMessage.payload.maxBandwidth ?? this.#server.maxBandwidth,
          welcomeText: decodedMessage.payload.welcomeText ?? this.#server.welcomeText,
          allowHtml: decodedMessage.payload.allowHtml ?? this.#server.allowHtml,
          messageLength: decodedMessage.payload.messageLength ?? this.#server.messageLength,
          imageMessageLength: decodedMessage.payload.imageMessageLength ?? this.#server.imageMessageLength,
          maxUsers: decodedMessage.payload.maxUsers ?? this.#server.maxUsers,
          recordingAllowed: decodedMessage.payload.recordingAllowed ?? this.#server.recordingAllowed
        };
        break;
      case TCPMessageType.Reject:
        this.#lastReject = { ...decodedMessage.payload };
        this.emit("reject", cloneControlMessage(decodedMessage.payload));
        break;
      case TCPMessageType.Version:
      case TCPMessageType.Authenticate:
        break;
      default:
        break;
    }

    this.emit("message", cloneControlMessage(decodedMessage));

    if (shouldEmitVoiceState) {
      this.emit("voiceSetup", this.getState().voice);
    }

    if (shouldEmitLiveSession) {
      const liveSession = this.buildLiveSession();
      this.#onLiveSession?.(liveSession);
      this.emit("liveSession", cloneLiveSession(liveSession));
    }

    return decodedMessage;
  }

  buildLiveSession(): AppClientLiveSession {
    const channels = [...this.#channels.values()].map((channel) => ({
      ...channel,
      permissions: channel.permissions ? { ...channel.permissions } : undefined
    }));
    const participants = [...this.#participants.values()].map((participant) => ({ ...participant }));
    const selfParticipant = this.#selfSessionId ? this.#participants.get(this.#selfSessionId) : null;
    const telemetry = this.buildTelemetry();

    return {
      channels,
      participants,
      activeChannelId: selfParticipant?.channelId ?? null,
      messages: this.#messages.map((message) => ({ ...message })),
      telemetry
    };
  }

  applyServerSync(payload: ServerSyncMessage): void {
    const selfSessionId = toSessionId(payload.session);
    if (selfSessionId) {
      this.#selfSessionId = selfSessionId;
      const selfParticipant = this.#participants.get(selfSessionId);
      if (selfParticipant) {
        this.#participants.set(selfSessionId, {
          ...selfParticipant,
          isSelf: true
        });
      }
    }

    this.#server = {
      ...this.#server,
      maxBandwidth: payload.maxBandwidth ?? this.#server.maxBandwidth,
      welcomeText: payload.welcomeText ?? this.#server.welcomeText,
      rootPermissions: payload.permissions ?? this.#server.rootPermissions
    };

    if (payload.permissions !== undefined) {
      this.applyChannelPermissions("0", permissionsFromMask(payload.permissions));
    }
  }

  applyChannelState(payload: ChannelStateMessage): boolean {
    const channelId = toChannelId(payload.channelId);
    if (!channelId) {
      return false;
    }

    const currentChannel = this.#channels.get(channelId);
    const permissions = payload.canEnter !== undefined
      ? {
        ...this.#channelPermissions.get(channelId),
        enter: payload.canEnter
      }
      : this.#channelPermissions.get(channelId);

    this.#channels.set(channelId, {
      id: channelId,
      name: normalizeText(payload.name) ?? currentChannel?.name ?? `Channel ${channelId}`,
      parentId: payload.parent !== undefined ? toChannelId(payload.parent) : currentChannel?.parentId ?? null,
      position: payload.position ?? currentChannel?.position ?? 0,
      permissions: permissions ? { ...permissions } : currentChannel?.permissions
    });
    return true;
  }

  applyChannelRemove(channelIdValue: number | undefined): boolean {
    const channelId = toChannelId(channelIdValue);
    if (!channelId) {
      return false;
    }

    const removed = this.#channels.delete(channelId);
    this.#channelPermissions.delete(channelId);

    for (const [participantId, participant] of this.#participants.entries()) {
      if (participant.channelId === channelId) {
        this.#participants.delete(participantId);
      }
    }

    return removed;
  }

  applyUserState(payload: UserStateMessage): boolean {
    const sessionId = toSessionId(payload.session);
    if (!sessionId) {
      return false;
    }

    const currentParticipant = this.#participants.get(sessionId);
    const channelId = payload.channelId !== undefined
      ? toChannelId(payload.channelId)
      : currentParticipant?.channelId ?? null;

    if (!channelId) {
      return false;
    }

    this.#participants.set(sessionId, {
      id: sessionId,
      name: normalizeText(payload.name) ?? currentParticipant?.name ?? `User ${sessionId}`,
      channelId,
      status: resolveParticipantStatus(payload),
      isSelf: sessionId === this.#selfSessionId ? true : currentParticipant?.isSelf
    });
    return true;
  }

  applyUserRemove(sessionValue: number | undefined): boolean {
    const sessionId = toSessionId(sessionValue);
    return sessionId ? this.#participants.delete(sessionId) : false;
  }

  applyTextMessage(payload: TextMessage): boolean {
    const body = normalizeText(payload.message);
    if (!body) {
      return false;
    }

    const authorSessionId = toSessionId(payload.actor);
    const author = authorSessionId
      ? this.#participants.get(authorSessionId)?.name ?? `User ${authorSessionId}`
      : "Server";
    const channelId = toChannelId(payload.channelIds?.[0] ?? payload.treeIds?.[0]);

    this.#messageCounter += 1;
    this.#messages.push({
      id: `mumble-control-${this.#messageCounter}`,
      author,
      body,
      channelId,
      sentAt: this.#now().toISOString()
    });
    if (this.#messages.length > MAX_SESSION_MESSAGES) {
      this.#messages.splice(0, this.#messages.length - MAX_SESSION_MESSAGES);
    }
    return true;
  }

  applyPing(payload: PingMessage): boolean {
    const totalPackets = payload.udpPackets ?? payload.tcpPackets;
    const packetLoss = typeof payload.lost === "number" && typeof totalPackets === "number" && totalPackets > 0
      ? (payload.lost / totalPackets) * 100
      : undefined;

    const nextTelemetry: Partial<AppClientTelemetry> = {
      latencyMs: payload.udpPingAvg ?? payload.tcpPingAvg,
      jitterMs: payload.udpPingVar ?? payload.tcpPingVar,
      packetLoss
    };

    const currentTelemetry = this.buildTelemetry();
    const changed = nextTelemetry.latencyMs !== currentTelemetry.latencyMs
      || nextTelemetry.jitterMs !== currentTelemetry.jitterMs
      || nextTelemetry.packetLoss !== currentTelemetry.packetLoss;

    this.#server = { ...this.#server };
    this.#telemetry = nextTelemetry;
    return changed;
  }

  applyPermissionQuery(payload: PermissionQueryMessage): boolean {
    if (payload.flush === true && payload.channelId === undefined) {
      const hadPermissions = this.#channelPermissions.size > 0;
      this.#channelPermissions.clear();

      for (const [channelId, channel] of this.#channels.entries()) {
        this.#channels.set(channelId, {
          ...channel,
          permissions: undefined
        });
      }

      if (this.#server.rootPermissions !== null) {
        this.applyChannelPermissions("0", permissionsFromMask(this.#server.rootPermissions));
      }

      return hadPermissions;
    }

    const channelId = toChannelId(payload.channelId);
    if (!channelId) {
      return false;
    }

    this.applyChannelPermissions(channelId, permissionsFromMask(payload.permissions));
    return true;
  }

  applyChannelPermissions(channelId: string, permissions: Partial<AppClientChannelPermissions>): void {
    const nextPermissions = {
      ...this.#channelPermissions.get(channelId),
      ...permissions
    };
    this.#channelPermissions.set(channelId, nextPermissions);

    const currentChannel = this.#channels.get(channelId);
    if (currentChannel) {
      this.#channels.set(channelId, {
        ...currentChannel,
        permissions: { ...nextPermissions }
      });
    }
  }

  buildTelemetry(): Partial<AppClientTelemetry> {
    return {
      ...this.#telemetry
    };
  }

  #telemetry: Partial<AppClientTelemetry> = {};
}
