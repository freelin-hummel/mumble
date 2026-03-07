import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const electronMainPath = path.join(repoRoot, "electron", "main.ts");

export const buildNodeOptions = (nodeOptions = "") => {
  const importOption = "--import tsx";
  return nodeOptions.includes(importOption)
    ? nodeOptions
    : [nodeOptions, importOption].filter(Boolean).join(" ");
};

export const resolveDevServerUrl = (server) => {
  const localUrl = server.resolvedUrls?.local[0] ?? server.resolvedUrls?.network[0];

  if (localUrl) {
    return localUrl;
  }

  const address = server.httpServer?.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to determine the Vite dev server URL");
  }

  return `http://localhost:${address.port}/`;
};

const forwardSignal = (child, signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

const main = async () => {
  const viteServer = await createServer();
  await viteServer.listen();
  viteServer.printUrls();

  const require = createRequire(import.meta.url);
  const electronBinary = require("electron");
  const child = spawn(electronBinary, [...process.argv.slice(2), electronMainPath], {
    stdio: "inherit",
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_OPTIONS: buildNodeOptions(process.env.NODE_OPTIONS),
      VITE_DEV_SERVER_URL: resolveDevServerUrl(viteServer)
    }
  });

  const shutdown = async (signal) => {
    forwardSignal(child, signal);
    await viteServer.close();
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  child.on("exit", async (code, signal) => {
    await viteServer.close();

    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
