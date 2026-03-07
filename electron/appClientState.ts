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

type PersistedAppClientState = {
  serverAddress: string;
  nickname: string;
  recentServers: string[];
  audio: AppClientAudioSettings;
  preferences: AppClientPreferences;
};

type AppClientListener = (state: AppClientState) => void;

type AppClientStoreOptions = {
  persistedState?: Partial<PersistedAppClientState> | null;
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
  autoReconnect: true,
  notificationsEnabled: true,
  showLatencyDetails: false
});

const defaultTelemetry = Object.freeze<AppClientTelemetry>({
  latencyMs: null,
  jitterMs: null,
  packetLoss: null
});

const defaultChannels: AppClientChannel[] = [
  { id: "lobby", name: "Lobby", parentId: null },
  { id: "ops", name: "Ops", parentId: null },
  { id: "afk", name: "AFK", parentId: null }
];

const createParticipants = (nickname: string): AppClientParticipant[] => ([
  { id: "self", name: nickname, channelId: "lobby", status: "live", isSelf: true },
  { id: "aster", name: "Aster", channelId: "lobby", status: "live" },
  { id: "milo", name: "Milo", channelId: "lobby", status: "muted" },
  { id: "quinn", name: "Quinn", channelId: "ops", status: "idle" },
  { id: "rhea", name: "Rhea", channelId: "afk", status: "idle" }
]);

const cloneState = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const clampGain = (value: number) => Math.min(150, Math.max(0, Math.round(value)));

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

const buildTelemetry = (serverAddress: string): AppClientTelemetry => {
  const seed = [...serverAddress].reduce((total, character) => total + character.charCodeAt(0), 0);
  return {
    latencyMs: 18 + (seed % 24),
    jitterMs: 2 + (seed % 5),
    packetLoss: Number(((seed % 4) * 0.1).toFixed(1))
  };
};

const createDisconnectedState = (persistedState?: Partial<PersistedAppClientState> | null): AppClientState => ({
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

const assertConnectRequest = ({ serverAddress, nickname }: AppClientConnectRequest) => {
  const normalizedServerAddress = serverAddress.trim();
  const normalizedNickname = nickname.trim();

  if (!normalizedServerAddress) {
    throw new Error("Enter a server address to join voice.");
  }

  if (!normalizedNickname) {
    throw new Error("Enter a nickname before joining.");
  }

  const portSeparatorIndex = normalizedServerAddress.lastIndexOf(":");
  if (portSeparatorIndex > 0) {
    const portValue = normalizedServerAddress.slice(portSeparatorIndex + 1);
    if (portValue.length > 0) {
      const port = Number(portValue);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("Server ports must be between 1 and 65535.");
      }
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
    this.state = createDisconnectedState(persistedState);
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
        channels: cloneState(defaultChannels),
        activeChannelId: "lobby",
        participants: createParticipants(normalizedRequest.nickname),
        telemetry: buildTelemetry(normalizedRequest.serverAddress)
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
    this.onPersist?.({
      serverAddress: this.state.connection.serverAddress,
      nickname: this.state.connection.nickname,
      recentServers: [...this.state.recentServers],
      audio: cloneState(this.state.audio),
      preferences: cloneState(this.state.preferences)
    });
  }
}
