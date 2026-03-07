import { app, BrowserWindow, ipcMain } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  AppClientStore,
  type AppClientAudioSettings,
  type AppClientConnectRequest,
  type AppClientPreferences,
  type AppClientState
} from "./appClientState.js";
import { createTestServerSessions } from "../src/testServerSession.js";

const APP_STATE_CHANNEL = "app:state-changed";
const APP_STATE_FILE_NAME = "desktop-client-state.json";

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
    return JSON.parse(readFileSync(getPersistedStatePath(), "utf8"));
  } catch {
    return null;
  }
};

const savePersistedState = (state: object) => {
  try {
    writeFileSync(getPersistedStatePath(), JSON.stringify(state, null, 2), "utf8");
  } catch {
    return;
  }
};

const getStore = () => {
  if (!store) {
    store = new AppClientStore({
      persistedState: loadPersistedState(),
      onPersist: savePersistedState
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
};
