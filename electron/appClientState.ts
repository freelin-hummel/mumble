import {
  DEFAULT_PUSH_TO_TALK_SHORTCUT,
  normalizePushToTalkShortcut
} from "../src/voiceActivation.js";
import {
  normalizeShortcutBindings,
  type AppClientShortcutBinding,
  type AppClientShortcutTarget
} from "../src/shortcutBindings.js";

export type AppClientConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
export type AppClientParticipantStatus = "live" | "muted" | "idle";

export type AppClientChannelPermissions = {
  traverse: boolean;
  enter: boolean;
  speak: boolean;
  muteDeafen: boolean;
  move: boolean;
  write: boolean;
};

export type AppClientChannel = {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  position: number;
  permissions: AppClientChannelPermissions;
  participantIds: string[];
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
  participantId?: string;
  sentAt: string;
  severity?: "error";
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
  shortcutBindings: AppClientShortcutBinding[];
  localNicknames: Record<string, string>;
  autoReconnect: boolean;
  notificationsEnabled: boolean;
  showLatencyDetails: boolean;
};

export type AppClientTelemetry = {
  latencyMs: number | null;
  jitterMs: number | null;
  packetLoss: number | null;
};

export type AppClientLogEvent = {
  level: "info" | "warn" | "error";
  event: string;
  context?: Record<string, unknown>;
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
  onLog?: (event: AppClientLogEvent) => void;
  waitForConnection?: () => Promise<void>;
};

export type AppClientConnectRequest = {
  serverAddress: string;
  nickname: string;
};

export type AppClientSendChatMessageRequest = {
  body: string;
  channelId?: string | null;
  participantId?: string | null;
};

export type AppClientChannelSnapshot = {
  id: string;
  name: string;
  parentId?: string | null;
  position?: number;
  permissions?: Partial<AppClientChannelPermissions>;
};

export type AppClientChannelPatch = {
  id: string;
  name?: string;
  parentId?: string | null;
  position?: number;
  permissions?: Partial<AppClientChannelPermissions>;
};

export type AppClientParticipantSnapshot = {
  id: string;
  name: string;
  channelId: string;
  status?: AppClientParticipantStatus;
  isSelf?: boolean;
};

export type AppClientParticipantPatch = {
  id: string;
  name?: string;
  channelId?: string;
  status?: AppClientParticipantStatus;
  isSelf?: boolean;
};

export type AppClientSessionSnapshot = {
  channels: AppClientChannelSnapshot[];
  participants: AppClientParticipantSnapshot[];
  activeChannelId?: string | null;
};

export type AppClientLiveSession = {
  channels: AppClientChannelSnapshot[];
  participants: AppClientParticipantSnapshot[];
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
  shortcutBindings: [],
  localNicknames: {},
  autoReconnect: true,
  notificationsEnabled: true,
  showLatencyDetails: false
});

const defaultTelemetry = Object.freeze<AppClientTelemetry>({
  latencyMs: null,
  jitterMs: null,
  packetLoss: null
});

const defaultChannelPermissions = Object.freeze<AppClientChannelPermissions>({
  traverse: true,
  enter: true,
  speak: true,
  muteDeafen: false,
  move: false,
  write: false
});
const MAX_CHAT_MESSAGES = 100;

const cloneState = <T>(value: T): T => {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
};
const isNonNull = <T>(value: T | null): value is T => value !== null;

