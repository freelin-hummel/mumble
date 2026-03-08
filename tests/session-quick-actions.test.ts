import assert from "node:assert/strict";
import test from "node:test";

import {
  describeQuickActionLatency,
  describeTalkMode,
  describeTransportStatus,
  findNextNavigableChannel,
  formatTransportActivity
} from "../src/sessionQuickActions";
import { createInitialVoiceActivationState } from "../src/voiceActivation";

test("session quick action helpers skip locked channels when cycling rooms", () => {
  const nextChannel = findNextNavigableChannel([
    {
      id: "lobby",
      name: "Lobby",
      parentId: null,
      depth: 0,
      position: 0,
      permissions: { traverse: true, enter: true, speak: true, muteDeafen: false, move: false, write: true },
      participantIds: []
    },
    {
      id: "ops",
      name: "Ops",
      parentId: null,
      depth: 0,
      position: 1,
      permissions: { traverse: true, enter: false, speak: false, muteDeafen: false, move: false, write: false },
      participantIds: []
    },
    {
      id: "squad",
      name: "Squad",
      parentId: null,
      depth: 0,
      position: 2,
      permissions: { traverse: true, enter: true, speak: true, muteDeafen: false, move: false, write: true },
      participantIds: []
    }
  ], "lobby");

  assert.equal(nextChannel?.id, "squad");
});

test("session quick action helpers summarize talk mode and latency state", () => {
  assert.equal(describeTalkMode({
    pushToTalk: true,
    pushToTalkPressed: false,
    shortcutLabel: "V",
    voiceActivation: createInitialVoiceActivationState()
  }), "Hold V to talk");

  assert.equal(describeQuickActionLatency({
    latencyMs: null,
    jitterMs: null,
    packetLoss: null
  }, {
    state: "connected",
    remoteAddress: "127.0.0.1",
    remotePort: 64738,
    localAddress: "127.0.0.1",
    localPort: 60000,
    lastError: null,
    lastSentAt: null,
    lastReceivedAt: null
  }), "Transport ready · waiting for live metrics");
});

test("session quick action helpers report transport activity and errors", () => {
  const timestamp = Date.UTC(2026, 2, 8, 5, 0, 0);
  const transportStatus = {
    state: "disconnected" as const,
    remoteAddress: null,
    remotePort: null,
    localAddress: null,
    localPort: null,
    lastError: "Timed out waiting for UDP",
    lastSentAt: null,
    lastReceivedAt: timestamp
  };

  assert.match(describeTransportStatus(transportStatus), /^Error · Timed out waiting for UDP$/);
  assert.match(formatTransportActivity(transportStatus), /^Last packet: /);
});
