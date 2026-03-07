import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import { registerAppStateIpc } from "./appStateIpc.js";
import { runSecureVoiceSelfTest } from "./secureVoice.js";
import { registerVoiceTransportIpc, shutdownVoiceTransport } from "./voiceTransportIpc.js";

let mainWindow: BrowserWindow | null = null;
let isShuttingDown = false;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#0d0f14",
    show: false,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/preload.mjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? process.env.ELECTRON_RENDERER_URL;
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(fileURLToPath(new URL("../renderer/index.html", import.meta.url)));
  }
};

app.whenReady().then(() => {
  ipcMain.handle("voice:run-self-test", () => runSecureVoiceSelfTest());
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
