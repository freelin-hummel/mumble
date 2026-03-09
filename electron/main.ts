import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import { registerAppStateIpc } from "./appStateIpc.js";
import { runSecureVoiceSelfTest } from "./secureVoice.js";
import {
  APP_INVOKE_CHANNELS,
  createSecureWebPreferences,
  CSP_VIOLATION_CHANNEL,
  formatCspViolation,
  validateSecureWebPreferences,
  withContentSecurityPolicy
} from "./security.js";
import { registerVoiceTransportIpc, shutdownVoiceTransport } from "./voiceTransportIpc.js";

let mainWindow: BrowserWindow | null = null;
let talkingPopoutWindow: BrowserWindow | null = null;
let isShuttingDown = false;
let isContentSecurityPolicyInstalled = false;

const handleCspViolation = (_event: Electron.IpcMainEvent, payload: Parameters<typeof formatCspViolation>[0]) => {
  console.warn(formatCspViolation(payload));
};

const installContentSecurityPolicy = (window: BrowserWindow) => {
  if (isContentSecurityPolicyInstalled) {
    return;
  }

  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== "mainFrame") {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }

    callback({
      responseHeaders: withContentSecurityPolicy(details.responseHeaders)
    });
  });

  isContentSecurityPolicyInstalled = true;
};

const loadRendererWindow = async (
  window: BrowserWindow,
  view?: typeof TALKING_POPOUT_VIEW,
) => {
  const devServerUrl =
    process.env.VITE_DEV_SERVER_URL ?? process.env.ELECTRON_RENDERER_URL;
  const search = view ? `?view=${view}` : "";
  if (devServerUrl) {
    await window.loadURL(`${devServerUrl}${search}`);
    return;
  }

  await window.loadFile(
    fileURLToPath(new URL("../renderer/index.html", import.meta.url)),
    search ? { search } : undefined,
  );
};

const TALKING_POPOUT_VIEW = "talking-popout";

const createWindow = () => {
  const webPreferences = createSecureWebPreferences(
    fileURLToPath(new URL("../preload/preload.mjs", import.meta.url))
  );
  validateSecureWebPreferences(webPreferences);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#0d0f14",
    show: false,
    titleBarStyle: "hiddenInset",
    webPreferences
  });

  installContentSecurityPolicy(mainWindow);

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  void loadRendererWindow(mainWindow).then(() => {
    if (process.env.VITE_DEV_SERVER_URL ?? process.env.ELECTRON_RENDERER_URL) {
      mainWindow?.webContents.openDevTools({ mode: "detach" });
    }
  });
};

const openTalkingPopout = async () => {
  if (talkingPopoutWindow && !talkingPopoutWindow.isDestroyed()) {
    talkingPopoutWindow.focus();
    return;
  }

  const webPreferences = createSecureWebPreferences(
    fileURLToPath(new URL("../preload/preload.mjs", import.meta.url))
  );
  validateSecureWebPreferences(webPreferences);

  talkingPopoutWindow = new BrowserWindow({
    width: 320,
    height: 520,
    minWidth: 260,
    minHeight: 320,
    backgroundColor: "#0d0f14",
    autoHideMenuBar: true,
    title: "Mumble Talking Popout",
    alwaysOnTop: true,
    webPreferences
  });

  installContentSecurityPolicy(talkingPopoutWindow);
  talkingPopoutWindow.on("closed", () => {
    talkingPopoutWindow = null;
  });
  await loadRendererWindow(talkingPopoutWindow, TALKING_POPOUT_VIEW);
};

app.whenReady().then(() => {
  ipcMain.handle("voice:run-self-test", () => runSecureVoiceSelfTest());
  ipcMain.handle(APP_INVOKE_CHANNELS.openTalkingPopout, async () => {
    await openTalkingPopout();
  });
  ipcMain.on(CSP_VIOLATION_CHANNEL, handleCspViolation);
  registerAppStateIpc();
  registerVoiceTransportIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", (event) => {
  if (isShuttingDown) {
    return;
  }

  event.preventDefault();
  isShuttingDown = true;
  void shutdownVoiceTransport().finally(() => {
    app.quit();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
