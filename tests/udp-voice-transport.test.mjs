import assert from "node:assert/strict";
import dgram from "node:dgram";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const { UdpVoiceTransport } = await import(pathToFileURL(path.join(repoRoot, "electron/udpVoiceTransport.ts")).href);

const bindServer = async () => {
  const server = dgram.createSocket("udp4");

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.bind(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  return server;
};

const waitForMessage = (socket) =>
  new Promise((resolve) => {
    socket.once("message", (message, remoteInfo) => {
      resolve({ message, remoteInfo });
    });
  });

const closeSocket = async (socket) => {
  await new Promise((resolve) => {
    socket.close(() => resolve());
  });
};

test("UDP voice transport connects and sends packets to the configured remote endpoint", async () => {
  const server = await bindServer();
  const transport = new UdpVoiceTransport();

  try {
    const serverAddress = server.address();
    assert.notEqual(typeof serverAddress, "string");

    const status = await transport.connect({
      host: "127.0.0.1",
      port: serverAddress.port
    });

    assert.equal(status.state, "connected");
    assert.equal(status.remoteAddress, "127.0.0.1");
    assert.equal(status.remotePort, serverAddress.port);
    assert.ok(status.localPort);

    const serverMessage = waitForMessage(server);
    const bytesSent = await transport.send(new Uint8Array([1, 2, 3, 4]));
    const { message, remoteInfo } = await serverMessage;

    assert.equal(bytesSent, 4);
    assert.deepEqual([...message], [1, 2, 3, 4]);
    assert.equal(remoteInfo.port, status.localPort);
  } finally {
    await transport.disconnect();
    await closeSocket(server);
  }
});

test("UDP voice transport emits incoming packets and status updates", async () => {
  const server = await bindServer();
  const transport = new UdpVoiceTransport();
  const receivedStatuses = [];

  try {
    const serverAddress = server.address();
    assert.notEqual(typeof serverAddress, "string");

    const messagePromise = new Promise((resolve) => {
      const unsubscribe = transport.onMessage((packet) => {
        unsubscribe();
        resolve(packet);
      });
    });

    const unsubscribeStatus = transport.onStatusChange((status) => {
      receivedStatuses.push(status);
    });

    const connectedStatus = await transport.connect({
      host: "127.0.0.1",
      port: serverAddress.port
    });

    server.send(Buffer.from([9, 8, 7]), connectedStatus.localPort, connectedStatus.localAddress ?? "127.0.0.1");

    const packet = await messagePromise;
    unsubscribeStatus();

    assert.deepEqual([...packet.payload], [9, 8, 7]);
    assert.equal(packet.remotePort, serverAddress.port);
    assert.equal(packet.remoteAddress, "127.0.0.1");
    assert.equal(receivedStatuses.at(0)?.state, "connecting");
    assert.equal(receivedStatuses.some((status) => status.state === "connected"), true);
    assert.equal(receivedStatuses.some((status) => status.lastReceivedAt !== null), true);
  } finally {
    await transport.disconnect();
    await closeSocket(server);
  }
});

test("UDP voice transport validates payload size and connection state", async () => {
  const transport = new UdpVoiceTransport();

  await assert.rejects(
    () => transport.send(new Uint8Array([1])),
    /not connected/
  );

  await assert.rejects(
    () => transport.connect({ host: "127.0.0.1", port: 0 }),
    /valid remote port/
  );

  const server = await bindServer();

  try {
    const serverAddress = server.address();
    assert.notEqual(typeof serverAddress, "string");

    await transport.connect({
      host: "127.0.0.1",
      port: serverAddress.port
    });

    await assert.rejects(
      () => transport.send(new Uint8Array(2049)),
      /exceeds 2048 bytes/
    );
  } finally {
    await transport.disconnect();
    await closeSocket(server);
  }
});

test("UDP voice transport disconnect resets its status", async () => {
  const server = await bindServer();
  const transport = new UdpVoiceTransport();

  try {
    const serverAddress = server.address();
    assert.notEqual(typeof serverAddress, "string");

    await transport.connect({
      host: "127.0.0.1",
      port: serverAddress.port
    });
    await transport.send(new Uint8Array([6, 5, 4]));

    const status = await transport.disconnect();

    assert.deepEqual(status, {
      state: "disconnected",
      remoteAddress: null,
      remotePort: null,
      localAddress: null,
      localPort: null,
      lastError: null,
      lastSentAt: null,
      lastReceivedAt: null
    });
  } finally {
    await closeSocket(server);
  }
});
