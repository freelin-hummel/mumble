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
        shortcutBindings: [{ target: "toggleMute", shortcut: "m" }],
        favoriteServers: [{ address: "voice.example.test:64738", label: "voice.example.test:64738" }],
        localNicknames: {
          atlas: "Lead"
        },
        autoReconnect: false,
        notificationsEnabled: false,
        showLatencyDetails: true,
        voiceProcessing: {
          agc: false,
          noiseSuppression: false,
          echoCancellation: true
        }
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
  assert.deepEqual(state.preferences.shortcutBindings, [{ target: "toggleMute", shortcut: "KeyM" }]);
  assert.deepEqual(state.preferences.favoriteServers, [
    { address: "voice.example.test:64738", label: "voice.example.test:64738" }
  ]);
  assert.deepEqual(state.preferences.localNicknames, { atlas: "Lead" });
  assert.equal(state.preferences.showLatencyDetails, true);
  assert.deepEqual(state.preferences.voiceProcessing, {
    agc: false,
    noiseSuppression: false,
    echoCancellation: true
  });
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

test("AppClientStore can remember a server draft without connecting", () => {
  const store = new AppClientStore({
    waitForConnection: async () => {}
  });

  const nextState = store.rememberServer("  stage.example.test:64738  ");
  store.rememberServer("voice.example.test:64738");
  store.rememberServer("stage.example.test:64738");

  assert.equal(nextState.connection.serverAddress, "stage.example.test:64738");
  assert.deepEqual(store.getState().recentServers, [
    "stage.example.test:64738",
    "voice.example.test:64738"
  ]);
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
        shortcutBindings: [
          { target: "toggleMute", shortcut: "m" },
          { target: "toggleMute", shortcut: "KeyN" },
          { target: "toggleLatencyDetails", shortcut: "l" },
          { target: "invalid", shortcut: "KeyQ" }
        ],
        favoriteServers: [
          { address: " voice.example.test:64738 ", label: " Alpha " },
          { address: "voice.example.test:64738", label: "" },
          { address: "backup.example.test:64738" },
          { address: "", label: "Missing" }
        ],
        localNicknames: {
          "  atlas  ": "  Lead  ",
          echo: "",
          "": "Ghost",
          nova: 42
        },
        autoReconnect: true,
        notificationsEnabled: true,
        showLatencyDetails: false,
        voiceProcessing: {
          agc: "loud",
          noiseSuppression: false,
          echoCancellation: true
        }
      }
    },
    waitForConnection: async () => {}
  });

  assert.equal(store.getState().preferences.pushToTalkShortcut, "Space");
  assert.deepEqual(store.getState().preferences.shortcutBindings, [
    { target: "toggleMute", shortcut: "KeyM" },
    { target: "toggleLatencyDetails", shortcut: "KeyL" }
  ]);
  assert.deepEqual(store.getState().preferences.favoriteServers, [
    { address: "voice.example.test:64738", label: "Alpha" },
    { address: "backup.example.test:64738", label: "backup.example.test:64738" }
  ]);
  assert.deepEqual(store.getState().preferences.localNicknames, {
    atlas: "Lead"
  });
  assert.deepEqual(store.getState().preferences.voiceProcessing, {
    agc: true,
    noiseSuppression: false,
    echoCancellation: true
  });
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
      shortcutBindings: [{ target: "cycleChannel", shortcut: "r" }],
      favoriteServers: [{ address: "voice.example.test:64738", label: "Ops" }],
      localNicknames: {
        atlas: "Lead"
      },
      autoReconnect: false,
      notificationsEnabled: false,
      showLatencyDetails: true,
      voiceProcessing: {
        agc: false,
        noiseSuppression: false,
        echoCancellation: true
      }
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
      shortcutBindings: [{ target: "cycleChannel", shortcut: "KeyR" }],
      favoriteServers: [{ address: "voice.example.test:64738", label: "Ops" }],
      localNicknames: {
        atlas: "Lead"
      },
      autoReconnect: false,
      notificationsEnabled: false,
      showLatencyDetails: true,
      voiceProcessing: {
        agc: false,
        noiseSuppression: false,
        echoCancellation: true
      }
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
    pushToTalkShortcut: "KeyV",
    shortcutBindings: [{ target: "toggleMute", shortcut: "KeyM" }],
    favoriteServers: [{ address: "voice.example.test:64738", label: "Primary" }],
    localNicknames: {
      atlas: "Lead"
    },
    voiceProcessing: {
      agc: false,
      noiseSuppression: true,
      echoCancellation: true
    }
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
      shortcutBindings: [{ target: "toggleMute", shortcut: "KeyM" }],
      favoriteServers: [{ address: "voice.example.test:64738", label: "Primary" }],
      localNicknames: {
        atlas: "Lead"
      },
      autoReconnect: true,
      notificationsEnabled: true,
      showLatencyDetails: false,
      voiceProcessing: {
        agc: false,
        noiseSuppression: true,
        echoCancellation: true
      }
    }
  });
});

test("AppClientStore updates and clears persisted local nicknames", () => {
  const store = new AppClientStore({
    persistedState: {
      preferences: {
        favoriteServers: [
          { address: "voice.example.test:64738", label: "Primary" }
        ],
        localNicknames: {
          atlas: "Lead"
        }
      }
    },
    waitForConnection: async () => {}
  });

  assert.deepEqual(store.updatePreferences({
    favoriteServers: [
      { address: "voice.example.test:64738", label: "Primary" },
      { address: "backup.example.test:64738", label: "Backup" }
    ],
    localNicknames: {
      atlas: "Lead",
      echo: "Anchor"
    }
  }).preferences, {
    pushToTalk: false,
    pushToTalkShortcut: "Space",
    shortcutBindings: [],
    favoriteServers: [
      { address: "voice.example.test:64738", label: "Primary" },
      { address: "backup.example.test:64738", label: "Backup" }
    ],
    localNicknames: {
      atlas: "Lead",
      echo: "Anchor"
    },
    autoReconnect: true,
    notificationsEnabled: true,
    showLatencyDetails: false,
    voiceProcessing: {
      agc: true,
      noiseSuppression: true,
      echoCancellation: false
    }
  });
  assert.deepEqual(store.updatePreferences({
    favoriteServers: [
      { address: "backup.example.test:64738", label: "Backup" }
    ],
    localNicknames: {
      echo: "Anchor"
    }
  }).preferences, {
    pushToTalk: false,
    pushToTalkShortcut: "Space",
    shortcutBindings: [],
    favoriteServers: [
      { address: "backup.example.test:64738", label: "Backup" }
    ],
    localNicknames: {
      echo: "Anchor"
    },
    autoReconnect: true,
    notificationsEnabled: true,
    showLatencyDetails: false,
    voiceProcessing: {
      agc: true,
      noiseSuppression: true,
      echoCancellation: false
    }
  });
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
  assert.equal(state.participants.some((participant) => participant.id === "ghost"), false);
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
  assert.deepEqual(nextState.channels.map((channel) => ({
    id: channel.id,
    parentId: channel.parentId,
    depth: channel.depth,
    participantIds: channel.participantIds
  })), [
    { id: "root", parentId: null, depth: 0, participantIds: ["guest"] },
    { id: "squad", parentId: "root", depth: 1, participantIds: ["self"] }
  ]);
  assert.deepEqual(nextState.participants, [
    { id: "guest", name: "Guest", channelId: "root", status: "idle", isSelf: undefined },
    { id: "self", name: "Scout", channelId: "squad", status: "live", isSelf: true }
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
