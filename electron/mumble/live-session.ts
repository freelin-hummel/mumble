import {
  type AppClientChannelPermissions,
  AppClientStore,
  type AppClientParticipantPatch
} from "../appClientState.js";
import { TCPMessageType, type ProtobufControlMessage } from "./types.js";

const WRITE_PERMISSION = 0x1;
const TRAVERSE_PERMISSION = 0x2;
const ENTER_PERMISSION = 0x4;
const SPEAK_PERMISSION = 0x8;
const MUTE_DEAFEN_PERMISSION = 0x10;
const MOVE_PERMISSION = 0x20;

type DecodedServerSyncMessage = {
  type: "serverSync";
  sessionId: string | null;
  permissions: number | null;
};

type DecodedChannelStateMessage = {
  type: "channelState";
  channelId: string | null;
  parentId?: string | null;
  name?: string;
  position?: number;
  canEnter?: boolean;
};

type DecodedChannelRemoveMessage = {
  type: "channelRemove";
  channelId: string | null;
};

type DecodedUserStateMessage = {
  type: "userState";
  sessionId: string | null;
  name?: string;
  channelId?: string;
  isMuted?: boolean;
  isDeafened?: boolean;
  isSelfMuted?: boolean;
  isSelfDeafened?: boolean;
  isSuppressed?: boolean;
};

type DecodedUserRemoveMessage = {
  type: "userRemove";
  sessionId: string | null;
};

type DecodedPermissionQueryMessage = {
  type: "permissionQuery";
  channelId: string | null;
  permissions: number | null;
  flush: boolean;
};

export type DecodedSessionControlMessage =
  | DecodedServerSyncMessage
  | DecodedChannelStateMessage
  | DecodedChannelRemoveMessage
  | DecodedUserStateMessage
  | DecodedUserRemoveMessage
  | DecodedPermissionQueryMessage;

type ProtobufField = {
  fieldNumber: number;
  wireType: number;
  value: bigint | Uint8Array;
};

const normalizeMessageId = (value: bigint | null | undefined) => {
  if (value === null || value === undefined) {
    return null;
  }

  return value.toString();
};

const readVarint = (payload: Uint8Array, offset: number) => {
  let value = 0n;
  let shift = 0n;
  let cursor = offset;

  while (cursor < payload.length) {
    const byte = payload[cursor] ?? 0;
    value |= BigInt(byte & 0x7f) << shift;
    cursor += 1;

    if ((byte & 0x80) === 0) {
      return {
        value,
        offset: cursor
      };
    }

    shift += 7n;
  }

  throw new Error("Unexpected end of protobuf payload.");
};

const readLengthDelimited = (payload: Uint8Array, offset: number) => {
  const { value: byteLength, offset: nextOffset } = readVarint(payload, offset);
  const length = Number(byteLength);
  const endOffset = nextOffset + length;
  if (!Number.isSafeInteger(length) || endOffset > payload.length) {
    throw new Error("Invalid protobuf length-delimited field.");
  }

  return {
    value: payload.subarray(nextOffset, endOffset),
    offset: endOffset
  };
};

const decodeProtobufFields = (payload: Uint8Array): ProtobufField[] => {
  const fields: ProtobufField[] = [];
  let offset = 0;

  while (offset < payload.length) {
    const { value: key, offset: nextOffset } = readVarint(payload, offset);
    const fieldNumber = Number(key >> 3n);
    const wireType = Number(key & 0x7n);
    offset = nextOffset;

    if (fieldNumber < 1) {
      throw new Error("Invalid protobuf field number.");
    }

    switch (wireType) {
      case 0: {
        const decodedValue = readVarint(payload, offset);
        fields.push({
          fieldNumber,
          wireType,
          value: decodedValue.value
        });
        offset = decodedValue.offset;
        break;
      }
      case 1: {
        const endOffset = offset + 8;
        if (endOffset > payload.length) {
          throw new Error("Unexpected end of protobuf payload.");
        }

        fields.push({
          fieldNumber,
          wireType,
          value: payload.subarray(offset, endOffset)
        });
        offset = endOffset;
        break;
      }
      case 2: {
        const decodedValue = readLengthDelimited(payload, offset);
        fields.push({
          fieldNumber,
          wireType,
          value: decodedValue.value
        });
        offset = decodedValue.offset;
        break;
      }
      case 5: {
        const endOffset = offset + 4;
        if (endOffset > payload.length) {
          throw new Error("Unexpected end of protobuf payload.");
        }

        fields.push({
          fieldNumber,
          wireType,
          value: payload.subarray(offset, endOffset)
        });
        offset = endOffset;
        break;
      }
      default:
        throw new Error(`Unsupported protobuf wire type: ${wireType}`);
    }
  }

  return fields;
};

