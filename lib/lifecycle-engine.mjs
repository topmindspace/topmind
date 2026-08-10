// ── topmind Lifecycle Engine (Kernel 5/8) ──────────────────────────────────
// Authoritative engine for lifecycle management: inbox review, catch-all cleanup,
// stale topic detection, output locking, and periodic review triggers.

import fs from "node:fs";
import path from "node:path";
import { resolveWorkspaceModel } from "./workspace-model.mjs";

/**
 * Scan workspace for lifecycle candidates based on contract lifecycle rules.
 *
 * @param {object} options
 * @param {string} options.workspaceRoot
 * @param {object} options.contract - v4 contract object
 * @param {string} [options.engineRoot] - engine root for template loading
 * @returns {object} lifecycle candidates by type
 */
export function scanLifecycle({ workspaceRoot, contract, engineRoot }) {
  const lifecycle = contract?.lifecycle || {};
  const candidates = {
    inboxReview: [],
    catchAllCleanup: [],
    staleTopics: [],
    outputLock: [],
    streamDigest: [],
  };

  // Resolve workspace model to get categories
  const model = resolveWorkspaceModel({ workspaceRoot, engineRoot, config: contract });

  // Inbox review: files older than review_after_days
  const inboxDays = lifecycle.inbox?.review_after_days || 7;
  const inboxCategory = model.categories.find((c) => c.role === "buffer");
  if (inboxCategory) {
    const inboxDir = path.join(workspaceRoot, inboxCategory.directory);
    candidates.inboxReview = scanOldFiles(inboxDir, inboxDays);
  }

  // Catch-all cleanup: files older than retention_days
  const catchAllDays = lifecycle.catch_all?.retention_days || 30;
  const catchAllCategory = model.categories.find((c) => c.role === "fallback");
  if (catchAllCategory) {
    const catchAllDir = path.join(workspaceRoot, catchAllCategory.directory);
    candidates.catchAllCleanup = scanOldFiles(catchAllDir, catchAllDays);
  }

  // Stale topics: topics not updated in stale_after_days
  const staleDays = lifecycle.topic?.stale_after_days || 90;
  const deepWorkCategories = model.categories.filter((c) => c.role === "deep-work");
  for (const category of deepWorkCategories) {
    const categoryDir = path.join(workspaceRoot, category.directory);
    candidates.staleTopics.push(...scanStaleTopics(categoryDir, staleDays));
  }

  // Output lock: outputs older than lock_after_days
  const lockDays = lifecycle.output?.lock_after_days || 30;
  const outputCategory = model.categories.find((c) => c.role === "delivery");
  if (outputCategory) {
    const outputDir = path.join(workspaceRoot, outputCategory.directory);
    candidates.outputLock = scanOldFiles(outputDir, lockDays);
  }

  // Stream digest: periods older than digest_after_periods
  const digestPeriods = lifecycle.stream?.digest_after_periods || 4;
  const streamCategory = model.categories.find((c) => c.role === "loose-stream");
  if (streamCategory) {
    const streamDir = path.join(workspaceRoot, streamCategory.directory);
    candidates.streamDigest = scanOldPeriods(streamDir, digestPeriods, model.stream?.packing);
  }

  return candidates;
}

/**
 * Scan directory for files older than specified days.
 * @param {string} dirPath
 * @param {number} days
 * @returns {Array<{path: string, daysOld: number}>}
 */
function scanOldFiles(dirPath, days) {
  const results = [];
  const now = Date.now();
  const threshold = days * 24 * 60 * 60 * 1000;

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      // Permission denied or other FS errors - skip this directory
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        try {
          const stats = fs.statSync(fullPath);
          const age = now - stats.mtimeMs;
          if (age > threshold) {
            results.push({
              path: fullPath,
              daysOld: Math.floor(age / (24 * 60 * 60 * 1000)),
            });
          }
        } catch {
          // File stat failed - skip this file
          continue;
        }
      }
    }
  }

  walk(dirPath);
  return results;
}

/**
 * Scan directory for stale topics (not updated in specified days).
 * Uses latest file mtime in topic directory instead of directory mtime (Windows unreliable).
 * @param {string} dirPath
 * @param {number} days
 * @returns {Array<{path: string, daysOld: number}>}
 */
function scanStaleTopics(dirPath, days) {
  const results = [];
  const now = Date.now();
  const threshold = days * 24 * 60 * 60 * 1000;

  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.isDirectory() && /^\d{4}-/.test(entry.name)) {
      const topicPath = path.join(dirPath, entry.name);
      const latestMtime = getLatestFileMtime(topicPath);
      if (latestMtime) {
        const age = now - latestMtime;
        if (age > threshold) {
          results.push({
            path: topicPath,
            daysOld: Math.floor(age / (24 * 60 * 60 * 1000)),
          });
        }
      }
    }
  }

  return results;
}

/**
 * Get latest file mtime in directory (recursive).
 * @param {string} dirPath
 * @returns {number|null} latest mtime in milliseconds
 */
function getLatestFileMtime(dirPath) {
  let latest = null;

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        try {
          const stats = fs.statSync(fullPath);
          if (!latest || stats.mtimeMs > latest) {
            latest = stats.mtimeMs;
          }
        } catch {
          continue;
        }
      }
    }
  }

  walk(dirPath);
  return latest;
}

/**
 * Scan stream directory for old periods (older than specified periods).
 * Supports weekly/daily/monthly packing and yearDir subdirectory layout.
 * Collects period files from both root level and year subdirectories.
 * @param {string} dirPath
 * @param {number} periods
 * @param {string} [packing] - stream packing (weekly|daily|monthly)
 * @returns {Array<{path: string, periodsOld: number}>}
 */
function scanOldPeriods(dirPath, periods, packing = "weekly") {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }

  // Match period files based on packing
  let pattern;
  if (packing === "daily") {
    pattern = /^\d{4}-\d{2}-\d{2}\.md$/;
  } else if (packing === "monthly") {
    pattern = /^\d{4}-\d{2}\.md$/;
  } else {
    // weekly
    pattern = /^\d{4}-W\d{2}\.md$/;
  }

  // Collect period files from root level and year subdirectories (yearDir default true)
  /** @type {{ name: string, fullPath: string }[]} */
  const periodFiles = [];
  for (const e of entries) {
    if (e.isFile() && pattern.test(e.name)) {
      periodFiles.push({ name: e.name, fullPath: path.join(dirPath, e.name) });
    } else if (e.isDirectory() && /^\d{4}$/u.test(e.name)) {
      // Scan year subdirectory
      try {
        const yearEntries = fs.readdirSync(path.join(dirPath, e.name));
        for (const f of yearEntries) {
          if (pattern.test(f)) {
            periodFiles.push({ name: f, fullPath: path.join(dirPath, e.name, f) });
          }
        }
      } catch {
        /* ignore year dir read errors */
      }
    }
  }

  // Sort newest first by filename (period keys sort chronologically)
  periodFiles.sort((a, b) => b.name.localeCompare(a.name));

  for (let i = periods; i < periodFiles.length; i++) {
    results.push({
      path: periodFiles[i].fullPath,
      periodsOld: i,
    });
  }

  return results;
}
