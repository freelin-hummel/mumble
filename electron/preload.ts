import { contextBridge, ipcRenderer } from "electron";
import { createPreloadApi, registerCspViolationLogging } from "./security.js";

const preloadApi = createPreloadApi(ipcRenderer, process);

contextBridge.exposeInMainWorld("app", preloadApi.app);
contextBridge.exposeInMainWorld("voice", preloadApi.voice);

registerCspViolationLogging(globalThis as { addEventListener?: (type: string, listener: (event: unknown) => void) => void }, ipcRenderer);
