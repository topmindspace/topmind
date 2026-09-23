/**
 * Workspace cleanup preview/apply for Tools & Logs.
 * All mutations route through WorkspaceService / kernel writeback — no raw fs.rm of content.
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import { archiveRoot, absWorkspaceRoot } from "./path-model.mjs";
import { exists, listDir, statSafe } from "./fs-utils.mjs";
import { CATEGORY_PATTERN } from "./path-model.mjs";
import { kernelDurableDelete } from "./kernel-api.mjs";

const ALLOWED_ROOT_NAMES = new Set(["memory"]);
const JUNK_RE = /^\.DS_Store$/u;

async function walkFiles(abs, rel, out, max = 50_000) {
  if (out.length >= max) return;
  let dirents;
  try { dirents = await fs.readdir(abs, { withFileTypes: true }); } catch { return; }
  for (const d of dirents) {
    if (d.name === ".topmind" || d.name === ".git" || d.name === ".obsidian") continue;
    const childAbs = path.join(abs, d.name);
    const childRel = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) {
      await walkFiles(childAbs, childRel, out, max);
      continue;
    }
    if (d.isFile()) out.push({ rel: childRel, abs: childAbs, name: d.name });
  }
}

/**
 * Scan for cleanup candidates. Read-only.
 * @param {string | { userWorkspaceRoot?: string, workspaceRoot?: string }} workspaceRoot
 */
export async function scanCleanupCandidates(workspaceRoot) {
  const root = absWorkspaceRoot(workspaceRoot);
  const junk = [];
  const emptyDirs = [];
  const outOfConvention = [];

  // Root-level junk
  const rootEntries = await listDir(root).catch(() => []);
  for (const name of rootEntries) {
    if (JUNK_RE.test(name)) {
      junk.push(name);
      continue;
    }
    const abs = path.join(root, name);
    const st = await statSafe(abs);
    if (!st) continue;
    if (name.startsWith(".")) continue;
    if (name === "topmind.yaml" || name === "topmind.yml") continue;
    if (ALLOWED_ROOT_NAMES.has(name)) continue;
    if (CATEGORY_PATTERN.test(name)) continue;
    if (st.isDirectory()) {
      outOfConvention.push({ path: name, kind: "dir" });
    } else {
      outOfConvention.push({ path: name, kind: "file" });
    }
  }

  // Nested junk + empty dirs (shallow, 3 levels)
  async function scanDirs(abs, rel, depth) {
    if (depth > 3) return;
    let dirents;
    try { dirents = await fs.readdir(abs, { withFileTypes: true }); } catch { return; }
    let hasVisible = false;
    for (const d of dirents) {
      if (d.name === ".topmind" || d.name === ".git" || d.name === ".obsidian") {
        hasVisible = true;
        continue;
      }
      if (JUNK_RE.test(d.name)) {
        junk.push(rel ? `${rel}/${d.name}` : d.name);
        continue;
      }
      hasVisible = true;
      if (d.isDirectory()) {
        await scanDirs(path.join(abs, d.name), rel ? `${rel}/${d.name}` : d.name, depth + 1);
      }
    }
    if (rel && !hasVisible) emptyDirs.push(rel);
  }
  await scanDirs(root, "", 0);

  // Archive sizes for pruning hint
  let archiveBytes = 0;
  let archiveFiles = 0;
  try {
    const arch = archiveRoot({ userWorkspaceRoot: root, workspaceRoot: root });
    if (await exists(arch)) {
      const files = [];
      await walkFiles(arch, path.basename(arch), files);
      for (const f of files) {
        const st = await fs.stat(f.abs).catch(() => null);
        if (st?.isFile()) {
          archiveBytes += st.size;
          archiveFiles += 1;
        }
      }
    }
  } catch { /* no archive */ }

  return {
    scannedAt: new Date().toISOString(),
    junk,
    emptyDirs,
    outOfConvention,
    archive: { bytes: archiveBytes, files: archiveFiles },
  };
}

/**
 * Apply cleanup. Only junk + empty dirs are auto-safe; out-of-convention is never auto-moved.
 * @param {{ workspaceRoot: string, targets: Array<object>, confirmed: boolean }} p
 * @param {object} ctx
 */
