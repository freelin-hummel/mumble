import { ProtobufReader, ProtobufWireError, ProtobufWriter, ProtobufWireType } from "./protobuf.js";
import { TCPMessageType, type ProtobufControlMessage } from "./types.js";

export interface VersionMessage {
  versionV1?: number;
  versionV2?: bigint;
  release?: string;
  os?: string;
  osVersion?: string;
}

export interface AuthenticateMessage {
  username?: string;
  password?: string;
  tokens?: string[];
  celtVersions?: number[];
  opus?: boolean;
  clientType?: number;
}

export interface PingMessage {
  timestamp?: bigint;
  good?: number;
  late?: number;
  lost?: number;
  resync?: number;
  udpPackets?: number;
  tcpPackets?: number;
  udpPingAvg?: number;
  udpPingVar?: number;
  tcpPingAvg?: number;
  tcpPingVar?: number;
}

export interface RejectMessage {
  type?: number;
  reason?: string;
}

export interface ServerSyncMessage {
  session?: number;
  maxBandwidth?: number;
  welcomeText?: string;
  permissions?: bigint;
}

export interface ChannelRemoveMessage {
  channelId?: number;
}

export interface ChannelStateMessage {
  channelId?: number;
  parent?: number;
  name?: string;
  links?: number[];
  description?: string;
  linksAdd?: number[];
  linksRemove?: number[];
  temporary?: boolean;
  position?: number;
  descriptionHash?: Uint8Array;
  maxUsers?: number;
  isEnterRestricted?: boolean;
  canEnter?: boolean;
}

export interface UserRemoveMessage {
  session?: number;
  actor?: number;
  reason?: string;
  ban?: boolean;
  banCertificate?: boolean;
  banIp?: boolean;
}

export interface UserStateVolumeAdjustmentMessage {
  listeningChannel?: number;
  volumeAdjustment?: number;
}

export interface UserStateMessage {
  session?: number;
  actor?: number;
  name?: string;
  userId?: number;
  channelId?: number;
  mute?: boolean;
  deaf?: boolean;
  suppress?: boolean;
  selfMute?: boolean;
  selfDeaf?: boolean;
  texture?: Uint8Array;
  pluginContext?: Uint8Array;
  pluginIdentity?: string;
  comment?: string;
  hash?: string;
  commentHash?: Uint8Array;
  textureHash?: Uint8Array;
  prioritySpeaker?: boolean;
  recording?: boolean;
  temporaryAccessTokens?: string[];
  listeningChannelAdd?: number[];
  listeningChannelRemove?: number[];
  listeningVolumeAdjustment?: UserStateVolumeAdjustmentMessage[];
}

export interface TextMessage {
  actor?: number;
  sessions?: number[];
  channelIds?: number[];
  treeIds?: number[];
  message?: string;
}

export interface CryptSetupMessage {
  key?: Uint8Array;
  clientNonce?: Uint8Array;
  serverNonce?: Uint8Array;
}

export interface PermissionQueryMessage {
  channelId?: number;
  permissions?: number;
  flush?: boolean;
}

export interface CodecVersionMessage {
  alpha?: number;
  beta?: number;
  preferAlpha?: boolean;
  opus?: boolean;
}

export interface ServerConfigMessage {
  maxBandwidth?: number;
  welcomeText?: string;
  allowHtml?: boolean;
  messageLength?: number;
  imageMessageLength?: number;
  maxUsers?: number;
  recordingAllowed?: boolean;
}

export type SupportedControlMessage =
  | { type: TCPMessageType.Version; payload: VersionMessage }
  | { type: TCPMessageType.Authenticate; payload: AuthenticateMessage }
  | { type: TCPMessageType.Ping; payload: PingMessage }
  | { type: TCPMessageType.Reject; payload: RejectMessage }
  | { type: TCPMessageType.ServerSync; payload: ServerSyncMessage }
  | { type: TCPMessageType.ChannelRemove; payload: ChannelRemoveMessage }
  | { type: TCPMessageType.ChannelState; payload: ChannelStateMessage }
  | { type: TCPMessageType.UserRemove; payload: UserRemoveMessage }
  | { type: TCPMessageType.UserState; payload: UserStateMessage }
  | { type: TCPMessageType.TextMessage; payload: TextMessage }
  | { type: TCPMessageType.CryptSetup; payload: CryptSetupMessage }
  | { type: TCPMessageType.PermissionQuery; payload: PermissionQueryMessage }
  | { type: TCPMessageType.CodecVersion; payload: CodecVersionMessage }
  | { type: TCPMessageType.ServerConfig; payload: ServerConfigMessage };

