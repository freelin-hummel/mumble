import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import { registerAppStateIpc } from "./appStateIpc.js";
import { runSecureVoiceSelfTest } from "./secureVoice.js";
import {
  createSecureWebPreferences,
  CSP_VIOLATION_CHANNEL,
  formatCspViolation,
  validateSecureWebPreferences,
  withContentSecurityPolicy
} from "./security.js";
import { registerVoiceTransportIpc, shutdownVoiceTransport } from "./voiceTransportIpc.js";

let mainWindow: BrowserWindow | null = null;
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

  const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(fileURLToPath(new URL("../renderer/index.html", import.meta.url)));
  }
};

app.whenReady().then(() => {
  ipcMain.handle("voice:run-self-test", () => runSecureVoiceSelfTest());
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
