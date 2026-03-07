import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { access } from 'node:fs/promises';

const preloadPath = path.join(app.getAppPath(), 'electron', 'preload.mjs');

async function getIndexPath() {
	const distIndex = path.join(app.getAppPath(), 'dist', 'index.html');

	try {
		await access(distIndex);
		return distIndex;
	} catch {
		return path.join(app.getAppPath(), 'index.html');
	}
}

async function createWindow() {
	const window = new BrowserWindow({
		width: 1480,
		height: 960,
		minWidth: 1100,
		minHeight: 720,
		backgroundColor: '#09111f',
		autoHideMenuBar: true,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			preload: preloadPath,
			sandbox: true
		}
	});

	await window.loadFile(await getIndexPath());
}

app.whenReady().then(async () => {
	await createWindow();

	app.on('activate', async () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			await createWindow();
		}
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});
