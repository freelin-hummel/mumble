import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

test("dev runner resolves the actual Vite server URL and injects tsx import once", async () => {
  const devRunner = await import(pathToFileURL(path.join(repoRoot, "scripts", "dev.mjs")).href);

  assert.equal(devRunner.buildNodeOptions(""), "--import tsx");
  assert.equal(devRunner.buildNodeOptions("--trace-warnings"), "--trace-warnings --import tsx");
  assert.equal(devRunner.buildNodeOptions("--trace-warnings --import tsx"), "--trace-warnings --import tsx");

  assert.equal(
    devRunner.resolveDevServerUrl({
      resolvedUrls: {
        local: ["http://localhost:5174/"]
      }
    }),
    "http://localhost:5174/"
  );

  assert.equal(
    devRunner.resolveDevServerUrl({
      resolvedUrls: {
        local: [],
        network: []
      },
      httpServer: {
        address: () => ({ port: 5199 })
      }
    }),
    "http://localhost:5199/"
  );
});
