import { BrowserWindow, ipcMain } from "electron";
import { LoopbackVoiceTransport } from "./loopbackVoiceTransport.js";
import { UdpVoiceTransport, type UdpVoiceTransportBinaryPayload, type UdpVoiceTransportConnectOptions } from "./udpVoiceTransport.js";

const voiceTransport = new UdpVoiceTransport();
const loopbackVoiceTransport = new LoopbackVoiceTransport();
let activeTransport: "udp" | "secure-loopback" | null = null;

const broadcast = (channel: string, payload: unknown) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
};

voiceTransport.onMessage((packet) => {
  broadcast("voice:message", packet);
});

voiceTransport.onStatusChange((status) => {
  broadcast("voice:status", status);
});

loopbackVoiceTransport.onMessage((packet) => {
  broadcast("voice:message", packet);
});

loopbackVoiceTransport.onStatusChange((status) => {
  broadcast("voice:status", status);
});

export const registerVoiceTransportIpc = () => {
  ipcMain.removeHandler("voice:connect");
  ipcMain.handle("voice:connect", async (_event, options: UdpVoiceTransportConnectOptions) => {
    activeTransport = "udp";
    await loopbackVoiceTransport.disconnect();
    return voiceTransport.connect(options);
  });

  ipcMain.removeHandler("voice:send");
  ipcMain.handle("voice:send", async (_event, payload: UdpVoiceTransportBinaryPayload) => {
    if (activeTransport === "secure-loopback") {
      return loopbackVoiceTransport.send(payload);
    }

    return voiceTransport.send(payload);
  });

  ipcMain.removeHandler("voice:disconnect");
  ipcMain.handle("voice:disconnect", async () => {
    activeTransport = null;
    await Promise.all([
      loopbackVoiceTransport.disconnect(),
      voiceTransport.disconnect()
    ]);
    return getVoiceTransportStatus();
  });

  ipcMain.removeHandler("voice:get-status");
  ipcMain.handle("voice:get-status", () => {
    return getVoiceTransportStatus();
  });
};

export const startLoopbackVoiceTransport = async (username: string) => {
  activeTransport = "secure-loopback";
  await voiceTransport.disconnect();
  return loopbackVoiceTransport.connect({ username });
};

export const getVoiceTransportStatus = () => (
  activeTransport === "secure-loopback"
    ? loopbackVoiceTransport.getStatus()
    : voiceTransport.getStatus()
);

export const shutdownVoiceTransport = async () => {
  activeTransport = null;
  await Promise.all([
    loopbackVoiceTransport.disconnect(),
    voiceTransport.disconnect()
  ]);
};
