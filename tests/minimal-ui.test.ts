import assert from "node:assert/strict";
import test from "node:test";

import type { AppClientChatMessage } from "../electron/appClientState.js";
import {
  COMPACT_CHAT_LOG_LIMIT,
  getCompactChatLogMessages,
  shouldExpandConnectionControls,
} from "../src/minimalUi";

test("minimalUi expands connection controls until a live session is connected", () => {
  assert.equal(shouldExpandConnectionControls("disconnected"), true);
  assert.equal(shouldExpandConnectionControls("connecting"), true);
  assert.equal(shouldExpandConnectionControls("authenticating"), true);
  assert.equal(shouldExpandConnectionControls("error"), true);
  assert.equal(shouldExpandConnectionControls("connected"), false);
});

test("minimalUi keeps the latest chat messages in chronological order", () => {
  const messages = Array.from({ length: COMPACT_CHAT_LOG_LIMIT + 3 }, (_, index) => ({
    id: `message-${index + 1}`,
    author: "Scout",
    body: `Message ${index + 1}`,
    channelId: "lobby",
    sentAt: `2026-03-09T06:${String(index).padStart(2, "0")}:00.000Z`,
  })) satisfies AppClientChatMessage[];

  assert.deepEqual(
    getCompactChatLogMessages(messages).map((message) => message.id),
    messages.slice(-COMPACT_CHAT_LOG_LIMIT).map((message) => message.id),
  );
});
