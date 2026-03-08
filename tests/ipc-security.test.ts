import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  APP_API_WHITELIST,
  APP_EVENT_CHANNELS,
  APP_INVOKE_CHANNELS,
  CONTENT_SECURITY_POLICY,
  createPreloadApi,
  createSecureWebPreferences,
  CSP_VIOLATION_CHANNEL,
  formatCspViolation,
  registerCspViolationLogging,
  SECURE_WEB_PREFERENCES,
  toCspViolationPayload,
  validateSecureWebPreferences,
  VOICE_API_WHITELIST,
  VOICE_EVENT_CHANNELS,
  VOICE_INVOKE_CHANNELS,
  withContentSecurityPolicy,
} from "../electron/security.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

test("preload exposes only the whitelisted app and voice APIs", () => {
  const invokeCalls: Array<{ channel: string; args: unknown[] }> = [];
  const onCalls: string[] = [];
  const removedCalls: string[] = [];
  const fakeIpcRenderer = {
    invoke: async (channel: string, ...args: unknown[]) => {
      invokeCalls.push({ channel, args });
      return { channel, args };
    },
    on: (channel: string, _listener: unknown) => {
      onCalls.push(channel);
    },
    removeListener: (channel: string, _listener: unknown) => {
      removedCalls.push(channel);
    },
    send: () => {},
  };

  const preloadApi = createPreloadApi(fakeIpcRenderer, {
    platform: "linux",
    versions: { electron: "35.7.5" } as NodeJS.ProcessVersions,
  });

  assert.deepEqual(Object.keys(preloadApi.app), [...APP_API_WHITELIST]);
  assert.deepEqual(Object.keys(preloadApi.voice), [...VOICE_API_WHITELIST]);
  assert.equal(Object.isFrozen(preloadApi.app), true);
  assert.equal(Object.isFrozen(preloadApi.voice), true);

  void preloadApi.app.runSecureVoiceSelfTest();
  void preloadApi.app.getState();
  void preloadApi.app.connect({
    serverAddress: "voice.example.test:64738",
    nickname: "Scout",
  });
  void preloadApi.app.rememberServer("stage.example.test:64738");
  void preloadApi.app.disconnect();
  void preloadApi.app.selectChannel("lobby");
  void preloadApi.app.joinChannel("lobby");
  void preloadApi.app.sendChatMessage({
    body: "Ready to roll",
    channelId: "lobby",
  });
  void preloadApi.app.updateAudioSettings({ inputGain: 120 });
  void preloadApi.app.updatePreferences({ autoReconnect: false });
  void preloadApi.app.exportDiagnostics();
  const unsubscribeState = preloadApi.app.onStateChanged(() => {});

  void preloadApi.voice.connect({ host: "voice.example.test", port: 64738 });
  void preloadApi.voice.send(new Uint8Array([1, 2, 3]));
  void preloadApi.voice.disconnect();
  void preloadApi.voice.getStatus();
  const unsubscribeMessage = preloadApi.voice.onMessage(() => {});
  const unsubscribeStatus = preloadApi.voice.onStatus(() => {});

  unsubscribeState();
  unsubscribeMessage();
  unsubscribeStatus();

  assert.deepEqual(
    invokeCalls.map((call) => call.channel),
    [
      APP_INVOKE_CHANNELS.runSecureVoiceSelfTest,
      APP_INVOKE_CHANNELS.getState,
      APP_INVOKE_CHANNELS.connect,
      APP_INVOKE_CHANNELS.rememberServer,
      APP_INVOKE_CHANNELS.disconnect,
      APP_INVOKE_CHANNELS.selectChannel,
      APP_INVOKE_CHANNELS.joinChannel,
      APP_INVOKE_CHANNELS.sendChatMessage,
      APP_INVOKE_CHANNELS.updateAudioSettings,
      APP_INVOKE_CHANNELS.updatePreferences,
      APP_INVOKE_CHANNELS.exportDiagnostics,
      VOICE_INVOKE_CHANNELS.connect,
      VOICE_INVOKE_CHANNELS.send,
      VOICE_INVOKE_CHANNELS.disconnect,
      VOICE_INVOKE_CHANNELS.getStatus,
    ],
  );
  assert.deepEqual(onCalls, [
    APP_EVENT_CHANNELS.onStateChanged,
    VOICE_EVENT_CHANNELS.onMessage,
    VOICE_EVENT_CHANNELS.onStatus,
  ]);
  assert.deepEqual(removedCalls, onCalls);
});

