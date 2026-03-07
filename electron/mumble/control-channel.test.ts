import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server, type Socket } from "node:net";
import test from "node:test";
import { TCPControlChannel } from "./control-channel.js";
import { ProtobufFramer } from "./framer.js";
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

test("TCPControlChannel sends and receives framed protobuf control messages", async () => {
  const receivedByServer: Array<{ type: TCPMessageType; payload: Buffer }> = [];
  const serverFramer = new ProtobufFramer();
  const responseFramer = new ProtobufFramer();

  const { server, port } = await listen((socket) => {
    socket.on("data", (chunk) => {
      receivedByServer.push(
        ...serverFramer.push(chunk).map((message) => ({
          type: message.type,
          payload: Buffer.from(message.payload)
        }))
      );

      if (receivedByServer.length === 1) {
        const responseFrame = responseFramer.encode({
          type: TCPMessageType.ServerSync,
          payload: Buffer.from([0x08, 0x07])
        });

        socket.write(responseFrame.subarray(0, 3));
        socket.write(responseFrame.subarray(3));
      }
    });
  });

  const channel = new TCPControlChannel();

  try {
    await channel.connect({ host: "127.0.0.1", port });

    const messagePromise = once(channel, "message");

    await channel.send({
      type: TCPMessageType.Version,
      payload: Buffer.from([0x08, 0x01])
    });

    const [message] = await messagePromise;

    assert.deepEqual(receivedByServer, [
      {
        type: TCPMessageType.Version,
        payload: Buffer.from([0x08, 0x01])
      }
    ]);
    assert.deepEqual(message, {
      type: TCPMessageType.ServerSync,
      payload: Buffer.from([0x08, 0x07])
    });
  } finally {
    await channel.disconnect();
    await closeServer(server);
  }
});

test("TCPControlChannel closes the socket when it receives an invalid frame", async () => {
  const { server, port } = await listen((socket) => {
    const invalidFrame = Buffer.alloc(6);
    invalidFrame.writeUInt16BE(999, 0);
    invalidFrame.writeUInt32BE(0, 2);
    socket.write(invalidFrame);
  });

  const channel = new TCPControlChannel();

  try {
    await channel.connect({ host: "127.0.0.1", port });

    const [error] = await once(channel, "error");
    const [hadError] = await once(channel, "close");

    assert.match((error as Error).message, /Unknown TCP message type/);
    assert.equal(hadError, true);
    assert.equal(channel.connected, false);
  } finally {
    await closeServer(server);
  }
});
