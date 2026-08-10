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
  },
);

let exitCode = 0;
let shuttingDown = false;

function forwardSignal(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  // Process-group kill: vite may spawn workers (esbuild service, etc.).
  // Without -pid, vite workers outlive their parent and hold the dev port,
  // forcing the next session onto a different port — visible as "stale dev
  // state" mismatches.
  // Negative PID is a Unix-only API; on Windows it throws (caught here,
  // falls through to the single-process kill).
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      /* fall through to single-process kill */
    }
  }
  try {
    child.kill(signal);
  } catch {
    /* already dead */
  }
}

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));
// SIGHUP on terminal close (macOS/Linux): must propagate to vite children or
// the port stays bound and the next npm run dev reuses a stale renderer URL.
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

await clearDevServerState(cwd);
process.exit(exitCode);
