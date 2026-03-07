import assert from "node:assert/strict";
import test from "node:test";

import { AppClientStore } from "../electron/appClientState.js";

test("AppClientStore hydrates persisted desktop preferences", () => {
  const store = new AppClientStore({
    persistedState: {
      serverAddress: "voice.example.test:64738",
      nickname: "Scout",
      recentServers: ["voice.example.test:64738", "backup.example.test"],
      audio: {
        inputDeviceId: "usb-mic",
        outputDeviceId: "usb-headset",
        captureEnabled: false,
        selfMuted: true,
        inputGain: 120,
        outputGain: 80
      },
      preferences: {
        pushToTalk: true,
        autoReconnect: false,
        notificationsEnabled: false,
        showLatencyDetails: true
      }
    },
    waitForConnection: async () => {}
  });

  const state = store.getState();
  assert.equal(state.connection.status, "disconnected");
  assert.equal(state.connection.serverAddress, "voice.example.test:64738");
  assert.equal(state.connection.nickname, "Scout");
  assert.deepEqual(state.recentServers, ["voice.example.test:64738", "backup.example.test"]);
  assert.equal(state.audio.inputDeviceId, "usb-mic");
  assert.equal(state.audio.outputDeviceId, "usb-headset");
  assert.equal(state.preferences.showLatencyDetails, true);
});

test("AppClientStore connect preserves an empty live session until real data arrives", async () => {
  const persistedStates: unknown[] = [];
  const store = new AppClientStore({
    onPersist: (state) => {
      persistedStates.push(state);
    },
    waitForConnection: async () => {}
  });

  await store.connect({
    serverAddress: "voice.example.test:64738",
    nickname: "Scout"
  });

  const state = store.getState();
  assert.equal(state.connection.status, "connected");
  assert.equal(state.connection.nickname, "Scout");
  assert.equal(state.activeChannelId, null);
  assert.deepEqual(state.channels, []);
  assert.deepEqual(state.participants, []);
  assert.deepEqual(state.telemetry, {
    latencyMs: null,
    jitterMs: null,
    packetLoss: null
  });
  assert.deepEqual(state.recentServers, ["voice.example.test:64738"]);
  assert.equal(persistedStates.length >= 2, true);
});

test("AppClientStore rejects invalid connection input and preserves error state", async () => {
  const store = new AppClientStore({
    waitForConnection: async () => {}
  });

  await assert.rejects(
    store.connect({
      serverAddress: "voice.example.test:70000",
      nickname: "Scout"
    }),
    /between 1 and 65535/
  );

  assert.equal(store.getState().connection.status, "error");
  assert.match(store.getState().connection.error ?? "", /between 1 and 65535/);
});

test("AppClientStore accepts IPv6 hosts without mistaking them for an invalid port", async () => {
  const store = new AppClientStore({
    waitForConnection: async () => {}
  });

  await store.connect({
    serverAddress: "2001:db8::1",
    nickname: "Scout"
  });

  assert.equal(store.getState().connection.status, "connected");
  assert.equal(store.getState().connection.serverAddress, "2001:db8::1");
});
