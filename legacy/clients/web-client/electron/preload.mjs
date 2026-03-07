import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('mumbleDesktop', {
	platform: process.platform,
	electron: process.versions.electron
});
