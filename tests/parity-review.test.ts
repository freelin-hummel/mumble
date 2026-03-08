import assert from "node:assert/strict";
import test from "node:test";

import { desktopScreens } from "../legacy/clients/web-client/src/features.js";
import {
  getLegacyParitySummary,
  legacyParityGroups,
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
