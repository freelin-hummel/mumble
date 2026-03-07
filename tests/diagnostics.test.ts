import assert from "node:assert/strict";
import test from "node:test";

import { AppClientStore } from "../electron/appClientState.js";
import { createDiagnosticsBundle, DiagnosticsLogStore } from "../electron/diagnostics.js";

const createConnectedState = async () => {
  const store = new AppClientStore({
    waitForConnection: async () => {}
  });

  await store.connect({
    serverAddress: "voice.example.test:64738",
    nickname: "Scout"
  });

  store.updateAudioSettings({
    inputDeviceId: "usb-mic",
    outputDeviceId: "usb-headset",
    inputGain: 118,
    outputGain: 92,
    selfMuted: true
  });

  return store.getState();
};

test("AppClientStore emits structured log events for connection and settings changes", async () => {
  const logEvents: Array<{ level: string; event: string; context?: Record<string, unknown> }> = [];
  const store = new AppClientStore({
    onLog: (event) => {
      logEvents.push(event);
    },
    waitForConnection: async () => {}
  });

  await store.connect({
    serverAddress: "voice.example.test:64738",
    nickname: "Scout"
  });

  store.updateAudioSettings({
    selfMuted: true,
    inputGain: 110
  });
  store.updatePreferences({
    showLatencyDetails: true
  });
  store.disconnect();

  assert.deepEqual(
    logEvents.map((entry) => entry.event),
    [
      "connection.connect.requested",
      "connection.connect.succeeded",
      "audio.settings.updated",
      "preferences.updated",
      "connection.disconnect.requested"
    ]
  );
  assert.deepEqual(logEvents[0]?.context, {
    serverAddress: "voice.example.test:64738",
    nickname: "Scout"
  });
  assert.deepEqual(logEvents[2]?.context, {
    selfMuted: true,
    inputGain: 110
  });
  assert.deepEqual(logEvents[3]?.context, {
    showLatencyDetails: true
  });
});

test("AppClientStore emits structured errors for failed connections", async () => {
  const logEvents: Array<{ level: string; event: string; context?: Record<string, unknown> }> = [];
  const store = new AppClientStore({
    onLog: (event) => {
      logEvents.push(event);
    },
    waitForConnection: async () => {}
  });

  await assert.rejects(
    store.connect({
      serverAddress: "voice.example.test:70000",
      nickname: "Scout"
    }),
    /between 1 and 65535/
  );

  assert.equal(logEvents.length, 1);
  assert.equal(logEvents[0]?.level, "error");
  assert.equal(logEvents[0]?.event, "connection.connect.failed");
  assert.match(String(logEvents[0]?.context?.error), /between 1 and 65535/);
});

test("createDiagnosticsBundle captures network, audio, and structured logs", async () => {
  const state = await createConnectedState();
  const logStore = new DiagnosticsLogStore(2);

  logStore.log("info", "session.started", { channelCount: 0 });
  logStore.log("warn", "network.jitter.detected", { jitterMs: 14 });
  logStore.log("error", "audio.device.warning", { outputDeviceId: "usb-headset" });

  const bundle = createDiagnosticsBundle({
    state: {
      ...state,
      telemetry: {
        latencyMs: 32,
        jitterMs: 14,
        packetLoss: 2
      }
    },
    logs: logStore.getEntries(),
    appVersion: "0.1.0",
    platform: "linux",
    voiceTransport: {
      state: "connected",
      remoteAddress: "voice.example.test",
      remotePort: 64738,
      localAddress: "127.0.0.1",
      localPort: 50000,
      lastError: null,
      lastSentAt: 10,
      lastReceivedAt: 11
    },
    rendererSnapshot: {
      audioRuntime: {
        inputLevel: 0.42,
        outputLevel: 0.25,
        mode: "vad-live",
        isTransmitting: true,
        meteringError: null,
        availableInputDevices: 3,
        availableOutputDevices: 2,
        outputRoutingReady: true
      }
    }
  });

  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.network.telemetry.latencyMs, 32);
  assert.equal(bundle.network.voiceTransport.state, "connected");
  assert.equal(bundle.audio.settings.inputDeviceId, "usb-mic");
  assert.equal(bundle.audio.runtime?.inputLevel, 0.42);
  assert.equal(bundle.audio.runtime?.availableOutputDevices, 2);
  assert.equal(bundle.logs.length, 2);
  assert.equal(bundle.logs[0]?.event, "network.jitter.detected");
  assert.equal(bundle.logs[1]?.event, "audio.device.warning");
});
