/**
 * Sub-header: status / priority / due chips for edit mode.
 * Uses shared Select(variant="chip") — single border, no nested chrome.
 */
import { useState } from "react";
import { Calendar, Flag, Loader2, Tag } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../../services/api";
import { emitLocal } from "../../plugins/host";
import { getStatusColumns, getPriorityOptions, resolveStatusColumn } from "../../lib/note-meta";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import { Tooltip } from "../ui/tooltip";
import { MenuSelect } from "../ui/menu-select";

interface Props {
  relativePath: string;
  frontmatter: Record<string, unknown> | null | undefined;
  readOnly?: boolean;
  flushBody?: () => Promise<void>;
  onUpdated?: (next: Record<string, unknown>) => void | Promise<void>;
  /** Title + breadcrumb (moved out of toolbar to free format tools) */
  identity?: {
    title: string;
    breadcrumb?: string | null;
    onContextMenu?: (e: React.MouseEvent) => void;
  };
}

export function FrontmatterBar({
  relativePath,
  frontmatter,
  readOnly,
  flushBody,
  onUpdated,
  identity,
}: Props) {
  const { t } = useTranslation("editor");
  const fm = frontmatter || {};
  const statusRaw = typeof fm.status === "string" ? fm.status : null;
  const statusKey = resolveStatusColumn(statusRaw);
  const priority = typeof fm.priority === "string" ? fm.priority : "";
  const due =
    typeof fm.due === "string"
      ? fm.due
      : typeof fm.deadline === "string"
        ? String(fm.deadline)
        : "";
  const tags = Array.isArray(fm.tags)
    ? (fm.tags as unknown[]).map(String).join(", ")
    : typeof fm.tags === "string"
      ? fm.tags
      : "";
  const category = typeof fm.category === "string" ? fm.category : "";
  const topic = typeof fm.topic === "string" ? fm.topic : "";

  const [busy, setBusy] = useState(false);

  const patch = async (fields: Record<string, unknown>) => {
    if (readOnly || busy) return;
    setBusy(true);
    try {
      if (flushBody) await flushBody();
      await api.ws.updateFrontmatter({ relativePath, fields });
      const next = { ...fm };
      for (const [k, v] of Object.entries(fields)) {
        if (v === null || v === "") delete next[k];
        else next[k] = v;
      }
      await onUpdated?.(next);
      emitLocal("workspace:file-changed", { relativePath });
      emitLocal("toast:show", { text: t("frontmatterBar.toastUpdated"), kind: "success" });
    } catch (e) {
      emitLocal("toast:show", { text: t("frontmatterBar.toastError", { error: e instanceof Error ? e.message : String(e) }), kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="v4-editor-subheader flex min-w-0 flex-wrap items-center gap-1.5 border-b border-border-subtle-dim px-2.5 py-1">
      {identity ? (
        <Tooltip content={t("frontmatterBar.pathTooltip", { path: relativePath })}>
          <button
            type="button"
            className="mr-1 flex min-w-0 max-w-[min(42%,220px)] shrink items-center gap-1.5 rounded-[var(--radius-sm)] px-1 py-0.5 text-left transition-colors hover:bg-surface-muted/60"
            onContextMenu={identity.onContextMenu}
          >
            <span className="min-w-0 truncate text-3xs font-medium text-text-primary">
              {identity.title}
            </span>
            {identity.breadcrumb ? (
              <span className="hidden min-w-0 truncate font-mono text-3xs text-text-quaternary sm:inline">
                {identity.breadcrumb}
              </span>
            ) : null}
          </button>
        </Tooltip>
      ) : (
        <span className="mr-0.5 hidden text-3xs font-medium uppercase tracking-wide text-text-quaternary sm:inline">
          {t("frontmatterBar.properties")}
        </span>
      )}

      <Tooltip content={t("frontmatterBar.statusTooltip")}>
        <span className="inline-flex min-w-0">
          <MenuSelect
            variant="chip"
            disabled={readOnly || busy}
            value={statusKey}
            aria-label={t("frontmatterBar.statusAria")}
            leading={<Flag size={ICON.nano} />}
            onChange={(v) => {
              const col = getStatusColumns().find((c) => c.key === v);
              if (col) void patch({ status: col.value });
            }}
            options={getStatusColumns().map((c) => ({ value: c.key, label: c.label }))}
            minWidth={140}
            maxHeight={260}
          />
        </span>
      </Tooltip>

      <Tooltip content={t("frontmatterBar.priorityTooltip")}>
        <span className="inline-flex min-w-0">
          <MenuSelect
            variant="chip"
            disabled={readOnly || busy}
            value={priority}
            aria-label={t("frontmatterBar.priorityAria")}
            onChange={(v) => void patch({ priority: v || null })}
            options={getPriorityOptions().map((p) => {
              const priorityLabelMap: Record<string, string> = { high: "priorityHigh", med: "priorityMedium", low: "priorityLow" };
              return {
                value: p.value,
                label: p.value === "" ? t("frontmatterBar.priorityNone") : t("frontmatterBar.priorityLabel", { label: t(`frontmatterBar.${priorityLabelMap[p.value]}`) }),
              };
            })}
            minWidth={140}
            maxHeight={220}
          />
        </span>
      </Tooltip>

      <Tooltip content={t("frontmatterBar.dueTooltip")}>
        <label
          className={cn(
            "v4-select-chip inline-flex h-7 max-w-[11rem] items-center gap-1 rounded-full",
            "border border-border-subtle-dim bg-surface-muted/70 px-2",
            "transition-colors hover:bg-surface-muted focus-within:ring-2 focus-within:ring-ring/35",
            (readOnly || busy) && "opacity-50",
          )}
        >
          <Calendar size={ICON.nano} className="shrink-0 opacity-60" aria-hidden />
          <input
            type="date"
            disabled={readOnly || busy}
            value={normalizeDateInput(due)}
            aria-label={t("frontmatterBar.dueAria")}
            onChange={(e) => void patch({ due: e.target.value || null })}
            className={cn(
              "h-full min-w-[6.5rem] max-w-[8.5rem] cursor-pointer border-0 bg-transparent",
              "py-0 text-3xs font-medium text-text-secondary outline-none",
              "disabled:cursor-not-allowed",
            )}
          />
        </label>
      </Tooltip>

      {tags ? (
        <Tooltip content={t("frontmatterBar.tagsTooltip", { tags })}>
          <span className="inline-flex max-w-[28%] items-center gap-1 truncate rounded-full border border-border-subtle-dim bg-surface px-2 py-0.5 text-3xs text-text-tertiary">
            <Tag size={ICON.nano} className="shrink-0 opacity-60" />
            <span className="truncate">{tags}</span>
          </span>
        </Tooltip>
      ) : null}

      {(category || topic) && (
        <span
          className="hidden max-w-[30%] truncate font-mono text-3xs text-text-quaternary lg:inline"
          title={[category, topic].filter(Boolean).join(" / ")}
        >
          {[category, topic].filter(Boolean).join(" / ")}
        </span>
      )}

      {busy ? <Loader2 size={ICON.xs} className="animate-spin text-text-quaternary" /> : null}
    </div>
  );
}

function normalizeDateInput(raw: string): string {
  if (!raw) return "";
  const m = String(raw).match(/^(\d{4}-\d{2}-\d{2})/u);
  return m ? m[1] : "";
}
