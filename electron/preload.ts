import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("app", {
  versions: process.versions,
  platform: process.platform,
  runSecureVoiceSelfTest: () => ipcRenderer.invoke("voice:run-self-test")
});