const decodeString = (value: Uint8Array) => new TextDecoder().decode(value).trim();
const decodeBool = (value: bigint) => value !== 0n;
const decodeNumber = (value: bigint) => {
  const nextValue = Number(value);
  return Number.isSafeInteger(nextValue) ? nextValue : null;
};
const permissionMaskToChannelPermissions = (permissions: number): AppClientChannelPermissions => ({
  write: (permissions & WRITE_PERMISSION) !== 0,
  traverse: (permissions & TRAVERSE_PERMISSION) !== 0,
  enter: (permissions & ENTER_PERMISSION) !== 0,
  speak: (permissions & SPEAK_PERMISSION) !== 0,
  muteDeafen: (permissions & MUTE_DEAFEN_PERMISSION) !== 0,
  move: (permissions & MOVE_PERMISSION) !== 0
});

const decodeServerSyncMessage = (payload: Uint8Array): DecodedServerSyncMessage => {
  let sessionId: string | null = null;
  let permissions: number | null = null;

  for (const field of decodeProtobufFields(payload)) {
    if (field.wireType !== 0 || typeof field.value !== "bigint") {
      continue;
    }

    if (field.fieldNumber === 1) {
      sessionId = normalizeMessageId(field.value);
    } else if (field.fieldNumber === 4) {
      permissions = decodeNumber(field.value);
    }
  }

  return {
    type: "serverSync",
    sessionId,
    permissions
  };
};

const decodeChannelStateMessage = (payload: Uint8Array): DecodedChannelStateMessage => {
  const nextMessage: DecodedChannelStateMessage = {
    type: "channelState",
    channelId: null
  };

  for (const field of decodeProtobufFields(payload)) {
    if (field.fieldNumber === 1 && field.wireType === 0 && typeof field.value === "bigint") {
      nextMessage.channelId = normalizeMessageId(field.value);
    } else if (field.fieldNumber === 2 && field.wireType === 0 && typeof field.value === "bigint") {
      nextMessage.parentId = normalizeMessageId(field.value);
    } else if (field.fieldNumber === 3 && field.wireType === 2 && field.value instanceof Uint8Array) {
      nextMessage.name = decodeString(field.value);
    } else if (field.fieldNumber === 9 && field.wireType === 0 && typeof field.value === "bigint") {
      nextMessage.position = decodeNumber(field.value) ?? undefined;
    } else if (field.fieldNumber === 13 && field.wireType === 0 && typeof field.value === "bigint") {
      nextMessage.canEnter = decodeBool(field.value);
    }
  }

  return nextMessage;
};

const decodeChannelRemoveMessage = (payload: Uint8Array): DecodedChannelRemoveMessage => {
  for (const field of decodeProtobufFields(payload)) {
    if (field.fieldNumber === 1 && field.wireType === 0 && typeof field.value === "bigint") {
      return {
        type: "channelRemove",
        channelId: normalizeMessageId(field.value)
      };
    }
  }

  return {
    type: "channelRemove",
    channelId: null
  };
};

const decodeUserStateMessage = (payload: Uint8Array): DecodedUserStateMessage => {
  const nextMessage: DecodedUserStateMessage = {
    type: "userState",
    sessionId: null
  };

  for (const field of decodeProtobufFields(payload)) {
    if (field.fieldNumber === 1 && field.wireType === 0 && typeof field.value === "bigint") {
      nextMessage.sessionId = normalizeMessageId(field.value);
    } else if (field.fieldNumber === 3 && field.wireType === 2 && field.value instanceof Uint8Array) {
      nextMessage.name = decodeString(field.value);
    } else if (field.fieldNumber === 5 && field.wireType === 0 && typeof field.value === "bigint") {
      const channelId = normalizeMessageId(field.value);
      if (channelId) {
        nextMessage.channelId = channelId;
      }
    } else if (field.fieldNumber === 6 && field.wireType === 0 && typeof field.value === "bigint") {
      nextMessage.isMuted = decodeBool(field.value);
    } else if (field.fieldNumber === 7 && field.wireType === 0 && typeof field.value === "bigint") {
      nextMessage.isDeafened = decodeBool(field.value);
    } else if (field.fieldNumber === 8 && field.wireType === 0 && typeof field.value === "bigint") {
      nextMessage.isSuppressed = decodeBool(field.value);
    } else if (field.fieldNumber === 9 && field.wireType === 0 && typeof field.value === "bigint") {
      nextMessage.isSelfMuted = decodeBool(field.value);
    } else if (field.fieldNumber === 10 && field.wireType === 0 && typeof field.value === "bigint") {
      nextMessage.isSelfDeafened = decodeBool(field.value);
    }
  }

  return nextMessage;
};

const decodeUserRemoveMessage = (payload: Uint8Array): DecodedUserRemoveMessage => {
  for (const field of decodeProtobufFields(payload)) {
    if (field.fieldNumber === 1 && field.wireType === 0 && typeof field.value === "bigint") {
      return {
        type: "userRemove",
        sessionId: normalizeMessageId(field.value)
      };
    }
  }

  return {
    type: "userRemove",
    sessionId: null
  };
};

