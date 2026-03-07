import assert from "node:assert/strict";
import test from "node:test";

import {
  AppClientStore,
  PERSISTED_APP_CLIENT_STATE_VERSION,
  migratePersistedAppClientState
} from "../electron/appClientState.js";

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
        pushToTalkShortcut: "KeyV",
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
  assert.equal(state.preferences.pushToTalkShortcut, "KeyV");
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

test("AppClientStore normalizes invalid push-to-talk shortcuts back to the default binding", () => {
  const store = new AppClientStore({
    persistedState: {
      preferences: {
        pushToTalk: true,
        pushToTalkShortcut: "",
        autoReconnect: true,
        notificationsEnabled: true,
        showLatencyDetails: false
      }
    },
    waitForConnection: async () => {}
  });

  assert.equal(store.getState().preferences.pushToTalkShortcut, "Space");
  assert.equal(store.updatePreferences({ pushToTalkShortcut: "m" }).preferences.pushToTalkShortcut, "KeyM");
});

test("migratePersistedAppClientState upgrades legacy desktop settings snapshots without losing values", () => {
  const migratedState = migratePersistedAppClientState({
    serverAddress: "voice.example.test:64738",
    nickname: "Scout",
    recentServers: ["voice.example.test:64738", "backup.example.test"],
    audio: {
      inputDeviceId: "usb-mic",
      outputDeviceId: "usb-headset",
      captureEnabled: false,
      selfMuted: true,
      inputGain: 121,
      outputGain: 80
    },
    preferences: {
      pushToTalk: true,
      pushToTalkShortcut: "v",
      autoReconnect: false,
      notificationsEnabled: false,
      showLatencyDetails: true
    }
  });

  assert.deepEqual(migratedState, {
    schemaVersion: PERSISTED_APP_CLIENT_STATE_VERSION,
    serverAddress: "voice.example.test:64738",
    nickname: "Scout",
    recentServers: ["voice.example.test:64738", "backup.example.test"],
    audio: {
      inputDeviceId: "usb-mic",
      outputDeviceId: "usb-headset",
      captureEnabled: false,
      selfMuted: true,
      inputGain: 121,
      outputGain: 80
    },
    preferences: {
      pushToTalk: true,
      pushToTalkShortcut: "KeyV",
      autoReconnect: false,
      notificationsEnabled: false,
      showLatencyDetails: true
    }
  });
});

test("AppClientStore persists versioned settings snapshots", () => {
  const persistedStates: unknown[] = [];
  const store = new AppClientStore({
    onPersist: (state) => {
      persistedStates.push(state);
    },
    waitForConnection: async () => {}
  });

  store.updateAudioSettings({
    inputDeviceId: "usb-mic",
    outputGain: 110
  });
  store.updatePreferences({
    pushToTalk: true,
    pushToTalkShortcut: "KeyV"
  });

  assert.deepEqual(persistedStates.at(-1), {
    schemaVersion: PERSISTED_APP_CLIENT_STATE_VERSION,
    serverAddress: "",
    nickname: "",
    recentServers: [],
    audio: {
      inputDeviceId: "usb-mic",
      outputDeviceId: "default",
      captureEnabled: true,
      selfMuted: false,
      inputGain: 100,
      outputGain: 110
    },
    preferences: {
      pushToTalk: true,
      pushToTalkShortcut: "KeyV",
      autoReconnect: true,
      notificationsEnabled: true,
      showLatencyDetails: false
    }
  });
});