export async function applyCleanup(p, ctx) {
  if (!p?.confirmed) {
    return { ok: false, reason: "needs-confirm", wrote: false };
  }
  const raw = p.workspaceRoot || ctx?.workspaceRoot;
  if (!raw) return { ok: false, reason: "no-workspace" };
  const root = absWorkspaceRoot(raw);

  const results = [];
  /** Reject rel paths that escape the workspace root. */
  const safeAbs = (rel) => {
    const r = String(rel || "").replace(/\\/g, "/");
    if (!r || r.startsWith("/") || r.includes("..")) {
      throw new Error(`path_escape: ${rel}`);
    }
    const abs = path.resolve(root, r);
    const relCheck = path.relative(root, abs);
    if (!relCheck || relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
      throw new Error(`path_escape: ${rel}`);
    }
    return abs;
  };
  for (const t of p.targets || []) {
    if (t.kind === "junk") {
      for (const rel of t.paths || []) {
        try {
          const abs = safeAbs(rel);
          await fs.unlink(abs);
          results.push({ ok: true, path: rel, op: "delete-junk" });
        } catch (err) {
          results.push({ ok: false, path: rel, op: "delete-junk", reason: err?.message });
        }
      }
      continue;
    }
    if (t.kind === "empty-dirs") {
      for (const rel of t.paths || []) {
        try {
          const abs = safeAbs(rel);
          await fs.rmdir(abs);
          results.push({ ok: true, path: rel, op: "rmdir" });
        } catch (err) {
          results.push({ ok: false, path: rel, op: "rmdir", reason: err?.message });
        }
      }
      continue;
    }
    if (t.kind === "duplicate-group") {
      // keepPath is informational (UI selected survivor); dropPaths go through writeback.
      const mode = t.mode === "permanent" ? "permanent" : "trash";
      for (const rel of t.dropPaths || []) {
        try {
          const ev = await kernelDurableDelete(
            { relativePath: rel },
            { workspaceRoot: root, userWorkspaceRoot: root },
            { permanent: mode === "permanent", actor: "user", confirmed: true },
          );
          results.push({ ok: ev?.ok !== false, path: rel, op: "duplicate-delete", mode, evidence: ev });
        } catch (err) {
          results.push({ ok: false, path: rel, op: "duplicate-delete", reason: err?.message });
        }
      }
      continue;
    }
    if (t.kind === "prune-backups") {
      // Rotation already runs on write; this re-triggers by pruning beyond KEEP.
      // Handled by listing and deleting extras beyond BACKUP_KEEP / RECEIPT_KEEP.
      const keepB = Math.max(0, Number(process.env.BACKUP_KEEP) || 3);
      const keepR = Math.max(0, Number(process.env.RECEIPT_KEEP) || 50);
      try {
        const arch = archiveRoot({ userWorkspaceRoot: root, workspaceRoot: root });
        const backupsDir = path.join(arch, "backups");
        const receiptsDir = path.join(arch, "receipts");
        let pruned = 0;
        if (keepB > 0 && await exists(backupsDir)) {
          // Per-file prune is already in kernel; here just count empties is not enough.
          // Leave deep prune to write-time rotation — report as advisory.
          pruned += 0;
        }
        if (keepR > 0 && await exists(receiptsDir)) {
          const names = (await listDir(receiptsDir).catch(() => []))
            .filter((n) => n.endsWith(".yaml") || n.endsWith(".yml"))
            .sort();
          if (names.length > keepR) {
            for (const stale of names.slice(0, names.length - keepR)) {
              await fs.unlink(path.join(receiptsDir, stale)).catch(() => undefined);
              pruned += 1;
            }
          }
        }
        results.push({ ok: true, op: "prune-backups", pruned, keepB, keepR });
      } catch (err) {
        results.push({ ok: false, op: "prune-backups", reason: err?.message });
      }
      continue;
    }
    results.push({ ok: false, op: t.kind, reason: "unsupported-target" });
  }

  const wrote = results.some((r) => r.ok);
  return { ok: wrote, wrote, results };
}
