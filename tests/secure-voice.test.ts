import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import {
  SecureVoiceClient,
  createSecureVoiceDemoServer,
  decryptVoicePacket,
  encryptVoicePacket
} from "../electron/secureVoice.ts";

test("authenticated clients derive session keys and exchange encrypted voice over UDP", async () => {
  const server = await createSecureVoiceDemoServer({
    users: {
      aster: "nebula-room"
    }
  });

  let client: SecureVoiceClient | null = null;

  try {
    client = await SecureVoiceClient.connect({
      host: server.address.host,
      tcpPort: server.address.tcpPort,
      username: "aster",
      password: "nebula-room"
    });

    const echoedPayload = await client.roundTripVoiceFrame(Buffer.from("voice-check", "utf8"));

    assert.equal(echoedPayload.toString("utf8"), "echo:voice-check");
    assert.equal(server.receivedVoiceFrames.at(0)?.toString("utf8"), "voice-check");
    assert.ok(server.encryptedVoiceFrames.at(0));
    assert.equal(server.encryptedVoiceFrames.at(0)?.includes(Buffer.from("voice-check", "utf8")), false);
    assert.ok(client.info.sessionId.length > 10);
  } finally {
    await client?.close();
    await server.close();
  }
});

test("authentication fails with the wrong password", async () => {
  const server = await createSecureVoiceDemoServer({
    users: {
      quinn: "correct-password"
    }
  });

  try {
    await assert.rejects(
      () => SecureVoiceClient.connect({
        host: server.address.host,
        tcpPort: server.address.tcpPort,
        username: "quinn",
        password: "wrong-password"
      }),
      /Authentication failed/
    );
  } finally {
    await server.close();
  }
});

test("voice packets detect tampering", () => {
  const key = randomBytes(32);
  const noncePrefix = randomBytes(4);
  const aad = randomBytes(16);
  const packet = encryptVoicePacket(key, noncePrefix, aad, 3n, Buffer.from("sealed payload", "utf8"));
  const tampered = Buffer.from(packet);
  tampered[tampered.length - 1] ^= 0xff;

  assert.throws(() => decryptVoicePacket(key, noncePrefix, aad, tampered));
});
