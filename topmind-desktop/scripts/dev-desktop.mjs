import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import {
  acquireDevSessionLock,
  clearDevServerState,
  readDevServerState,
  waitForDevServerState,
} from "./dev-runtime.mjs";

const cwd = process.cwd();
const rendererScript = path.resolve(cwd, "scripts", "dev-renderer.mjs");
const electronScript = path.resolve(cwd, "scripts", "dev-electron.mjs");

// Pre-flight: kill any orphaned Electron processes pointing at THIS workspace
// directory. Historical sessions could leak as orphans because dev-electron.mjs
// only killed its direct child (not the process group) and didn't handle SIGHUP
// (terminal close on macOS). An orphaned Electron from a previous session shows
// up as a "second window" the next time you chat with the AI — the long-standing
// "AI 对话触发多窗口" symptom. Lock acquisition keeps this safe: by the time we
// run, no other dev-desktop owns this workspace, so any lingering Electron here
// is by definition a leak.
function killOrphanedElectron() {
  try {
    // Cross-platform orphan kill:
    //   macOS/Linux: pkill -f "electron.*{cwd}"
    //   Windows:     taskkill /F /FI "IMAGENAME eq electron.exe" /T
    // The taskkill /T flag kills the entire process tree. Both commands exit
    // non-zero when no matches are found — harmless.
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/F", "/FI", "IMAGENAME eq electron.exe", "/T"], { stdio: "ignore", shell: true });
    } else {
      spawnSync("pkill", ["-f", `electron.*${cwd}`], { stdio: "ignore" });
    }
  } catch {
    // pkill/taskkill not present or no matches — both harmless.
  }
}
const devSessionLock = await acquireDevSessionLock(cwd);
let renderer = null;

if (!devSessionLock.acquired) {
  const rendererState = (await readDevServerState(cwd)) ?? (await waitForDevServerState(cwd));
  if (!rendererState) {
    console.error(
      `[topmind-desktop] Another dev session is active (pid ${devSessionLock.owner?.pid ?? "unknown"}), but no renderer state appeared.`,
    );
    await devSessionLock.release();
    process.exit(1);
  }

  console.log(
    `[topmind-desktop] Another topmind Desktop dev session is already active (pid ${devSessionLock.owner?.pid ?? "unknown"}). Reusing existing renderer ${rendererState.url}; no new Electron process was started.`,
  );
  await devSessionLock.release();
  process.exit(0);
}

await clearDevServerState(cwd);

// Defensive: clear any orphaned Electron from a prior crashed session before
// spawning a fresh one. Without this, a leaked grandchild from a previous
// run persists on-screen next to the new window.
void killOrphanedElectron();

renderer = spawn(process.execPath, [rendererScript], {
  cwd,
  env: process.env,
  stdio: "inherit",
});

const electron = spawn(process.execPath, [electronScript], {
  cwd,
  env: process.env,
  stdio: "inherit",
});

const children = [renderer, electron].filter(Boolean);
let shuttingDown = false;

function stopChildren(signal = "SIGTERM") {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  children.forEach((child) => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
}

process.on("SIGINT", () => stopChildren("SIGINT"));
process.on("SIGTERM", () => stopChildren("SIGTERM"));
// SIGHUP fires when the controlling terminal closes on macOS/Linux.
// Windows has no SIGHUP — the listener is a no-op there ( harmless registration).
// Without this, dev-desktop dies silently on macOS and its children
// (dev-renderer + dev-electron and their grandchildren) become permanent orphans.
// The SIGHUP → SIGKILL chain guarantees cleanup more aggressive than the default SIGTERM forwarding,
// which is appropriate because terminal-close is an unrecoverable teardown.
if (process.platform !== "win32") {
  process.on("SIGHUP", () => stopChildren("SIGKILL"));
}

let firstExit = 0;

try {
  firstExit = await Promise.race(
    children.map(
      (child) =>
        new Promise((resolve) => {
          child.on("exit", (code, signal) => {
            resolve(code ?? (signal ? 1 : 0));
          });
          child.on("error", () => resolve(1));
        }),
    ),
  );
} finally {
  stopChildren();
  await clearDevServerState(cwd);
  await devSessionLock.release();
}

process.exit(Number(firstExit) || 0);
