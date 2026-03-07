export const DEFAULT_PUSH_TO_TALK_SHORTCUT = "Space";
export const DEFAULT_VAD_START_THRESHOLD = 0.18;
export const DEFAULT_VAD_STOP_THRESHOLD = 0.12;

export type VoiceActivationMode = "muted" | "vad-armed" | "vad-live" | "ptt-armed" | "ptt-live";

export type VoiceActivationState = {
  mode: VoiceActivationMode;
  inputLevel: number;
  outputLevel: number;
  isTransmitting: boolean;
  voiceDetected: boolean;
  pushToTalkPressed: boolean;
};

export type VoiceActivationOptions = {
  inputLevel: number;
  captureEnabled: boolean;
  selfMuted: boolean;
  pushToTalk: boolean;
  pushToTalkPressed: boolean;
  inputGain: number;
  outputGain: number;
  vadStartThreshold?: number;
  vadStopThreshold?: number;
};

type KeyboardShortcutEvent = {
  code?: string | null;
  key?: string | null;
};

export function createInitialVoiceActivationState(): VoiceActivationState {
  return {
    mode: "vad-armed",
    inputLevel: 0,
    outputLevel: 0,
    isTransmitting: false,
    voiceDetected: false,
    pushToTalkPressed: false
  };
}

export function normalizePushToTalkShortcut(shortcut?: string | null) {
  if (typeof shortcut !== "string") {
    return DEFAULT_PUSH_TO_TALK_SHORTCUT;
  }

  const trimmedShortcut = shortcut.trim();
  if (!trimmedShortcut) {
    return DEFAULT_PUSH_TO_TALK_SHORTCUT;
  }

  if (/^[A-Za-z]$/.test(trimmedShortcut)) {
    return `Key${trimmedShortcut.toUpperCase()}`;
  }

  if (/^\d$/.test(trimmedShortcut)) {
    return `Digit${trimmedShortcut}`;
  }

  return trimmedShortcut;
}

export function formatPushToTalkShortcut(shortcut?: string | null) {
  const normalizedShortcut = normalizePushToTalkShortcut(shortcut);

  if (normalizedShortcut === "Space") {
    return "Space";
  }

  if (normalizedShortcut.startsWith("Key") && normalizedShortcut.length === 4) {
    return normalizedShortcut.slice(3);
  }

  if (normalizedShortcut.startsWith("Digit") && normalizedShortcut.length === 6) {
    return normalizedShortcut.slice(5);
  }

  return normalizedShortcut.replace(/(Left|Right)$/, " $1");
}

export function shortcutFromKeyboardEvent(event: KeyboardShortcutEvent) {
  if (typeof event.code === "string" && event.code.trim().length > 0) {
    return normalizePushToTalkShortcut(event.code);
  }

  if (typeof event.key === "string" && event.key.trim().length > 0) {
    return normalizePushToTalkShortcut(event.key);
  }

  return null;
}

export function matchesPushToTalkShortcut(shortcut: string, event: KeyboardShortcutEvent) {
  const resolvedShortcut = shortcutFromKeyboardEvent(event);
  return resolvedShortcut !== null && resolvedShortcut === normalizePushToTalkShortcut(shortcut);
}

export function stepVoiceActivation(
  currentState: VoiceActivationState,
  {
    inputLevel,
    captureEnabled,
    selfMuted,
    pushToTalk,
    pushToTalkPressed,
    inputGain,
    outputGain,
    vadStartThreshold = DEFAULT_VAD_START_THRESHOLD,
    vadStopThreshold = DEFAULT_VAD_STOP_THRESHOLD
  }: VoiceActivationOptions
): VoiceActivationState {
  const normalizedInputLevel = clampLevel(inputLevel * normalizeGain(inputGain));
  const normalizedOutputLevel = clampLevel(normalizedInputLevel * normalizeGain(outputGain));

  if (!captureEnabled || selfMuted) {
    return {
      mode: "muted",
      inputLevel: normalizedInputLevel,
      outputLevel: 0,
      isTransmitting: false,
      voiceDetected: false,
      pushToTalkPressed: false
    };
  }

  if (pushToTalk) {
    return {
      mode: pushToTalkPressed ? "ptt-live" : "ptt-armed",
      inputLevel: normalizedInputLevel,
      outputLevel: pushToTalkPressed ? normalizedOutputLevel : 0,
      isTransmitting: pushToTalkPressed,
      voiceDetected: false,
      pushToTalkPressed
    };
  }

  const normalizedStartThreshold = clampLevel(vadStartThreshold);
  const normalizedStopThreshold = clampLevel(Math.min(normalizedStartThreshold, vadStopThreshold));
  const voiceDetected = currentState.voiceDetected
    ? normalizedInputLevel >= normalizedStopThreshold
    : normalizedInputLevel >= normalizedStartThreshold;

  return {
    mode: voiceDetected ? "vad-live" : "vad-armed",
    inputLevel: normalizedInputLevel,
    outputLevel: voiceDetected ? normalizedOutputLevel : 0,
    isTransmitting: voiceDetected,
    voiceDetected,
    pushToTalkPressed: false
  };
}

function clampLevel(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function normalizeGain(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value) / 100;
}
