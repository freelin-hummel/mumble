import assert from "node:assert/strict";
import test from "node:test";

import {
  DSP_STORAGE_KEY,
  createDspPipeline,
  defaultDspSettings,
  loadDspSettings,
  persistDspSettings,
  setDspFeature
} from "../src/dspPipeline.mjs";

const createMemoryStorage = (seed = {}) => {
  const store = new Map(Object.entries(seed));

  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, value);
    }
  };
};

test("DSP settings default to a safe, normalized pipeline", () => {
  const pipeline = createDspPipeline();

  assert.deepEqual(pipeline.settings, defaultDspSettings);
  assert.equal(pipeline.isBypassed, false);
  assert.deepEqual(pipeline.activeStages, [
    "Automatic gain control",
    "Noise suppression"
  ]);
});

test("toggling a DSP feature updates the pipeline immediately and persists the new state", () => {
  const storage = createMemoryStorage();
  const pipeline = setDspFeature(defaultDspSettings, "echoCancellation", true, storage);

  assert.equal(pipeline.settings.echoCancellation, true);
  assert.equal(pipeline.isBypassed, false);
  assert.match(storage.getItem(DSP_STORAGE_KEY), /"echoCancellation":true/);
  assert.deepEqual(pipeline.activeStages, [
    "Automatic gain control",
    "Noise suppression",
    "Echo cancellation"
  ]);
});

test("persisted DSP settings survive a reload and malformed values fall back to defaults", () => {
  const persistedStorage = createMemoryStorage();
  persistDspSettings(
    {
      agc: false,
      noiseSuppression: false,
      echoCancellation: true
    },
    persistedStorage
  );

  assert.deepEqual(loadDspSettings(persistedStorage), {
    agc: false,
    noiseSuppression: false,
    echoCancellation: true
  });

  const malformedStorage = createMemoryStorage({
    [DSP_STORAGE_KEY]: "{\"agc\":\"loud\""
  });

  assert.deepEqual(loadDspSettings(malformedStorage), defaultDspSettings);
});
