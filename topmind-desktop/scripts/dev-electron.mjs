import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { createDevServerEnv, waitForDevServer, waitForDevServerState } from "./dev-runtime.mjs";
import { electronLaunchArgs } from "../electron/lib/platform.mjs";

const cwd = process.cwd();
const electronCli = path.join(cwd, "node_modules", "electron", "cli.js");

// macOS Dock reads the *Electron.app bundle* icon (not project build/icon.icns).
// Patch before spawn so the first Dock tile is already topmind — app.dock.setIcon
// alone is unreliable while the process is still branded as Electron.
if (process.platform === "darwin") {
  const patchScript = path.join(cwd, "scripts", "patch-electron-icon.mjs");
  const patch = spawnSync(process.execPath, [patchScript], {
    cwd,
    stdio: "inherit",
  });
  if (patch.status !== 0) {
    console.warn(
      "[topmind-desktop] patch-electron-icon failed (Dock may stay Electron default). Run: npm run icons:generate",
    );
  }
}

const devServerState = process.env.topmind_DESKTOP_DEV_SERVER_URL
  ? {
      host: process.env.topmind_DESKTOP_DEV_SERVER_HOST,
      port: Number.parseInt(process.env.topmind_DESKTOP_DEV_SERVER_PORT ?? "", 10),
      url: process.env.topmind_DESKTOP_DEV_SERVER_URL,
    }
  : await waitForDevServerState(cwd);

if (!devServerState?.url || !devServerState.host || !Number.isInteger(devServerState.port)) {
  console.error(
    "[topmind-desktop] No active renderer state found for this workspace. Run `npm run dev` or `npm run dev:renderer` first.",
  );
  process.exit(1);
}

const ready = await waitForDevServer(devServerState.url);
if (!ready) {
  console.error(
    `[topmind-desktop] Renderer dev server did not become ready at ${devServerState.url}.`,
  );
  process.exit(1);
}

const env = createDevServerEnv({
  host: devServerState.host,
  port: devServerState.port,
  url: devServerState.url,
});
env.topmind_NODE_RUNTIME = process.execPath;

console.log(`[topmind-desktop] Launching Electron against ${devServerState.url}`);

// Shared Chromium flag policy with production main.mjs (Linux/ARM sandbox + GPU).
const electronArgs = [".", ...electronLaunchArgs(env)];

// detached:true gives Electron its own process group on Unix so we can kill the
// whole tree (GPU/utility/helper) via process.kill(-pid) without signaling
// ourselves. On Windows, tree-kill is handled via taskkill in dev-desktop.
const child = spawn(process.execPath, [electronCli, ...electronArgs], {
  cwd,
  env,
  stdio: "inherit",
  detached: process.platform !== "win32",
});

let exitCode = 0;
let shuttingDown = false;

function forwardSignal(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  // Kill the child's whole process group on Unix (detached spawn above).
  // Falls back to direct kill if the group isn't query-able (race / win32).
  try {
    if (process.platform !== "win32" && child.pid) {
      process.kill(-child.pid, signal);
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    child.kill(signal);
  } catch {
    /* already gone */
  }
}

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));
// SIGHUP fires when the controlling terminal closes on macOS/Linux — without this
// handler, dev-electron dies silently and the Electron grandchild becomes a
// permanent orphan. Next `npm run dev` spawns a fresh Electron alongside the
// old one — the visible symptom of the long-standing "AI 对话触发多窗口" bug.
// Windows has no SIGHUP — listener is a no-op there.
if (process.platform !== "win32") {
  process.on("SIGHUP", () => forwardSignal("SIGKILL"));
}

child.on("exit", (code, signal) => {
  exitCode = code ?? (signal ? 1 : 0);
});

await new Promise((resolve) => {
  child.on("exit", resolve);
  child.on("error", resolve);
});

process.exit(exitCode);
