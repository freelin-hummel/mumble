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
  assert.deepEqual(state.messages, []);
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

test("AppClientStore syncLiveSession applies channel tree, active room, roster, and chat updates", async () => {
  const store = new AppClientStore({
    waitForConnection: async () => {}
  });

  await store.connect({
    serverAddress: "voice.example.test:64738",
    nickname: "Scout"
  });

  const nextState = store.syncLiveSession({
    channels: [
      { id: "root", name: "Root", parentId: null },
      { id: "squad", name: "Squad", parentId: "root" }
    ],
    participants: [
      { id: "self", name: "Scout", channelId: "squad", status: "live", isSelf: true },
      { id: "guest", name: "Guest", channelId: "root", status: "idle" },
      { id: "orphan", name: "Orphan", channelId: "missing", status: "live" }
    ],
    messages: [
      {
        id: "welcome",
        author: "Server",
        body: "Welcome aboard",
        channelId: null,
        sentAt: "2026-03-07T22:00:00.000Z"
      },
      {
        id: "briefing",
        author: "Guest",
        body: "Squad briefing starts now.",
        channelId: "squad",
        sentAt: "2026-03-07T22:00:03.000Z"
      },
      {
        id: "invalid-room",
        author: "Ghost",
        body: "Hidden room message",
        channelId: "missing",
        sentAt: "2026-03-07T22:00:05.000Z"
      }
    ],
    telemetry: {
      latencyMs: 41.26,
      jitterMs: 7.21,
      packetLoss: 0
    }
  });

  assert.equal(nextState.activeChannelId, "squad");
  assert.deepEqual(nextState.channels, [
    { id: "root", name: "Root", parentId: null },
    { id: "squad", name: "Squad", parentId: "root" }
  ]);
  assert.deepEqual(nextState.participants, [
    { id: "self", name: "Scout", channelId: "squad", status: "live", isSelf: true },
    { id: "guest", name: "Guest", channelId: "root", status: "idle", isSelf: undefined }
  ]);
  assert.deepEqual(nextState.messages, [
    {
      id: "welcome",
      author: "Server",
      body: "Welcome aboard",
      channelId: null,
      sentAt: "2026-03-07T22:00:00.000Z",
      isSelf: undefined
    },
    {
      id: "briefing",
      author: "Guest",
      body: "Squad briefing starts now.",
      channelId: "squad",
      sentAt: "2026-03-07T22:00:03.000Z",
      isSelf: undefined
    }
  ]);
  assert.deepEqual(nextState.telemetry, {
    latencyMs: 41.3,
    jitterMs: 7.2,
    packetLoss: 0
  });
});

test("AppClientStore sendChatMessage appends a self-authored room message", async () => {
  const store = new AppClientStore({
    waitForConnection: async () => {}
  });

  await store.connect({
    serverAddress: "voice.example.test:64738",
    nickname: "Scout"
  });

  store.syncLiveSession({
    channels: [
      { id: "lobby", name: "Lobby", parentId: null }
    ],
    participants: [
      { id: "self", name: "Scout", channelId: "lobby", status: "live", isSelf: true }
    ]
  });

  const nextState = store.sendChatMessage("  Ready to roll.  ");
  assert.equal(nextState.messages.length, 1);
  assert.equal(nextState.messages[0]?.author, "Scout");
  assert.equal(nextState.messages[0]?.body, "Ready to roll.");
  assert.equal(nextState.messages[0]?.channelId, "lobby");
  assert.equal(nextState.messages[0]?.isSelf, true);
});
