import { pathToFileURL } from "node:url";

import { desktopScreens } from "./legacy/clients/web-client/src/features.js";

export const legacyParityGroups = [
  {
    group: "Core workspace",
    summary:
      "The Electron renderer covers the main voice workspace, a lightweight direct-connect flow with saved-server editing, and basic room chat, but it still lacks the broader server browser, metadata, identity, token, search, and developer-tooling flows from the legacy client.",
    partiallyCoveredLegacyScreenIds: ["main-window", "connect-dialog", "connect-dialog-edit", "text-message"],
    missingLegacyScreenIds: [
      "server-information",
      "search-dialog",
      "user-information",
      "user-edit",
      "user-local-nickname",
      "tokens",
      "developer-console"
    ],
    evidence: [
      "src/App.tsx:783-828",
      "src/App.tsx:1044-1132",
      "tests/app-client-state.test.ts:78-91"
    ]
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
      "The renderer now includes a lightweight shortcut manager with add/remove controls, editable quick-action bindings, and per-binding target routing, but it still remains renderer-local and does not yet match the legacy client's richer global capture and assignment workflow.",
    partiallyCoveredLegacyScreenIds: ["global-shortcut", "global-shortcut-buttons", "global-shortcut-target"],
    missingLegacyScreenIds: [],
    evidence: [
      "src/App.tsx:846-982",
      "src/App.tsx:1647-1807",
      "tests/shortcut-bindings.test.ts:11-36"
    ]
  },
  {
    group: "Administration",
    summary:
      "The renderer now offers a focused failed-connection recovery panel with retry and diagnostics shortcuts, but the broader moderation, ACL, and ban-management flows from the legacy client are still missing.",
    partiallyCoveredLegacyScreenIds: ["failed-connection-dialog"],
    missingLegacyScreenIds: ["acl-editor", "ban-editor", "ban-dialog"],
    evidence: ["src/App.tsx:1003-1046", "src/App.tsx:1456-1508"]
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

const reviewedLegacyScreenIdSet = new Set(reviewedLegacyScreenIds);

export const legacyParityWorkItems = desktopScreens.flatMap((screen) => {
  if (!reviewedLegacyScreenIdSet.has(screen.id)) {
    return [];
  }

  const parityGroup = legacyParityGroups.find(
    (group) =>
      group.partiallyCoveredLegacyScreenIds.includes(screen.id) ||
      group.missingLegacyScreenIds.includes(screen.id)
  );

  if (!parityGroup) {
    throw new Error(`Missing parity group for legacy screen: ${screen.id}`);
  }

  return [
    {
      id: screen.id,
      title: screen.title,
      group: parityGroup.group,
      status: parityGroup.partiallyCoveredLegacyScreenIds.includes(screen.id)
        ? "partially-covered"
        : "missing",
      sourceUi: screen.sourceUi,
      summary: screen.summary,
      stubActions: screen.stubActions,
      surfaces: screen.surfaces,
      groupSummary: parityGroup.summary,
      evidence: parityGroup.evidence
    }
  ];
});

function formatGroupCoverage(group) {
  const partialCount = group.partiallyCoveredLegacyScreenIds.length;
  const missingCount = group.missingLegacyScreenIds.length;
  const segments = [];

  if (partialCount > 0) {
    segments.push(`${partialCount} partial`);
  }

  if (missingCount > 0) {
    segments.push(`${missingCount} missing`);
  }

  return `${group.group} (${segments.join(", ")})`;
}

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

export function getNextLegacyParityWorkItem() {
  const group =
    legacyParityGroups.find(
      (candidate) =>
        candidate.partiallyCoveredLegacyScreenIds.length > 0 &&
        candidate.missingLegacyScreenIds.length > 0
    ) ?? legacyParityGroups.find((candidate) => candidate.missingLegacyScreenIds.length > 0);

  if (!group) {
    return null;
  }

  const nextWorkItemId = group.missingLegacyScreenIds[0];
  const nextWorkItem = legacyParityWorkItems.find((item) => item.id === nextWorkItemId);

  if (!nextWorkItem) {
    throw new Error(`Missing parity work item for legacy screen: ${nextWorkItemId}`);
  }

  return {
    ...nextWorkItem,
    recommendedBecause:
      group.partiallyCoveredLegacyScreenIds.length > 0
        ? `The ${group.group} group already has renderer coverage, so ${nextWorkItem.title} is the next adjacent missing screen to close before branching into untouched areas.`
        : `${nextWorkItem.title} is the first remaining gap in the ${group.group} group.`
  };
}

export function getLegacyParityPrSummary() {
  const summary = getLegacyParitySummary();
  const nextWorkItem = getNextLegacyParityWorkItem();
  const activeCoverage = legacyParityGroups
    .filter(
      (group) =>
        group.partiallyCoveredLegacyScreenIds.length > 0 || group.missingLegacyScreenIds.length > 0
    )
    .map(formatGroupCoverage)
    .join("; ");

  const lines = [
    "## Legacy parity review",
    `- Reviewed legacy screens: ${summary.totalLegacyScreens}`,
    `- Partially covered legacy screens: ${summary.partiallyCoveredLegacyScreens}`,
    `- Missing legacy screens: ${summary.missingLegacyScreens}`,
    `- Feature groups tracked: ${summary.featureGroups}`,
    `- Current grouped coverage: ${activeCoverage}`
  ];

  if (nextWorkItem) {
    lines.push(
      `- Next recommended work item: \`${nextWorkItem.id}\` (${nextWorkItem.title}) in ${nextWorkItem.group}`,
      `- Why next: ${nextWorkItem.recommendedBecause}`,
      `- Legacy scope: ${nextWorkItem.summary}`,
      `- Key actions: ${nextWorkItem.stubActions.join(", ")}`,
      `- Key surfaces: ${nextWorkItem.surfaces.join(", ")}`
    );
  }

  return lines.join("\n");
}

export const getLegacyParityPullRequestSummary = getLegacyParityPrSummary;

const isDirectExecution =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  console.log(getLegacyParityPrSummary());
}
