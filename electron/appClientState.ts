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

export type AppClientChatMessage = {
  id: string;
  author: string;
  body: string;
  channelId: string | null;
  sentAt: string;
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
  messages: AppClientChatMessage[];
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

export type AppClientLiveSession = {
  channels: AppClientChannel[];
  participants: AppClientParticipant[];
  messages?: AppClientChatMessage[];
  activeChannelId?: string | null;
  telemetry?: Partial<AppClientTelemetry> | null;
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

const MAX_CHAT_MESSAGES = 100;

const cloneState = <T>(value: T): T => {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
};

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
  messages: [],
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

const normalizeChannelList = (channels: AppClientChannel[]) => {
  const seenChannelIds = new Set<string>();
  return channels.filter((channel) => {
    if (typeof channel.id !== "string" || channel.id.length === 0 || seenChannelIds.has(channel.id)) {
      return false;
    }

    seenChannelIds.add(channel.id);
    return typeof channel.name === "string" && channel.name.trim().length > 0;
  }).map((channel) => ({
    id: channel.id,
    name: channel.name.trim(),
    parentId: typeof channel.parentId === "string" && channel.parentId.length > 0 ? channel.parentId : null
  }));
};

const normalizeParticipantList = (participants: AppClientParticipant[], channelIds: Set<string>) => {
  const seenParticipantIds = new Set<string>();
  return participants.filter((participant) => {
    if (typeof participant.id !== "string" || participant.id.length === 0 || seenParticipantIds.has(participant.id)) {
      return false;
    }

    if (typeof participant.name !== "string" || participant.name.trim().length === 0) {
      return false;
    }

    if (!channelIds.has(participant.channelId)) {
      return false;
    }

    seenParticipantIds.add(participant.id);
    return true;
  }).map((participant) => ({
    id: participant.id,
    name: participant.name.trim(),
    channelId: participant.channelId,
    status: participant.status === "live" || participant.status === "muted" ? participant.status : "idle",
    isSelf: participant.isSelf === true ? true : undefined
  }));
};

const normalizeChatMessageList = (messages: AppClientChatMessage[], channelIds: Set<string>) => {
  const seenMessageIds = new Set<string>();
  return messages.filter((message) => {
    if (typeof message.id !== "string" || message.id.length === 0 || seenMessageIds.has(message.id)) {
      return false;
    }

    if (typeof message.author !== "string" || message.author.trim().length === 0) {
      return false;
    }

    if (typeof message.body !== "string" || message.body.trim().length === 0) {
      return false;
    }

    if (message.channelId !== null && !channelIds.has(message.channelId)) {
      return false;
    }

    seenMessageIds.add(message.id);
    return true;
  }).map((message) => ({
    id: message.id,
    author: message.author.trim(),
    body: message.body.trim(),
    channelId: message.channelId,
    sentAt: Number.isNaN(Date.parse(message.sentAt)) ? new Date(0).toISOString() : message.sentAt,
    isSelf: message.isSelf === true ? true : undefined
  })).slice(-MAX_CHAT_MESSAGES);
};

const normalizeTelemetryMetric = (value: number | null | undefined, fallback: number | null) => {
  if (value === null) {
    return null;
  }

  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    return fallback;
  }

  return Math.round(value * 10) / 10;
};

const resolveActiveChannelId = (
  currentState: AppClientState,
  channels: AppClientChannel[],
  participants: AppClientParticipant[],
  requestedChannelId?: string | null
) => {
  const validChannelIds = new Set(channels.map((channel) => channel.id));

  if (typeof requestedChannelId === "string" && validChannelIds.has(requestedChannelId)) {
    return requestedChannelId;
  }

  if (currentState.activeChannelId && validChannelIds.has(currentState.activeChannelId)) {
    return currentState.activeChannelId;
  }

  const selfParticipant = participants.find((participant) => participant.isSelf && validChannelIds.has(participant.channelId));
  if (selfParticipant) {
    return selfParticipant.channelId;
  }

  return channels[0]?.id ?? null;
};

export const mergeLiveSessionState = (currentState: AppClientState, session: AppClientLiveSession): AppClientState => {
  const channels = normalizeChannelList(session.channels);
  const channelIds = new Set(channels.map((channel) => channel.id));
  const participants = normalizeParticipantList(session.participants, channelIds);
  const messages = normalizeChatMessageList(session.messages ?? currentState.messages, channelIds);

  return {
    ...currentState,
    channels,
    activeChannelId: resolveActiveChannelId(currentState, channels, participants, session.activeChannelId),
    participants,
    messages,
    telemetry: {
      latencyMs: normalizeTelemetryMetric(session.telemetry?.latencyMs, currentState.telemetry.latencyMs),
      jitterMs: normalizeTelemetryMetric(session.telemetry?.jitterMs, currentState.telemetry.jitterMs),
      packetLoss: normalizeTelemetryMetric(session.telemetry?.packetLoss, currentState.telemetry.packetLoss)
    }
  };
};

const buildLocalChatMessageId = () => {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const appendLocalChatMessageState = (currentState: AppClientState, body: string): AppClientState => {
  if (currentState.connection.status !== "connected") {
    throw new Error("Join a server before sending chat.");
  }

  const normalizedBody = body.trim();
  if (!normalizedBody) {
    throw new Error("Enter a message before sending.");
  }

  const nextMessage: AppClientChatMessage = {
    id: buildLocalChatMessageId(),
    author: currentState.connection.nickname || "You",
    body: normalizedBody,
    channelId: currentState.activeChannelId,
    sentAt: new Date().toISOString(),
    isSelf: true
  };

  return {
    ...currentState,
    messages: [...currentState.messages, nextMessage].slice(-MAX_CHAT_MESSAGES)
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
        channels: [],
        activeChannelId: null,
        participants: [],
        messages: [],
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
      messages: [],
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

  public syncLiveSession(session: AppClientLiveSession) {
    this.updateState((currentState) => currentState.connection.status === "connected"
      ? mergeLiveSessionState(currentState, session)
      : currentState);
    return this.getState();
  }

  public sendChatMessage(body: string) {
    this.updateState((currentState) => appendLocalChatMessageState(currentState, body));
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
