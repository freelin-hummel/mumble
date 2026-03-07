import { app, BrowserWindow, ipcMain } from "electron";
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

const APP_STATE_CHANNEL = "app:state-changed";
const APP_STATE_FILE_NAME = "desktop-client-state.json";

let store: AppClientStore | null = null;

const broadcastState = (state: AppClientState) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(APP_STATE_CHANNEL, state);
  }
};

const getPersistedStatePath = () => path.join(app.getPath("userData"), APP_STATE_FILE_NAME);

const loadPersistedState = () => loadPersistedAppClientState(getPersistedStatePath());

const savePersistedState = (state: PersistedAppClientState) => {
  savePersistedAppClientState(getPersistedStatePath(), state);
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

export const registerAppStateIpc = () => {
  ipcMain.removeHandler("app:get-state");
  ipcMain.removeHandler("app:connect");
  ipcMain.removeHandler("app:disconnect");
  ipcMain.removeHandler("app:select-channel");
  ipcMain.removeHandler("app:update-audio");
  ipcMain.removeHandler("app:update-preferences");

  ipcMain.handle("app:get-state", () => getStore().getState());
  ipcMain.handle("app:connect", (_event, request: AppClientConnectRequest) => getStore().connect(request));
  ipcMain.handle("app:disconnect", () => getStore().disconnect());
  ipcMain.handle("app:select-channel", (_event, channelId: string) => getStore().selectChannel(channelId));
  ipcMain.handle("app:update-audio", (_event, audio: Partial<AppClientAudioSettings>) => (
    getStore().updateAudioSettings(audio)
  ));
  ipcMain.handle("app:update-preferences", (_event, preferences: Partial<AppClientPreferences>) => (
    getStore().updatePreferences(preferences)
  ));
};