export class UnsupportedControlMessageTypeError extends Error {
  constructor(type: TCPMessageType) {
    super(`Unsupported control message type: ${TCPMessageType[type] ?? String(type)}`);
    this.name = "UnsupportedControlMessageTypeError";
  }
}

const decodeVersionMessage = (payload: Uint8Array): VersionMessage => {
  const reader = new ProtobufReader(payload);
  const message: VersionMessage = {};

  while (!reader.eof) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1:
        message.versionV1 = reader.readUint32("version_v1");
        break;
      case 2:
        message.release = reader.readString();
        break;
      case 3:
        message.os = reader.readString();
        break;
      case 4:
        message.osVersion = reader.readString();
        break;
      case 5:
        message.versionV2 = reader.readUint64();
        break;
      default:
        reader.skipField(wireType);
    }
  }

  return message;
};

const encodeVersionMessage = (payload: VersionMessage): Uint8Array => {
  const writer = new ProtobufWriter();
  writer.writeUint32(1, payload.versionV1);
  writer.writeString(2, payload.release);
  writer.writeString(3, payload.os);
  writer.writeString(4, payload.osVersion);
  writer.writeUint64(5, payload.versionV2);
  return writer.finish();
};

const decodeAuthenticateMessage = (payload: Uint8Array): AuthenticateMessage => {
  const reader = new ProtobufReader(payload);
  const message: AuthenticateMessage = {
    tokens: [],
    celtVersions: []
  };

  while (!reader.eof) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1:
        message.username = reader.readString();
        break;
      case 2:
        message.password = reader.readString();
        break;
      case 3:
        if (!reader.readPackedString(message.tokens ?? [], wireType)) {
          reader.skipField(wireType);
        }
        break;
      case 4:
        if (!reader.readPackedInt32(message.celtVersions ?? [], wireType)) {
          reader.skipField(wireType);
        }
        break;
      case 5:
        message.opus = reader.readBool();
        break;
      case 6:
        message.clientType = reader.readInt32("client_type");
        break;
      default:
        reader.skipField(wireType);
    }
  }

  return message;
};

const encodeAuthenticateMessage = (payload: AuthenticateMessage): Uint8Array => {
  const writer = new ProtobufWriter();
  writer.writeString(1, payload.username);
  writer.writeString(2, payload.password);
  writer.writeRepeatedString(3, payload.tokens);
  writer.writeRepeatedInt32(4, payload.celtVersions);
  writer.writeBool(5, payload.opus);
  writer.writeInt32(6, payload.clientType);
  return writer.finish();
};

const decodePingMessage = (payload: Uint8Array): PingMessage => {
  const reader = new ProtobufReader(payload);
  const message: PingMessage = {};

  while (!reader.eof) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1:
        message.timestamp = reader.readUint64();
        break;
      case 2:
        message.good = reader.readUint32("good");
        break;
      case 3:
        message.late = reader.readUint32("late");
        break;
      case 4:
        message.lost = reader.readUint32("lost");
        break;
      case 5:
        message.resync = reader.readUint32("resync");
        break;
      case 6:
        message.udpPackets = reader.readUint32("udp_packets");
        break;
      case 7:
        message.tcpPackets = reader.readUint32("tcp_packets");
        break;
      case 8:
        message.udpPingAvg = reader.readFloat();
        break;
      case 9:
        message.udpPingVar = reader.readFloat();
        break;
      case 10:
        message.tcpPingAvg = reader.readFloat();
        break;
      case 11:
        message.tcpPingVar = reader.readFloat();
        break;
      default:
        reader.skipField(wireType);
    }
  }

  return message;
};

