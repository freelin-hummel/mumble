import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("app", {
  versions: process.versions,
  platform: process.platform
});

contextBridge.exposeInMainWorld("voice", {
  connect: (options: { host: string; port: number; bindAddress?: string; bindPort?: number }) =>
    ipcRenderer.invoke("voice:connect", options),
  send: (payload: ArrayBuffer | ArrayBufferView) => ipcRenderer.invoke("voice:send", payload),
  disconnect: () => ipcRenderer.invoke("voice:disconnect"),
  getStatus: () => ipcRenderer.invoke("voice:get-status"),
  onMessage: (listener: (packet: { payload: Uint8Array; remoteAddress: string; remotePort: number; receivedAt: number }) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, packet: { payload: Uint8Array; remoteAddress: string; remotePort: number; receivedAt: number }) => {
      listener({
        ...packet,
        payload: new Uint8Array(packet.payload)
      });
    };

    ipcRenderer.on("voice:message", wrappedListener);

    return () => {
      ipcRenderer.removeListener("voice:message", wrappedListener);
    };
  },
  onStatus: (listener: (status: {
    state: "disconnected" | "connecting" | "connected";
    remoteAddress: string | null;
    remotePort: number | null;
    localAddress: string | null;
    localPort: number | null;
    lastError: string | null;
    lastSentAt: number | null;
    lastReceivedAt: number | null;
  }) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, status: {
      state: "disconnected" | "connecting" | "connected";
      remoteAddress: string | null;
      remotePort: number | null;
      localAddress: string | null;
      localPort: number | null;
      lastError: string | null;
      lastSentAt: number | null;
      lastReceivedAt: number | null;
    }) => {
      listener(status);
    };

    ipcRenderer.on("voice:status", wrappedListener);

    return () => {
      ipcRenderer.removeListener("voice:status", wrappedListener);
    };
  }
});