const decodePermissionQueryMessage = (payload: Uint8Array): DecodedPermissionQueryMessage => {
  const nextMessage: DecodedPermissionQueryMessage = {
    type: "permissionQuery",
    channelId: null,
    permissions: null,
    flush: false
  };

  for (const field of decodeProtobufFields(payload)) {
    if (field.fieldNumber === 1 && field.wireType === 0 && typeof field.value === "bigint") {
      nextMessage.channelId = normalizeMessageId(field.value);
    } else if (field.fieldNumber === 2 && field.wireType === 0 && typeof field.value === "bigint") {
      nextMessage.permissions = decodeNumber(field.value);
    } else if (field.fieldNumber === 3 && field.wireType === 0 && typeof field.value === "bigint") {
      nextMessage.flush = decodeBool(field.value);
    }
  }

  return nextMessage;
};

export const decodeSessionControlMessage = (
  message: ProtobufControlMessage
): DecodedSessionControlMessage | null => {
  switch (message.type) {
    case TCPMessageType.ServerSync:
      return decodeServerSyncMessage(message.payload);
    case TCPMessageType.ChannelState:
      return decodeChannelStateMessage(message.payload);
    case TCPMessageType.ChannelRemove:
      return decodeChannelRemoveMessage(message.payload);
    case TCPMessageType.UserState:
      return decodeUserStateMessage(message.payload);
    case TCPMessageType.UserRemove:
      return decodeUserRemoveMessage(message.payload);
    case TCPMessageType.PermissionQuery:
      return decodePermissionQueryMessage(message.payload);
    default:
      return null;
  }
};

export class MumbleControlSessionHydrator {
  #selfSessionId: string | null = null;
  #pendingRootPermissions: number | null = null;

  public applyMessage(store: AppClientStore, message: ProtobufControlMessage) {
    const decodedMessage = decodeSessionControlMessage(message);
    if (!decodedMessage) {
      return store.getState();
    }

    switch (decodedMessage.type) {
      case "serverSync": {
        this.#selfSessionId = decodedMessage.sessionId;
        this.#pendingRootPermissions = decodedMessage.permissions;
        this.#applyPendingRootPermissions(store);
        return store.getState();
      }
      case "channelState": {
        if (!decodedMessage.channelId) {
          return store.getState();
        }

        const currentChannel = store.getState().channels.find((channel) => channel.id === decodedMessage.channelId);
        store.upsertChannel({
          id: decodedMessage.channelId,
          name: decodedMessage.name ?? currentChannel?.name ?? decodedMessage.channelId,
          parentId: decodedMessage.parentId !== undefined ? decodedMessage.parentId : currentChannel?.parentId,
          position: decodedMessage.position ?? currentChannel?.position,
          permissions: decodedMessage.canEnter === undefined
            ? undefined
            : {
              ...currentChannel?.permissions,
              enter: decodedMessage.canEnter
            }
        });
        this.#applyPendingRootPermissions(store);
        return store.getState();
      }
      case "channelRemove":
        return decodedMessage.channelId ? store.removeChannel(decodedMessage.channelId) : store.getState();
      case "userState": {
        if (!decodedMessage.sessionId) {
          return store.getState();
        }

        const nextParticipant: AppClientParticipantPatch = {
          id: decodedMessage.sessionId,
          name: decodedMessage.name,
          channelId: decodedMessage.channelId,
          isSelf: decodedMessage.sessionId === this.#selfSessionId ? true : undefined,
          isMuted: decodedMessage.isMuted,
          isDeafened: decodedMessage.isDeafened,
          isSelfMuted: decodedMessage.isSelfMuted,
          isSelfDeafened: decodedMessage.isSelfDeafened,
          isSuppressed: decodedMessage.isSuppressed
        };

        return store.upsertParticipant(nextParticipant);
      }
      case "userRemove":
        return decodedMessage.sessionId ? store.removeParticipant(decodedMessage.sessionId) : store.getState();
      case "permissionQuery":
        if (decodedMessage.flush) {
          for (const channel of store.getState().channels) {
            store.updateChannelPermissions(channel.id, permissionMaskToChannelPermissions(0));
          }
        }

        if (decodedMessage.channelId && decodedMessage.permissions !== null) {
          return store.updateChannelPermissions(
            decodedMessage.channelId,
            permissionMaskToChannelPermissions(decodedMessage.permissions)
          );
        }

        return store.getState();
      default:
        return store.getState();
    }
  }

  #applyPendingRootPermissions(store: AppClientStore) {
    if (this.#pendingRootPermissions === null) {
      return;
    }

    const rootChannel = store.getState().channels.find((channel) => channel.parentId === null);
    if (!rootChannel) {
      return;
    }

    store.updateChannelPermissions(rootChannel.id, permissionMaskToChannelPermissions(this.#pendingRootPermissions));
    this.#pendingRootPermissions = null;
  }
}
