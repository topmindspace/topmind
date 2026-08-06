/**
 * Format WritebackEvidence into a user-visible toast line.
 * Surfaces target path + backup receipt so writes are auditable in the UI.
 *
 * Uses the i18n instance directly so toast helpers work outside React render.
 */
import i18n from "../locales";
import { emitLocal } from "../plugins/host";
import type { BatchEvidenceSummary, WritebackEvidence } from "../types";

function shortPath(p?: string | null): string {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/");
  if (parts.length <= 2) return parts.join("/");
  // Prefer category/topic/file visibility when path is deep
  return parts.slice(-2).join("/");
}

export function formatWritebackToast(
  verb: string,
  evidence?: WritebackEvidence | null,
  opts?: { fail?: boolean },
): string {
  if (opts?.fail) return `✗ ${verb}`;
  if (!evidence) return `✓ ${verb}`;
  const target = evidence.targetPath || evidence.path || evidence.newPath;
  const bits = [`✓ ${verb}`];
  if (target) bits.push(shortPath(target));
  if (evidence.backupPath) {
    bits.push(i18n.t("common:writeback.backup", { path: shortPath(evidence.backupPath) }));
  }
  return bits.join(" · ");
}

/** Emit toast for a successful writeback. */
export function toastWriteback(verb: string, evidence?: WritebackEvidence | null): void {
  emitLocal("toast:show", formatWritebackToast(verb, evidence));
}

/** Emit toast for a failed operation. */
export function toastWritebackError(verb: string, error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  emitLocal("toast:show", `✗ ${verb}: ${msg}`);
}

/** Format multi-file batch receipt for toast / banner title. */
export function formatBatchEvidenceLine(
  summary: BatchEvidenceSummary | null | undefined,
): string {
  if (!summary || !summary.writeCount) return "";
  const paths = summary.targetPaths || [];
  const shown = paths.slice(0, 5).map(shortPath);
  const more = paths.length > 5
    ? i18n.t("common:writeback.etcItems", { count: paths.length })
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
  emitLocal("toast:show", line);
}
