import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AppClientStore,
  PERSISTED_APP_CLIENT_STATE_VERSION
} from "../electron/appClientState.js";
import {
  loadPersistedAppClientState,
  savePersistedAppClientState
} from "../electron/appStateStorage.js";

const withTempStatePath = async (run: (statePath: string) => Promise<void> | void) => {
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "mumble-app-state-"));
  const statePath = path.join(tempDirectory, "desktop-client-state.json");

  try {
    await run(statePath);
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
};

test("desktop settings persist across restart via the app state storage file", async () => {
  await withTempStatePath(async (statePath) => {
    const firstRunStore = new AppClientStore({
      onPersist: (state) => {
        savePersistedAppClientState(statePath, state);
      },
      waitForConnection: async () => {}
    });

    firstRunStore.updateAudioSettings({
      inputDeviceId: "usb-mic",
      outputDeviceId: "usb-headset",
      captureEnabled: false,
      selfMuted: true,
      inputGain: 125,
      outputGain: 85
    });
    firstRunStore.updatePreferences({
      pushToTalk: true,
      pushToTalkShortcut: "v",
      shortcutBindings: [{ target: "toggleMute", shortcut: "m" }],
      autoReconnect: false,
      notificationsEnabled: false,
      showLatencyDetails: true
    });
    firstRunStore.rememberServer("stage.example.test:64738");
    await firstRunStore.connect({
      serverAddress: "voice.example.test:64738",
      nickname: "Scout"
    });

    const secondRunStore = new AppClientStore({
      persistedState: loadPersistedAppClientState(statePath),
      waitForConnection: async () => {}
    });

    const restartedState = secondRunStore.getState();
    assert.equal(restartedState.connection.serverAddress, "voice.example.test:64738");
    assert.equal(restartedState.connection.nickname, "Scout");
    assert.deepEqual(restartedState.recentServers, [
      "voice.example.test:64738",
      "stage.example.test:64738"
    ]);
    assert.deepEqual(restartedState.audio, {
      inputDeviceId: "usb-mic",
      outputDeviceId: "usb-headset",
      captureEnabled: false,
      selfMuted: true,
      inputGain: 125,
      outputGain: 85
    });
    assert.deepEqual(restartedState.preferences, {
      pushToTalk: true,
      pushToTalkShortcut: "KeyV",
      shortcutBindings: [{ target: "toggleMute", shortcut: "KeyM" }],
      autoReconnect: false,
      notificationsEnabled: false,
      showLatencyDetails: true
    });

    assert.match(readFileSync(statePath, "utf8"), /"schemaVersion": 1/);
  });
});

test("loadPersistedAppClientState migrates legacy settings files without losing saved values", async () => {
  await withTempStatePath((statePath) => {
    writeFileSync(statePath, JSON.stringify({
      serverAddress: "voice.example.test:64738",
      nickname: "Scout",
      recentServers: ["voice.example.test:64738", "backup.example.test"],
      audio: {
        inputDeviceId: "usb-mic",
        outputDeviceId: "usb-headset",
        captureEnabled: false,
        selfMuted: true,
        inputGain: 125,
        outputGain: 85
      },
      preferences: {
        pushToTalk: true,
        pushToTalkShortcut: "v",
        shortcutBindings: [{ target: "toggleLatencyDetails", shortcut: "l" }],
        autoReconnect: false,
        notificationsEnabled: false,
        showLatencyDetails: true
      }
    }, null, 2));

    assert.deepEqual(loadPersistedAppClientState(statePath), {
      schemaVersion: PERSISTED_APP_CLIENT_STATE_VERSION,
      serverAddress: "voice.example.test:64738",
      nickname: "Scout",
      recentServers: ["voice.example.test:64738", "backup.example.test"],
      audio: {
        inputDeviceId: "usb-mic",
        outputDeviceId: "usb-headset",
        captureEnabled: false,
        selfMuted: true,
        inputGain: 125,
        outputGain: 85
      },
      preferences: {
        pushToTalk: true,
        pushToTalkShortcut: "KeyV",
        shortcutBindings: [{ target: "toggleLatencyDetails", shortcut: "KeyL" }],
        autoReconnect: false,
        notificationsEnabled: false,
        showLatencyDetails: true
      }
    });
  });
});
