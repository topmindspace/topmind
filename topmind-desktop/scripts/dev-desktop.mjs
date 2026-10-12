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
  escalateWorkspaceTree,
  getDesktopOwnedRuntime,
  ownedDevChildRecord,
  planDevSessionStart,
  registerDesktopOwned,
} from "../electron/lib/runtime-bounds.mjs";

const cwd = process.cwd();
const rendererScript = path.resolve(cwd, "scripts", "dev-renderer.mjs");
const electronScript = path.resolve(cwd, "scripts", "dev-electron.mjs");

// OS delivery for one workspace pid. Unix signals the process group, then the
// pid. Windows uses taskkill /T, and /F only for SIGKILL. Never pkill.
function deliverOsSignal(pid, signal) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
  const sig = signal === "SIGKILL" || signal === "SIGINT" || signal === "SIGTERM"
    ? signal
    : "SIGTERM";
  if (process.platform === "win32") {
    const args = ["/PID", String(pid), "/T"];
    if (sig === "SIGKILL") args.push("/F");
    spawnSync("taskkill", args, { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, sig);
  } catch {
    try { process.kill(pid, sig); } catch { /* already gone */ }
  }
}

function pidIsAlive(pid) {
  const child = children.find((item) => item?.pid === pid);
  if (child && (child.exitCode != null || child.signalCode != null)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function readWorkspaceProcesses() {
  try {
    return readProcessCommandTable();
  } catch {
    return [];
  }
}

// Dead same-workspace lock: catchable signal, then SIGKILL for whatever is
// still alive. The pid list is planDevSessionStart — this workspace only.
async function replaceStaleWorkspaceTree() {
  const processes = readWorkspaceProcesses();
  const plan = planDevSessionStart({
    cwd,
    lockOwner: null,
    processes,
    selfPid: process.pid,
    parentPid: process.ppid,
  });
  if (plan.action !== "replace" || plan.killPids.length === 0) return;
  await escalateWorkspaceTree({
    signal: "SIGTERM",
    processes,
    cwd,
    selfPid: process.pid,
    parentPid: process.ppid,
    kill: deliverOsSignal,
    isAlive: pidIsAlive,
  });
}
let children = [];
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
await replaceStaleWorkspaceTree();

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

children = [renderer, electron].filter(Boolean);
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
let teardownPromise = null;

function ownedChildRecords() {
  const records = [];
  for (const child of children) {
    if (!child?.pid) continue;
    const script = child === electron ? electronScript : rendererScript;
    records.push(ownedDevChildRecord({
      pid: child.pid,
      cwd: workspaceKey,
      script,
      execPath: process.execPath,
    }));
  }
  return records;
}

// Catchable signal first, then SIGKILL for workspace pids that ignore it.
// The promise stays referenced until SIGKILL is requested. process.exit in
// the caller runs only after this resolves, so a stuck child cannot outlive us.
function stopChildren(signal = "SIGTERM") {
  if (teardownPromise) return teardownPromise;
  teardownPromise = (async () => {
    const processes = [...readWorkspaceProcesses(), ...ownedChildRecords()];
    try {
      applyDevTeardown(getDesktopOwnedRuntime(), { signal, workspaceKey });
    } catch {
      /* registry bookkeeping only */
    }
    return escalateWorkspaceTree({
      signal,
      processes,
      cwd: workspaceKey,
      selfPid: process.pid,
      parentPid: process.ppid,
      kill: deliverOsSignal,
      isAlive: pidIsAlive,
    });
  })();
  return teardownPromise;
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
  try {
    await stopChildren();
  } finally {
    await clearDevServerState(cwd);
    await devSessionLock.release();
  }
}

process.exit(Number(firstExit) || 0);
