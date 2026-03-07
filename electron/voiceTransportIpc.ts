import { BrowserWindow, ipcMain } from "electron";
import { UdpVoiceTransport, type UdpVoiceTransportBinaryPayload, type UdpVoiceTransportConnectOptions } from "./udpVoiceTransport.js";

const voiceTransport = new UdpVoiceTransport();

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

export const registerVoiceTransportIpc = () => {
  ipcMain.removeHandler("voice:connect");
  ipcMain.handle("voice:connect", async (_event, options: UdpVoiceTransportConnectOptions) => {
    return voiceTransport.connect(options);
  });

  ipcMain.removeHandler("voice:send");
  ipcMain.handle("voice:send", async (_event, payload: UdpVoiceTransportBinaryPayload) => {
    return voiceTransport.send(payload);
  });

  ipcMain.removeHandler("voice:disconnect");
  ipcMain.handle("voice:disconnect", async () => {
    return voiceTransport.disconnect();
  });

  ipcMain.removeHandler("voice:get-status");
  ipcMain.handle("voice:get-status", () => {
    return voiceTransport.getStatus();
  });
};

export const shutdownVoiceTransport = async () => {
  await voiceTransport.disconnect();
};
