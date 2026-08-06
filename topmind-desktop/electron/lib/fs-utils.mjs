import { promises as fs } from "node:fs";
import path from "node:path";

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
