/**
 * Optional confirm gate for knowledge-ingest pipeline batches.
 * Shown only when confirmBeforeConvert is enabled (or forceConfirm).
 */
import { AlertTriangle, FileInput, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/Button";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import {
  useIngestStagingStore,
} from "../../stores/ingest-staging-store";
import { confirmIngestStaging } from "../../lib/ingest-batch";
import type { IngestBatchItem } from "../../types";

function formatSize(n?: number): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function kindLabel(kind?: string, convertible?: boolean, t?: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!kind) return t?.("overlays:staging.kindFile") ?? "File";
  if (convertible === false) return t?.("overlays:staging.kindOriginal", { kind }) ?? `${kind} · original`;
  if (kind === "markdown" || kind === "text") return kind;
  return t?.("overlays:staging.kindToMd", { kind }) ?? `${kind} → MD`;
}

export function IngestStagingSheet() {
  const { t } = useTranslation();
  const open = useIngestStagingStore((s) => s.open);
  const items = useIngestStagingStore((s) => s.items);
  const capped = useIngestStagingStore((s) => s.capped);
  const busy = useIngestStagingStore((s) => s.busy);
  const error = useIngestStagingStore((s) => s.error);
  const setItems = useIngestStagingStore((s) => s.setItems);
  const close = useIngestStagingStore((s) => s.close);

  if (!open) return null;

  const selectedCount = items.filter((it) => it.selected !== false).length;

  const toggle = (path: string) => {
    setItems(
      items.map((it) =>
        it.absolutePath === path ? { ...it, selected: it.selected === false } : it,
      ),
    );
  };

  const selectAll = (on: boolean) => {
    setItems(items.map((it) => ({ ...it, selected: on })));
  };

  const remove = (path: string) => {
    const next = items.filter((it) => it.absolutePath !== path);
    if (!next.length) close();
    else setItems(next);
  };

  const onConfirm = () => {
    void confirmIngestStaging().catch(() => {
      /* error already in store */
    });
  };

  return (
    <div
      className="fixed inset-0 z-floating flex items-end justify-center bg-scrim p-4 sm:items-center animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ingest-staging-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) close();
      }}
    >
      <div className="flex max-h-[min(32rem,85vh)] w-full max-w-lg flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border-subtle bg-surface shadow-[var(--shadow-overlay)]">
        <header className="flex items-start gap-2 border-b border-border-subtle-dim px-4 py-3">
          <FileInput size={ICON.sm} className="mt-0.5 shrink-0 text-accent-color" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 id="ingest-staging-title" className="text-sm font-semibold tracking-tight text-text-primary">
              {t("overlays:staging.title")}
            </h2>
            <p className="mt-0.5 text-3xs text-text-tertiary">
              {t("overlays:staging.subtitle")}
            </p>
          </div>
          <button
            type="button"
            className="rounded-[var(--radius-md)] p-1 text-text-quaternary hover:bg-surface-muted hover:text-text-secondary"
            aria-label={t("overlays:staging.close")}
            disabled={busy}
            onClick={() => close()}
          >
            <X size={ICON.sm} />
          </button>
        </header>

        {capped ? (
          <div className="flex items-start gap-1.5 border-b border-warning/20 bg-status-warning-bg/40 px-4 py-2 text-3xs text-warning">
            <AlertTriangle size={ICON.xs} className="mt-0.5 shrink-0" aria-hidden />
            {t("overlays:staging.cappedWarning")}
          </div>
        ) : null}

        <div className="flex items-center gap-2 border-b border-border-subtle-dim px-4 py-1.5 text-3xs text-text-tertiary">
          <button type="button" className="hover:text-text-secondary" onClick={() => selectAll(true)}>
            {t("overlays:staging.selectAll")}
          </button>
          <span aria-hidden>·</span>
          <button type="button" className="hover:text-text-secondary" onClick={() => selectAll(false)}>
            {t("overlays:staging.selectNone")}
          </button>
          <span className="ml-auto tabular-nums">
            {t("overlays:staging.selected", { selected: selectedCount, total: items.length })}
          </span>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {items.map((it) => (
            <StagingRow
              key={it.absolutePath}
              item={it}
              onToggle={() => toggle(it.absolutePath)}
              onRemove={() => remove(it.absolutePath)}
            />
          ))}
        </ul>

        {error ? (
          <p className="px-4 pb-1 text-3xs text-danger" role="alert">
            {error}
          </p>
        ) : null}

        <footer className="flex items-center justify-end gap-2 border-t border-border-subtle-dim px-4 py-3">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => close()}>
            {t("overlays:staging.cancel")}
          </Button>
          <Button size="sm" disabled={busy || selectedCount === 0} onClick={onConfirm}>
            {busy ? (
              <>
                <Loader2 size={ICON.xs} className="animate-spin" aria-hidden /> {t("overlays:staging.confirmQueuing")}
              </>
            ) : (
              t("overlays:staging.confirmConvert", { count: selectedCount })
            )}
          </Button>
        </footer>
      </div>
    </div>
  );
}

function StagingRow({
  item,
  onToggle,
  onRemove,
}: {
  item: IngestBatchItem;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const checked = item.selected !== false;
  return (
    <li
      className={cn(
        "mb-1 flex items-start gap-2 rounded-[var(--radius-md)] px-2 py-1.5",
        checked ? "bg-surface-elevated" : "opacity-60",
      )}
    >
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
        onChange={onToggle}
        aria-label={t("overlays:staging.selectItem", { name: item.name })}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-3xs font-medium text-text-primary" title={item.absolutePath}>
          {item.name}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-2 text-3xs text-text-quaternary">
          <span>{kindLabel(item.kind, item.convertible, t)}</span>
          {item.size != null ? <span>{formatSize(item.size)}</span> : null}
        </div>
        {item.warning ? (
          <div className="mt-0.5 text-3xs text-warning">{item.warning}</div>
        ) : null}
      </div>
      <button
        type="button"
        className="shrink-0 rounded p-0.5 text-text-quaternary hover:bg-surface-muted hover:text-text-secondary"
        aria-label={t("overlays:staging.removeItem", { name: item.name })}
        onClick={onRemove}
      >
        <X size={ICON.xs} />
      </button>
    </li>
  );
}
