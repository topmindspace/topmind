// ── TagsView — tag cloud + filtered file list ────────────────────────────
import { useState, useEffect, useCallback } from "react";
import { Tag, FileText, AlertCircle, RefreshCw, ChevronLeft, FilePenLine, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import { onLocal } from "../../plugins/host";
import type { NoteMeta } from "../../types";
import { ICON } from "../../lib/icons";
import { getCachedAllNotes } from "../../lib/workspace-data-cache";
import { EmptyState } from "../ui/view";
import {
  useFileContextMenu,
  WorkspaceFileContextMenu,
} from "../ui/workspace-file-menu";
import { useViewStore } from "../../stores/view-store";

interface TagsViewProps {
  onNavigate: (selection: { kind: string; path: string }) => void;
}

export function TagsView({ onNavigate }: TagsViewProps) {
  const { t } = useTranslation("shell");
  const [tags, setTags] = useState<Map<string, NoteMeta[]>>(new Map());
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [truncatedHint, setTruncatedHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fileMenu = useFileContextMenu();

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const result = await getCachedAllNotes(500);
      const tagMap = new Map<string, NoteMeta[]>();
      for (const note of result.notes) {
        if (!note.tags || note.tags.length === 0) continue;
        for (const t of note.tags) {
          if (!tagMap.has(t)) tagMap.set(t, []);
          tagMap.get(t)!.push(note);
        }
      }
      const sorted = new Map([...tagMap.entries()].sort((a, b) => b[1].length - a[1].length));
      setTags(sorted);
      if (
        result.truncated
        && typeof result.scannedTotal === "number"
        && result.scannedTotal > result.notes.length
      ) {
        setTruncatedHint(t("sidebar.tags.truncatedHint", { shown: result.notes.length, total: result.scannedTotal }));
      } else {
        setTruncatedHint(null);
      }
      if (silent) setError(null);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = onLocal("workspace:file-changed", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load({ silent: true }), 200);
    });
    return () => { if (timer) clearTimeout(timer); unsub(); };
  }, [load]);

  if (loading) {
    return (
      <div
        className="flex items-center gap-1.5 px-3 py-3 text-3xs text-text-tertiary"
        role="status"
        aria-live="polite"
      >
        <Loader2 size={ICON.micro} className="animate-spin" aria-hidden /> {t("sidebar.tags.loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-1.5 px-3 py-2" role="alert">
        <div className="flex items-center gap-1.5 text-3xs text-error">
          <AlertCircle size={ICON.micro} aria-hidden />
          <span>{error}</span>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1 self-start rounded-[var(--radius-md)] border border-border-subtle px-2 py-1 text-3xs text-text-secondary hover:bg-surface-muted v4-focus-ring"
        >
          <RefreshCw size={ICON.nano} /> {t("sidebar.tags.retry")}
        </button>
      </div>
    );
  }

  if (tags.size === 0) {
    return (
      <div className="px-2 py-3">
        <EmptyState
          compact
          icon={<Tag size={ICON.sm} />}
          title={t("sidebar.tags.emptyTitle")}
          hint={t("sidebar.tags.emptyHint")}
          action={
            <button
              type="button"
              onClick={() => useViewStore.getState().select({ kind: "stream" })}
              className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-border-subtle bg-surface px-2 py-1 text-3xs font-medium text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary v4-focus-ring"
            >
              <FilePenLine size={ICON.nano} aria-hidden />
              {t("sidebar.tags.goWorkspace")}
            </button>
          }
        />
      </div>
    );
  }

  if (selectedTag) {
    const files = tags.get(selectedTag) || [];
    return (
      <div className="overflow-auto">
        <button
          type="button"
          onClick={() => setSelectedTag(null)}
          className="flex w-full items-center gap-1.5 border-b border-border-subtle px-3 py-2 text-3xs font-medium text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary"
        >
          <ChevronLeft size={ICON.xs} />
          <Tag size={ICON.micro} className="text-accent-color" />
          <span className="truncate">{selectedTag}</span>
          <span className="ml-auto rounded-full bg-surface-muted px-1.5 tabular-nums text-3xs text-text-quaternary">{files.length}</span>
        </button>
        {files.map((f, i) => (
          <button
            key={`${f.path}-${i}`}
            type="button"
            onClick={() => onNavigate({ kind: "file", path: f.path })}
            onContextMenu={(e) =>
              fileMenu.open(e, { path: f.path, label: f.name, kind: "note" })
            }
            className="v4-dense-row flex w-full items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 transition-colors hover:bg-surface-muted"
          >
            <FileText size={ICON.xs} className="shrink-0 text-text-quaternary" />
            <span className="truncate text-sm font-medium text-text-primary">{f.title || f.name.replace(/\.md$/u, "")}</span>
          </button>
        ))}
        <WorkspaceFileContextMenu
          menu={fileMenu.menu}
          onClose={fileMenu.close}
          onMutated={() => void load()}
        />
      </div>
    );
  }

  return (
    <div className="overflow-auto px-2.5 py-2">
      {truncatedHint ? (
        <div className="mb-2 rounded-[var(--radius-md)] border border-border-subtle-dim bg-surface-muted/50 px-2 py-1 text-3xs text-text-tertiary" role="status">
          {truncatedHint}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {[...tags.entries()].map(([tag, files]) => {
          const count = files.length;
          const weight = count >= 10 ? "font-semibold" : count >= 4 ? "font-medium" : "font-normal";
          return (
            <button
              key={tag}
              type="button"
              onClick={() => setSelectedTag(tag)}
              className={cn(
                "flex items-center gap-1 rounded-[var(--radius-md)] border border-border-subtle-dim bg-surface-muted/40 px-2 py-1.5 text-3xs",
                "transition-[background-color,border-color,box-shadow] duration-[var(--duration-fast)]",
                "hover:border-border-subtle hover:bg-surface-muted hover:shadow-xs",
                weight,
                "text-text-secondary",
              )}
            >
              <Tag size={ICON.micro} className="text-accent-color/70" />
              <span>{tag}</span>
              <span className="tabular-nums text-text-quaternary">{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
