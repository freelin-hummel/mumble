import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

test("package scripts cover production builds and platform packages", async () => {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));

  assert.equal(packageJson.scripts.build, "npm run clean && npm run build:renderer && npm run build:main");
  assert.match(packageJson.scripts.pack, /electron-builder --dir/);
  assert.match(packageJson.scripts.package, /electron-builder --config electron-builder\.config\.mjs/);
  assert.equal(packageJson.scripts["package:mac"], "npm run clean:release && npm run build && electron-builder --mac --config electron-builder.config.mjs --publish never");
  assert.equal(packageJson.scripts["package:win"], "npm run clean:release && npm run build && electron-builder --win --config electron-builder.config.mjs --publish never");
  assert.equal(packageJson.scripts["package:linux"], "npm run clean:release && npm run build && electron-builder --linux --config electron-builder.config.mjs --publish never");
});

test("electron-builder config packages the built renderer and Electron entrypoints", async () => {
  const { default: config } = await import(pathToFileURL(path.join(repoRoot, "electron-builder.config.mjs")).href);

  assert.deepEqual(config.files, ["dist/**/*", "package.json", "LICENSE"]);
  assert.equal(config.extraMetadata.main, "dist/electron/main.js");
  assert.equal(config.artifactName, "${productName}-${version}-${os}-${arch}.${ext}");
  assert.deepEqual(config.mac.target, ["dmg", "zip"]);
  assert.equal(config.mac.identity, null);
  assert.deepEqual(config.win.target, ["nsis"]);
  assert.deepEqual(config.linux.target, ["AppImage", "deb"]);
});
