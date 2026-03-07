import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { desktopScreens } from '../src/features.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const webClientDir = path.resolve(testDir, '..');
const repoRoot = path.resolve(webClientDir, '..', '..');
const desktopUiRoot = path.join(repoRoot, 'src', 'mumble');

async function walkUiFiles(directory, prefix = '') {
	const entries = await readdir(directory, { withFileTypes: true });
	const output = [];

	for (const entry of entries) {
		const nextPath = path.join(directory, entry.name);
		const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;

		if (entry.isDirectory()) {
			output.push(...await walkUiFiles(nextPath, nextPrefix));
			continue;
		}

		if (entry.isFile() && entry.name.endsWith('.ui')) {
			output.push(nextPrefix);
		}
	}

	return output;
}

test('desktop Qt forms are mirrored by the stubbed web manifest', async () => {
	const desktopUiFiles = await walkUiFiles(desktopUiRoot);
	const represented = desktopScreens
		.map((screen) => screen.sourceUi)
		.filter((value) => value !== null)
		.sort();

	assert.deepEqual(represented, desktopUiFiles.sort());
});

test('screen ids and source routes are unique', () => {
	const ids = desktopScreens.map((screen) => screen.id);
	const routes = desktopScreens.map((screen) => `/screen/${screen.id}`);

	assert.equal(new Set(ids).size, ids.length);
	assert.equal(new Set(routes).size, routes.length);
});

test('screens without matching Qt forms are still explicitly represented', () => {
	const nativeOnlyScreens = desktopScreens.filter((screen) => screen.sourceUi === null);

	assert.deepEqual(nativeOnlyScreens.map((screen) => screen.id), ['developer-console']);
	assert.match(nativeOnlyScreens[0].summary, /not backed by a \.ui form/i);
});

test('electron and build scripts are available from package.json', async () => {
	const packageJson = JSON.parse(await readFile(path.join(webClientDir, 'package.json'), 'utf8'));

	assert.equal(packageJson.scripts['build:web'], 'node scripts/build-web.mjs');
	assert.equal(packageJson.scripts['start:electron'], 'electron .');
	assert.match(packageJson.scripts['build:electron'], /electron-builder --dir/);
});
