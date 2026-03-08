import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import type { AppClientConnectRequest } from "../appClientState.js";
import { MumbleSessionManager, parseServerAddress } from "./session-manager.js";
import { TCPMessageType, type ProtobufControlMessage } from "./types.js";

const encodeVarint = (value: number | bigint) => {
  let remaining = BigInt(value);
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
    Buffer.from(encodeVarint(fieldNumber << 3)),
    Buffer.from(encodeVarint(normalizedValue))
  ]);
};

const encodeStringField = (fieldNumber: number, value: string) => {
  const encodedValue = Buffer.from(value, "utf8");
  return Buffer.concat([
    Buffer.from(encodeVarint((fieldNumber << 3) | 2)),
    Buffer.from(encodeVarint(encodedValue.length)),
    encodedValue
  ]);
};

const encodeServerSync = (session: number, welcomeText?: string) => Buffer.concat([
  encodeVarintField(1, session),
  ...(welcomeText ? [encodeStringField(3, welcomeText)] : [])
]);

const encodeChannelState = (channelId: number, name: string, parentId?: number | null, canEnter?: boolean) => Buffer.concat([
  encodeVarintField(1, channelId),
  ...(parentId === undefined || parentId === null ? [] : [encodeVarintField(2, parentId)]),
  encodeStringField(3, name),
  ...(canEnter === undefined ? [] : [encodeVarintField(13, canEnter)])
]);

const encodeUserState = ({
  session,
  name,
  channelId,
  selfMute
}: {
  session: number;
  name: string;
  channelId: number;
  selfMute?: boolean;
}) => Buffer.concat([
  encodeVarintField(1, session),
  encodeStringField(3, name),
  encodeVarintField(5, channelId),
  ...(selfMute ? [encodeVarintField(9, true)] : [])
]);

const encodeReject = (reason: string) => encodeStringField(2, reason);

class FakeControlChannel extends EventEmitter {
  public readonly sentMessages: ProtobufControlMessage[] = [];
  public readonly connections: Array<{ host: string; port: number }> = [];
  public disconnectCallCount = 0;

  constructor(
    private readonly onSend: (message: ProtobufControlMessage, channel: FakeControlChannel) => void = () => undefined
  ) {
    super();
  }

  async connect(options: { host: string; port: number }) {
    this.connections.push(options);
  }

  async disconnect() {
    this.disconnectCallCount += 1;
  }

  async send(message: ProtobufControlMessage) {
    this.sentMessages.push(message);
    this.onSend(message, this);
  }
}

const baseRequest: AppClientConnectRequest = {
  serverAddress: "voice.example.test:64738",
  nickname: "Scout"
};

test("parseServerAddress supports default ports and bracketed IPv6 hosts", () => {
  assert.deepEqual(parseServerAddress("voice.example.test"), {
    host: "voice.example.test",
    port: 64738
  });
  assert.deepEqual(parseServerAddress("[2001:db8::1]:6502"), {
    host: "2001:db8::1",
    port: 6502
  });
});

test("MumbleSessionManager bootstraps a live session from control-channel messages", async () => {
  let sawAuthenticating = false;
  const channel = new FakeControlChannel((message, activeChannel) => {
    if (message.type !== TCPMessageType.Authenticate) {
      return;
    }

    sawAuthenticating = true;
    queueMicrotask(() => {
      activeChannel.emit("message", {
        type: TCPMessageType.ChannelState,
        payload: encodeChannelState(1, "Root")
      } satisfies ProtobufControlMessage);
      activeChannel.emit("message", {
        type: TCPMessageType.ChannelState,
        payload: encodeChannelState(2, "Lobby", 1, true)
      } satisfies ProtobufControlMessage);
      activeChannel.emit("message", {
        type: TCPMessageType.UserState,
        payload: encodeUserState({
          session: 7,
          name: "Scout",
          channelId: 2
        })
      } satisfies ProtobufControlMessage);
      activeChannel.emit("message", {
        type: TCPMessageType.ServerSync,
        payload: encodeServerSync(7, "Welcome aboard")
      } satisfies ProtobufControlMessage);
    });
  });

  const manager = new MumbleSessionManager({
    channelFactory: () => channel
  });

  const session = await manager.connect(baseRequest, {
    setAuthenticating: () => {
      sawAuthenticating = true;
    }
  });

  assert.equal(sawAuthenticating, true);
  assert.deepEqual(channel.connections, [{
    host: "voice.example.test",
    port: 64738
  }]);
  assert.deepEqual(channel.sentMessages.map((message) => message.type), [
    TCPMessageType.Version,
    TCPMessageType.Authenticate
  ]);
  assert.equal(session.activeChannelId, "2");
  assert.deepEqual(session.channels.map((channelState) => channelState.name), ["Root", "Lobby"]);
  assert.deepEqual(session.participants, [{
    id: "7",
    name: "Scout",
    channelId: "2",
    status: "live",
    isSelf: true
  }]);
  assert.equal(session.messages?.[0]?.body, "Welcome aboard");
});

test("MumbleSessionManager surfaces server rejects and cleans up the failed channel", async () => {
  const channel = new FakeControlChannel((message, activeChannel) => {
    if (message.type !== TCPMessageType.Authenticate) {
      return;
    }

    queueMicrotask(() => {
      activeChannel.emit("message", {
        type: TCPMessageType.Reject,
        payload: encodeReject("Nickname already in use")
      } satisfies ProtobufControlMessage);
    });
  });

  const manager = new MumbleSessionManager({
    channelFactory: () => channel,
    bootstrapTimeoutMs: 100
  });

  await assert.rejects(
    manager.connect(baseRequest, {
      setAuthenticating: () => undefined
    }),
    /Nickname already in use/
  );
  assert.equal(channel.disconnectCallCount, 1);
});

test("MumbleSessionManager reports unexpected disconnects after bootstrap", async () => {
  let disconnectReason: string | null = null;
  const channel = new FakeControlChannel((message, activeChannel) => {
    if (message.type !== TCPMessageType.Authenticate) {
      return;
    }

    queueMicrotask(() => {
      activeChannel.emit("message", {
        type: TCPMessageType.ChannelState,
        payload: encodeChannelState(1, "Root")
      } satisfies ProtobufControlMessage);
      activeChannel.emit("message", {
        type: TCPMessageType.UserState,
        payload: encodeUserState({
          session: 7,
          name: "Scout",
          channelId: 1,
          selfMute: true
        })
      } satisfies ProtobufControlMessage);
      activeChannel.emit("message", {
        type: TCPMessageType.ServerSync,
        payload: encodeServerSync(7)
      } satisfies ProtobufControlMessage);
    });
  });

  const manager = new MumbleSessionManager({
    channelFactory: () => channel,
    onDisconnected: (reason) => {
      disconnectReason = reason;
    }
  });

  const session = await manager.connect(baseRequest, {
    setAuthenticating: () => undefined
  });
  assert.equal(session.participants[0]?.status, "muted");

  channel.emit("error", new Error("Socket hang up"));
  channel.emit("close", true);

  assert.equal(disconnectReason, "Socket hang up");
});
