import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  getDevServerUrl,
  resolveDevServerHost,
  resolveDevServerPort,
} from "../config/dev-server.mjs";

const DEV_STATE_DIR = path.join(os.tmpdir(), "topmind-desktop");
const DEV_STATE_VERSION = 1;

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function getWorkspaceStateId(cwd) {
  return createHash("sha1").update(path.resolve(cwd)).digest("hex").slice(0, 16);
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function isValidState(candidate, cwd) {
  if (!candidate || typeof candidate !== "object") {
    return false;
  }

  return (
    candidate.version === DEV_STATE_VERSION &&
    candidate.cwd === path.resolve(cwd) &&
    typeof candidate.host === "string" &&
    candidate.host.length > 0 &&
    Number.isInteger(candidate.port) &&
    candidate.port > 0 &&
    typeof candidate.url === "string" &&
    candidate.url.length > 0 &&
    isProcessAlive(candidate.pid)
  );
}

async function ensureStateDir() {
  await fs.mkdir(DEV_STATE_DIR, { recursive: true });
}

export function getDevServerStatePath(cwd = process.cwd()) {
  return path.join(DEV_STATE_DIR, `${getWorkspaceStateId(cwd)}.json`);
}

export function getDevSessionLockPath(cwd = process.cwd()) {
  return path.join(DEV_STATE_DIR, `${getWorkspaceStateId(cwd)}.lock`);
}

async function unlinkIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

async function readDevSessionLock(lockPath) {
  try {
    const raw = await fs.readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (
      parsed.version !== DEV_STATE_VERSION ||
      typeof parsed.cwd !== "string" ||
      !Number.isInteger(parsed.pid)
    ) {
      return null;
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

export async function acquireDevSessionLock(cwd = process.cwd(), { pid = process.pid } = {}) {
  await ensureStateDir();

  const resolvedCwd = path.resolve(cwd);
  const lockPath = getDevSessionLockPath(cwd);
  const owner = {
    version: DEV_STATE_VERSION,
    cwd: resolvedCwd,
    pid,
    createdAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await fs.writeFile(lockPath, `${JSON.stringify(owner, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });

      let released = false;
      return {
        acquired: true,
        lockPath,
        owner,
        async release() {
          if (released) {
            return;
          }
          released = true;
          const currentOwner = await readDevSessionLock(lockPath);
          if (currentOwner?.pid === pid && currentOwner.cwd === resolvedCwd) {
            await unlinkIfExists(lockPath);
          }
        },
      };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }

      const existingOwner = await readDevSessionLock(lockPath);
      if (!existingOwner || existingOwner.cwd !== resolvedCwd || !isProcessAlive(existingOwner.pid)) {
        await unlinkIfExists(lockPath);
        continue;
      }

      return {
        acquired: false,
        lockPath,
        owner: existingOwner,
        async release() {},
      };
    }
  }

  const existingOwner = await readDevSessionLock(lockPath);
  return {
    acquired: false,
    lockPath,
    owner: existingOwner,
    async release() {},
  };
}

export async function clearDevServerState(cwd = process.cwd()) {
  await unlinkIfExists(getDevServerStatePath(cwd));
}

export async function readDevServerState(cwd = process.cwd()) {
  const statePath = getDevServerStatePath(cwd);

  try {
    const raw = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!isValidState(parsed, cwd)) {
      await clearDevServerState(cwd);
      return null;
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    if (error instanceof SyntaxError) {
      await clearDevServerState(cwd);
      return null;
    }
    throw error;
  }
}

export async function waitForDevServerState(
  cwd = process.cwd(),
  { timeoutMs = 15_000, intervalMs = 150 } = {},
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const state = await readDevServerState(cwd);
    if (state) {
      return state;
    }
    await sleep(intervalMs);
  }

  return null;
}

export async function writeDevServerState(
  { host, port, url, pid = process.pid },
  cwd = process.cwd(),
) {
  await ensureStateDir();

  const payload = {
    version: DEV_STATE_VERSION,
    cwd: path.resolve(cwd),
    host,
    port,
    url,
    pid,
    updatedAt: new Date().toISOString(),
  };

  await fs.writeFile(getDevServerStatePath(cwd), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

function isPortAvailable(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    server.once("error", () => resolve(false));
    server.listen({ host, port }, () => {
      server.close(() => resolve(true));
    });
  });
}

export async function findAvailablePort({
  host = resolveDevServerHost(),
  startPort = resolveDevServerPort(),
  maxAttempts = 25,
} = {}) {
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = startPort + offset;
    // eslint-disable-next-line no-await-in-loop
    if (await isPortAvailable(port, host)) {
      return port;
    }
  }

  throw new Error(
    `Unable to find an available port for topmind Desktop dev server starting at ${startPort}.`,
  );
}

export function createDevServerEnv({
  host = resolveDevServerHost(),
  port = resolveDevServerPort(),
  url = getDevServerUrl({ host, port }),
  strictPort = false,
  env = process.env,
} = {}) {
  const nextEnv = {
    ...env,
    topmind_DESKTOP_DEV_SERVER_HOST: host,
    topmind_DESKTOP_DEV_SERVER_PORT: String(port),
    topmind_DESKTOP_DEV_SERVER_URL: url,
  };

  if (strictPort) {
    nextEnv.topmind_DESKTOP_DEV_SERVER_STRICT_PORT = "1";
  } else {
    delete nextEnv.topmind_DESKTOP_DEV_SERVER_STRICT_PORT;
  }

  return nextEnv;
}

export async function waitForDevServer(
  url,
  { timeoutMs = 15_000, intervalMs = 300 } = {},
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) {
        return true;
      }
    } catch {
      // Keep polling until the deadline. The renderer may still be booting.
    }

    await sleep(intervalMs);
  }

  return false;
}