test("secure BrowserWindow preferences enforce context isolation and sandboxing", () => {
  const webPreferences = createSecureWebPreferences("/tmp/preload.mjs");

  assert.deepEqual(webPreferences, {
    preload: "/tmp/preload.mjs",
    ...SECURE_WEB_PREFERENCES,
  });
  assert.doesNotThrow(() => {
    validateSecureWebPreferences(webPreferences);
  });
  assert.throws(() => {
    validateSecureWebPreferences({
      ...webPreferences,
      contextIsolation: false,
    });
  }, /contextIsolation/);
  assert.throws(() => {
    validateSecureWebPreferences({
      ...webPreferences,
      nodeIntegration: true,
    });
  }, /nodeIntegration/);
  assert.throws(() => {
    validateSecureWebPreferences({
      ...webPreferences,
      sandbox: false,
    });
  }, /sandbox/);
  assert.throws(() => {
    validateSecureWebPreferences({
      ...webPreferences,
      webSecurity: false,
    });
  }, /webSecurity/);
});

test("content security policy is attached to response headers and renderer HTML", async () => {
  const responseHeaders = withContentSecurityPolicy({
    "x-frame-options": ["DENY"],
    "content-security-policy": ["default-src *"],
  });
  const indexHtml = await readFile(path.join(repoRoot, "index.html"), "utf8");

  assert.deepEqual(responseHeaders, {
    "x-frame-options": ["DENY"],
    "Content-Security-Policy": [CONTENT_SECURITY_POLICY],
  });
  assert.match(CONTENT_SECURITY_POLICY, /default-src 'self'/);
  assert.match(CONTENT_SECURITY_POLICY, /object-src 'none'/);
  assert.match(CONTENT_SECURITY_POLICY, /frame-ancestors 'none'/);
  assert.match(
    indexHtml,
    new RegExp(
      `http-equiv="Content-Security-Policy"[\\s\\S]*content="${CONTENT_SECURITY_POLICY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
    ),
  );
});

test("CSP violations are serialized and logged through the internal security channel", () => {
  const sentPayloads: Array<{ channel: string; payload: unknown }> = [];
  const listeners = new Map<string, (event: unknown) => void>();
  const fakeTarget = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener);
    },
  };
  const fakeIpcRenderer = {
    invoke: async () => undefined,
    on: () => {},
    removeListener: () => {},
    send: (channel: string, payload: unknown) => {
      sentPayloads.push({ channel, payload });
    },
  };

  registerCspViolationLogging(fakeTarget, fakeIpcRenderer);

  listeners.get("securitypolicyviolation")?.({
    blockedURI: "",
    documentURI: "file:///renderer/index.html",
    effectiveDirective: "script-src-elem",
    originalPolicy: CONTENT_SECURITY_POLICY,
    violatedDirective: "script-src",
  });

  assert.equal(sentPayloads.length, 1);
  assert.equal(sentPayloads[0]?.channel, CSP_VIOLATION_CHANNEL);
  assert.deepEqual(
    sentPayloads[0]?.payload,
    toCspViolationPayload({
      blockedURI: "",
      documentURI: "file:///renderer/index.html",
      effectiveDirective: "script-src-elem",
      originalPolicy: CONTENT_SECURITY_POLICY,
      violatedDirective: "script-src",
    }),
  );
  assert.match(
    formatCspViolation(
      sentPayloads[0]?.payload as ReturnType<typeof toCspViolationPayload>,
    ),
    /\[csp\] Blocked "script-src-elem"/,
  );
});
