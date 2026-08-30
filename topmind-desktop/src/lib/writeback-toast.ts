/**
 * Format WritebackEvidence into a user-visible toast line.
 * Surfaces target path + backup receipt so writes are auditable in the UI.
 *
 * Uses the i18n instance directly so toast helpers work outside React render.
 */
import i18n from "../locales/index";
import { emitLocal } from "../plugins/host";
import type { ToastPayload } from "./local-events";
import type { BatchEvidenceSummary, WritebackEvidence } from "../types";

export type { ToastPayload };

function shortPath(p?: string | null): string {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/");
  if (parts.length <= 2) return parts.join("/");
  // Prefer category/topic/file visibility when path is deep
  return parts.slice(-2).join("/");
}

/**
 * Structural evidence subset — full WritebackEvidence or the slim shape
 * returned by some IPC surfaces (e.g. ledger append). Record branch tolerates
 * callers that spread whole IPC results in.
 */
export type WritebackEvidenceLike =
  | WritebackEvidence
  | Record<string, unknown>
  | null
  | undefined;

type EvidenceView = {
  targetPath?: string;
  path?: string;
  newPath?: string;
  backupPath?: string;
  receiptPath?: string;
};

function evidenceView(evidence: WritebackEvidenceLike): EvidenceView | null {
  if (!evidence || typeof evidence !== "object") return null;
  return evidence as EvidenceView;
}

export function formatWritebackToast(
  verb: string,
  evidence?: WritebackEvidenceLike,
  opts?: { fail?: boolean },
): string {
  if (opts?.fail) return `✗ ${verb}`;
  const ev = evidenceView(evidence);
  if (!ev) return `✓ ${verb}`;
  const target = ev.targetPath || ev.path || ev.newPath;
  const bits = [`✓ ${verb}`];
  if (target) bits.push(shortPath(target));
  if (ev.backupPath) {
    bits.push(i18n.t("common:writeback.backup", { path: shortPath(ev.backupPath) }));
  }
  return bits.join(" · ");
}

/**
 * Structured toast payload — when evidence has a backupPath, the Toast
 * renders an interactive「撤销」button that can restore the file.
 * Re-exported from local-events.ts (single source of truth for event types).
 */

/** Emit toast for a successful writeback. */
export function toastWriteback(verb: string, evidence?: WritebackEvidenceLike): void {
  const text = formatWritebackToast(verb, evidence);
  const ev = evidenceView(evidence);
  // Send structured payload when evidence has a backup path (enables undo button)
  if (ev?.backupPath || ev?.receiptPath) {
    emitLocal("toast:show", {
      text,
      kind: "success",
      evidence: ev as WritebackEvidence,
    } satisfies ToastPayload);
  } else {
    emitLocal("toast:show", { text, kind: "success" });
  }
}

/** Emit toast for a failed operation. */
export function toastWritebackError(verb: string, error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  emitLocal("toast:show", { text: `✗ ${verb}: ${msg}`, kind: "error" });
}

/** Format multi-file batch receipt for toast / banner title. */
export function formatBatchEvidenceLine(
  summary: BatchEvidenceSummary | null | undefined,
): string {
  if (!summary || !summary.writeCount) return "";
  const paths = summary.targetPaths || [];
  const shown = paths.slice(0, 5).map(shortPath);
  const more = paths.length > 5
    ? i18n.t("common:writeback.etcItems", { count: paths.length - 5 })
    : "";
  const backups = summary.backupPaths?.length
    ? ` · ${i18n.t("common:writeback.backup", { path: String(summary.backupPaths.length) })}`
    : "";
  const head = summary.message?.trim()
    || i18n.t("common:writeback.multiFileWriteSuccess", { count: summary.writeCount });
  if (shown.length === 0) return `${head}${backups}`;
  return `${head} · ${shown.join(", ")}${more}${backups}`;
}

/** Batch AI turn summary toast (multi-path receipt). */
export function toastBatchEvidence(summary: BatchEvidenceSummary | null | undefined): void {
  const line = formatBatchEvidenceLine(summary);
  if (!line) return;
  emitLocal("toast:show", { text: line, kind: "success" });
}
