import {
  DEFAULT_PUSH_TO_TALK_SHORTCUT,
  normalizePushToTalkShortcut
} from "../src/voiceActivation.js";

export type AppClientConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
export type AppClientParticipantStatus = "live" | "muted" | "idle";

export type AppClientChannel = {
  id: string;
  name: string;
  parentId: string | null;
};

export type AppClientParticipant = {
  id: string;
  name: string;
  channelId: string;
  status: AppClientParticipantStatus;
  isSelf?: boolean;
};

export type AppClientAudioSettings = {
  inputDeviceId: string;
  outputDeviceId: string;
  captureEnabled: boolean;
  selfMuted: boolean;
  inputGain: number;
  outputGain: number;
};

export type AppClientPreferences = {
  pushToTalk: boolean;
  pushToTalkShortcut: string;
  autoReconnect: boolean;
  notificationsEnabled: boolean;
  showLatencyDetails: boolean;
};

export type AppClientTelemetry = {
  latencyMs: number | null;
  jitterMs: number | null;
  packetLoss: number | null;
};

export type AppClientConnectionState = {
  status: AppClientConnectionStatus;
  serverAddress: string;
  nickname: string;
  error: string | null;
};

export type AppClientState = {
  connection: AppClientConnectionState;
  channels: AppClientChannel[];
  activeChannelId: string | null;
  participants: AppClientParticipant[];
  audio: AppClientAudioSettings;
  preferences: AppClientPreferences;
  telemetry: AppClientTelemetry;
  recentServers: string[];
};

export const PERSISTED_APP_CLIENT_STATE_VERSION = 1;

export type PersistedAppClientState = {
  schemaVersion: typeof PERSISTED_APP_CLIENT_STATE_VERSION;
  serverAddress: string;
  nickname: string;
  recentServers: string[];
  audio: AppClientAudioSettings;
  preferences: AppClientPreferences;
};

type AppClientListener = (state: AppClientState) => void;

type AppClientStoreOptions = {
  persistedState?: unknown | null;
  onPersist?: (state: PersistedAppClientState) => void;
  waitForConnection?: () => Promise<void>;
};

export type AppClientConnectRequest = {
  serverAddress: string;
  nickname: string;
};

const defaultAudioSettings = Object.freeze<AppClientAudioSettings>({
  inputDeviceId: "default",
  outputDeviceId: "default",
  captureEnabled: true,
  selfMuted: false,
  inputGain: 100,
  outputGain: 100
});

const defaultPreferences = Object.freeze<AppClientPreferences>({
  pushToTalk: false,
  pushToTalkShortcut: DEFAULT_PUSH_TO_TALK_SHORTCUT,
  autoReconnect: true,
  notificationsEnabled: true,
  showLatencyDetails: false
});

const defaultTelemetry = Object.freeze<AppClientTelemetry>({
  latencyMs: null,
  jitterMs: null,
  packetLoss: null
});

const cloneState = <T>(value: T): T => {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
};

const clampGain = (value: number) => Math.min(150, Math.max(0, Math.round(value)));

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null
);

const normalizeAudioSettings = (audio?: Partial<AppClientAudioSettings> | null): AppClientAudioSettings => ({
  inputDeviceId: typeof audio?.inputDeviceId === "string" && audio.inputDeviceId.length > 0
    ? audio.inputDeviceId
    : defaultAudioSettings.inputDeviceId,
  outputDeviceId: typeof audio?.outputDeviceId === "string" && audio.outputDeviceId.length > 0
    ? audio.outputDeviceId
    : defaultAudioSettings.outputDeviceId,
  captureEnabled: typeof audio?.captureEnabled === "boolean"
    ? audio.captureEnabled
    : defaultAudioSettings.captureEnabled,
  selfMuted: typeof audio?.selfMuted === "boolean"
    ? audio.selfMuted
    : defaultAudioSettings.selfMuted,
  inputGain: typeof audio?.inputGain === "number"
    ? clampGain(audio.inputGain)
    : defaultAudioSettings.inputGain,
  outputGain: typeof audio?.outputGain === "number"
    ? clampGain(audio.outputGain)
    : defaultAudioSettings.outputGain
});

