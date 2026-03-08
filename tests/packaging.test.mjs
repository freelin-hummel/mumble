import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const sliceBetween = (source, startMarker, endMarker) => {
  const startIndex = source.indexOf(startMarker);
  assert.notEqual(startIndex, -1, `expected to find ${startMarker} in electron.vite.config.ts`);
  const contentStartIndex = startIndex + startMarker.length;

  const endIndex = typeof endMarker === "string" ? source.indexOf(endMarker, contentStartIndex) : -1;
  return endIndex === -1 ? source.slice(contentStartIndex) : source.slice(contentStartIndex, endIndex);
};

test("package scripts cover production builds and platform packages", async () => {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));

  assert.equal(packageJson.scripts.dev, "node scripts/dev.mjs");
  assert.equal(packageJson.scripts.build, "npm run clean && electron-vite build");
  assert.match(packageJson.scripts.pack, /electron-builder --dir/);
  assert.match(packageJson.scripts.package, /electron-builder --config electron-builder\.config\.mjs/);
  assert.equal(packageJson.scripts["package:mac"], "npm run clean:release && npm run build && electron-builder --mac --config electron-builder.config.mjs --publish never");
  assert.equal(packageJson.scripts["package:win"], "npm run clean:release && npm run build && electron-builder --win --config electron-builder.config.mjs --publish never");
  assert.equal(packageJson.scripts["package:linux"], "npm run clean:release && npm run build && electron-builder --linux --config electron-builder.config.mjs --publish never");
});

test("electron-builder config packages the built renderer and Electron entrypoints", async () => {
  const { default: config } = await import(pathToFileURL(path.join(repoRoot, "electron-builder.config.mjs")).href);

  assert.deepEqual(config.files, ["dist/**/*", "package.json", "LICENSE"]);
  assert.equal(config.extraMetadata.main, "dist/main/main.js");
  assert.equal(config.artifactName, "${productName}-${version}-${os}-${arch}.${ext}");
  assert.deepEqual(config.mac.target, ["dmg", "zip"]);
  assert.equal(config.mac.identity, null);
  assert.deepEqual(config.win.target, ["nsis"]);
  assert.deepEqual(config.linux.target, ["AppImage", "deb"]);
});

test("electron-vite config keeps the packaged build output in the expected dist layout", async () => {
  const configSource = await readFile(path.join(repoRoot, "electron.vite.config.ts"), "utf8");
  const mainConfig = sliceBetween(configSource, "main: {", "  preload: {");
  const preloadConfig = sliceBetween(configSource, "preload: {", "  renderer: {");
  const rendererConfig = sliceBetween(configSource, "renderer: {");

  assert.match(mainConfig, /outDir:\s*["']dist\/main["']/, "main outDir should be dist/main");
  assert.match(mainConfig, /main:\s*resolve\(__dirname,\s*["']electron\/main\.ts["']\)/, "main entry should point at electron/main.ts");
  assert.match(preloadConfig, /outDir:\s*["']dist\/preload["']/, "preload outDir should be dist/preload");
  assert.match(preloadConfig, /preload:\s*resolve\(__dirname,\s*["']electron\/preload\.ts["']\)/, "preload entry should point at electron/preload.ts");
  assert.match(rendererConfig, /outDir:\s*["']dist\/renderer["']/, "renderer outDir should be dist/renderer");
  assert.match(rendererConfig, /index:\s*resolve\(__dirname,\s*["']index\.html["']\)/, "renderer entry should point at index.html");
});
