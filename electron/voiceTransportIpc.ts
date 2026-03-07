import { BrowserWindow, ipcMain } from "electron";
import { UdpVoiceTransport, type UdpVoiceTransportBinaryPayload, type UdpVoiceTransportConnectOptions } from "./udpVoiceTransport.js";

const voiceTransport = new UdpVoiceTransport();
let handlersRegistered = false;

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
  if (handlersRegistered) {
    return;
  }

  handlersRegistered = true;

  ipcMain.handle("voice:connect", async (_event, options: UdpVoiceTransportConnectOptions) => {
    return voiceTransport.connect(options);
  });

  ipcMain.handle("voice:send", async (_event, payload: UdpVoiceTransportBinaryPayload) => {
    return voiceTransport.send(payload);
  });

  ipcMain.handle("voice:disconnect", async () => {
    return voiceTransport.disconnect();
  });

  ipcMain.handle("voice:get-status", () => {
    return voiceTransport.getStatus();
  });
};

export const shutdownVoiceTransport = async () => {
  await voiceTransport.disconnect();
};
