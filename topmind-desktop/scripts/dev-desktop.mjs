import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import {
  acquireDevSessionLock,
  clearDevServerState,
  readDevServerState,
  waitForDevServerState,
} from "./dev-runtime.mjs";
import { readProcessCommandTable } from "./dev-process-table.mjs";
import {
  applyDevTeardown,
  getDesktopOwnedRuntime,
  planDevSessionStart,
  planSignalTeardown,
  registerDesktopOwned,
} from "../electron/lib/runtime-bounds.mjs";

const cwd = process.cwd();
const rendererScript = path.resolve(cwd, "scripts", "dev-renderer.mjs");
const electronScript = path.resolve(cwd, "scripts", "dev-electron.mjs");

// Pre-flight: replace a dead same-workspace Electron/Node tree.
// The pid list comes from planDevSessionStart — never pkill, and never
// taskkill every electron.exe on the machine.
function killWorkspacePid(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
  }
}

function replaceStaleWorkspaceTree() {
  let processes = [];
  try {
    processes = readProcessCommandTable();
  } catch {
    processes = [];
  }
  const plan = planDevSessionStart({
    cwd,
    lockOwner: null,
    processes,
    selfPid: process.pid,
    parentPid: process.ppid,
  });
  for (const pid of plan.killPids) killWorkspacePid(pid);
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
replaceStaleWorkspaceTree();

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
const workspaceKey = path.resolve(cwd);
for (const child of children) {
  if (!child?.pid) continue;
  registerDesktopOwned({
    kind: child === electron ? "dev-electron" : "dev-renderer",
    pid: child.pid,
    workspaceKey,
    cwd: workspaceKey,
  });
}
let shuttingDown = false;

function stopChildren(signal = "SIGTERM") {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  const plan = planSignalTeardown(signal);
  for (const child of children) {
    try { child.kill(plan.forward); } catch { /* already gone */ }
  }
  applyDevTeardown(getDesktopOwnedRuntime(), { signal, workspaceKey });
  const timer = setTimeout(() => {
    for (const child of children) {
      if (child.exitCode == null && child.signalCode == null) {
        try { child.kill(plan.escalate); } catch { /* already gone */ }
      }
    }
  }, plan.escalateAfterMs);
  timer.unref?.();
}

process.on("SIGINT", () => stopChildren("SIGINT"));
process.on("SIGTERM", () => stopChildren("SIGTERM"));
// SIGHUP fires when the controlling terminal closes on macOS/Linux.
// Forward a catchable SIGTERM first so dev-electron can reap its detached
// process group, then escalate. SIGKILL first would orphan that group.
if (process.platform !== "win32") {
  process.on("SIGHUP", () => stopChildren("SIGHUP"));
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
