import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeControlMessage,
  encodeControlMessage,
  UnsupportedControlMessageTypeError
} from "./messages.js";
import { TCPMessageType } from "./types.js";

test("control-message codec encodes Authenticate payloads with protobuf-compatible wire bytes", () => {
  const message = encodeControlMessage({
    type: TCPMessageType.Authenticate,
    payload: {
      username: "Scout",
      password: "secret",
      opus: true,
      clientType: 1
    }
  });

  assert.equal(message.type, TCPMessageType.Authenticate);
  assert.deepEqual(Buffer.from(message.payload), Buffer.from([
    0x0a, 0x05, 0x53, 0x63, 0x6f, 0x75, 0x74,
    0x12, 0x06, 0x73, 0x65, 0x63, 0x72, 0x65, 0x74,
    0x28, 0x01,
    0x30, 0x01
  ]));
  assert.deepEqual(decodeControlMessage(message), {
    type: TCPMessageType.Authenticate,
    payload: {
      username: "Scout",
      password: "secret",
      tokens: [],
      celtVersions: [],
      opus: true,
      clientType: 1
    }
  });
});

test("control-message codec decodes bootstrap-critical server messages", () => {
  const serverSync = decodeControlMessage({
    type: TCPMessageType.ServerSync,
    payload: Uint8Array.from([
      0x08, 0x07,
      0x10, 0x40,
      0x1a, 0x02, 0x48, 0x69,
      0x20, 0x0f
    ])
  });
  const channelState = decodeControlMessage({
    type: TCPMessageType.ChannelState,
    payload: Uint8Array.from([
      0x08, 0x01,
      0x10, 0x00,
      0x1a, 0x04, 0x52, 0x6f, 0x6f, 0x74,
      0x48, 0x02,
      0x68, 0x01
    ])
  });
  const userState = decodeControlMessage({
    type: TCPMessageType.UserState,
    payload: Uint8Array.from([
      0x08, 0x07,
      0x1a, 0x05, 0x53, 0x63, 0x6f, 0x75, 0x74,
      0x28, 0x01,
      0x48, 0x01
    ])
  });
  const textMessage = decodeControlMessage({
    type: TCPMessageType.TextMessage,
    payload: Uint8Array.from([
      0x08, 0x07,
      0x18, 0x01,
      0x2a, 0x05, 0x48, 0x65, 0x6c, 0x6c, 0x6f
    ])
  });
  const cryptSetup = decodeControlMessage({
    type: TCPMessageType.CryptSetup,
    payload: Uint8Array.from([
      0x0a, 0x03, 0x01, 0x02, 0x03,
      0x12, 0x01, 0x04,
      0x1a, 0x01, 0x05
    ])
  });
  const permissionQuery = decodeControlMessage({
    type: TCPMessageType.PermissionQuery,
    payload: Uint8Array.from([
      0x08, 0x01,
      0x10, 0x2f,
      0x18, 0x01
    ])
  });
  const serverConfig = decodeControlMessage({
    type: TCPMessageType.ServerConfig,
    payload: Uint8Array.from([
      0x08, 0x40,
      0x12, 0x07, 0x57, 0x65, 0x6c, 0x63, 0x6f, 0x6d, 0x65,
      0x18, 0x00,
      0x20, 0x80, 0x04,
      0x30, 0x14,
      0x38, 0x01
    ])
  });

  assert.deepEqual(serverSync, {
    type: TCPMessageType.ServerSync,
    payload: {
      session: 7,
      maxBandwidth: 64,
      welcomeText: "Hi",
      permissions: 15n
    }
  });
  assert.deepEqual(channelState, {
    type: TCPMessageType.ChannelState,
    payload: {
      channelId: 1,
      parent: 0,
      name: "Root",
      links: [],
      linksAdd: [],
      linksRemove: [],
      position: 2,
      canEnter: true
    }
  });
  assert.deepEqual(userState, {
    type: TCPMessageType.UserState,
    payload: {
      session: 7,
      name: "Scout",
      channelId: 1,
      selfMute: true,
      temporaryAccessTokens: [],
      listeningChannelAdd: [],
      listeningChannelRemove: [],
      listeningVolumeAdjustment: []
    }
  });
  assert.deepEqual(textMessage, {
    type: TCPMessageType.TextMessage,
    payload: {
      actor: 7,
      sessions: [],
      channelIds: [1],
      treeIds: [],
      message: "Hello"
    }
  });
  assert.deepEqual(cryptSetup, {
    type: TCPMessageType.CryptSetup,
    payload: {
      key: Uint8Array.from([1, 2, 3]),
      clientNonce: Uint8Array.from([4]),
      serverNonce: Uint8Array.from([5])
    }
  });
  assert.deepEqual(permissionQuery, {
    type: TCPMessageType.PermissionQuery,
    payload: {
      channelId: 1,
      permissions: 47,
      flush: true
    }
  });
  assert.deepEqual(serverConfig, {
    type: TCPMessageType.ServerConfig,
    payload: {
      maxBandwidth: 64,
      welcomeText: "Welcome",
      allowHtml: false,
      messageLength: 512,
      maxUsers: 20,
      recordingAllowed: true
    }
  });
});

test("control-message codec rejects unsupported message types", () => {
  assert.throws(() => decodeControlMessage({
    type: TCPMessageType.UDPTunnel,
    payload: Uint8Array.of()
  }), UnsupportedControlMessageTypeError);
});
