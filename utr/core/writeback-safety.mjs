import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

import { t } from "./i18n-strings.mjs";

const MAX_TRANSACTIONAL_BACKUP_FILES = 10;
const MAX_TRANSACTIONAL_BACKUP_SIZE = 1_048_576;
const MAX_TRANSACTIONAL_BACKUP_AGE_MS = 60 * 60 * 1000;

function transactionalBackupPath(originalPath) {
  return `${originalPath}.mh-safe-bak`;
}

async function cleanStaleTransactionalBackups(dirPath) {
  try {
    const entries = await fs.readdir(dirPath);
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.endsWith(".mh-safe-bak")) continue;
      const fullPath = path.join(dirPath, entry);
      try {
        const stat = await fs.stat(fullPath);
        if (now - stat.mtimeMs > MAX_TRANSACTIONAL_BACKUP_AGE_MS) {
          await fs.unlink(fullPath);
        }
      } catch {
        await fs.unlink(fullPath).catch(() => {});
      }
    }
  } catch {
    // Missing or unreadable directories have no backups to clean.
  }
}

export function nextAvailablePath(targetPath, { maxAttempts = 1000 } = {}) {
  if (!existsSync(targetPath)) return targetPath;
  const parsed = path.parse(targetPath);
  for (let index = 2; index < maxAttempts; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error(t("error.safetyPathFailed", { path: targetPath }));
}

export async function snapshotAffectedFiles(resolvedPaths) {
  const backedUp = [];

  for (const filePath of resolvedPaths.slice(0, MAX_TRANSACTIONAL_BACKUP_FILES)) {
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;
      if (stat.size > MAX_TRANSACTIONAL_BACKUP_SIZE) continue;

      const backup = transactionalBackupPath(filePath);
      await fs.copyFile(filePath, backup);
      backedUp.push(filePath);

      await cleanStaleTransactionalBackups(path.dirname(filePath));
    } catch {
      // Missing or unreadable files do not need transactional snapshots.
    }
  }

  return backedUp;
}

export async function restoreAffectedFiles(backedUpPaths) {
  const restored = [];
  const failed = [];

  for (const filePath of backedUpPaths) {
    const backup = transactionalBackupPath(filePath);
    try {
      await fs.copyFile(backup, filePath);
      restored.push(filePath);
    } catch {
      failed.push(filePath);
    }
  }

  return { restored, failed };
}

export async function clearTransactionalBackups(backedUpPaths) {
  for (const filePath of backedUpPaths) {
    try {
      await fs.unlink(transactionalBackupPath(filePath));
    } catch {
      // Already cleaned or unavailable; the write itself has succeeded.
    }
  }
}
