/**
 * Shared knowledge-ingest queue UI — used by Hub and float Quick Capture.
 * Same jobs store (main process); both surfaces subscribe to queue events.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle, CheckCircle2, FileInput, Loader2, RotateCcw, X,
} from "lucide-react";
import { api } from "../../services/api";
import { onLocal } from "../../plugins/host";
import type { IngestJob } from "../../types";
import { Button } from "../ui/Button";
import { Tooltip } from "../ui/tooltip";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";

function shortJobDetail(text: string | undefined, max = 100): string {
  if (!text) return "";
  const s = String(text).replace(/\s+/gu, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function useIngestJobs(opts?: { limit?: number; pollMs?: number }) {
  const limit = opts?.limit ?? 40;
  const [jobs, setJobs] = useState<IngestJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api.ingest.list();
      const list = r.jobs || [];
      setJobs(list.slice(0, limit));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void refresh();
    const u1 = onLocal("ingest:queue-changed", () => void refresh());
    const u2 = onLocal("ingest:job-updated", () => void refresh());
    return () => {
      u1();
      u2();
    };
  }, [refresh]);

  // Light poll while active jobs exist (float may miss some IPC)
  useEffect(() => {
    const active = jobs.some((j) => j.status === "queued" || j.status === "running");
    if (!active) return;
    const ms = opts?.pollMs ?? 1500;
    const t = window.setInterval(() => void refresh(), ms);
    return () => window.clearInterval(t);
  }, [jobs, refresh, opts?.pollMs]);

  const activeCount = jobs.filter((j) => j.status === "queued" || j.status === "running").length;
  return { jobs, loading, error, refresh, activeCount };
}

function JobRow({
  job,
  compact,
  onOpen,
  onRetry,
  onCancel,
}: {
  job: IngestJob;
  compact?: boolean;
  onOpen?: (path: string) => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("ingest");
  const statusIcon =
    job.status === "running" || job.status === "queued" ? (
      <Loader2 size={compact ? ICON.xs : ICON.sm} className="animate-spin text-accent-color" />
    ) : job.status === "done" && !job.result?.fallback ? (
      <CheckCircle2 size={compact ? ICON.xs : ICON.sm} className="text-success" />
    ) : job.status === "done" && job.result?.fallback ? (
      <AlertTriangle size={compact ? ICON.xs : ICON.sm} className="text-warning" />
    ) : (
      <AlertTriangle size={compact ? ICON.xs : ICON.sm} className="text-error" />
    );

  const statusLabel =
    job.status === "done" && job.result?.fallback
      ? t("fallback")
      : t(`status.${job.status}`, { defaultValue: job.status });

  const detailBits: string[] = [statusLabel];
  if (!compact && job.result?.converter) detailBits.push(job.result.converter);
  if (job.result?.targetPath && !compact) detailBits.push(job.result.targetPath);
  if (job.error) detailBits.push(shortJobDetail(job.error, compact ? 48 : 120));
  else if (job.result?.warnings?.length) {
    detailBits.push(shortJobDetail(job.result.warnings[0], compact ? 48 : 120));
  }

  return (
    <li
      className={cn(
        "flex items-center gap-2 rounded-[var(--radius-md)] border border-border-subtle-dim bg-surface",
        compact ? "px-2 py-1.5 text-3xs" : "px-2.5 py-2 text-sm shadow-xs",
      )}
    >
      {statusIcon}
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate font-normal text-text-primary",
            compact ? "text-3xs" : "text-sm",
          )}
        >
          {job.source?.name}
        </div>
        <div
          className={cn(
            "truncate",
            "text-3xs",
            job.status === "failed" || job.result?.fallback
              ? "text-warning"
              : "font-mono text-text-quaternary",
          )}
          title={[job.error, ...(job.result?.warnings || [])].filter(Boolean).join("\n") || detailBits.join(" · ")}
        >
          {detailBits.join(" · ")}
        </div>
      </div>
      {job.result?.targetPath && onOpen ? (
        <Button size="sm" variant="ghost" onClick={() => onOpen(job.result!.targetPath!)}>
          {t("openResult")}
        </Button>
      ) : null}
      {(job.status === "failed" || (job.status === "done" && job.result?.fallback)) ? (
        <Tooltip content={t("retry")}>
          <Button size="sm" variant="ghost" onClick={onRetry}>
            <RotateCcw size={ICON.sm} />
          </Button>
        </Tooltip>
      ) : null}
      {job.status === "queued" ? (
        <Tooltip content={t("cancel")}>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            <X size={ICON.sm} />
          </Button>
        </Tooltip>
      ) : null}
    </li>
  );
}

export type IngestQueuePanelProps = {
  /** compact = float capture strip; full = hub list */
  variant?: "compact" | "full";
  maxItems?: number;
  /** Show header with active count */
  showHeader?: boolean;
  className?: string;
  onOpenResult?: (path: string) => void;
  /** compact: hide entirely when queue empty */
  hideWhenEmpty?: boolean;
  emptyHint?: string;
};

export function IngestQueuePanel({
  variant = "full",
  maxItems = 40,
  showHeader = true,
  className,
  onOpenResult,
  hideWhenEmpty = false,
  emptyHint,
}: IngestQueuePanelProps) {
  const { t } = useTranslation("ingest");
  const compact = variant === "compact";
  const { jobs, loading, error, refresh, activeCount } = useIngestJobs({
    limit: maxItems,
    pollMs: compact ? 1200 : 2000,
  });
  const list = jobs.slice(0, maxItems);
  const resolvedEmptyHint = emptyHint ?? t("empty");

  if (hideWhenEmpty && !loading && list.length === 0) return null;

  return (
    <div className={cn(compact ? "mt-2" : "", className)}>
      {showHeader ? (
        <div className={cn("mb-1.5 flex items-center justify-between gap-2", compact && "mb-1")}>
          <div className="text-3xs font-semibold tracking-wide text-text-secondary">
            {activeCount > 0 ? (
              <span className="inline-flex items-center gap-1 text-accent-color">
                <Loader2 size={ICON.micro} className="animate-spin" aria-hidden />
                {t("hub.subtitleActive", { count: activeCount })}
              </span>
            ) : (
              t("title")
            )}
          </div>
          <div className="text-3xs text-text-quaternary">
            {list.length > 0 ? `${list.length}` : t("empty")}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mb-1.5 rounded-[var(--radius-md)] border border-error/20 bg-status-error-bg px-2 py-1 text-3xs text-error">
          {error}
        </div>
      ) : null}

      {loading && list.length === 0 ? (
        <div className="flex items-center gap-1.5 py-2 text-3xs text-text-quaternary">
          <Loader2 size={ICON.xs} className="animate-spin" /> {t("hub.loading")}
        </div>
      ) : list.length === 0 ? (
        compact ? (
          <div className="py-1 text-3xs text-text-quaternary">{resolvedEmptyHint}</div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-6 text-text-quaternary">
            <FileInput size={ICON.md} />
            <div className="text-3xs">{resolvedEmptyHint}</div>
          </div>
        )
      ) : (
        <ul
          className={cn(
            "m-0 list-none space-y-1 p-0",
            compact && "max-h-36 overflow-y-auto overscroll-contain",
          )}
        >
          {list.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              compact={compact}
              onOpen={onOpenResult}
              onRetry={() => void api.ingest.retry(job.id).then(refresh)}
              onCancel={() => void api.ingest.cancel(job.id).then(refresh)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
