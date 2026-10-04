import { spawn } from "node:child_process";
import path from "node:path";
import {
  getDevServerUrl,
  resolveDevServerHost,
  resolveDevServerPort,
} from "../config/dev-server.mjs";
import {
  clearDevServerState,
  createDevServerEnv,
  findAvailablePort,
  writeDevServerState,
} from "./dev-runtime.mjs";
import { planSignalTeardown } from "../electron/lib/runtime-bounds.mjs";

const cwd = process.cwd();
const host = resolveDevServerHost();
const requestedPort = resolveDevServerPort();
const port = process.env.topmind_DESKTOP_DEV_SERVER_PORT
  ? requestedPort
  : await findAvailablePort({ host, startPort: requestedPort });
const url = getDevServerUrl({ host, port });
const env = createDevServerEnv({
  host,
  port,
  url,
  strictPort: true,
});
const viteCli = path.join(cwd, "node_modules", "vite", "bin", "vite.js");

await clearDevServerState(cwd);
await writeDevServerState({ host, port, url }, cwd);

if (port !== requestedPort) {
  console.log(
    `[topmind-desktop] Port ${requestedPort} is busy. Using ${port} for this workspace instead.`,
  );
}

console.log(`[topmind-desktop] Renderer dev server: ${url}`);

const child = spawn(
  process.execPath,
  [viteCli, "--host", host, "--port", String(port), "--strictPort"],
  {
    cwd,
    env,
    stdio: "inherit",
    // Own process group on Unix so SIGHUP/SIGTERM can reap vite workers
    // (esbuild) together. Without it, workers keep the dev port after the
    // parent is gone and the next session looks like a stale renderer.
    detached: process.platform !== "win32",
  },
);

let exitCode = 0;
let shuttingDown = false;

function deliver(signal) {
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      /* not a group leader yet — fall through */
    }
  }
  try {
    child.kill(signal);
  } catch {
    /* already dead */
  }
}

function forwardSignal(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  const plan = planSignalTeardown(signal);
  deliver(plan.forward);
  const timer = setTimeout(() => {
    if (child.exitCode == null && child.signalCode == null) deliver(plan.escalate);
  }, plan.escalateAfterMs);
  timer.unref?.();
}

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));
// SIGHUP on terminal close (macOS/Linux): catchable SIGTERM first so vite can
// drop the port, then SIGKILL. A leading SIGKILL skips that cleanup.
// Windows has no SIGHUP — listener is a no-op there.
if (process.platform !== "win32") {
  process.on("SIGHUP", () => forwardSignal("SIGHUP"));
}

child.on("exit", (code, signal) => {
  exitCode = code ?? (signal ? 1 : 0);
});

await new Promise((resolve) => {
  child.on("exit", resolve);
  child.on("error", resolve);
});

await clearDevServerState(cwd);
process.exit(exitCode);
