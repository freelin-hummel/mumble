import { contextBridge, ipcRenderer } from "electron";
import type {
  AppClientAudioSettings,
  AppClientPreferences,
  AppClientState
} from "./appClientState.js";
import type {
  UdpVoiceTransportConnectOptions,
  UdpVoiceTransportPacket,
  UdpVoiceTransportStatus
} from "./udpVoiceTransport.js";

contextBridge.exposeInMainWorld("app", {
  versions: process.versions,
  platform: process.platform,
  runSecureVoiceSelfTest: () => ipcRenderer.invoke("voice:run-self-test"),
  getState: () => ipcRenderer.invoke("app:get-state"),
  connect: (options: { serverAddress: string; nickname: string }) => ipcRenderer.invoke("app:connect", options),
  disconnect: () => ipcRenderer.invoke("app:disconnect"),
  selectChannel: (channelId: string) => ipcRenderer.invoke("app:select-channel", channelId),
  updateAudioSettings: (audio: Partial<AppClientAudioSettings>) => ipcRenderer.invoke("app:update-audio", audio),
  updatePreferences: (preferences: Partial<AppClientPreferences>) => ipcRenderer.invoke("app:update-preferences", preferences),
  onStateChanged: (listener: (state: AppClientState) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: AppClientState) => {
      listener(state);
    };

    ipcRenderer.on("app:state-changed", wrappedListener);

    return () => {
      ipcRenderer.removeListener("app:state-changed", wrappedListener);
    };
  }
});

contextBridge.exposeInMainWorld("voice", {
  connect: (options: UdpVoiceTransportConnectOptions) =>
    ipcRenderer.invoke("voice:connect", options),
  send: (payload: ArrayBuffer | ArrayBufferView) => ipcRenderer.invoke("voice:send", payload),
  disconnect: () => ipcRenderer.invoke("voice:disconnect"),
  getStatus: () => ipcRenderer.invoke("voice:get-status"),
  onMessage: (listener: (packet: UdpVoiceTransportPacket) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, packet: UdpVoiceTransportPacket) => {
      listener(packet);
    };

    ipcRenderer.on("voice:message", wrappedListener);

    return () => {
      ipcRenderer.removeListener("voice:message", wrappedListener);
    };
  },
  onStatus: (listener: (status: UdpVoiceTransportStatus) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, status: UdpVoiceTransportStatus) => {
      listener(status);
    };

    ipcRenderer.on("voice:status", wrappedListener);

    return () => {
      ipcRenderer.removeListener("voice:status", wrappedListener);
    };
  }
});
