import assert from "node:assert/strict";
import test from "node:test";

import { LoopbackVoiceTransport } from "../electron/loopbackVoiceTransport.js";
import type { UdpVoiceTransportPacket, UdpVoiceTransportStatus } from "../electron/udpVoiceTransport.js";

test("secure loopback voice transport echoes encoded payloads and reports telemetry", async () => {
  const transport = new LoopbackVoiceTransport();
  const statuses: UdpVoiceTransportStatus[] = [];

  try {
    const packetPromise = new Promise<UdpVoiceTransportPacket>((resolve) => {
      const unsubscribe = transport.onMessage((packet) => {
        unsubscribe();
        resolve(packet);
      });
    });
    const unsubscribeStatus = transport.onStatusChange((status) => {
      statuses.push(status);
    });

    const status = await transport.connect({
      username: "Scout"
    });
    const bytesSent = await transport.send(new TextEncoder().encode("voice-loopback"));
    const packet = await packetPromise;

    unsubscribeStatus();

    assert.equal(status.state, "connected");
    assert.equal(status.transportMode, "secure-loopback");
    assert.equal(status.cipherSuite, "AES-256-GCM / X25519 / HKDF-SHA256");
    assert.equal(bytesSent, "voice-loopback".length);
    assert.equal(new TextDecoder().decode(packet.payload), "voice-loopback");
    assert.equal(packet.remoteAddress, "127.0.0.1");
    assert.equal(statuses.some((entry) => entry.state === "connecting"), true);
    assert.equal(statuses.some((entry) => entry.state === "connected"), true);
    assert.equal(transport.getStatus().packetsSent, 1);
    assert.equal(transport.getStatus().packetsReceived, 1);
    assert.equal(transport.getStatus().packetLoss, 0);
    assert.equal(typeof transport.getStatus().averageRoundTripMs, "number");
  } finally {
    await transport.disconnect();
  }
});

test("secure loopback voice transport rejects sends before connect and resets to a disconnected state", async () => {
  const transport = new LoopbackVoiceTransport();

  await assert.rejects(
    () => transport.send(new Uint8Array([1, 2, 3])),
    /cannot be sent before the secure loopback session is connected/
  );

  await transport.connect({
    username: "Scout"
  });

  const status = await transport.disconnect();
  assert.deepEqual(status, {
    state: "disconnected",
    remoteAddress: null,
    remotePort: null,
    localAddress: null,
    localPort: null,
    lastError: null,
    lastSentAt: null,
    lastReceivedAt: null,
    transportMode: "secure-loopback",
    sessionId: null,
    cipherSuite: null,
    packetsSent: 0,
    packetsReceived: 0,
    packetLoss: 0,
    averageRoundTripMs: null
  });
});
