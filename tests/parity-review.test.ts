import assert from "node:assert/strict";
import test from "node:test";

import { desktopScreens } from "../legacy/clients/web-client/src/features.js";
import {
  getLegacyParityPrSummary,
  getLegacyParitySummary,
  getNextLegacyParityWorkItem,
  legacyParityGroups,
  legacyParityWorkItems,
  reviewedLegacyScreenIds,
  testingGaps,
  webappOnlyCapabilities
} from "../parity-review.mjs";

test("parity review accounts for every legacy screen exactly once", () => {
  const legacyIds = desktopScreens.map((screen) => screen.id).sort();
  const reviewIds = [...reviewedLegacyScreenIds].sort();

  assert.equal(new Set(reviewIds).size, reviewIds.length);
  assert.deepEqual(reviewIds, legacyIds);
});

test("parity review summary matches the grouped screen inventory", () => {
  const summary = getLegacyParitySummary();

  assert.deepEqual(summary, {
    totalLegacyScreens: 40,
    partiallyCoveredLegacyScreens: 14,
    missingLegacyScreens: 26,
    fullyImplementedLegacyScreens: 0,
    featureGroups: 6
  });

  for (const group of legacyParityGroups) {
    const groupedIds = [
      ...group.partiallyCoveredLegacyScreenIds,
      ...group.missingLegacyScreenIds
    ];

    assert.equal(groupedIds.length > 0, true);
    assert.equal(new Set(groupedIds).size, groupedIds.length);
    assert.match(group.summary, /\S/);
    assert.equal(group.evidence.length > 0, true);
  }
});

test("parity review preserves concrete testing gaps and new-client-only capabilities", () => {
  assert.equal(testingGaps.length, 3);
  assert.equal(webappOnlyCapabilities.length, 3);

  for (const gap of testingGaps) {
    assert.match(gap.area, /\S/);
    assert.match(gap.gap, /\S/);
    assert.match(gap.nextStep, /\S/);
    assert.equal(gap.evidence.length > 0, true);
  }

  for (const capability of webappOnlyCapabilities) {
    assert.match(capability.title, /\S/);
    assert.match(capability.summary, /\S/);
    assert.equal(capability.evidence.length > 0, true);
  }
});

test("parity review derives a deterministic next work item from the grouped inventory", () => {
  assert.equal(legacyParityWorkItems.length, desktopScreens.length);

  const nextWorkItem = getNextLegacyParityWorkItem();

  assert.notEqual(nextWorkItem, null);
  assert.deepEqual(nextWorkItem, {
    id: "server-information",
    title: "Server Information",
    group: "Core workspace",
    status: "missing",
    sourceUi: "ServerInformation.ui",
    summary:
      "Read-only server details, certificates, welcome text, and uptime surfaces.",
    stubActions: ["Inspect metadata", "Review certificate", "Copy server info"],
    surfaces: [
      "Identity summary",
      "Certificate details",
      "Version info",
      "Welcome message"
    ],
    groupSummary:
      "The Electron renderer covers the main voice workspace, a lightweight direct-connect flow with saved-server editing, and basic room chat, but it still lacks the broader server browser, metadata, identity, token, search, and developer-tooling flows from the legacy client.",
    evidence: [
      "src/App.tsx:783-828",
      "src/App.tsx:1044-1132",
      "tests/app-client-state.test.ts:78-91"
    ],
    recommendedBecause:
      "The Core workspace group already has renderer coverage, so Server Information is the next adjacent missing screen to close before branching into untouched areas."
  });
});

test("parity review can format a PR-ready summary from the live inventory", () => {
  const summary = getLegacyParityPrSummary();

  assert.match(summary, /^## Legacy parity review/m);
  assert.match(summary, /- Reviewed legacy screens: 40/);
  assert.match(summary, /- Partially covered legacy screens: 14/);
  assert.match(summary, /- Missing legacy screens: 26/);
  assert.match(
    summary,
    /- Next recommended work item: `server-information` \(Server Information\) in Core workspace/
  );
  assert.match(summary, /- Key actions: Inspect metadata, Review certificate, Copy server info/);
});
