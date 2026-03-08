import type { WebPreferences } from "electron";
import type {
  AppClientAudioSettings,
  AppClientPreferences,
  AppClientState
} from "./appClientState.js";
import type { RendererDiagnosticsSnapshot } from "./diagnostics.js";
import type {
  UdpVoiceTransportConnectOptions,
  UdpVoiceTransportPacket,
  UdpVoiceTransportStatus
} from "./udpVoiceTransport.js";

export const APP_API_WHITELIST = Object.freeze([
  "versions",
  "platform",
  "runSecureVoiceSelfTest",
  "getState",
  "connect",
  "disconnect",
  "selectChannel",
  "sendChatMessage",
  "updateAudioSettings",
  "updatePreferences",
  "exportDiagnostics",
  "onStateChanged"
] as const);

export const VOICE_API_WHITELIST = Object.freeze([
  "connect",
  "send",
  "disconnect",
  "getStatus",
  "onMessage",
  "onStatus"
] as const);

export const APP_INVOKE_CHANNELS = Object.freeze({
  runSecureVoiceSelfTest: "voice:run-self-test",
  getState: "app:get-state",
  connect: "app:connect",
  disconnect: "app:disconnect",
  selectChannel: "app:select-channel",
  sendChatMessage: "app:send-chat-message",
  updateAudioSettings: "app:update-audio",
  updatePreferences: "app:update-preferences",
  exportDiagnostics: "app:export-diagnostics"
} as const);

export const APP_EVENT_CHANNELS = Object.freeze({
  onStateChanged: "app:state-changed"
} as const);

export const VOICE_INVOKE_CHANNELS = Object.freeze({
  connect: "voice:connect",
  send: "voice:send",
  disconnect: "voice:disconnect",
  getStatus: "voice:get-status"
} as const);

export const VOICE_EVENT_CHANNELS = Object.freeze({
  onMessage: "voice:message",
  onStatus: "voice:status"
} as const);

export const CSP_VIOLATION_CHANNEL = "security:csp-violation";

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' http: https: ws: wss:",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'"
].join("; ");

export const SECURE_WEB_PREFERENCES = Object.freeze({
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true
} satisfies Pick<WebPreferences, "contextIsolation" | "nodeIntegration" | "sandbox" | "webSecurity">);

type IpcListener<TPayload> = (event: unknown, payload: TPayload) => void;

export type IpcRendererLike = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: IpcListener<unknown>): void;
  removeListener(channel: string, listener: IpcListener<unknown>): void;
  send(channel: string, ...args: unknown[]): void;
};

export type PreloadAppApi = Readonly<{
  versions: NodeJS.ProcessVersions;
  platform: NodeJS.Platform;
  runSecureVoiceSelfTest: () => Promise<unknown>;
  getState: () => Promise<AppClientState>;
  connect: (options: { serverAddress: string; nickname: string }) => Promise<AppClientState>;
  disconnect: () => Promise<AppClientState>;
  selectChannel: (channelId: string) => Promise<AppClientState>;
  sendChatMessage: (body: string) => Promise<AppClientState>;
  updateAudioSettings: (audio: Partial<AppClientAudioSettings>) => Promise<AppClientState>;
  updatePreferences: (preferences: Partial<AppClientPreferences>) => Promise<AppClientState>;
  exportDiagnostics: (snapshot?: RendererDiagnosticsSnapshot) => Promise<{
    canceled: boolean;
    filePath: string | null;
  }>;
  onStateChanged: (listener: (state: AppClientState) => void) => () => void;
}>;

export type PreloadVoiceApi = Readonly<{
  connect: (options: UdpVoiceTransportConnectOptions) => Promise<UdpVoiceTransportStatus>;
  send: (payload: ArrayBuffer | ArrayBufferView) => Promise<number>;
  disconnect: () => Promise<UdpVoiceTransportStatus>;
  getStatus: () => Promise<UdpVoiceTransportStatus>;
  onMessage: (listener: (packet: UdpVoiceTransportPacket) => void) => () => void;
  onStatus: (listener: (status: UdpVoiceTransportStatus) => void) => () => void;
}>;

export type CspViolationPayload = Readonly<{
  blockedURI: string;
  documentURI: string;
  effectiveDirective: string;
  originalPolicy: string;
  violatedDirective: string;
}>;

type CspViolationEventLike = {
  blockedURI?: unknown;
  documentURI?: unknown;
  effectiveDirective?: unknown;
  originalPolicy?: unknown;
  violatedDirective?: unknown;
};

export const createSecureWebPreferences = (preload: string): WebPreferences => ({
  preload,
  ...SECURE_WEB_PREFERENCES
});

export const validateSecureWebPreferences = (
  webPreferences: Pick<WebPreferences, "contextIsolation" | "nodeIntegration" | "sandbox" | "webSecurity">
) => {
  if (!webPreferences.contextIsolation) {
    throw new Error("BrowserWindow must enable contextIsolation.");
  }

  if (webPreferences.nodeIntegration) {
    throw new Error("BrowserWindow must disable nodeIntegration.");
  }

  if (!webPreferences.sandbox) {
    throw new Error("BrowserWindow must enable sandbox mode.");
  }

  if (!webPreferences.webSecurity) {
    throw new Error("BrowserWindow must enable webSecurity.");
  }
};

