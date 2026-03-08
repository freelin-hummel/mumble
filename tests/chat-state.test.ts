import assert from "node:assert/strict";
import test from "node:test";

import type { AppClientState } from "../electron/appClientState.js";
import {
  getChatMessagesForTarget,
  getChatTargetKey,
  getChatViewTarget,
  getUnreadCountForTarget
} from "../src/chatState";

const baseState: AppClientState = {
  connection: {
    status: "connected",
    serverAddress: "voice.example.test:64738",
    nickname: "Scout",
    error: null
  },
  channels: [
    {
      id: "lobby",
      name: "Lobby",
      parentId: null,
      depth: 0,
      position: 0,
      permissions: {
        traverse: true,
        enter: true,
        speak: true,
        muteDeafen: false,
        move: false,
        write: true
      },
      participantIds: ["self", "atlas"]
    }
  ],
  activeChannelId: "lobby",
  participants: [
    { id: "self", name: "Scout", channelId: "lobby", status: "live", isSelf: true },
    { id: "atlas", name: "Atlas", channelId: "lobby", status: "live" }
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
      id: "room",
      author: "Atlas",
      body: "Lobby comms check.",
      channelId: "lobby",
      sentAt: "2026-03-07T22:00:05.000Z"
    },
    {
      id: "dm",
      author: "Atlas",
      body: "Send me a direct reply.",
      channelId: null,
      participantId: "atlas",
      sentAt: "2026-03-07T22:00:08.000Z"
    }
  ],
  audio: {
    inputDeviceId: "default",
    outputDeviceId: "default",
    captureEnabled: true,
    selfMuted: false,
    inputGain: 100,
    outputGain: 100
  },
  preferences: {
    pushToTalk: false,
    pushToTalkShortcut: "Space",
    shortcutBindings: [],
    localNicknames: {},
    autoReconnect: true,
    notificationsEnabled: true,
    showLatencyDetails: false
  },
  telemetry: {
    latencyMs: 40,
    jitterMs: 4,
    packetLoss: 0
  },
  recentServers: ["voice.example.test:64738"]
};

test("chatState selects a direct-message target when another participant is selected", () => {
  assert.deepEqual(getChatViewTarget(baseState, "atlas"), {
    type: "participant",
    participantId: "atlas"
  });
  assert.deepEqual(getChatViewTarget(baseState, "self"), {
    type: "channel",
    channelId: "lobby"
  });
});

test("chatState filters channel and participant conversations independently", () => {
  assert.deepEqual(
    getChatMessagesForTarget(baseState.messages, { type: "channel", channelId: "lobby" }).map((message) => message.id),
    ["welcome", "room"]
  );
  assert.deepEqual(
    getChatMessagesForTarget(baseState.messages, { type: "participant", participantId: "atlas" }).map((message) => message.id),
    ["welcome", "dm"]
  );
});

test("chatState counts unread messages without treating server notices as unread badges", () => {
  assert.equal(
    getUnreadCountForTarget(
      baseState.messages,
      { type: "channel", channelId: "lobby" },
      ["room"]
    ),
    0
  );
  assert.equal(
    getUnreadCountForTarget(
      baseState.messages,
      { type: "participant", participantId: "atlas" },
      []
    ),
    1
  );
  assert.equal(getChatTargetKey({ type: "participant", participantId: "atlas" }), "participant:atlas");
});
