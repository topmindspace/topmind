// ── KanbanView — status board with drag-to-write frontmatter ─────────────
import { useState, useEffect, useCallback } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import { FileText, AlertCircle, RefreshCw, Loader2, Radio } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import { api } from "../../services/api";
import { onLocal, emitLocal } from "../../plugins/host";
import type { NoteMeta } from "../../types";
import {
  getStatusColumns,
  resolveStatusColumn,
  statusValueForColumn,
  type StatusColumnKey,
} from "../../lib/note-meta";
import { getCachedAllNotes } from "../../lib/workspace-data-cache";
import { Tooltip } from "../ui/tooltip";
import {
  useFileContextMenu,
  WorkspaceFileContextMenu,
} from "../ui/workspace-file-menu";
import { ICON } from "../../lib/icons";

interface KanbanViewProps {
  onNavigate: (selection: { kind: string; path: string }) => void;
}

export function KanbanView({ onNavigate }: KanbanViewProps) {
  const { t } = useTranslation("shell");
  const [columns, setColumns] = useState<Map<string, NoteMeta[]>>(new Map());
  const [truncatedHint, setTruncatedHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeNote, setActiveNote] = useState<NoteMeta | null>(null);
  const [savingPath, setSavingPath] = useState<string | null>(null);
  const fileMenu = useFileContextMenu();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const result = await getCachedAllNotes(500);
      const colMap = new Map<string, NoteMeta[]>();
      for (const col of getStatusColumns()) colMap.set(col.key, []);
      for (const note of result.notes) {
        const colKey = resolveStatusColumn(note.status);
        colMap.get(colKey)!.push(note);
      }
      setColumns(colMap);
      if (
        result.truncated
        && typeof result.scannedTotal === "number"
        && result.scannedTotal > result.notes.length
      ) {
        setTruncatedHint(t("sidebar.kanban.truncatedHint", { shown: result.notes.length, total: result.scannedTotal }));
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

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = onLocal("workspace:file-changed", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load({ silent: true }), 200);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [load]);

  const moveNoteLocal = (notePath: string, toKey: StatusColumnKey) => {
    setColumns((prev) => {
      const next = new Map<string, NoteMeta[]>();
      let moved: NoteMeta | undefined;
      for (const col of getStatusColumns()) {
        const list: NoteMeta[] = [];
        for (const n of prev.get(col.key) || []) {
          if (n.path === notePath) moved = n;
          else list.push(n);
        }
        next.set(col.key, list);
      }
      if (moved) {
        const updated: NoteMeta = { ...moved, status: statusValueForColumn(toKey) };
        next.set(toKey, [...(next.get(toKey) || []), updated]);
      }
      return next;
    });
  };

  const handleDragStart = (e: DragStartEvent) => {
    const note = e.active.data.current?.note as NoteMeta | undefined;
    setActiveNote(note ?? null);
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setActiveNote(null);
    const note = e.active.data.current?.note as NoteMeta | undefined;
    const toKey = e.over?.data.current?.columnKey as StatusColumnKey | undefined;
    if (!note || !toKey) return;
    const fromKey = resolveStatusColumn(note.status);
    if (fromKey === toKey) return;

    moveNoteLocal(note.path, toKey);
    setSavingPath(note.path);
    try {
      await api.ws.updateFrontmatter({
        relativePath: note.path,
        fields: { status: statusValueForColumn(toKey) },
      });
      emitLocal("workspace:file-changed");
      emitLocal("toast:show", { text: t("sidebar.kanban.toastMoved", { name: note.name, status: t(`sidebar.kanban.status${toKey.replace(/-(.)/gu, (_, c) => c.toUpperCase()).replace(/^./u, (c) => c.toUpperCase())}`) }), kind: "success" });
    } catch (err) {
      // Revert by reload
      void load();
      emitLocal(
        "toast:show",
        { text: t("sidebar.kanban.toastMoveFailed", { error: err instanceof Error ? err.message : String(err) }), kind: "error" },
      );
    } finally {
      setSavingPath(null);
    }
  };

  if (loading) {
    return (
      <div
        className="flex items-center gap-1.5 px-3 py-3 text-3xs text-text-tertiary"
        role="status"
        aria-live="polite"
      >
        <Loader2 size={ICON.micro} className="animate-spin" aria-hidden /> {t("sidebar.kanban.loading")}
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
        <Tooltip content={t("sidebar.kanban.reloadTooltip")}>
          <button
            type="button"
            onClick={() => void load()}
            className="flex items-center gap-1 self-start rounded-[var(--radius-md)] border border-border-subtle px-2 py-1 text-3xs text-text-tertiary hover:text-accent-color v4-focus-ring"
          >
            <RefreshCw size={ICON.micro} aria-hidden /> {t("sidebar.kanban.retry")}
          </button>
        </Tooltip>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={(e) => void handleDragEnd(e)}>
      <div className="v4-content-scroll flex h-full flex-col gap-2.5 overflow-auto p-2.5">
        <div className="flex items-center justify-between">
          <Tooltip content={t("sidebar.kanban.hintTooltip")}>
            <div className="cursor-help px-1 text-3xs leading-relaxed text-text-quaternary">
              {t("sidebar.kanban.hint")}
            </div>
          </Tooltip>
          <Tooltip content={t("sidebar.kanban.backToStream")}>
            <button
              type="button"
              onClick={() => emitLocal("sidebar:set-view", "stream")}
              aria-label={t("sidebar.kanban.backToStream")}
              className="flex items-center gap-0.5 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-3xs text-text-tertiary transition-colors hover:bg-surface-muted hover:text-accent-color v4-focus-ring"
            >
              <Radio size={ICON.nano} aria-hidden />
            </button>
          </Tooltip>
        </div>
        {truncatedHint ? (
          <div
            role="status"
            className="rounded-[var(--radius-md)] border border-border-subtle-dim bg-surface-muted/50 px-2 py-1 text-3xs text-text-tertiary"
          >
            {truncatedHint}
          </div>
        ) : null}
        {getStatusColumns().map((col) => {
          const notes = columns.get(col.key) || [];
          return (
            <KanbanColumn
              key={col.key}
              columnKey={col.key}
              label={t(`sidebar.kanban.status${col.key.replace(/-(.)/gu, (_, c) => c.toUpperCase()).replace(/^./u, (c) => c.toUpperCase())}`)}
              notes={notes}
              savingPath={savingPath}
              onNavigate={onNavigate}
              onFileContextMenu={fileMenu.open}
            />
          );
        })}
        <WorkspaceFileContextMenu
          menu={fileMenu.menu}
          onClose={fileMenu.close}
          onMutated={() => void load()}
        />
      </div>
      <DragOverlay dropAnimation={null}>
        {activeNote ? (
          <div className="rounded-[var(--radius-md)] border border-accent-border-subtle bg-surface-elevated px-2.5 py-2 text-3xs font-medium shadow-[var(--shadow-elevated-hairline,var(--shadow-float))]">
            {activeNote.title || activeNote.name}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function KanbanColumn({
  columnKey,
  label,
  notes,
  savingPath,
  onNavigate,
  onFileContextMenu,
}: {
  columnKey: StatusColumnKey;
  label: string;
  notes: NoteMeta[];
  savingPath: string | null;
  onNavigate: (selection: { kind: string; path: string }) => void;
  onFileContextMenu: (
    e: React.MouseEvent,
    target: { path: string; label?: string; kind?: "note" },
  ) => void;
}) {
  const { t } = useTranslation("shell");
  const { setNodeRef, isOver } = useDroppable({
    id: `kanban-col-${columnKey}`,
    data: { columnKey },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "v4-drop-target rounded-[var(--radius-lg)] border border-border-subtle-dim bg-surface-muted/35 p-2",
        isOver && "v4-drop-target-active",
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5 px-1 text-3xs font-medium tracking-wide text-text-quaternary">
        <FileText size={ICON.micro} aria-hidden />
        <span>{label}</span>
        <span className="rounded-full bg-surface-muted px-1.5 tabular-nums text-text-quaternary">{notes.length}</span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {notes.length === 0 ? (
          <li
            className={cn(
              "rounded-[var(--radius-md)] border border-dashed border-border-subtle-dim bg-surface/40 px-2 py-3 text-center text-3xs text-text-quaternary transition-colors",
              isOver && "border-accent-color/40 bg-accent-bg-subtle/40 text-accent-color",
            )}
          >
            {isOver ? t("shell:sidebar.kanban.dropOver") : t("shell:sidebar.kanban.dropEmpty")}
          </li>
        ) : (
          notes.map((n) => (
            <KanbanCard
              key={n.path}
              note={n}
              saving={savingPath === n.path}
              onNavigate={onNavigate}
              onContextMenu={(e) =>
                onFileContextMenu(e, {
                  path: n.path,
                  label: n.name,
                  kind: "note",
                })
              }
            />
          ))
        )}
      </ul>
    </div>
  );
}

function KanbanCard({
  note,
  saving,
  onNavigate,
  onContextMenu,
}: {
  note: NoteMeta;
  saving: boolean;
  onNavigate: (selection: { kind: string; path: string }) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `kanban-note-${note.path}`,
    data: { note },
  });

  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onContextMenu={onContextMenu}
      className={cn(
        "v4-dense-row group flex cursor-grab items-start gap-1.5 rounded-[var(--radius-md)] border border-border-subtle-dim bg-surface px-2.5 py-2 text-3xs shadow-xs",
        "transition-[opacity,box-shadow,border-color] duration-[var(--duration-fast)] active:cursor-grabbing",
        "hover:border-border-subtle hover:shadow-sm",
        isDragging && "opacity-35 shadow-none",
      )}
    >
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={(e) => {
          e.stopPropagation();
          onNavigate({ kind: "file", path: note.path });
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="truncate font-normal text-text-primary group-hover:text-accent-color">
          {note.title || note.name}
        </div>
        <div className="mt-0.5 line-clamp-2 text-3xs leading-relaxed text-text-quaternary">
          {[note.category, note.topic].filter(Boolean).join(" / ") || note.path}
          {note.priority ? ` · ${note.priority}` : ""}
          {note.due ? ` · due ${String(note.due).slice(0, 10)}` : ""}
        </div>
      </button>
      {saving ? <Loader2 size={ICON.micro} className="mt-0.5 shrink-0 animate-spin text-accent-color" /> : null}
    </li>
  );
}