const encodePingMessage = (payload: PingMessage): Uint8Array => {
  const writer = new ProtobufWriter();
  writer.writeUint64(1, payload.timestamp);
  writer.writeUint32(2, payload.good);
  writer.writeUint32(3, payload.late);
  writer.writeUint32(4, payload.lost);
  writer.writeUint32(5, payload.resync);
  writer.writeUint32(6, payload.udpPackets);
  writer.writeUint32(7, payload.tcpPackets);
  writer.writeFloat(8, payload.udpPingAvg);
  writer.writeFloat(9, payload.udpPingVar);
  writer.writeFloat(10, payload.tcpPingAvg);
  writer.writeFloat(11, payload.tcpPingVar);
  return writer.finish();
};

const decodeRejectMessage = (payload: Uint8Array): RejectMessage => {
  const reader = new ProtobufReader(payload);
  const message: RejectMessage = {};

  while (!reader.eof) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1:
        message.type = reader.readInt32("reject type");
        break;
      case 2:
        message.reason = reader.readString();
        break;
      default:
        reader.skipField(wireType);
    }
  }

  return message;
};

const encodeRejectMessage = (payload: RejectMessage): Uint8Array => {
  const writer = new ProtobufWriter();
  writer.writeInt32(1, payload.type);
  writer.writeString(2, payload.reason);
  return writer.finish();
};

const decodeServerSyncMessage = (payload: Uint8Array): ServerSyncMessage => {
  const reader = new ProtobufReader(payload);
  const message: ServerSyncMessage = {};

  while (!reader.eof) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1:
        message.session = reader.readUint32("session");
        break;
      case 2:
        message.maxBandwidth = reader.readUint32("max_bandwidth");
        break;
      case 3:
        message.welcomeText = reader.readString();
        break;
      case 4:
        message.permissions = reader.readUint64();
        break;
      default:
        reader.skipField(wireType);
    }
  }

  return message;
};

const encodeServerSyncMessage = (payload: ServerSyncMessage): Uint8Array => {
  const writer = new ProtobufWriter();
  writer.writeUint32(1, payload.session);
  writer.writeUint32(2, payload.maxBandwidth);
  writer.writeString(3, payload.welcomeText);
  writer.writeUint64(4, payload.permissions);
  return writer.finish();
};

const decodeChannelRemoveMessage = (payload: Uint8Array): ChannelRemoveMessage => {
  const reader = new ProtobufReader(payload);
  const message: ChannelRemoveMessage = {};

  while (!reader.eof) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1:
        message.channelId = reader.readUint32("channel_id");
        break;
      default:
        reader.skipField(wireType);
    }
  }

  return message;
};

const encodeChannelRemoveMessage = (payload: ChannelRemoveMessage): Uint8Array => {
  const writer = new ProtobufWriter();
  writer.writeUint32(1, payload.channelId);
  return writer.finish();
};

const decodeChannelStateMessage = (payload: Uint8Array): ChannelStateMessage => {
  const reader = new ProtobufReader(payload);
  const message: ChannelStateMessage = {
    links: [],
    linksAdd: [],
    linksRemove: []
  };

  while (!reader.eof) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1:
        message.channelId = reader.readUint32("channel_id");
        break;
      case 2:
        message.parent = reader.readUint32("parent");
        break;
      case 3:
        message.name = reader.readString();
        break;
      case 4:
        if (!reader.readPackedUint32(message.links ?? [], wireType)) {
          reader.skipField(wireType);
        }
        break;
      case 5:
        message.description = reader.readString();
        break;
      case 6:
        if (!reader.readPackedUint32(message.linksAdd ?? [], wireType)) {
          reader.skipField(wireType);
        }
        break;
      case 7:
        if (!reader.readPackedUint32(message.linksRemove ?? [], wireType)) {
          reader.skipField(wireType);
        }
        break;
      case 8:
        message.temporary = reader.readBool();
        break;
      case 9:
        message.position = reader.readInt32("position");
        break;
      case 10:
        message.descriptionHash = reader.readBytes();
        break;
      case 11:
        message.maxUsers = reader.readUint32("max_users");
        break;
      case 12:
        message.isEnterRestricted = reader.readBool();
        break;
      case 13:
        message.canEnter = reader.readBool();
        break;
      default:
        reader.skipField(wireType);
    }
  }

  return message;
};

