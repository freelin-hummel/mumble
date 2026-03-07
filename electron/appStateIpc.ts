import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  AppClientStore,
  type AppClientAudioSettings,
  type AppClientConnectRequest,
  type AppClientPreferences,
  type PersistedAppClientState,
  type AppClientState
} from "./appClientState.js";
import {
  loadPersistedAppClientState,
  savePersistedAppClientState
} from "./appStateStorage.js";
import {
  createDiagnosticsBundle,
  getDiagnosticsLogStore,
  type RendererDiagnosticsSnapshot
} from "./diagnostics.js";
import { getVoiceTransportStatus } from "./voiceTransportIpc.js";
import { createTestServerSessions } from "../src/testServerSession.js";

const APP_STATE_CHANNEL = "app:state-changed";
const APP_STATE_FILE_NAME = "desktop-client-state.json";
const diagnosticsLogStore = getDiagnosticsLogStore();

let store: AppClientStore | null = null;
let liveSessionTimerIds: NodeJS.Timeout[] = [];

const broadcastState = (state: AppClientState) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(APP_STATE_CHANNEL, state);
  }
};

const getPersistedStatePath = () => path.join(app.getPath("userData"), APP_STATE_FILE_NAME);

const loadPersistedState = () => {
  try {
    return loadPersistedAppClientState(getPersistedStatePath());
  } catch (error) {
    const errorCode = typeof error === "object" && error !== null && "code" in error ? error.code : null;
    if (errorCode !== "ENOENT") {
      diagnosticsLogStore.log("warn", "app.state.load.failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return null;
  }
};

const savePersistedState = (state: PersistedAppClientState) => {
  try {
    savePersistedAppClientState(getPersistedStatePath(), state);
  } catch (error) {
    diagnosticsLogStore.log("error", "app.state.persist.failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
};

const buildDiagnosticsFilePath = () => path.join(
  app.getPath("downloads"),
  `mumble-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
);

const getStore = () => {
  if (!store) {
    store = new AppClientStore({
      persistedState: loadPersistedState(),
      onPersist: savePersistedState,
      onLog: (event) => {
        diagnosticsLogStore.log(event.level, event.event, event.context);
      }
    });
    store.subscribe((state) => {
      broadcastState(state);
    });
  }

  return store;
};

const clearLiveSessionTimers = () => {
  liveSessionTimerIds.forEach((timerId) => {
    clearTimeout(timerId);
  });
  liveSessionTimerIds = [];
};

const startTestServerSession = (nickname: string) => {
  clearLiveSessionTimers();
  const liveSessions = createTestServerSessions(nickname);
  liveSessionTimerIds = liveSessions.map(({ delayMs, session }) => setTimeout(() => {
    getStore().syncLiveSession(session);
  }, delayMs));
};

export const registerAppStateIpc = () => {
  ipcMain.removeHandler("app:get-state");
  ipcMain.removeHandler("app:connect");
  ipcMain.removeHandler("app:disconnect");
  ipcMain.removeHandler("app:select-channel");
  ipcMain.removeHandler("app:send-chat-message");
  ipcMain.removeHandler("app:update-audio");
  ipcMain.removeHandler("app:update-preferences");
  ipcMain.removeHandler("app:export-diagnostics");

  ipcMain.handle("app:get-state", () => getStore().getState());
  ipcMain.handle("app:connect", async (_event, request: AppClientConnectRequest) => {
    const nextState = await getStore().connect(request);
    startTestServerSession(nextState.connection.nickname);
    return getStore().getState();
  });
  ipcMain.handle("app:disconnect", () => {
    clearLiveSessionTimers();
    return getStore().disconnect();
  });
  ipcMain.handle("app:select-channel", (_event, channelId: string) => getStore().selectChannel(channelId));
  ipcMain.handle("app:send-chat-message", (_event, body: string) => getStore().sendChatMessage(body));
  ipcMain.handle("app:update-audio", (_event, audio: Partial<AppClientAudioSettings>) => (
    getStore().updateAudioSettings(audio)
  ));
  ipcMain.handle("app:update-preferences", (_event, preferences: Partial<AppClientPreferences>) => (
    getStore().updatePreferences(preferences)
  ));
  ipcMain.handle("app:export-diagnostics", async (event, rendererSnapshot?: RendererDiagnosticsSnapshot) => {
    diagnosticsLogStore.log("info", "diagnostics.export.requested", {
      connectionStatus: getStore().getState().connection.status
    });

    const browserWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const saveResult = await dialog.showSaveDialog(browserWindow, {
      title: "Export diagnostics bundle",
      defaultPath: buildDiagnosticsFilePath(),
      filters: [
        {
          name: "JSON",
          extensions: ["json"]
        }
      ]
    });

    if (saveResult.canceled || !saveResult.filePath) {
      diagnosticsLogStore.log("info", "diagnostics.export.cancelled");
      return {
        canceled: true,
        filePath: null
      };
    }

    try {
      const bundle = createDiagnosticsBundle({
        state: getStore().getState(),
        logs: diagnosticsLogStore.getEntries(),
        appVersion: app.getVersion(),
        platform: process.platform,
        voiceTransport: getVoiceTransportStatus(),
        rendererSnapshot
      });
      writeFileSync(saveResult.filePath, JSON.stringify(bundle, null, 2), "utf8");
      diagnosticsLogStore.log("info", "diagnostics.export.succeeded", {
        filePath: saveResult.filePath
      });
      return {
        canceled: false,
        filePath: saveResult.filePath
      };
    } catch (error) {
      diagnosticsLogStore.log("error", "diagnostics.export.failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  });
};
