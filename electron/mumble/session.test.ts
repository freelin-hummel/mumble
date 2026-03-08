import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server, type Socket } from "node:net";
import test from "node:test";
import { AppClientStore } from "../appClientState.js";
import { TCPControlChannel } from "./control-channel.js";
import { ProtobufFramer } from "./framer.js";
import { decodeControlMessage, encodeControlMessage } from "./messages.js";
import { MumbleControlSession } from "./session.js";
import { TCPMessageType } from "./types.js";

const listen = async (
  onConnection: (socket: Socket) => void
): Promise<{ server: Server; port: number }> => {
  const server = createServer(onConnection);

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve the test server address.");
  }

  return {
    server,
    port: address.port
  };
};

const closeServer = async (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

const waitFor = async (predicate: () => boolean, timeoutMs = 2_000): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for the session state to update.");
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }
};

test("MumbleControlSession exchanges auth and applies bootstrap control messages over TCP", async () => {
  const receivedByServer: ReturnType<typeof decodeControlMessage>[] = [];
  const serverFramer = new ProtobufFramer();
  const responseFramer = new ProtobufFramer();
  const now = new Date("2026-03-08T05:00:00.000Z");

  const { server, port } = await listen((socket) => {
    socket.on("data", (chunk) => {
      for (const message of serverFramer.push(chunk)) {
        const decodedMessage = decodeControlMessage(message);
        receivedByServer.push(decodedMessage);

        if (decodedMessage.type !== TCPMessageType.Authenticate) {
          continue;
        }

        const frames = [
          encodeControlMessage({
            type: TCPMessageType.ChannelState,
            payload: {
              channelId: 0,
              name: "Root",
              position: 0,
              canEnter: true
            }
          }),
          encodeControlMessage({
            type: TCPMessageType.ChannelState,
            payload: {
              channelId: 1,
              parent: 0,
              name: "Squad",
              position: 1,
              canEnter: true
            }
          }),
          encodeControlMessage({
            type: TCPMessageType.UserState,
            payload: {
              session: 7,
              name: "Scout",
              channelId: 1
            }
          }),
          encodeControlMessage({
            type: TCPMessageType.UserState,
            payload: {
              session: 8,
              name: "Guest",
              channelId: 0
            }
          }),
          encodeControlMessage({
            type: TCPMessageType.ServerSync,
            payload: {
              session: 7,
              maxBandwidth: 72_000,
              welcomeText: "Welcome",
              permissions: 0x0fn
            }
          }),
          encodeControlMessage({
            type: TCPMessageType.PermissionQuery,
            payload: {
              channelId: 1,
              permissions: 0x2f,
              flush: true
            }
          }),
          encodeControlMessage({
            type: TCPMessageType.TextMessage,
            payload: {
              actor: 8,
              channelIds: [1],
              message: "Briefing starts now."
            }
          }),
          encodeControlMessage({
            type: TCPMessageType.Ping,
            payload: {
              tcpPackets: 100,
              lost: 3,
              tcpPingAvg: 41.26,
              tcpPingVar: 7.21
            }
          }),
          encodeControlMessage({
            type: TCPMessageType.ServerConfig,
            payload: {
              allowHtml: false,
              maxUsers: 20,
              recordingAllowed: true
            }
          }),
          encodeControlMessage({
            type: TCPMessageType.CodecVersion,
            payload: {
              alpha: 0,
              beta: 0,
              preferAlpha: true,
              opus: true
            }
          }),
          encodeControlMessage({
            type: TCPMessageType.CryptSetup,
            payload: {
              key: Uint8Array.from([1, 2, 3]),
              clientNonce: Uint8Array.from([4]),
              serverNonce: Uint8Array.from([5])
            }
          })
        ];

        for (const frame of frames) {
          socket.write(responseFramer.encode(frame));
        }
      }
    });
  });

  const store = new AppClientStore({
    waitForConnection: async () => {}
  });
  const channel = new TCPControlChannel();
  const session = new MumbleControlSession({
    channel,
    now: () => now,
    onLiveSession: (liveSession) => {
      store.syncLiveSession(liveSession);
    }
  });

  try {
    await store.connect({
      serverAddress: `127.0.0.1:${port}`,
      nickname: "Scout"
    });
    await channel.connect({ host: "127.0.0.1", port });

    await session.sendVersion({
      versionV1: 1,
      release: "mumble-electron",
      os: "linux",
      osVersion: "test"
    });
    await session.sendAuthenticate({
      username: "Scout",
      password: "secret",
      opus: true
    });

    await waitFor(() => (
      store.getState().messages.length === 1
        && session.getState().voice.cryptSetup !== null
        && session.getState().selfSessionId === "7"
    ));

    assert.equal(receivedByServer.length, 2);
    assert.deepEqual(receivedByServer[0], {
      type: TCPMessageType.Version,
      payload: {
        versionV1: 1,
        release: "mumble-electron",
        os: "linux",
        osVersion: "test"
      }
    });
    assert.deepEqual(receivedByServer[1], {
      type: TCPMessageType.Authenticate,
      payload: {
        username: "Scout",
        password: "secret",
        tokens: [],
        celtVersions: [],
        opus: true
      }
    });

    const state = store.getState();
    assert.equal(state.activeChannelId, "1");
    assert.deepEqual(state.channels.map((entry) => ({
      id: entry.id,
      parentId: entry.parentId,
      depth: entry.depth,
      permissions: {
        enter: entry.permissions.enter,
        speak: entry.permissions.speak,
        move: entry.permissions.move,
        write: entry.permissions.write
      },
      participantIds: entry.participantIds
    })), [
      {
        id: "0",
        parentId: null,
        depth: 0,
        permissions: {
          enter: true,
          speak: true,
          move: false,
          write: true
        },
        participantIds: ["8"]
      },
      {
        id: "1",
        parentId: "0",
        depth: 1,
        permissions: {
          enter: true,
          speak: true,
          move: true,
          write: true
        },
        participantIds: ["7"]
      }
    ]);
    assert.deepEqual(state.participants, [
      {
        id: "8",
        name: "Guest",
        channelId: "0",
        status: "idle",
        isMuted: undefined,
        isDeafened: undefined,
        isSelfMuted: undefined,
        isSelfDeafened: undefined,
        isSuppressed: undefined,
        isSelf: undefined
      },
      {
        id: "7",
        name: "Scout",
        channelId: "1",
        status: "idle",
        isMuted: undefined,
        isDeafened: undefined,
        isSelfMuted: undefined,
        isSelfDeafened: undefined,
        isSuppressed: undefined,
        isSelf: true
      }
    ]);
    assert.deepEqual(state.messages, [
      {
        id: "mumble-control-1",
        author: "Guest",
        body: "Briefing starts now.",
        channelId: "1",
        sentAt: now.toISOString(),
        isSelf: undefined
      }
    ]);
    assert.deepEqual(state.telemetry, {
      latencyMs: 41.3,
      jitterMs: 7.2,
      packetLoss: 3
    });

    const sessionState = session.getState();
    assert.equal(sessionState.selfSessionId, "7");
    assert.deepEqual(sessionState.server, {
      maxBandwidth: 72_000,
      welcomeText: "Welcome",
      rootPermissions: 15n,
      allowHtml: false,
      messageLength: null,
      imageMessageLength: null,
      maxUsers: 20,
      recordingAllowed: true
    });
    assert.deepEqual(sessionState.voice, {
      cryptSetup: {
        key: Uint8Array.from([1, 2, 3]),
        clientNonce: Uint8Array.from([4]),
        serverNonce: Uint8Array.from([5])
      },
      codecVersion: {
        alpha: 0,
        beta: 0,
        preferAlpha: true,
        opus: true
      }
    });
  } finally {
    await channel.disconnect();
    session.detach();
    await closeServer(server);
  }
});