const normalizePreferences = (preferences?: Partial<AppClientPreferences> | null): AppClientPreferences => ({
  pushToTalk: typeof preferences?.pushToTalk === "boolean"
    ? preferences.pushToTalk
    : defaultPreferences.pushToTalk,
  pushToTalkShortcut: normalizePushToTalkShortcut(preferences?.pushToTalkShortcut),
  autoReconnect: typeof preferences?.autoReconnect === "boolean"
    ? preferences.autoReconnect
    : defaultPreferences.autoReconnect,
  notificationsEnabled: typeof preferences?.notificationsEnabled === "boolean"
    ? preferences.notificationsEnabled
    : defaultPreferences.notificationsEnabled,
  showLatencyDetails: typeof preferences?.showLatencyDetails === "boolean"
    ? preferences.showLatencyDetails
    : defaultPreferences.showLatencyDetails
});

const normalizeRecentServers = (recentServers?: string[] | null) => {
  if (!Array.isArray(recentServers)) {
    return [];
  }

  return recentServers
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim())
    .slice(0, 5);
};

const buildRecentServers = (recentServers: string[], serverAddress: string) => {
  const normalizedAddress = serverAddress.trim();
  return [normalizedAddress, ...recentServers.filter((value) => value !== normalizedAddress)].slice(0, 5);
};

export const migratePersistedAppClientState = (persistedState?: unknown | null): PersistedAppClientState | null => {
  if (!isRecord(persistedState)) {
    return null;
  }

  const schemaVersion = persistedState.schemaVersion;
  if (schemaVersion !== undefined && schemaVersion !== PERSISTED_APP_CLIENT_STATE_VERSION) {
    return null;
  }

  return {
    schemaVersion: PERSISTED_APP_CLIENT_STATE_VERSION,
    serverAddress: typeof persistedState.serverAddress === "string" ? persistedState.serverAddress : "",
    nickname: typeof persistedState.nickname === "string" ? persistedState.nickname : "",
    recentServers: normalizeRecentServers(persistedState.recentServers as string[] | null | undefined),
    audio: normalizeAudioSettings(isRecord(persistedState.audio) ? persistedState.audio : null),
    preferences: normalizePreferences(isRecord(persistedState.preferences) ? persistedState.preferences : null)
  };
};

export const createPersistedAppClientState = (state: AppClientState): PersistedAppClientState => ({
  schemaVersion: PERSISTED_APP_CLIENT_STATE_VERSION,
  serverAddress: state.connection.serverAddress,
  nickname: state.connection.nickname,
  recentServers: [...state.recentServers],
  audio: cloneState(state.audio),
  preferences: cloneState(state.preferences)
});

const createDisconnectedState = (persistedState?: PersistedAppClientState | null): AppClientState => ({
  connection: {
    status: "disconnected",
    serverAddress: typeof persistedState?.serverAddress === "string" ? persistedState.serverAddress : "",
    nickname: typeof persistedState?.nickname === "string" ? persistedState.nickname : "",
    error: null
  },
  channels: [],
  activeChannelId: null,
  participants: [],
  audio: normalizeAudioSettings(persistedState?.audio),
  preferences: normalizePreferences(persistedState?.preferences),
  telemetry: cloneState(defaultTelemetry),
  recentServers: normalizeRecentServers(persistedState?.recentServers)
});

const getPortValue = (serverAddress: string) => {
  if (serverAddress.startsWith("[")) {
    const ipv6Match = /^\[(?<host>[^\]]+)\](?::(?<port>[^:]+))?$/.exec(serverAddress);
    if (!ipv6Match?.groups?.host) {
      throw new Error("IPv6 server addresses must use bracket notation.");
    }

    return ipv6Match.groups.port ?? null;
  }

  if (serverAddress.includes("[") || serverAddress.includes("]")) {
    throw new Error("IPv6 server addresses must use bracket notation.");
  }

  const separatorCount = serverAddress.split(":").length - 1;
  if (separatorCount === 1) {
    const [hostValue, portValue] = serverAddress.split(":");
    if (!hostValue?.trim()) {
      throw new Error("Enter a valid server address to join voice.");
    }

    return portValue ?? null;
  }

  if (!serverAddress.trim()) {
    throw new Error("Enter a valid server address to join voice.");
  }

  return null;
};

