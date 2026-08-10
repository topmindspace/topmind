// ── topmind Workspace Model · Stream ───────────────────────────────────────
// Stream category discovery, period-note target resolution, period listing.
// Split from workspace-model facade — import via workspace-model.mjs.

import fsSync from "node:fs";
import path from "node:path";
import { resolveWorkspaceModel } from "./model-core.mjs";
import {
  normalizeStreamConfig,
  periodFileStem,
  periodNoteTitle,
  periodYearDir,
} from "./stream-period.mjs";

/**
 * First visible loose-stream (or flat-default) category — home for 动态.
 * @param {ReturnType<typeof resolveWorkspaceModel>} model
 */
export function findStreamCategory(model) {
  const loose = model.categories.find(
    (c) => c.ok && !c.hidden && c.role === "loose-stream",
  );
  if (loose) return loose;
  return (
    model.categories.find(
      (c) => c.ok && !c.hidden && c.specialBehavior === "flat-default",
    ) || null
  );
}

/**
 * Resolve stream settings + current period note absolute path.
 * @param {object} options
 * @param {string} options.workspaceRoot
 * @param {string} [options.engineRoot]
 * @param {object} [options.config]
 * @param {Date} [options.date]
 * @returns {{
 *   packing: string,
 *   appendHeading: string,
 *   streamCategory: object|null,
 *   periodStem: string|null,
 *   periodFileName: string|null,
 *   periodAbsPath: string|null,
 *   periodRelPath: string|null,
 *   title: string|null,
 * }}
 */
export function resolveStreamTarget(options = {}) {
  const model = resolveWorkspaceModel({
    workspaceRoot: options.workspaceRoot,
    engineRoot: options.engineRoot,
    config: options.config,
  });
  const stream = normalizeStreamConfig(model.stream || model.config?.stream);
  const cat = findStreamCategory(model);
  const packing = stream.packing;
  const date = options.date || new Date();
  const stem = periodFileStem(packing, date);
  if (!cat || packing === "atom" || !stem) {
    return {
      packing,
      appendHeading: stream.appendHeading,
      yearDir: stream.yearDir,
      streamCategory: cat,
      periodStem: stem,
      periodFileName: stem ? `${stem}.md` : null,
      periodAbsPath: null,
      periodRelPath: null,
      title: stem ? periodNoteTitle(packing, date) : null,
    };
  }
  const fileName = `${stem}.md`;
  const yearSub = periodYearDir(packing, stream.yearDir, date);
  // When yearDir is enabled, period notes live under {category}/{year}/{period}.md
  const relPath = yearSub
    ? path.join(cat.directory, yearSub, fileName)
    : path.join(cat.directory, fileName);
  const abs = path.join(model.workspaceRoot, relPath);
  // Normalize to forward slashes for cross-platform consistency
  const relPathNormalized = relPath.replace(/\\/g, "/");
  return {
    packing,
    appendHeading: stream.appendHeading,
    yearDir: stream.yearDir,
    streamCategory: cat,
    periodStem: stem,
    periodFileName: fileName,
    periodAbsPath: abs,
    periodRelPath: relPathNormalized,
    title: periodNoteTitle(packing, date),
  };
}

/**
 * Whether a category should receive period-note append on capture (not atom, not topic).
 * @param {object|null} category — CategoryDescriptor
 * @param {string} packing
 */
export function shouldAppendToPeriodNote(category, packing) {
  if (!category || packing === "atom") return false;
  if (category.role === "loose-stream") return true;
  if (category.specialBehavior === "flat-default") return true;
  return false;
}

/**
 * List all period notes in the stream category, including year subdirectories.
 * Returns sorted (newest first) list of { relPath, fileName, mtime, title, reconciled }.
 *
 * @param {object} options
 * @param {string} options.workspaceRoot
 * @param {string} [options.engineRoot]
 * @param {object} [options.config]
 * @param {number} [options.limit=50] — max results
 * @returns {Promise<Array<{ relPath: string, fileName: string, mtime: string|null, title: string|null, reconciled: boolean }>>}
 */
