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

test("AppClientStore syncs a stable channel tree with participant presence and permissions", async () => {
  const store = new AppClientStore({
    waitForConnection: async () => {}
  });

  await store.connect({
    serverAddress: "voice.example.test:64738",
    nickname: "Scout"
  });

  const state = store.syncSessionSnapshot({
    channels: [
      { id: "lounge", name: "Lounge", parentId: "root", position: 2 },
      { id: "ops", name: "Ops", parentId: "root", position: 1, permissions: { enter: false, speak: false } },
      { id: "games", name: "Games", parentId: "lounge", position: 0, permissions: { speak: false } },
      { id: "root", name: "Root", position: 0 }
    ],
    participants: [
      { id: "guest", name: "Bravo", channelId: "root", status: "idle" },
      { id: "self", name: "Scout", channelId: "games", status: "live", isSelf: true },
      { id: "ghost", name: "Ghost", channelId: "missing", status: "muted" }
    ]
  });

  assert.deepEqual(state.channels.map((channel) => ({
    id: channel.id,
    parentId: channel.parentId,
    depth: channel.depth,
    participantIds: channel.participantIds,
    permissions: {
      enter: channel.permissions.enter,
      speak: channel.permissions.speak
    }
  })), [
    {
      id: "root",
      parentId: null,
      depth: 0,
      participantIds: ["guest"],
      permissions: { enter: true, speak: true }
    },
    {
      id: "ops",
      parentId: "root",
      depth: 1,
      participantIds: [],
      permissions: { enter: false, speak: false }
    },
    {
      id: "lounge",
      parentId: "root",
      depth: 1,
      participantIds: [],
      permissions: { enter: true, speak: true }
    },
    {
      id: "games",
      parentId: "lounge",
      depth: 2,
      participantIds: ["self"],
      permissions: { enter: true, speak: false }
    }
  ]);
  assert.deepEqual(state.participants.map((participant) => ({
    id: participant.id,
    channelId: participant.channelId,
    status: participant.status,
    isSelf: participant.isSelf
  })), [
    { id: "guest", channelId: "root", status: "idle", isSelf: undefined },
    { id: "self", channelId: "games", status: "live", isSelf: true }
  ]);
  assert.equal(state.activeChannelId, "games");
});

test("AppClientStore keeps channel selection aligned with enter permissions", async () => {
  const store = new AppClientStore({
    waitForConnection: async () => {}
  });

  await store.connect({
    serverAddress: "voice.example.test:64738",
    nickname: "Scout"
  });

  store.syncSessionSnapshot({
    channels: [
      { id: "root", name: "Root", position: 0 },
      { id: "ops", name: "Ops", parentId: "root", position: 0, permissions: { enter: false } },
      { id: "lounge", name: "Lounge", parentId: "root", position: 1 }
    ],
    participants: []
  });

  assert.equal(store.selectChannel("ops").activeChannelId, "root");
  assert.equal(store.selectChannel("lounge").activeChannelId, "lounge");
  assert.equal(store.updateChannelPermissions("lounge", { enter: false }).activeChannelId, "root");
  assert.equal(store.updateChannelPermissions("root", { enter: false }).activeChannelId, null);
});

test("AppClientStore incrementally applies channel and participant updates", async () => {
  const store = new AppClientStore({
    waitForConnection: async () => {}
  });

  await store.connect({
    serverAddress: "voice.example.test:64738",
    nickname: "Scout"
  });

  store.upsertChannel({ id: "root", name: "Root", position: 0 });
  store.upsertChannel({ id: "squad", name: "Squad", parentId: "root", position: 0, permissions: { speak: false } });
  store.upsertParticipant({ id: "self", name: "Scout", channelId: "root", status: "live", isSelf: true });
  store.upsertParticipant({ id: "alpha", name: "Alpha", channelId: "squad", status: "muted" });

  let state = store.getState();
  assert.deepEqual(state.channels.map((channel) => ({
    id: channel.id,
    participantIds: channel.participantIds,
    depth: channel.depth,
    speak: channel.permissions.speak
  })), [
    { id: "root", participantIds: ["self"], depth: 0, speak: true },
    { id: "squad", participantIds: ["alpha"], depth: 1, speak: false }
  ]);

  store.upsertParticipant({ id: "alpha", channelId: "root", status: "live" });
  state = store.getState();
  assert.deepEqual(state.channels.map((channel) => ({
    id: channel.id,
    participantIds: channel.participantIds
  })), [
    { id: "root", participantIds: ["self", "alpha"] },
    { id: "squad", participantIds: [] }
  ]);

  store.removeParticipant("alpha");
  assert.deepEqual(store.getState().participants.map((participant) => participant.id), ["self"]);

  store.removeChannel("squad");
  state = store.getState();
  assert.deepEqual(state.channels.map((channel) => channel.id), ["root"]);
  assert.equal(state.activeChannelId, "root");
});