const encodeChannelStateMessage = (payload: ChannelStateMessage): Uint8Array => {
  const writer = new ProtobufWriter();
  writer.writeUint32(1, payload.channelId);
  writer.writeUint32(2, payload.parent);
  writer.writeString(3, payload.name);
  writer.writeRepeatedUint32(4, payload.links);
  writer.writeString(5, payload.description);
  writer.writeRepeatedUint32(6, payload.linksAdd);
  writer.writeRepeatedUint32(7, payload.linksRemove);
  writer.writeBool(8, payload.temporary);
  writer.writeInt32(9, payload.position);
  writer.writeBytes(10, payload.descriptionHash);
  writer.writeUint32(11, payload.maxUsers);
  writer.writeBool(12, payload.isEnterRestricted);
  writer.writeBool(13, payload.canEnter);
  return writer.finish();
};

const decodeUserRemoveMessage = (payload: Uint8Array): UserRemoveMessage => {
  const reader = new ProtobufReader(payload);
  const message: UserRemoveMessage = {};

  while (!reader.eof) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1:
        message.session = reader.readUint32("session");
        break;
      case 2:
        message.actor = reader.readUint32("actor");
        break;
      case 3:
        message.reason = reader.readString();
        break;
      case 4:
        message.ban = reader.readBool();
        break;
      case 5:
        message.banCertificate = reader.readBool();
        break;
      case 6:
        message.banIp = reader.readBool();
        break;
      default:
        reader.skipField(wireType);
    }
  }

  return message;
};

const encodeUserRemoveMessage = (payload: UserRemoveMessage): Uint8Array => {
  const writer = new ProtobufWriter();
  writer.writeUint32(1, payload.session);
  writer.writeUint32(2, payload.actor);
  writer.writeString(3, payload.reason);
  writer.writeBool(4, payload.ban);
  writer.writeBool(5, payload.banCertificate);
  writer.writeBool(6, payload.banIp);
  return writer.finish();
};

const decodeUserStateVolumeAdjustmentMessage = (payload: Uint8Array): UserStateVolumeAdjustmentMessage => {
  const reader = new ProtobufReader(payload);
  const message: UserStateVolumeAdjustmentMessage = {};

  while (!reader.eof) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1:
        message.listeningChannel = reader.readUint32("listening_channel");
        break;
      case 2:
        message.volumeAdjustment = reader.readFloat();
        break;
      default:
        reader.skipField(wireType);
    }
  }

  return message;
};

const encodeUserStateVolumeAdjustmentMessage = (
  payload: UserStateVolumeAdjustmentMessage
): Uint8Array => {
  const writer = new ProtobufWriter();
  writer.writeUint32(1, payload.listeningChannel);
  writer.writeFloat(2, payload.volumeAdjustment);
  return writer.finish();
};