export async function listStreamPeriods(options = {}) {
  const model = resolveWorkspaceModel({
    workspaceRoot: options.workspaceRoot,
    engineRoot: options.engineRoot,
    config: options.config,
  });
  const cat = findStreamCategory(model);
  if (!cat?.path) return [];

  const stream = normalizeStreamConfig(model.stream || model.config?.stream);
  const packing = stream.packing;
  if (packing === "atom") return [];

  // Pattern for period note filenames: YYYY-Www.md (weekly), YYYY-MM-DD.md (daily), YYYY-MM.md (monthly)
  const periodPattern =
    packing === "weekly"
      ? /^\d{4}-W\d{2}\.md$/u
      : packing === "daily"
        ? /^\d{4}-\d{2}-\d{2}\.md$/u
        : packing === "monthly"
          ? /^\d{4}-\d{2}\.md$/u
          : null;
  if (!periodPattern) return [];

  const limit = options.limit || 50;
  const results = [];

  // Walk category root and year subdirectories
  const walkDir = async (dirAbs, dirRel) => {
    let entries;
    try {
      entries = await fsSync.promises.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const abs = path.join(dirAbs, e.name);
      const rel = dirRel ? `${dirRel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        // Only descend into year-like subdirs (4 digits)
        if (/^\d{4}$/u.test(e.name)) {
          await walkDir(abs, rel);
        }
      } else if (e.isFile() && periodPattern.test(e.name)) {
        let mtime = null;
        let title = null;
        let reconciled = false;
        try {
          const st = await fsSync.promises.stat(abs);
          mtime = st.mtime.toISOString();
        } catch { /* ignore */ }
        // Peek frontmatter for title + reconciled flag
        try {
          const text = fsSync.readFileSync(abs, "utf-8");
          const fmMatch = text.match(/^---\n([\s\S]*?)\n---/u);
          if (fmMatch) {
            const fm = fmMatch[1];
            const titleMatch = fm.match(/^title:\s*(.+)$/mu);
            if (titleMatch) title = titleMatch[1].trim();
            reconciled = /^reconciled_at:\s*\S+/mu.test(fm);
          }
        } catch { /* ignore */ }
        results.push({ relPath: rel, fileName: e.name, mtime, title, reconciled });
      }
    }
  };

  await walkDir(cat.path, cat.directory);

  // Sort newest first by filename (period keys sort chronologically)
  results.sort((a, b) => b.fileName.localeCompare(a.fileName));
  return results.slice(0, limit);
}

/**
 * List all year directories in the stream category.
 * Returns sorted (newest first) list of { year, periodCount, archived }.
 *
 * @param {object} options
 * @param {string} options.workspaceRoot
 * @param {string} [options.engineRoot]
 * @param {object} [options.config]
 * @returns {Promise<Array<{ year: string, periodCount: number, archived: boolean }>>}
 */
export async function listStreamYears(options = {}) {
  const model = resolveWorkspaceModel({
    workspaceRoot: options.workspaceRoot,
    engineRoot: options.engineRoot,
    config: options.config,
  });
  const cat = findStreamCategory(model);
  if (!cat?.path) return [];

  const stream = normalizeStreamConfig(model.stream || model.config?.stream);
  const packing = stream.packing;
  if (packing === "atom") return [];

  const periodPattern =
    packing === "weekly"
      ? /^\d{4}-W\d{2}\.md$/u
      : packing === "daily"
        ? /^\d{4}-\d{2}-\d{2}\.md$/u
        : packing === "monthly"
          ? /^\d{4}-\d{2}\.md$/u
          : null;
  if (!periodPattern) return [];

  const results = [];

  // Walk category root for year subdirectories
  let entries;
  try {
    entries = await fsSync.promises.readdir(cat.path, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (!e.isDirectory()) continue;
    if (!/^\d{4}$/u.test(e.name)) continue;

    const yearDirAbs = path.join(cat.path, e.name);
    let periodCount = 0;
    try {
      const yearEntries = await fsSync.promises.readdir(yearDirAbs, { withFileTypes: true });
      for (const ye of yearEntries) {
        if (ye.isFile() && periodPattern.test(ye.name)) periodCount += 1;
      }
    } catch {
      /* ignore */
    }

    // Check if this year is archived (exists in 99-归档/stream-archive/)
    let archived = false;
    try {
      const sysRoot = model.categories.find((c) => c.role === "system");
      if (sysRoot?.path) {
        const archivePath = path.join(sysRoot.path, "stream-archive", e.name);
        archived = fsSync.existsSync(archivePath);
      }
    } catch {
      /* ignore */
    }

    results.push({ year: e.name, periodCount, archived });
  }

  // Sort newest first
  results.sort((a, b) => b.year.localeCompare(a.year));
  return results;
}

/**
 * Archive a complete year of stream period notes to 99-归档/stream-archive/{year}/.
 * Only allows archiving years before the current calendar year.
 *
 * @param {object} options
 * @param {string} options.workspaceRoot
 * @param {string} options.year - 4-digit year string (e.g., "2025")
 * @param {string} [options.engineRoot]
 * @param {object} [options.config]
 * @returns {Promise<{ ok: boolean, archived: boolean, year: string, movedCount: number, archivePath: string, receiptPath?: string, reason?: string }>}
 */
export async function archiveStreamYear(options = {}) {
  const { workspaceRoot, year, engineRoot, config } = options;
  const root = path.resolve(workspaceRoot);
  const yearStr = String(year || "").trim();
  if (!/^\d{4}$/u.test(yearStr)) {
    return { ok: false, archived: false, year: yearStr, movedCount: 0, archivePath: "", reason: "invalid-year" };
  }

  const currentYear = String(new Date().getFullYear());
  if (yearStr >= currentYear) {
    return { ok: false, archived: false, year: yearStr, movedCount: 0, archivePath: "", reason: "current-or-future-year" };
  }

  const model = resolveWorkspaceModel({ workspaceRoot: root, engineRoot, config });
  const cat = findStreamCategory(model);
  if (!cat?.path) {
    return { ok: false, archived: false, year: yearStr, movedCount: 0, archivePath: "", reason: "no-stream-category" };
  }

  const sourceDir = path.join(cat.path, yearStr);
  if (!fsSync.existsSync(sourceDir)) {
    return { ok: false, archived: false, year: yearStr, movedCount: 0, archivePath: "", reason: "year-dir-not-found" };
  }

  // Count period files for receipt
  const stream = normalizeStreamConfig(model.stream || model.config?.stream);
  const packing = stream.packing;
  const periodPattern =
    packing === "weekly"
      ? /^\d{4}-W\d{2}\.md$/u
      : packing === "daily"
        ? /^\d{4}-\d{2}-\d{2}\.md$/u
        : packing === "monthly"
          ? /^\d{4}-\d{2}\.md$/u
          : null;

  let movedCount = 0;
  if (periodPattern) {
    try {
      const files = fsSync.readdirSync(sourceDir);
      movedCount = files.filter((f) => periodPattern.test(f)).length;
    } catch {
      movedCount = 0;
    }
  }

  if (movedCount === 0) {
    return { ok: false, archived: false, year: yearStr, movedCount: 0, archivePath: "", reason: "no-period-files" };
  }

  // Resolve archive destination: 99-归档/stream-archive/{year}/
  const sysCat = model.categories.find((c) => c.role === "system");
  if (!sysCat?.path) {
    return { ok: false, archived: false, year: yearStr, movedCount: 0, archivePath: "", reason: "no-archive-category" };
  }
  const archiveBase = path.join(sysCat.path, "stream-archive");
  const archiveDest = path.join(archiveBase, yearStr);

  // Ensure archive base exists
  fsSync.mkdirSync(archiveBase, { recursive: true });

  // If destination already exists, don't overwrite
  if (fsSync.existsSync(archiveDest)) {
    return { ok: false, archived: false, year: yearStr, movedCount: 0, archivePath: archiveDest, reason: "already-archived" };
  }

  // Atomic directory move (rename)
  fsSync.renameSync(sourceDir, archiveDest);

  // Generate receipt via writeback-engine (high-impact: directory archive)
  const receiptData = {
    operation: "archive-stream-year",
    year: yearStr,
    source: path.relative(root, sourceDir).replace(/\\/g, "/"),
    destination: path.relative(root, archiveDest).replace(/\\/g, "/"),
    movedCount,
    timestamp: new Date().toISOString(),
  };

  // Write receipt to 99-归档/receipts/
  const receiptsDir = path.join(sysCat.path, "receipts");
  fsSync.mkdirSync(receiptsDir, { recursive: true });
  const receiptFileName = `archive-stream-${yearStr}-${Date.now()}.json`;
  const receiptPath = path.join(receiptsDir, receiptFileName);
  fsSync.writeFileSync(receiptPath, JSON.stringify(receiptData, null, 2) + "\n", "utf-8");

  return {
    ok: true,
    archived: true,
    year: yearStr,
    movedCount,
    archivePath: path.relative(root, archiveDest).replace(/\\/g, "/"),
    receiptPath: path.relative(root, receiptPath).replace(/\\/g, "/"),
  };
}
