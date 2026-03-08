import {
  formatPushToTalkShortcut,
  normalizePushToTalkShortcut
} from "./voiceActivation";

export const shortcutTargetOptions = [
  {
    value: "toggleMute",
    label: "Toggle mute",
    description: "Mute or unmute your microphone without leaving the workspace."
  },
  {
    value: "selectSystemOutput",
    label: "Route output",
    description: "Send playback back to the system output device."
  },
  {
    value: "toggleLatencyDetails",
    label: "Toggle diagnostics",
    description: "Show or hide the live latency, jitter, and packet-loss panel."
  },
  {
    value: "cycleChannel",
    label: "Cycle room",
    description: "Move to the next available room in the current channel list."
  }
] as const;

export type AppClientShortcutTarget = (typeof shortcutTargetOptions)[number]["value"];

export type AppClientShortcutBinding = {
  shortcut: string;
  target: AppClientShortcutTarget;
};

const defaultShortcutByTarget: Record<AppClientShortcutTarget, string> = {
  toggleMute: "KeyM",
  selectSystemOutput: "KeyO",
  toggleLatencyDetails: "KeyL",
  cycleChannel: "KeyR"
};

const shortcutTargetSet = new Set<AppClientShortcutTarget>(
  shortcutTargetOptions.map((option) => option.value)
);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null
);

export const isShortcutTarget = (value: unknown): value is AppClientShortcutTarget => (
  typeof value === "string" && shortcutTargetSet.has(value as AppClientShortcutTarget)
);

export const getDefaultShortcutBinding = (target: AppClientShortcutTarget): AppClientShortcutBinding => ({
  target,
  shortcut: defaultShortcutByTarget[target]
});

export const getShortcutTargetOption = (target: AppClientShortcutTarget) => (
  shortcutTargetOptions.find((option) => option.value === target) ?? null
);

export const findNextShortcutTarget = (
  bindings: readonly AppClientShortcutBinding[]
): AppClientShortcutTarget | null => (
  shortcutTargetOptions.find((option) => (
    !bindings.some((binding) => binding.target === option.value)
  ))?.value ?? null
);

export const normalizeShortcutBindings = (bindings?: unknown): AppClientShortcutBinding[] => {
  if (!Array.isArray(bindings)) {
    return [];
  }

  const seenTargets = new Set<AppClientShortcutTarget>();
  const normalizedBindings: AppClientShortcutBinding[] = [];

  for (const binding of bindings) {
    if (!isRecord(binding) || !isShortcutTarget(binding.target) || typeof binding.shortcut !== "string") {
      continue;
    }

    if (seenTargets.has(binding.target)) {
      continue;
    }

    seenTargets.add(binding.target);
    normalizedBindings.push({
      target: binding.target,
      shortcut: normalizePushToTalkShortcut(binding.shortcut)
    });
  }

  return normalizedBindings;
};

export const formatShortcutBinding = (binding: AppClientShortcutBinding) => (
  `${getShortcutTargetOption(binding.target)?.label ?? binding.target}: ${formatPushToTalkShortcut(binding.shortcut)}`
);
