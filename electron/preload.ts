import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("app", {
  versions: process.versions,
  platform: process.platform
});