test("MumbleControlSession removes channels and participants from follow-up control messages", () => {
  const session = new MumbleControlSession({
    now: () => new Date("2026-03-08T05:00:00.000Z")
  });

  session.processControlMessage({
    type: TCPMessageType.ChannelState,
    payload: {
      channelId: 0,
      name: "Root"
    }
  });
  session.processControlMessage({
    type: TCPMessageType.ChannelState,
    payload: {
      channelId: 1,
      parent: 0,
      name: "Ops"
    }
  });
  session.processControlMessage({
    type: TCPMessageType.UserState,
    payload: {
      session: 7,
      name: "Scout",
      channelId: 1
    }
  });
  session.processControlMessage({
    type: TCPMessageType.UserState,
    payload: {
      session: 8,
      name: "Guest",
      channelId: 0
    }
  });
  session.processControlMessage({
    type: TCPMessageType.ServerSync,
    payload: {
      session: 7
    }
  });

  session.processControlMessage({
    type: TCPMessageType.UserRemove,
    payload: {
      session: 8
    }
  });
  session.processControlMessage({
    type: TCPMessageType.ChannelRemove,
    payload: {
      channelId: 1
    }
  });

  assert.deepEqual(session.buildLiveSession(), {
    channels: [
      {
        id: "0",
        name: "Root",
        parentId: null,
        position: 0,
        permissions: undefined
      }
    ],
    participants: [],
    activeChannelId: null,
    messages: [],
    telemetry: {}
  });
});

test("MumbleControlSession flushes cached channel permissions when requested by the server", () => {
  const session = new MumbleControlSession();

  session.processControlMessage({
    type: TCPMessageType.ChannelState,
    payload: {
      channelId: 0,
      name: "Root"
    }
  });
  session.processControlMessage({
    type: TCPMessageType.ChannelState,
    payload: {
      channelId: 1,
      parent: 0,
      name: "Ops"
    }
  });
  session.processControlMessage({
    type: TCPMessageType.ServerSync,
    payload: {
      permissions: 0x0fn
    }
  });
  session.processControlMessage({
    type: TCPMessageType.PermissionQuery,
    payload: {
      channelId: 1,
      permissions: 0x2f
    }
  });

  const beforeFlush = session.buildLiveSession();
  assert.equal(beforeFlush.channels.find((channel) => channel.id === "1")?.permissions?.move, true);

  session.processControlMessage({
    type: TCPMessageType.PermissionQuery,
    payload: {
      flush: true
    }
  });

  assert.deepEqual(session.buildLiveSession(), {
    channels: [
      {
        id: "0",
        name: "Root",
        parentId: null,
        position: 0,
        permissions: {
          traverse: true,
          enter: true,
          speak: true,
          muteDeafen: false,
          move: false,
          write: true
        }
      },
      {
        id: "1",
        name: "Ops",
        parentId: "0",
        position: 0,
        permissions: undefined
      }
    ],
    participants: [],
    activeChannelId: null,
    messages: [],
    telemetry: {}
  });
});
