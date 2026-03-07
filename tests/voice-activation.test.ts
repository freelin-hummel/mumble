import assert from "node:assert/strict";
import test from "node:test";

import {
  createInitialVoiceActivationState,
  formatPushToTalkShortcut,
  matchesPushToTalkShortcut,
  normalizePushToTalkShortcut,
  shortcutFromKeyboardEvent,
  stepVoiceActivation
} from "../src/voiceActivation";

test("push-to-talk shortcuts normalize and format single-key bindings", () => {
  assert.equal(normalizePushToTalkShortcut(undefined), "Space");
  assert.equal(normalizePushToTalkShortcut("v"), "KeyV");
  assert.equal(normalizePushToTalkShortcut("7"), "Digit7");
  assert.equal(formatPushToTalkShortcut("KeyV"), "V");
  assert.equal(formatPushToTalkShortcut("Digit7"), "7");
});

test("keyboard shortcut helpers resolve and match configured push-to-talk keys", () => {
  assert.equal(shortcutFromKeyboardEvent({ code: "Space", key: " " }), "Space");
  assert.equal(shortcutFromKeyboardEvent({ key: "b" }), "KeyB");
  assert.equal(matchesPushToTalkShortcut("KeyB", { code: "KeyB" }), true);
  assert.equal(matchesPushToTalkShortcut("Space", { code: "KeyV" }), false);
});

test("voice activity detection opens and closes the transmit bus with hysteresis", () => {
  const idleState = createInitialVoiceActivationState();
  const liveState = stepVoiceActivation(idleState, {
    inputLevel: 0.24,
    captureEnabled: true,
    selfMuted: false,
    pushToTalk: false,
    pushToTalkPressed: false,
    inputGain: 100,
    outputGain: 100
  });

  assert.equal(liveState.mode, "vad-live");
  assert.equal(liveState.isTransmitting, true);
  assert.equal(liveState.voiceDetected, true);
  assert.equal(liveState.outputLevel > 0, true);

  const heldByHysteresis = stepVoiceActivation(liveState, {
    inputLevel: 0.13,
    captureEnabled: true,
    selfMuted: false,
    pushToTalk: false,
    pushToTalkPressed: false,
    inputGain: 100,
    outputGain: 100
  });
  assert.equal(heldByHysteresis.mode, "vad-live");

  const releasedState = stepVoiceActivation(heldByHysteresis, {
    inputLevel: 0.1,
    captureEnabled: true,
    selfMuted: false,
    pushToTalk: false,
    pushToTalkPressed: false,
    inputGain: 100,
    outputGain: 100
  });
  assert.equal(releasedState.mode, "vad-armed");
  assert.equal(releasedState.isTransmitting, false);
  assert.equal(releasedState.outputLevel, 0);
});

test("push-to-talk requires the configured key to be held even when voice activity is high", () => {
  const armedState = stepVoiceActivation(createInitialVoiceActivationState(), {
    inputLevel: 0.8,
    captureEnabled: true,
    selfMuted: false,
    pushToTalk: true,
    pushToTalkPressed: false,
    inputGain: 100,
    outputGain: 125
  });

  assert.equal(armedState.mode, "ptt-armed");
  assert.equal(armedState.isTransmitting, false);
  assert.equal(armedState.outputLevel, 0);

  const liveState = stepVoiceActivation(armedState, {
    inputLevel: 0.8,
    captureEnabled: true,
    selfMuted: false,
    pushToTalk: true,
    pushToTalkPressed: true,
    inputGain: 100,
    outputGain: 125
  });

  assert.equal(liveState.mode, "ptt-live");
  assert.equal(liveState.isTransmitting, true);
  assert.equal(liveState.outputLevel, 1);
});

test("muting or disabling capture forces the state machine into a non-transmitting state", () => {
  const mutedByPreference = stepVoiceActivation(createInitialVoiceActivationState(), {
    inputLevel: 0.9,
    captureEnabled: true,
    selfMuted: true,
    pushToTalk: false,
    pushToTalkPressed: false,
    inputGain: 100,
    outputGain: 100
  });
  assert.equal(mutedByPreference.mode, "muted");
  assert.equal(mutedByPreference.isTransmitting, false);

  const mutedByCaptureToggle = stepVoiceActivation(mutedByPreference, {
    inputLevel: 0.9,
    captureEnabled: false,
    selfMuted: false,
    pushToTalk: true,
    pushToTalkPressed: true,
    inputGain: 100,
    outputGain: 100
  });
  assert.equal(mutedByCaptureToggle.mode, "muted");
  assert.equal(mutedByCaptureToggle.pushToTalkPressed, false);
});