export const withContentSecurityPolicy = (
  responseHeaders: Record<string, string[] | undefined> = {}
) => {
  const nextHeaders = { ...responseHeaders };
  delete nextHeaders["content-security-policy"];
  delete nextHeaders["Content-Security-Policy"];
  nextHeaders["Content-Security-Policy"] = [CONTENT_SECURITY_POLICY];
  return nextHeaders;
};

const invoke = <TReturn>(ipcRenderer: IpcRendererLike, channel: string, ...args: unknown[]) => (
  ipcRenderer.invoke(channel, ...args) as Promise<TReturn>
);

const subscribe = <TPayload>(
  ipcRenderer: IpcRendererLike,
  channel: string,
  listener: (payload: TPayload) => void
) => {
  const wrappedListener: IpcListener<TPayload> = (_event, payload) => {
    listener(payload);
  };

  ipcRenderer.on(channel, wrappedListener as IpcListener<unknown>);

  return () => {
    ipcRenderer.removeListener(channel, wrappedListener as IpcListener<unknown>);
  };
};

export const createPreloadApi = (
  ipcRenderer: IpcRendererLike,
  runtime: Pick<NodeJS.Process, "platform" | "versions">
): Readonly<{ app: PreloadAppApi; voice: PreloadVoiceApi }> => {
  const appApi: PreloadAppApi = Object.freeze({
    versions: runtime.versions,
    platform: runtime.platform,
    runSecureVoiceSelfTest: () => invoke(ipcRenderer, APP_INVOKE_CHANNELS.runSecureVoiceSelfTest),
    getState: () => invoke(ipcRenderer, APP_INVOKE_CHANNELS.getState),
    connect: (options) => invoke(ipcRenderer, APP_INVOKE_CHANNELS.connect, options),
    disconnect: () => invoke(ipcRenderer, APP_INVOKE_CHANNELS.disconnect),
    selectChannel: (channelId) => invoke(ipcRenderer, APP_INVOKE_CHANNELS.selectChannel, channelId),
    sendChatMessage: (body) => invoke(ipcRenderer, APP_INVOKE_CHANNELS.sendChatMessage, body),
    updateAudioSettings: (audio) => invoke(ipcRenderer, APP_INVOKE_CHANNELS.updateAudioSettings, audio),
    updatePreferences: (preferences) => invoke(ipcRenderer, APP_INVOKE_CHANNELS.updatePreferences, preferences),
    exportDiagnostics: (snapshot) => invoke(ipcRenderer, APP_INVOKE_CHANNELS.exportDiagnostics, snapshot),
    onStateChanged: (listener) => subscribe(ipcRenderer, APP_EVENT_CHANNELS.onStateChanged, listener)
  });

  const voiceApi: PreloadVoiceApi = Object.freeze({
    connect: (options) => invoke(ipcRenderer, VOICE_INVOKE_CHANNELS.connect, options),
    send: (payload) => invoke(ipcRenderer, VOICE_INVOKE_CHANNELS.send, payload),
    disconnect: () => invoke(ipcRenderer, VOICE_INVOKE_CHANNELS.disconnect),
    getStatus: () => invoke(ipcRenderer, VOICE_INVOKE_CHANNELS.getStatus),
    onMessage: (listener) => subscribe(ipcRenderer, VOICE_EVENT_CHANNELS.onMessage, listener),
    onStatus: (listener) => subscribe(ipcRenderer, VOICE_EVENT_CHANNELS.onStatus, listener)
  });

  return Object.freeze({
    app: appApi,
    voice: voiceApi
  });
};

const getString = (value: unknown, fallback: string) => {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return fallback;
};

export const toCspViolationPayload = (event: CspViolationEventLike): CspViolationPayload => ({
  blockedURI: getString(event.blockedURI, "inline"),
  documentURI: getString(event.documentURI, "unknown"),
  effectiveDirective: getString(event.effectiveDirective, "unknown"),
  originalPolicy: getString(event.originalPolicy, CONTENT_SECURITY_POLICY),
  violatedDirective: getString(event.violatedDirective, "unknown")
});

export const registerCspViolationLogging = (
  eventTarget: { addEventListener?: (type: string, listener: (event: unknown) => void) => void },
  ipcRenderer: IpcRendererLike
) => {
  eventTarget.addEventListener?.("securitypolicyviolation", (event) => {
    ipcRenderer.send(CSP_VIOLATION_CHANNEL, toCspViolationPayload(event as CspViolationEventLike));
  });
};

export const formatCspViolation = (payload: CspViolationPayload) => (
  `[csp] Blocked "${payload.effectiveDirective}" on ${payload.documentURI}; source=${payload.blockedURI}; violated="${payload.violatedDirective}"`
);
