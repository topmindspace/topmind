/**
 * External-disk conflict resolution for dirty editors (FileEditorView C3).
 * Three user choices: keep local · take disk · merge (local + disk-only block).
 *
 * Pure — no React / IPC. Desktop editor and tests share this contract.
 */

export type DiskConflictChoice = "keep-local" | "take-disk" | "merge";

export interface DiskConflictInput {
  /** Body last loaded/saved from disk (base). */
  base: string;
  /** Current dirty editor body (ours). */
  local: string;
  /** Incoming disk body (theirs). */
  disk: string;
}

export interface DiskConflictResult {
  /** True when there is nothing to resolve (auto-safe). */
  auto: boolean;
  /** How the auto path resolved (when auto=true). */
  autoKind?: "identical" | "local-eq-base" | "disk-eq-base";
  /** Body after applying the choice. */
  body: string;
  /** True when the result should be treated as dirty (needs user save). */
  dirty: boolean;
}

/**
 * Apply a user choice to a dirty/disk conflict.
 * Merge keeps the local body and appends a marked block with disk-only lines
 * (never silently drops either side).
 */
export function resolveDiskConflict(
  input: DiskConflictInput,
  choice: DiskConflictChoice,
): DiskConflictResult {
  const base = String(input.base ?? "");
  const local = String(input.local ?? "");
  const disk = String(input.disk ?? "");

  if (local === disk) {
    return { auto: true, autoKind: "identical", body: local, dirty: false };
  }
  if (local === base) {
    return { auto: true, autoKind: "local-eq-base", body: disk, dirty: false };
  }
  if (disk === base) {
    return { auto: true, autoKind: "disk-eq-base", body: local, dirty: true };
  }

  if (choice === "keep-local") {
    return { auto: false, body: local, dirty: true };
  }
  if (choice === "take-disk") {
    return { auto: false, body: disk, dirty: false };
  }
  // merge: keep local, append disk-only unique lines under a marked heading.
  const localLines = new Set(local.split("\n").map((s) => s.trim()).filter(Boolean));
  const diskOnly = disk
    .split("\n")
    .filter((line) => line.trim() && !localLines.has(line.trim()));
  if (diskOnly.length === 0) {
    return { auto: false, body: local, dirty: true };
  }
  const block = [
    "",
    "",
    "<!-- topmind:merged-from-disk -->",
    "## 外部更新（磁盘）/ External update (disk)",
    "",
    ...diskOnly,
    "",
  ].join("\n");
  return { auto: false, body: `${local.replace(/\n+$/u, "")}${block}`, dirty: true };
}

/**
 * Whether a dirty editor should open the conflict dialog for an incoming disk body.
 * Auto-safe paths return null (caller reloads or keeps without prompting).
 */
export function needsDiskConflictPrompt(
  input: DiskConflictInput,
): "prompt" | "auto" {
  const resolved = resolveDiskConflict(input, "keep-local");
  return resolved.auto ? "auto" : "prompt";
}