const clampGain = (value: number) => Math.min(150, Math.max(0, Math.round(value)));
const compareText = (left: string, right: string) => left.localeCompare(right, undefined, {
  numeric: true,
  sensitivity: "base"
});
const isParticipantStatus = (value: string): value is AppClientParticipantStatus => (
  value === "live" || value === "muted" || value === "idle"
);
const normalizeId = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : null;
};
const normalizeChannelPermissions = (
  permissions?: Partial<AppClientChannelPermissions> | null,
  fallback: Partial<AppClientChannelPermissions> = defaultChannelPermissions
): AppClientChannelPermissions => ({
  traverse: typeof permissions?.traverse === "boolean" ? permissions.traverse : fallback.traverse,
  enter: typeof permissions?.enter === "boolean" ? permissions.enter : fallback.enter,
  speak: typeof permissions?.speak === "boolean" ? permissions.speak : fallback.speak,
  muteDeafen: typeof permissions?.muteDeafen === "boolean" ? permissions.muteDeafen : fallback.muteDeafen,
  move: typeof permissions?.move === "boolean" ? permissions.move : fallback.move,
  write: typeof permissions?.write === "boolean" ? permissions.write : fallback.write
});
const resolveChannelPermissionsFallback = (channel?: AppClientChannelSnapshot | null) => (
  channel?.permissions ?? defaultChannelPermissions
);

const resolveActiveChannelId = (
  channels: AppClientChannel[],
  participants: AppClientParticipant[],
  requestedActiveChannelId: string | null | undefined,
  currentActiveChannelId: string | null
) => {
  const channelLookup = new Map(channels.map((channel) => [channel.id, channel]));
  const candidates = [
    normalizeId(requestedActiveChannelId),
    normalizeId(currentActiveChannelId),
    participants.find((participant) => participant.isSelf)?.channelId ?? null,
    channels.find((channel) => channel.permissions.enter)?.id ?? null,
    channels[0]?.id ?? null
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const channel = channelLookup.get(candidate);
    if (channel?.permissions.enter) {
      return candidate;
    }
  }

  return null;
};

// Build a stable, depth-annotated channel list ordered by position/name/id while
// recovering gracefully from invalid parent links or cycles by re-rooting leftovers.
const sortChannelsIntoTree = (channels: AppClientChannel[]) => {
  const childLookup = new Map<string | null, AppClientChannel[]>();
  const compareChannels = (left: AppClientChannel, right: AppClientChannel) => (
    left.position - right.position
      || compareText(left.name, right.name)
      || compareText(left.id, right.id)
  );
  const visit = (
    parentId: string | null,
    depth: number,
    orderedChannels: AppClientChannel[],
    visitedChannels: Set<string>
  ) => {
    const children = [...(childLookup.get(parentId) ?? [])].sort(compareChannels);
    for (const child of children) {
      if (visitedChannels.has(child.id)) {
        continue;
      }

      visitedChannels.add(child.id);
      orderedChannels.push({
        ...child,
        depth
      });
      visit(child.id, depth + 1, orderedChannels, visitedChannels);
    }
  };

  for (const channel of channels) {
    const siblings = childLookup.get(channel.parentId);
    if (siblings) {
      siblings.push(channel);
      continue;
    }

    childLookup.set(channel.parentId, [channel]);
  }

  const orderedChannels: AppClientChannel[] = [];
  const visitedChannels = new Set<string>();
  visit(null, 0, orderedChannels, visitedChannels);

  for (const channel of [...channels].sort(compareChannels)) {
    if (visitedChannels.has(channel.id)) {
      continue;
    }

    orderedChannels.push({
      ...channel,
      parentId: null,
      depth: 0
    });
    visit(channel.id, 1, orderedChannels, visitedChannels);
  }

  return orderedChannels;
};