const decodeUserStateMessage = (payload: Uint8Array): UserStateMessage => {
  const reader = new ProtobufReader(payload);
  const message: UserStateMessage = {
    temporaryAccessTokens: [],
    listeningChannelAdd: [],
    listeningChannelRemove: [],
    listeningVolumeAdjustment: []
  };

  while (!reader.eof) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1:
        message.session = reader.readUint32("session");
        break;
      case 2:
        message.actor = reader.readUint32("actor");
        break;
      case 3:
        message.name = reader.readString();
        break;
      case 4:
        message.userId = reader.readUint32("user_id");
        break;
      case 5:
        message.channelId = reader.readUint32("channel_id");
        break;
      case 6:
        message.mute = reader.readBool();
        break;
      case 7:
        message.deaf = reader.readBool();
        break;
      case 8:
        message.suppress = reader.readBool();
        break;
      case 9:
        message.selfMute = reader.readBool();
        break;
      case 10:
        message.selfDeaf = reader.readBool();
        break;
      case 11:
        message.texture = reader.readBytes();
        break;
      case 12:
        message.pluginContext = reader.readBytes();
        break;
      case 13:
        message.pluginIdentity = reader.readString();
        break;
      case 14:
        message.comment = reader.readString();
        break;
      case 15:
        message.hash = reader.readString();
        break;
      case 16:
        message.commentHash = reader.readBytes();
        break;
      case 17:
        message.textureHash = reader.readBytes();
        break;
      case 18:
        message.prioritySpeaker = reader.readBool();
        break;
      case 19:
        message.recording = reader.readBool();
        break;
      case 20:
        if (!reader.readPackedString(message.temporaryAccessTokens ?? [], wireType)) {
          reader.skipField(wireType);
        }
        break;
      case 21:
        if (!reader.readPackedUint32(message.listeningChannelAdd ?? [], wireType)) {
          reader.skipField(wireType);
        }
        break;
      case 22:
        if (!reader.readPackedUint32(message.listeningChannelRemove ?? [], wireType)) {
          reader.skipField(wireType);
        }
        break;
      case 23: {
        if (wireType !== ProtobufWireType.LengthDelimited) {
          reader.skipField(wireType);
          break;
        }

        message.listeningVolumeAdjustment?.push(
          decodeUserStateVolumeAdjustmentMessage(reader.readBytes())
        );
        break;
      }
      default:
        reader.skipField(wireType);
    }
  }

  return message;
};

const encodeUserStateMessage = (payload: UserStateMessage): Uint8Array => {
  const writer = new ProtobufWriter();
  writer.writeUint32(1, payload.session);
  writer.writeUint32(2, payload.actor);
  writer.writeString(3, payload.name);
  writer.writeUint32(4, payload.userId);
  writer.writeUint32(5, payload.channelId);
  writer.writeBool(6, payload.mute);
  writer.writeBool(7, payload.deaf);
  writer.writeBool(8, payload.suppress);
  writer.writeBool(9, payload.selfMute);
  writer.writeBool(10, payload.selfDeaf);
  writer.writeBytes(11, payload.texture);
  writer.writeBytes(12, payload.pluginContext);
  writer.writeString(13, payload.pluginIdentity);
  writer.writeString(14, payload.comment);
  writer.writeString(15, payload.hash);
  writer.writeBytes(16, payload.commentHash);
  writer.writeBytes(17, payload.textureHash);
  writer.writeBool(18, payload.prioritySpeaker);
  writer.writeBool(19, payload.recording);
  writer.writeRepeatedString(20, payload.temporaryAccessTokens);
  writer.writeRepeatedUint32(21, payload.listeningChannelAdd);
  writer.writeRepeatedUint32(22, payload.listeningChannelRemove);
  for (const adjustment of payload.listeningVolumeAdjustment ?? []) {
    writer.writeMessage(23, encodeUserStateVolumeAdjustmentMessage(adjustment));
  }
  return writer.finish();
};

const decodeTextMessage = (payload: Uint8Array): TextMessage => {
  const reader = new ProtobufReader(payload);
  const message: TextMessage = {
    sessions: [],
    channelIds: [],
    treeIds: []
  };

  while (!reader.eof) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1:
        message.actor = reader.readUint32("actor");
        break;
      case 2:
        if (!reader.readPackedUint32(message.sessions ?? [], wireType)) {
          reader.skipField(wireType);
        }
        break;
      case 3:
        if (!reader.readPackedUint32(message.channelIds ?? [], wireType)) {
          reader.skipField(wireType);
        }
        break;
      case 4:
        if (!reader.readPackedUint32(message.treeIds ?? [], wireType)) {
          reader.skipField(wireType);
        }
        break;
      case 5:
        message.message = reader.readString();
        break;
      default:
        reader.skipField(wireType);
    }
  }

  return message;
};

const encodeTextMessage = (payload: TextMessage): Uint8Array => {
  const writer = new ProtobufWriter();
  writer.writeUint32(1, payload.actor);
  writer.writeRepeatedUint32(2, payload.sessions);
  writer.writeRepeatedUint32(3, payload.channelIds);
  writer.writeRepeatedUint32(4, payload.treeIds);
  writer.writeString(5, payload.message);
  return writer.finish();
};