const assertConnectRequest = ({ serverAddress, nickname }: AppClientConnectRequest) => {
  const normalizedServerAddress = serverAddress.trim();
  const normalizedNickname = nickname.trim();

  if (!normalizedServerAddress) {
    throw new Error("Enter a server address to join voice.");
  }

  if (!normalizedNickname) {
    throw new Error("Enter a nickname before joining.");
  }

  const portValue = getPortValue(normalizedServerAddress);
  if (portValue !== null) {
    if (portValue.length === 0) {
      throw new Error("Server ports must be between 1 and 65535.");
    }

    const port = Number(portValue);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Server ports must be between 1 and 65535.");
    }
  }

  return {
    serverAddress: normalizedServerAddress,
    nickname: normalizedNickname
  };
};

export class AppClientStore {
  private state: AppClientState;
  private readonly listeners = new Set<AppClientListener>();
  private readonly onPersist?: (state: PersistedAppClientState) => void;
  private readonly waitForConnection: () => Promise<void>;

  public constructor({ persistedState, onPersist, waitForConnection }: AppClientStoreOptions = {}) {
    this.state = createDisconnectedState(migratePersistedAppClientState(persistedState));
    this.onPersist = onPersist;
    this.waitForConnection = waitForConnection ?? (() => new Promise((resolve) => {
      setTimeout(resolve, 250);
    }));
  }

  public getState() {
    return cloneState(this.state);
  }

  public subscribe(listener: AppClientListener) {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async connect(request: AppClientConnectRequest) {
    try {
      const normalizedRequest = assertConnectRequest(request);
      this.updateState((currentState) => ({
        ...currentState,
        connection: {
          status: "connecting",
          serverAddress: normalizedRequest.serverAddress,
          nickname: normalizedRequest.nickname,
          error: null
        },
        recentServers: buildRecentServers(currentState.recentServers, normalizedRequest.serverAddress)
      }));
      await this.waitForConnection();
      this.updateState((currentState) => ({
        ...currentState,
        connection: {
          ...currentState.connection,
          status: "connected",
          error: null
        },
        channels: [],
        activeChannelId: null,
        participants: [],
        telemetry: cloneState(defaultTelemetry)
      }));
      return this.getState();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to connect right now.";
      this.updateState((currentState) => ({
        ...currentState,
        connection: {
          ...currentState.connection,
          status: "error",
          error: message
        }
      }));
      throw error;
    }
  }

  public disconnect() {
    this.updateState((currentState) => ({
      ...currentState,
      connection: {
        ...currentState.connection,
        status: "disconnected",
        error: null
      },
      channels: [],
      activeChannelId: null,
      participants: [],
      telemetry: cloneState(defaultTelemetry)
    }));
    return this.getState();
  }

  public selectChannel(channelId: string) {
    this.updateState((currentState) => {
      if (currentState.connection.status !== "connected") {
        return currentState;
      }

      const nextChannel = currentState.channels.find((channel) => channel.id === channelId);
      if (!nextChannel) {
        return currentState;
      }

      return {
        ...currentState,
        activeChannelId: nextChannel.id
      };
    });
    return this.getState();
  }

  public updateAudioSettings(audio: Partial<AppClientAudioSettings>) {
    this.updateState((currentState) => ({
      ...currentState,
      audio: normalizeAudioSettings({
        ...currentState.audio,
        ...audio
      })
    }));
    return this.getState();
  }

  public updatePreferences(preferences: Partial<AppClientPreferences>) {
    this.updateState((currentState) => ({
      ...currentState,
      preferences: normalizePreferences({
        ...currentState.preferences,
        ...preferences
      })
    }));
    return this.getState();
  }

  private updateState(updater: (state: AppClientState) => AppClientState) {
    this.state = updater(this.state);
    this.persistState();
    const nextState = this.getState();
    this.listeners.forEach((listener) => {
      listener(nextState);
    });
  }

  private persistState() {
    this.onPersist?.(createPersistedAppClientState(this.state));
  }
}