// Normalize live session payloads into renderer-safe state by validating channel
// references, ordering the tree, filtering participants in missing rooms, and
// choosing the best active channel that the UI can still enter.
const normalizeSessionState = (
  channels: AppClientChannelSnapshot[],
  participants: AppClientParticipantSnapshot[],
  requestedActiveChannelId: string | null | undefined,
  currentActiveChannelId: string | null
) => {
  const normalizedChannels: AppClientChannel[] = [];

  for (const channel of channels) {
    const id = normalizeId(channel.id);
    const name = typeof channel.name === "string" ? channel.name.trim() : "";

    if (!id || name.length === 0) {
      continue;
    }

    normalizedChannels.push({
      id,
      name,
      parentId: normalizeId(channel.parentId),
      depth: 0,
      position: typeof channel.position === "number" && Number.isFinite(channel.position)
        ? Math.round(channel.position)
        : 0,
      permissions: normalizeChannelPermissions(channel.permissions),
      participantIds: []
    });
  }

  const channelLookup = new Map(normalizedChannels.map((channel) => [channel.id, channel]));
  const sanitizedChannels = normalizedChannels.map((channel) => ({
    ...channel,
    parentId: channel.parentId && channel.parentId !== channel.id && channelLookup.has(channel.parentId)
      ? channel.parentId
      : null
  }));
  const orderedChannels = sortChannelsIntoTree(sanitizedChannels);
  const orderedChannelIds = new Map(orderedChannels.map((channel, index) => [channel.id, index]));
  const normalizedParticipants = participants
    .map((participant) => {
      const id = normalizeId(participant.id);
      const name = typeof participant.name === "string" ? participant.name.trim() : "";
      const channelId = normalizeId(participant.channelId);

      if (!id || name.length === 0 || !channelId || !orderedChannelIds.has(channelId)) {
        return null;
      }

      const nextStatus = participant.status ?? "idle";
      return {
        id,
        name,
        channelId,
        status: isParticipantStatus(nextStatus) ? nextStatus : "idle",
        isSelf: participant.isSelf === true ? true : undefined
      } satisfies AppClientParticipant;
    })
    .filter(isNonNull)
    .sort((left, right) => (
      (orderedChannelIds.get(left.channelId) ?? -1)
        - (orderedChannelIds.get(right.channelId) ?? -1)
      || Number(Boolean(right.isSelf)) - Number(Boolean(left.isSelf))
      || compareText(left.name, right.name)
      || compareText(left.id, right.id)
    ));

  const participantIdsByChannel = new Map<string, string[]>();
  for (const participant of normalizedParticipants) {
    const channelParticipantIds = participantIdsByChannel.get(participant.channelId);
    if (channelParticipantIds) {
      channelParticipantIds.push(participant.id);
      continue;
    }

    participantIdsByChannel.set(participant.channelId, [participant.id]);
  }

  return {
    channels: orderedChannels.map((channel) => ({
      ...channel,
      participantIds: participantIdsByChannel.get(channel.id) ?? []
    })),
    participants: normalizedParticipants,
    activeChannelId: resolveActiveChannelId(
      orderedChannels,
      normalizedParticipants,
      requestedActiveChannelId,
      currentActiveChannelId
    )
  };
};

const toChannelSnapshot = (channel: AppClientChannel): AppClientChannelSnapshot => ({
  id: channel.id,
  name: channel.name,
  parentId: channel.parentId,
  position: channel.position,
  permissions: cloneState(channel.permissions)
});

const toParticipantSnapshot = (participant: AppClientParticipant): AppClientParticipantSnapshot => ({
  id: participant.id,
  name: participant.name,
  channelId: participant.channelId,
  status: participant.status,
  isSelf: participant.isSelf
});

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null
);

const normalizeLocalNicknames = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) {
    return {};
  }

  return Object.entries(value).reduce<Record<string, string>>((nicknames, [participantId, nickname]) => {
    const normalizedParticipantId = normalizeId(participantId);
    const normalizedNickname = typeof nickname === "string" ? nickname.trim() : "";
    if (!normalizedParticipantId || normalizedNickname.length === 0) {
      return nicknames;
    }

    nicknames[normalizedParticipantId] = normalizedNickname;
    return nicknames;
  }, {});
};

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
  shortcutBindings: normalizeShortcutBindings(preferences?.shortcutBindings),
  localNicknames: normalizeLocalNicknames(preferences?.localNicknames),
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

