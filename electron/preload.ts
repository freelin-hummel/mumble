import { contextBridge, ipcRenderer } from "electron";
import { createPreloadApi, registerCspViolationLogging } from "./security.js";

type EventTargetLike = {
  addEventListener?: (type: string, listener: (event: unknown) => void) => void;
};

const preloadApi = createPreloadApi(ipcRenderer, process);
const preloadEventTarget: EventTargetLike = globalThis;

contextBridge.exposeInMainWorld("app", preloadApi.app);
contextBridge.exposeInMainWorld("voice", preloadApi.voice);

registerCspViolationLogging(preloadEventTarget, ipcRenderer);
