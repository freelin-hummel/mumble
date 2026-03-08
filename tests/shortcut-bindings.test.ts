import assert from "node:assert/strict";
import test from "node:test";

import {
  findNextShortcutTarget,
  formatShortcutBinding,
  getDefaultShortcutBinding,
  normalizeShortcutBindings
} from "../src/shortcutBindings";

test("shortcut binding helpers normalize valid unique targets", () => {
  assert.deepEqual(normalizeShortcutBindings([
    { target: "toggleMute", shortcut: "m" },
    { target: "toggleMute", shortcut: "n" },
    { target: "toggleLatencyDetails", shortcut: "l" },
    { target: "invalid", shortcut: "q" }
  ]), [
    { target: "toggleMute", shortcut: "KeyM" },
    { target: "toggleLatencyDetails", shortcut: "KeyL" }
  ]);
});

test("shortcut binding helpers provide defaults and available targets", () => {
  assert.deepEqual(getDefaultShortcutBinding("cycleChannel"), {
    target: "cycleChannel",
    shortcut: "KeyR"
  });
  assert.equal(findNextShortcutTarget([
    { target: "toggleMute", shortcut: "KeyM" },
    { target: "selectSystemOutput", shortcut: "KeyO" }
  ]), "toggleLatencyDetails");
  assert.equal(formatShortcutBinding({
    target: "toggleMute",
    shortcut: "KeyM"
  }), "Toggle mute: M");
});