const decodeCryptSetupMessage = (payload: Uint8Array): CryptSetupMessage => {
  const reader = new ProtobufReader(payload);
  const message: CryptSetupMessage = {};

  while (!reader.eof) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1:
        message.key = reader.readBytes();
        break;
      case 2:
        message.clientNonce = reader.readBytes();
        break;
      case 3:
        message.serverNonce = reader.readBytes();
        break;
      default:
        reader.skipField(wireType);
    }
  }

  return message;
};

const encodeCryptSetupMessage = (payload: CryptSetupMessage): Uint8Array => {
  const writer = new ProtobufWriter();
  writer.writeBytes(1, payload.key);
  writer.writeBytes(2, payload.clientNonce);
  writer.writeBytes(3, payload.serverNonce);
  return writer.finish();
};

const decodePermissionQueryMessage = (payload: Uint8Array): PermissionQueryMessage => {
  const reader = new ProtobufReader(payload);
  const message: PermissionQueryMessage = {};

  while (!reader.eof) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1:
        message.channelId = reader.readUint32("channel_id");
        break;
      case 2:
        message.permissions = reader.readUint32("permissions");
        break;
      case 3:
        message.flush = reader.readBool();
        break;
      default:
        reader.skipField(wireType);
    }
  }

  return message;
};

const encodePermissionQueryMessage = (payload: PermissionQueryMessage): Uint8Array => {
  const writer = new ProtobufWriter();
  writer.writeUint32(1, payload.channelId);
  writer.writeUint32(2, payload.permissions);
  writer.writeBool(3, payload.flush);
  return writer.finish();
};

const decodeCodecVersionMessage = (payload: Uint8Array): CodecVersionMessage => {
  const reader = new ProtobufReader(payload);
  const message: CodecVersionMessage = {};

  while (!reader.eof) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1:
        message.alpha = reader.readInt32("alpha");
        break;
      case 2:
        message.beta = reader.readInt32("beta");
        break;
      case 3:
        message.preferAlpha = reader.readBool();
        break;
      case 4:
        message.opus = reader.readBool();
        break;
      default:
        reader.skipField(wireType);
    }
  }

  return message;
};

const encodeCodecVersionMessage = (payload: CodecVersionMessage): Uint8Array => {
  const writer = new ProtobufWriter();
  writer.writeInt32(1, payload.alpha);
  writer.writeInt32(2, payload.beta);
  writer.writeBool(3, payload.preferAlpha);
  writer.writeBool(4, payload.opus);
  return writer.finish();
};

const decodeServerConfigMessage = (payload: Uint8Array): ServerConfigMessage => {
  const reader = new ProtobufReader(payload);
  const message: ServerConfigMessage = {};

  while (!reader.eof) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1:
        message.maxBandwidth = reader.readUint32("max_bandwidth");
        break;
      case 2:
        message.welcomeText = reader.readString();
        break;
      case 3:
        message.allowHtml = reader.readBool();
        break;
      case 4:
        message.messageLength = reader.readUint32("message_length");
        break;
      case 5:
        message.imageMessageLength = reader.readUint32("image_message_length");
        break;
      case 6:
        message.maxUsers = reader.readUint32("max_users");
        break;
      case 7:
        message.recordingAllowed = reader.readBool();
        break;
      default:
        reader.skipField(wireType);
    }
  }

  return message;
};

const encodeServerConfigMessage = (payload: ServerConfigMessage): Uint8Array => {
  const writer = new ProtobufWriter();
  writer.writeUint32(1, payload.maxBandwidth);
  writer.writeString(2, payload.welcomeText);
  writer.writeBool(3, payload.allowHtml);
  writer.writeUint32(4, payload.messageLength);
  writer.writeUint32(5, payload.imageMessageLength);
  writer.writeUint32(6, payload.maxUsers);
  writer.writeBool(7, payload.recordingAllowed);
  return writer.finish();
};

