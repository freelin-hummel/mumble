import { desktopScreens } from "./legacy/clients/web-client/src/features.js";

export const legacyParityGroups = [
  {
    group: "Core workspace",
    summary:
      "The Electron renderer covers the main voice workspace, a lightweight direct-connect form, and basic room chat, but it still lacks the broader server browser, metadata, identity, token, search, and developer-tooling flows from the legacy client.",
    partiallyCoveredLegacyScreenIds: ["main-window", "connect-dialog", "text-message"],
    missingLegacyScreenIds: [
      "connect-dialog-edit",
      "server-information",
      "search-dialog",
      "user-information",
      "user-edit",
      "user-local-nickname",
      "tokens",
      "developer-console"
    ],
    evidence: ["src/App.tsx:892-989", "src/App.tsx:1169-1323"]
  },
  {
    group: "Audio",
    summary:
      "The renderer exposes device selection, gain, push-to-talk/VAD behavior, live metering, and basic telemetry, but it does not yet provide guided setup, positional audio, recording, ASIO configuration, or the richer legacy tuning surfaces.",
    partiallyCoveredLegacyScreenIds: ["audio-input", "audio-output", "audio-stats", "ptt-button-widget"],
    missingLegacyScreenIds: ["audio-wizard", "asio-input", "positional-audio-viewer", "voice-recorder"],
    evidence: ["src/App.tsx:991-1164", "src/App.tsx:1326-1458"]
  },
  {
    group: "Preferences",
    summary:
      "The renderer has a small saved-preferences area plus reconnect/diagnostics toggles, but it does not yet expose the multi-section settings shell or the appearance, certificate, overlay, logging, and rich-text editors from the legacy client.",
    partiallyCoveredLegacyScreenIds: ["config-dialog", "network-config"],
    missingLegacyScreenIds: [
      "look-config",
      "overlay",
      "overlay-editor",
      "lcd",
      "log",
      "cert",
      "rich-text-editor",
      "rich-text-editor-link"
    ],
    evidence: ["src/App.tsx:1430-1537"]
  },
  {
    group: "Shortcuts",
    summary:
      "The current push-to-talk shortcut field is renderer-local and only covers one binding, so the dedicated legacy shortcut management flows remain missing for parity purposes.",
    partiallyCoveredLegacyScreenIds: [],
    missingLegacyScreenIds: ["global-shortcut", "global-shortcut-buttons", "global-shortcut-target"],
    evidence: ["src/App.tsx:1465-1509"]
  },
  {
    group: "Administration",
    summary:
      "The renderer can surface connection errors inline, but none of the moderation, ACL, ban, or focused recovery dialogs from the legacy client are implemented yet.",
    partiallyCoveredLegacyScreenIds: [],
    missingLegacyScreenIds: ["acl-editor", "ban-editor", "ban-dialog", "failed-connection-dialog"],
    evidence: ["src/App.tsx:978-987"]
  },
  {
    group: "Plugins",
    summary:
      "The new client currently has no plugin-management surfaces, installer flows, updater UI, or manual positional-audio configuration equivalent to the legacy client.",
    partiallyCoveredLegacyScreenIds: [],
    missingLegacyScreenIds: ["plugin-config", "plugin-installer", "plugin-updater", "manual-plugin"],
    evidence: ["README.md:80-81"]
  }
];

export const webappOnlyCapabilities = [
  {
    title: "Authenticated secure transport self-test",
    summary:
      "The renderer can trigger an Electron-backed secure voice handshake/self-test that is not represented in the legacy Qt screen inventory.",
    evidence: ["src/App.tsx:1541-1577", "tests/secure-voice.test.ts:11-69"]
  },
  {
    title: "Renderer-side DSP presets and pipeline toggles",
    summary:
      "The renderer includes lightweight DSP preset controls and pipeline stage toggles that go beyond the legacy bootstrap inventory.",
    evidence: ["src/App.tsx:1326-1387", "tests/dsp-pipeline.test.mjs:9-42"]
  },
  {
    title: "Structured diagnostics export",
    summary:
      "The renderer can export diagnostics bundles with runtime audio and transport data for bug reports, which is broader than the legacy stub inventory.",
    evidence: ["src/App.tsx:1430-1458", "tests/diagnostics.test.ts:97-150"]
  }
];

export const testingGaps = [
  {
    area: "Parity inventory coverage",
    gap:
      "Before this review, the root Electron test suite did not verify that every legacy screen had been accounted for in the new client's parity assessment.",
    nextStep:
      "Keep tests/parity-review.test.ts aligned with legacy/clients/web-client/src/features.js whenever the legacy baseline or renderer scope changes.",
    evidence: [
      "legacy/clients/web-client/tests/web-client.test.mjs:35-58",
      "tests/parity-review.test.ts:13-19"
    ]
  },
  {
    area: "Renderer UI behavior",
    gap:
      "Current root tests validate state, transport, audio devices, diagnostics, and voice activation, but they do not render the React workspace or assert connect/channel/chat/preferences flows through the UI.",
    nextStep:
      "Add renderer/component coverage once the project introduces a DOM-capable test harness for React UI behavior.",
    evidence: [
      "tests/app-client-state.test.ts:10-278",
      "tests/audio-devices.test.ts:7-132",
      "tests/diagnostics.test.ts:28-150",
      "tests/voice-activation.test.ts:7-97"
    ]
  },
  {
    area: "Visual regression evidence",
    gap:
      "There is no screenshot or snapshot-based regression coverage for the current workspace layout, so UI parity checks remain manual.",
    nextStep:
      "Adopt visual or snapshot coverage after the main renderer layout stabilizes.",
    evidence: ["src/App.tsx:886-1579"]
  }
];

export const reviewedLegacyScreenIds = legacyParityGroups.flatMap((group) => [
  ...group.partiallyCoveredLegacyScreenIds,
  ...group.missingLegacyScreenIds
]);

export function getLegacyParitySummary() {
  const partiallyCoveredLegacyScreens = legacyParityGroups.reduce(
    (count, group) => count + group.partiallyCoveredLegacyScreenIds.length,
    0
  );
  const missingLegacyScreens = legacyParityGroups.reduce(
    (count, group) => count + group.missingLegacyScreenIds.length,
    0
  );

  return {
    totalLegacyScreens: desktopScreens.length,
    partiallyCoveredLegacyScreens,
    missingLegacyScreens,
    fullyImplementedLegacyScreens: 0,
    featureGroups: legacyParityGroups.length
  };
}
