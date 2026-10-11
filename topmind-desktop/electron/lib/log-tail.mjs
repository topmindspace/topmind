/**
 * Log tail / clear — read the desktop file sinks for the Tools & Logs panel.
 * No Electron dependency beyond paths supplied by the caller.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { getLogFilePath } from "./writeback.mjs";
import { getOpsJournalPath } from "./ops-journal.mjs";

function resolveLogFile(file) {
  if (file === "ops") return getOpsJournalPath();
  return getLogFilePath();
}

/**
 * Tail JSONL log lines with optional filters. Reads whole file then filters —
 * files are size-capped (main 2MB×3, ops 1MB×2) so this stays cheap.
 * @param {{ file?: "main"|"ops", limit?: number, level?: string, cat?: string, contains?: string, includeRotated?: boolean }} p
 */
export async function tailLogFile(p = {}) {
  const which = p.file === "ops" ? "ops" : "main";
  const primary = resolveLogFile(which);
  if (!primary) return { ok: false, reason: "not-attached", entries: [], path: null };

  const limit = Math.max(1, Math.min(Number(p.limit) || 200, 2000));
  const files = [];
  try {
    const dir = path.dirname(primary);
    const base = path.basename(primary);
    const names = await fs.readdir(dir);
    const matching = names.filter((n) =>
      n === base || n.startsWith(`${base}.`),
    );
    matching.sort((a, b) => {
      if (a === base) return 1;
      if (b === base) return -1;
      const an = Number(a.split(".").pop()) || 0;
      const bn = Number(b.split(".").pop()) || 0;
      return bn - an;
    });
    for (const n of matching) {
      const isRotated = n !== base;
      if (isRotated && !p.includeRotated) continue;
      files.push(path.join(dir, n));
    }
  } catch (err) {
    return { ok: false, reason: err?.message || String(err), entries: [], path: primary };
  }

  const levelRank = { debug: 0, info: 1, warn: 2, error: 3 };
  const minLevel = p.level ? (levelRank[p.level] ?? 1) : 0;
  const entries = [];
  for (const file of files) {
    let text = "";
    try { text = await fs.readFile(file, "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (p.level) {
        const lv = levelRank[String(obj.level || "info").toLowerCase()] ?? 1;
        if (lv < minLevel) continue;
      }
      if (p.cat && obj.cat !== p.cat) continue;
      if (p.contains) {
        const hay = `${obj.msg || ""} ${JSON.stringify(obj)}`.toLowerCase();
        if (!hay.includes(String(p.contains).toLowerCase())) continue;
      }
      entries.push(obj);
    }
  }
  return {
    ok: true,
    file: which,
    path: primary,
    total: entries.length,
    entries: entries.slice(-limit),
  };
}

/**
 * Clear primary log file (and optionally rotated siblings).
 * @param {{ file?: "main"|"ops", includeRotated?: boolean }} p
 */
export async function clearLogFile(p = {}) {
  const which = p.file === "ops" ? "ops" : "main";
  const primary = resolveLogFile(which);
  if (!primary) return { ok: false, reason: "not-attached" };
  try {
    await fs.writeFile(primary, "", "utf8");
    if (p.includeRotated) {
      const dir = path.dirname(primary);
      const base = path.basename(primary);
      const names = await fs.readdir(dir).catch(() => []);
      for (const n of names) {
        if (n !== base && n.startsWith(`${base}.`)) {
          await fs.unlink(path.join(dir, n)).catch(() => undefined);
        }
      }
    }
    return { ok: true, path: primary, file: which };
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) };
  }
}

/** Absolute directory that actually holds the file sinks. */
export function logsDirectory() {
  const p = getLogFilePath() || getOpsJournalPath();
  return p ? path.dirname(p) : null;
}