export const decodeControlMessage = (message: ProtobufControlMessage): SupportedControlMessage => {
  try {
    switch (message.type) {
      case TCPMessageType.Version:
        return { type: TCPMessageType.Version, payload: decodeVersionMessage(message.payload) };
      case TCPMessageType.Authenticate:
        return { type: TCPMessageType.Authenticate, payload: decodeAuthenticateMessage(message.payload) };
      case TCPMessageType.Ping:
        return { type: TCPMessageType.Ping, payload: decodePingMessage(message.payload) };
      case TCPMessageType.Reject:
        return { type: TCPMessageType.Reject, payload: decodeRejectMessage(message.payload) };
      case TCPMessageType.ServerSync:
        return { type: TCPMessageType.ServerSync, payload: decodeServerSyncMessage(message.payload) };
      case TCPMessageType.ChannelRemove:
        return { type: TCPMessageType.ChannelRemove, payload: decodeChannelRemoveMessage(message.payload) };
      case TCPMessageType.ChannelState:
        return { type: TCPMessageType.ChannelState, payload: decodeChannelStateMessage(message.payload) };
      case TCPMessageType.UserRemove:
        return { type: TCPMessageType.UserRemove, payload: decodeUserRemoveMessage(message.payload) };
      case TCPMessageType.UserState:
        return { type: TCPMessageType.UserState, payload: decodeUserStateMessage(message.payload) };
      case TCPMessageType.TextMessage:
        return { type: TCPMessageType.TextMessage, payload: decodeTextMessage(message.payload) };
      case TCPMessageType.CryptSetup:
        return { type: TCPMessageType.CryptSetup, payload: decodeCryptSetupMessage(message.payload) };
      case TCPMessageType.PermissionQuery:
        return { type: TCPMessageType.PermissionQuery, payload: decodePermissionQueryMessage(message.payload) };
      case TCPMessageType.CodecVersion:
        return { type: TCPMessageType.CodecVersion, payload: decodeCodecVersionMessage(message.payload) };
      case TCPMessageType.ServerConfig:
        return { type: TCPMessageType.ServerConfig, payload: decodeServerConfigMessage(message.payload) };
      default:
        throw new UnsupportedControlMessageTypeError(message.type);
    }
  } catch (error) {
    if (error instanceof UnsupportedControlMessageTypeError) {
      throw error;
    }

    if (error instanceof ProtobufWireError) {
      throw error;
    }

    throw new ProtobufWireError(
      error instanceof Error ? error.message : "Failed to decode the control message payload."
    );
  }
};

export const encodeControlMessage = (message: SupportedControlMessage): ProtobufControlMessage => {
  switch (message.type) {
    case TCPMessageType.Version:
      return { type: message.type, payload: encodeVersionMessage(message.payload) };
    case TCPMessageType.Authenticate:
      return { type: message.type, payload: encodeAuthenticateMessage(message.payload) };
    case TCPMessageType.Ping:
      return { type: message.type, payload: encodePingMessage(message.payload) };
    case TCPMessageType.Reject:
      return { type: message.type, payload: encodeRejectMessage(message.payload) };
    case TCPMessageType.ServerSync:
      return { type: message.type, payload: encodeServerSyncMessage(message.payload) };
    case TCPMessageType.ChannelRemove:
      return { type: message.type, payload: encodeChannelRemoveMessage(message.payload) };
    case TCPMessageType.ChannelState:
      return { type: message.type, payload: encodeChannelStateMessage(message.payload) };
    case TCPMessageType.UserRemove:
      return { type: message.type, payload: encodeUserRemoveMessage(message.payload) };
    case TCPMessageType.UserState:
      return { type: message.type, payload: encodeUserStateMessage(message.payload) };
    case TCPMessageType.TextMessage:
      return { type: message.type, payload: encodeTextMessage(message.payload) };
    case TCPMessageType.CryptSetup:
      return { type: message.type, payload: encodeCryptSetupMessage(message.payload) };
    case TCPMessageType.PermissionQuery:
      return { type: message.type, payload: encodePermissionQueryMessage(message.payload) };
    case TCPMessageType.CodecVersion:
      return { type: message.type, payload: encodeCodecVersionMessage(message.payload) };
    case TCPMessageType.ServerConfig:
      return { type: message.type, payload: encodeServerConfigMessage(message.payload) };
    default:
      throw new UnsupportedControlMessageTypeError(message.type);
  }
};