export type { AppClientShortcutBinding, AppClientShortcutTarget };

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

    const normalizedChannelId = normalizeId(message.channelId);
    if (normalizedChannelId !== null && !channelIds.has(normalizedChannelId)) {
      return false;
    }

    seenMessageIds.add(message.id);
    return true;
  }).map((message) => ({
    id: message.id,
    author: message.author.trim(),
    body: message.body.trim(),
    channelId: normalizeId(message.channelId),
    ...(normalizeId(message.participantId) ? { participantId: normalizeId(message.participantId) ?? undefined } : {}),
    sentAt: Number.isNaN(Date.parse(message.sentAt)) ? new Date(0).toISOString() : message.sentAt,
    ...(message.severity === "error" ? { severity: "error" as const } : {}),
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

export const mergeLiveSessionState = (currentState: AppClientState, session: AppClientLiveSession): AppClientState => {
  const normalizedSessionState = normalizeSessionState(
    session.channels,
    session.participants,
    session.activeChannelId,
    currentState.activeChannelId
  );
  const channelIds = new Set(normalizedSessionState.channels.map((channel) => channel.id));
  const messages = normalizeChatMessageList([
    ...currentState.messages,
    ...(session.messages ?? [])
  ], channelIds);

  return {
    ...currentState,
    channels: normalizedSessionState.channels,
    activeChannelId: normalizedSessionState.activeChannelId,
    participants: normalizedSessionState.participants,
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

const resolveSendChatRequest = (
  currentState: AppClientState,
  request: string | AppClientSendChatMessageRequest
) => {
  const payload = typeof request === "string"
    ? { body: request, channelId: currentState.activeChannelId }
    : request;
  const normalizedBody = payload.body.trim();
  const normalizedParticipantId = normalizeId(payload.participantId);
  const normalizedChannelId = normalizedParticipantId === null
    ? normalizeId(payload.channelId ?? currentState.activeChannelId)
    : null;

  if (!normalizedBody) {
    throw new Error("Enter a message before sending.");
  }

  if (normalizedParticipantId !== null) {
    const participant = currentState.participants.find((entry) => entry.id === normalizedParticipantId);
    if (!participant || participant.isSelf) {
      throw new Error("Choose someone else in the session before sending a direct message.");
    }
  } else if (normalizedChannelId === null) {
    throw new Error("Choose a room before sending chat.");
  } else if (!currentState.channels.some((channel) => channel.id === normalizedChannelId)) {
    throw new Error("Choose a room that is still available before sending chat.");
  }

  return {
    body: normalizedBody,
    channelId: normalizedChannelId,
    participantId: normalizedParticipantId
  };
};

export const appendLocalChatMessageState = (
  currentState: AppClientState,
  request: string | AppClientSendChatMessageRequest
): AppClientState => {
  if (currentState.connection.status !== "connected") {
    throw new Error("Join a server before sending chat.");
  }

  const normalizedRequest = resolveSendChatRequest(currentState, request);

  const nextMessage: AppClientChatMessage = {
    id: buildLocalChatMessageId(),
    author: currentState.connection.nickname || "You",
    body: normalizedRequest.body,
    channelId: normalizedRequest.channelId,
    ...(normalizedRequest.participantId ? { participantId: normalizedRequest.participantId } : {}),
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
  private readonly onLog?: (event: AppClientLogEvent) => void;
  private readonly waitForConnection: () => Promise<void>;

  public constructor({ persistedState, onPersist, onLog, waitForConnection }: AppClientStoreOptions = {}) {
    this.state = createDisconnectedState(migratePersistedAppClientState(persistedState));
    this.onPersist = onPersist;
    this.onLog = onLog;
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
      this.log("info", "connection.connect.requested", normalizedRequest);
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
      this.log("info", "connection.connect.succeeded", {
        serverAddress: normalizedRequest.serverAddress
      });
      return this.getState();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to connect right now.";
      this.log("error", "connection.connect.failed", {
        serverAddress: request.serverAddress,
        nickname: request.nickname,
        error: message
      });
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

  public rememberServer(serverAddress: string) {
    const normalizedAddress = serverAddress.trim();
    if (normalizedAddress.length === 0) {
      return this.getState();
    }

    this.updateState((currentState) => ({
      ...currentState,
      connection: {
        ...currentState.connection,
        serverAddress: normalizedAddress
      },
      recentServers: buildRecentServers(currentState.recentServers, normalizedAddress)
    }));
    this.log("info", "connection.server.remembered", {
      serverAddress: normalizedAddress
    });
    return this.getState();
  }

  public disconnect() {
    this.log("info", "connection.disconnect.requested", {
      serverAddress: this.state.connection.serverAddress
    });
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
    const previousActiveChannelId = this.state.activeChannelId;
    let nextActiveChannelId = previousActiveChannelId;
    this.updateState((currentState) => {
      if (currentState.connection.status !== "connected") {
        return currentState;
      }

      const nextChannel = currentState.channels.find((channel) => channel.id === channelId);
      if (!nextChannel || !nextChannel.permissions.enter) {
        return currentState;
      }

      nextActiveChannelId = nextChannel.id;

      return {
        ...currentState,
        activeChannelId: nextChannel.id
      };
    });
    if (nextActiveChannelId !== previousActiveChannelId) {
      this.log("info", "channel.selected", {
        channelId: nextActiveChannelId
      });
    }
    return this.getState();
  }

  public syncSessionSnapshot(snapshot: AppClientSessionSnapshot) {
    this.updateState((currentState) => {
      const normalizedSessionState = normalizeSessionState(
        snapshot.channels,
        snapshot.participants,
        snapshot.activeChannelId,
        currentState.activeChannelId
      );

      return {
        ...currentState,
        channels: normalizedSessionState.channels,
        participants: normalizedSessionState.participants,
        activeChannelId: normalizedSessionState.activeChannelId
      };
    });
    return this.getState();
  }

  public upsertChannel(channel: AppClientChannelPatch) {
    this.updateState((currentState) => {
      const normalizedChannelId = normalizeId(channel.id);
      if (!normalizedChannelId) {
        return currentState;
      }

      const nextChannels = new Map(currentState.channels.map((entry) => [entry.id, toChannelSnapshot(entry)]));
      const currentChannel = nextChannels.get(normalizedChannelId);
      nextChannels.set(normalizedChannelId, {
        id: normalizedChannelId,
        name: typeof channel.name === "string" ? channel.name : currentChannel?.name ?? normalizedChannelId,
        parentId: channel.parentId !== undefined ? channel.parentId : currentChannel?.parentId ?? null,
        position: channel.position ?? currentChannel?.position ?? 0,
        permissions: normalizeChannelPermissions(channel.permissions, resolveChannelPermissionsFallback(currentChannel))
      });

      const normalizedSessionState = normalizeSessionState(
        [...nextChannels.values()],
        currentState.participants.map(toParticipantSnapshot),
        currentState.activeChannelId,
        currentState.activeChannelId
      );

      return {
        ...currentState,
        channels: normalizedSessionState.channels,
        participants: normalizedSessionState.participants,
        activeChannelId: normalizedSessionState.activeChannelId
      };
    });
    return this.getState();
  }

  public removeChannel(channelId: string) {
    this.updateState((currentState) => {
      const normalizedChannelId = normalizeId(channelId);
      if (!normalizedChannelId) {
        return currentState;
      }

      const normalizedSessionState = normalizeSessionState(
        currentState.channels
          .filter((channel) => channel.id !== normalizedChannelId)
          .map(toChannelSnapshot),
        currentState.participants
          .filter((participant) => participant.channelId !== normalizedChannelId)
          .map(toParticipantSnapshot),
        currentState.activeChannelId === normalizedChannelId ? null : currentState.activeChannelId,
        currentState.activeChannelId
      );

      return {
        ...currentState,
        channels: normalizedSessionState.channels,
        participants: normalizedSessionState.participants,
        activeChannelId: normalizedSessionState.activeChannelId
      };
    });
    return this.getState();
  }

  public upsertParticipant(participant: AppClientParticipantPatch) {
    this.updateState((currentState) => {
      const normalizedParticipantId = normalizeId(participant.id);
      if (!normalizedParticipantId) {
        return currentState;
      }

      const nextParticipants = new Map(currentState.participants.map((entry) => [entry.id, toParticipantSnapshot(entry)]));
      const currentParticipant = nextParticipants.get(normalizedParticipantId);
      const normalizedChannelId = normalizeId(participant.channelId ?? currentParticipant?.channelId);
      if (!normalizedChannelId) {
        return currentState;
      }

      const nextStatus = participant.status ?? currentParticipant?.status ?? "idle";
      nextParticipants.set(normalizedParticipantId, {
        id: normalizedParticipantId,
        name: typeof participant.name === "string"
          ? participant.name
          : currentParticipant?.name ?? normalizedParticipantId,
        channelId: normalizedChannelId,
        status: isParticipantStatus(nextStatus) ? nextStatus : "idle",
        isSelf: participant.isSelf ?? currentParticipant?.isSelf
      });

      const normalizedSessionState = normalizeSessionState(
        currentState.channels.map(toChannelSnapshot),
        [...nextParticipants.values()],
        currentState.activeChannelId,
        currentState.activeChannelId
      );

      return {
        ...currentState,
        channels: normalizedSessionState.channels,
        participants: normalizedSessionState.participants,
        activeChannelId: normalizedSessionState.activeChannelId
      };
    });
    return this.getState();
  }

  public removeParticipant(participantId: string) {
    this.updateState((currentState) => {
      const normalizedParticipantId = normalizeId(participantId);
      if (!normalizedParticipantId) {
        return currentState;
      }

      const normalizedSessionState = normalizeSessionState(
        currentState.channels.map(toChannelSnapshot),
        currentState.participants
          .filter((participant) => participant.id !== normalizedParticipantId)
          .map(toParticipantSnapshot),
        currentState.activeChannelId,
        currentState.activeChannelId
      );

      return {
        ...currentState,
        channels: normalizedSessionState.channels,
        participants: normalizedSessionState.participants,
        activeChannelId: normalizedSessionState.activeChannelId
      };
    });
    return this.getState();
  }

  public updateChannelPermissions(channelId: string, permissions: Partial<AppClientChannelPermissions>) {
    this.updateState((currentState) => {
      const normalizedChannelId = normalizeId(channelId);
      if (!normalizedChannelId) {
        return currentState;
      }

      const normalizedSessionState = normalizeSessionState(
        currentState.channels.map((channel) => (
          channel.id === normalizedChannelId
            ? {
              ...toChannelSnapshot(channel),
              permissions: normalizeChannelPermissions(permissions, resolveChannelPermissionsFallback(channel))
            }
            : toChannelSnapshot(channel)
        )),
        currentState.participants.map(toParticipantSnapshot),
        currentState.activeChannelId,
        currentState.activeChannelId
      );

      return {
        ...currentState,
        channels: normalizedSessionState.channels,
        participants: normalizedSessionState.participants,
        activeChannelId: normalizedSessionState.activeChannelId
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
    this.log("info", "audio.settings.updated", cloneState(audio as Record<string, unknown>));
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
    this.log("info", "preferences.updated", cloneState(preferences as Record<string, unknown>));
    return this.getState();
  }

  public syncLiveSession(session: AppClientLiveSession) {
    this.updateState((currentState) => currentState.connection.status === "connected"
      ? mergeLiveSessionState(currentState, session)
      : currentState);
    return this.getState();
  }

  public sendChatMessage(request: string | AppClientSendChatMessageRequest) {
    this.updateState((currentState) => appendLocalChatMessageState(currentState, request));
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

  private log(level: AppClientLogEvent["level"], event: string, context?: Record<string, unknown>) {
    this.onLog?.({
      level,
      event,
      context
    });
  }
}
