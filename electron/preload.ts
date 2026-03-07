import { contextBridge, ipcRenderer } from "electron";
import type {
  UdpVoiceTransportConnectOptions,
  UdpVoiceTransportPacket,
  UdpVoiceTransportStatus
} from "./udpVoiceTransport.js";

contextBridge.exposeInMainWorld("app", {
  versions: process.versions,
  platform: process.platform,
  runSecureVoiceSelfTest: () => ipcRenderer.invoke("voice:run-self-test")
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
