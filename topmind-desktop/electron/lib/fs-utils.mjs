import { promises as fs, readdirSync, statSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * Chromium caches under the desktop state home. Regenerable: the next launch
 * rebuilds them. Caps stop Cache + Code Cache from sitting at hundreds of MB.
 */
export const REGENERABLE_CACHE_CAPS = Object.freeze({
  Cache: 128 * 1024 * 1024,
  "Code Cache": 64 * 1024 * 1024,
  GPUCache: 32 * 1024 * 1024,
  DawnWebGPUCache: 32 * 1024 * 1024,
  DawnGraphiteCache: 32 * 1024 * 1024,
  GPUPersistentCache: 32 * 1024 * 1024,
});

function dirBytesUntil(abs, ceiling) {
  let total = 0;
  const stack = [abs];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        total += statSync(child).size;
      } catch {
        /* raced */
      }
      if (total > ceiling) return total;
    }
  }
  return total;
}

/**
 * Delete regenerable cache directories that exceed their cap.
 * Call only after this process owns the single-instance lock, before windows open.
 * Does not touch state/, logs/, or Cookies.
 * @param {string} stateHome
 * @param {Record<string, number>} [caps]
 * @returns {Array<{ name: string, bytes: number }>}
 */
export function pruneRegenerableCaches(stateHome, caps = REGENERABLE_CACHE_CAPS) {
  if (!stateHome) return [];
  /** @type {Array<{ name: string, bytes: number }>} */
  const pruned = [];
  for (const [name, cap] of Object.entries(caps)) {
    if (!Number.isFinite(cap) || cap < 0) continue;
    const abs = path.join(stateHome, name);
    const bytes = dirBytesUntil(abs, cap);
    if (bytes <= cap) continue;
    try {
      rmSync(abs, { recursive: true, force: true });
      pruned.push({ name, bytes });
    } catch {
      /* locked by a previous process — leave it */
    }
  }
  return pruned;
}

/** Check whether a file or directory exists. */
export async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/** Read and parse a JSON file. Returns fallback if unreadable. */
export async function readJson(filePath, fallback = null) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

/** Read a text file. Returns fallback if unreadable. */
export async function readText(filePath, fallback = "") {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
}

/** Read a text file with byte limit for preview. */
export async function readTextPreview(filePath, maxBytes = 4096) {
  try {
    const handle = await fs.open(filePath, "r");
    try {
      const buf = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buf, 0, maxBytes, 0);
      return buf.toString("utf8", 0, bytesRead);
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}

/** Write text file, creating parent directories as needed. */
export async function writeText(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

/** Ensure a directory exists, creating it if needed. */
export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

/** List directory entries (names only). Returns [] if dir doesn't exist. */
export async function listDir(dirPath) {
  try {
    return await fs.readdir(dirPath);
  } catch {
    return [];
  }
}

/** Get file stats, or null if not found. */
export async function statSafe(targetPath) {
  try {
    return await fs.stat(targetPath);
  } catch {
    return null;
  }
}

/**
 * Clip destination modes — single source of truth (merged from clip-dest-modes.mjs).
 * Used by clip-bridge.mjs (resolveClipDest) and workspace-inbox-ops.mjs (ingestInbox).
 */
export const CLIP_DEST_MODES = Object.freeze(["inbox", "stream", "topic", "category"]);
