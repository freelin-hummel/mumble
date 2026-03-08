import type { AppClientState } from "./appClientState.js";
import type { UdpVoiceTransportStatus } from "./udpVoiceTransport.js";

export type DiagnosticsLogLevel = "info" | "warn" | "error";

export type DiagnosticsLogEntry = {
  timestamp: string;
  level: DiagnosticsLogLevel;
  event: string;
  context: Record<string, unknown> | null;
};

export type RendererDiagnosticsSnapshot = {
  audioRuntime?: {
    inputLevel: number;
    outputLevel: number;
    mode: string;
    isTransmitting: boolean;
    meteringError: string | null;
    availableInputDevices: number;
    availableOutputDevices: number;
    outputRoutingReady: boolean;
  };
};

export type DiagnosticsBundle = {
  schemaVersion: 1;
  exportedAt: string;
  appVersion: string;
  platform: NodeJS.Platform;
  state: AppClientState;
  network: {
    telemetry: AppClientState["telemetry"];
    voiceTransport: UdpVoiceTransportStatus;
  };
  audio: {
    settings: AppClientState["audio"];
    runtime: RendererDiagnosticsSnapshot["audioRuntime"] | null;
  };
  logs: DiagnosticsLogEntry[];
};

const DEFAULT_MAX_LOG_ENTRIES = 200;

const cloneValue = <T>(value: T): T => {
  if (value == null) {
    return value;
  }

  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
};

const normalizeContext = (context?: Record<string, unknown>) => {
  if (!context || Object.keys(context).length === 0) {
    return null;
  }

  return cloneValue(context);
};

export class DiagnosticsLogStore {
  private readonly maxEntries: number;
  private entries: DiagnosticsLogEntry[] = [];

  public constructor(maxEntries = DEFAULT_MAX_LOG_ENTRIES) {
    this.maxEntries = Math.max(1, Math.floor(maxEntries));
  }

  public log(level: DiagnosticsLogLevel, event: string, context?: Record<string, unknown>) {
    this.entries.push({
      timestamp: new Date().toISOString(),
      level,
      event,
      context: normalizeContext(context)
    });

    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  public getEntries() {
    return cloneValue(this.entries);
  }
}

const diagnosticsLogStore = new DiagnosticsLogStore();

export const getDiagnosticsLogStore = () => diagnosticsLogStore;

export const createDiagnosticsBundle = ({
  state,
  logs,
  appVersion,
  platform,
  voiceTransport,
  rendererSnapshot
}: {
  state: AppClientState;
  logs: DiagnosticsLogEntry[];
  appVersion: string;
  platform: NodeJS.Platform;
  voiceTransport: UdpVoiceTransportStatus;
  rendererSnapshot?: RendererDiagnosticsSnapshot;
}): DiagnosticsBundle => ({
  schemaVersion: 1,
  exportedAt: new Date().toISOString(),
  appVersion,
  platform,
  state: cloneValue(state),
  network: {
    telemetry: cloneValue(state.telemetry),
    voiceTransport: cloneValue(voiceTransport)
  },
  audio: {
    settings: cloneValue(state.audio),
    runtime: rendererSnapshot?.audioRuntime ? cloneValue(rendererSnapshot.audioRuntime) : null
  },
  logs: cloneValue(logs)
});
