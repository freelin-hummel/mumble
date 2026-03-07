export const DSP_STORAGE_KEY = "mumble.dsp.settings";

export const defaultDspSettings = Object.freeze({
  agc: true,
  noiseSuppression: true,
  echoCancellation: false
});

export const dspFeatures = Object.freeze([
  {
    key: "agc",
    label: "Adaptive gain",
    description: "Keep mic levels consistent as voices get louder or softer.",
    stageLabel: "Automatic gain control"
  },
  {
    key: "noiseSuppression",
    label: "Noise suppression",
    description: "Reduce constant fan and room noise before transmission.",
    stageLabel: "Noise suppression"
  },
  {
    key: "echoCancellation",
    label: "Echo cancellation",
    description: "Filter speaker bleed when monitoring through open-air output.",
    stageLabel: "Echo cancellation"
  }
]);

const getDefaultStorage = () => {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

export const normalizeDspSettings = (settings = {}) => ({
  agc: typeof settings.agc === "boolean" ? settings.agc : defaultDspSettings.agc,
  noiseSuppression: typeof settings.noiseSuppression === "boolean"
    ? settings.noiseSuppression
    : defaultDspSettings.noiseSuppression,
  echoCancellation: typeof settings.echoCancellation === "boolean"
    ? settings.echoCancellation
    : defaultDspSettings.echoCancellation
});

export const createDspPipeline = (settings = defaultDspSettings) => {
  const normalizedSettings = normalizeDspSettings(settings);
  const activeStages = dspFeatures
    .filter(({ key }) => normalizedSettings[key])
    .map(({ stageLabel }) => stageLabel);

  return {
    settings: normalizedSettings,
    activeStages,
    isBypassed: activeStages.length === 0
  };
};

export const loadDspSettings = (storage = getDefaultStorage()) => {
  if (!storage?.getItem) {
    return normalizeDspSettings();
  }

  try {
    const rawValue = storage.getItem(DSP_STORAGE_KEY);

    if (!rawValue) {
      return normalizeDspSettings();
    }

    return normalizeDspSettings(JSON.parse(rawValue));
  } catch {
    return normalizeDspSettings();
  }
};

export const loadDspPipeline = (storage = getDefaultStorage()) => (
  createDspPipeline(loadDspSettings(storage))
);

export const persistDspSettings = (settings, storage = getDefaultStorage()) => {
  const normalizedSettings = normalizeDspSettings(settings);

  if (storage?.setItem) {
    try {
      storage.setItem(DSP_STORAGE_KEY, JSON.stringify(normalizedSettings));
    } catch {
      return normalizedSettings;
    }
  }

  return normalizedSettings;
};

export const setDspFeature = (settings, feature, enabled, storage = getDefaultStorage()) => {
  if (!(feature in defaultDspSettings)) {
    throw new TypeError(`Unknown DSP feature: ${feature}`);
  }

  const nextSettings = {
    ...normalizeDspSettings(settings),
    [feature]: Boolean(enabled)
  };

  persistDspSettings(nextSettings, storage);

  return createDspPipeline(nextSettings);
};
