/**
 * Inbox — temporary capture queue.
 * Topic picker uses portal dropdown (never clipped by EditorArea overflow).
 */
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useDraggable } from "@dnd-kit/core";
import {
  RiArrowDownSLine,
  RiCheckboxBlankLine,
  RiCheckboxLine,
  RiDeleteBin6Line,
  RiDraggable,
  RiFileTextLine,
  RiPencilLine,
  RiFolderOpenLine,
  RiFolderReceivedLine,
  RiInboxUnarchiveLine,
  RiLink,
  RiLoader4Line,
  RiQuillPenLine,
  RiRefreshLine,
  RiAddLine,
} from "@remixicon/react";
import { api } from "../../../services/api";
import { formatRelativeTime } from "../../../lib/datetime";
import type { InboxFile as InboxFileMeta, Topic } from "../../../types";
import { Button } from "../../../components/ui/Button";
import { ConfirmDialog, PromptDialog, ErrorDialog } from "../../../components/ui/Dialog";
import {
  ViewContainer,
  EmptyState,
  MetaText,
  RowList,
  LoadingState,
  ErrorState,
  listRowClass,
  FilterChip,
  FeedLayoutToggle,
  CollectionFeed,
  FeedColumn,
  FeedChrome,
  useCollectionLayout,
} from "../../../components/ui/view";
import { TitleBarActions } from "../../../lib/chrome-portal";
import { useTitleBarChrome } from "../../../lib/titlebar-chrome";
import {
  DropdownMenu,
} from "../../../components/ui/DropdownMenu";
import {
  useFileContextMenu,
  WorkspaceFileContextMenu,
} from "../../../components/ui/workspace-file-menu";
import { useViewStore } from "../../../stores/view-store";
import { onLocal, emitLocal } from "../../../plugins/host";
import { toastWriteback, toastWritebackError } from "../../../lib/writeback-toast";
import { displayNoteTitle, noteTitleDiffersFromFile } from "../../../lib/note-meta";
import { Tooltip } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/cn";
import { ICON } from "../../../lib/icons";
import {
  TopicPickerList as SharedTopicPickerList,
  useTopicGroups as useSharedTopicGroups,
} from "../../../components/workspace/TopicPickerMenu";

type InboxFilter = "all" | "external-capture" | "user-original" | "other";

function matchesFilter(file: InboxFileMeta, filter: InboxFilter): boolean {
  if (filter === "all") return true;
  const st = file.source_type || "";
  if (filter === "external-capture") return st === "external-capture";
  if (filter === "user-original") return st === "user-original";
  return st !== "external-capture" && st !== "user-original";
}

export function InboxView() {
  const [files, setFiles] = useState<InboxFileMeta[]>([]);
  const [inboxName, setInboxName] = useState("00 Inbox");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [noteDialog, setNoteDialog] = useState(false);
  const [errorDialog, setErrorDialog] = useState<string | null>(null);
  const openOverlay = useViewStore((s) => s.openOverlay);
  const select = useViewStore((s) => s.select);
  const selection = useViewStore((s) => s.selection);
  const feedLayout = useViewStore((s) => s.feedLayout);
  const setFeedLayout = useViewStore((s) => s.setFeedLayout);
  const fileMenu = useFileContextMenu();

  const loadGen = useRef(0);
  const loadFiles = useCallback(async (opts?: { silent?: boolean }) => {
    const gen = ++loadGen.current;
    const silent = Boolean(opts?.silent);
    if (!silent) setLoading(true);
    try {
      const inbox = await api.ws.inbox();
      if (gen !== loadGen.current) return;
      setFiles(inbox.files || []);
      if (inbox.inboxName) setInboxName(inbox.inboxName);
      setSelected((prev) => {
        const paths = new Set((inbox.files || []).map((f) => f.relativePath));
        return new Set([...prev].filter((p) => paths.has(p)));
      });
      setError(null);
    } catch (e) {
      if (gen !== loadGen.current) return;
      if (!silent) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFiles();
    const unsub = onLocal("workspace:file-changed", () => void loadFiles({ silent: true }));
    return () => {
      unsub();
    };
  }, [loadFiles]);

  const counts = useMemo(() => {
    let external = 0;
    let original = 0;
    let other = 0;
    for (const f of files) {
      if (f.source_type === "external-capture") external++;
      else if (f.source_type === "user-original") original++;
      else other++;
    }
    return { all: files.length, external, original, other };
  }, [files]);

  const visible = useMemo(
    () => files.filter((f) => matchesFilter(f, filter)),
    [files, filter],
  );

  const allSelected = visible.length > 0 && visible.every((f) => selected.has(f.relativePath));
  const someSelected = selected.size > 0;

  const toggleAll = () => {
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const f of visible) next.delete(f.relativePath);
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const f of visible) next.add(f.relativePath);
        return next;
      });
    }
  };

  const toggleOne = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const { t } = useTranslation(["workspace", "common"]);

  const confirmNewNote = async (name: string) => {
    setNoteDialog(false);
    const filename = name.trim();
    if (!filename) return;
    const base = filename.endsWith(".md") ? filename : `${filename}.md`;
    const relativePath = `${inboxName}/${base}`;
    try {
      await api.ws.save({ relativePath, content: `# ${base.replace(/\.md$/u, "")}\n\n` });
      emitLocal("workspace:file-changed");
      select({ kind: "file", path: relativePath });
    } catch (e) {
      setErrorDialog(e instanceof Error ? e.message : String(e));
    }
  };

  useTitleBarChrome("inbox", {
    title: t("workspace:inbox.title"),
    stats: files.length > 0
      ? t("workspace:inbox.headerHintHas", { name: inboxName, count: files.length })
      : t("workspace:inbox.headerHintEmpty", { name: inboxName }),
  });

  if (loading) return <LoadingState label={t("workspace:inbox.loading")} />;
  if (error) return <ErrorState message={error} onRetry={() => void loadFiles()} />;

  const filterChips: { id: InboxFilter; label: string; count: number }[] = [
    { id: "all", label: t("workspace:inbox.tabAll"), count: counts.all },
    { id: "external-capture", label: t("workspace:inbox.tabExternal"), count: counts.external },
    { id: "user-original", label: t("workspace:inbox.tabUserOriginal"), count: counts.original },
    { id: "other", label: t("workspace:inbox.tabOther"), count: counts.other },
  ];

  return (
    <ViewContainer>
      <TitleBarActions>
        <Tooltip content={t("workspace:shared.newNote")}>
          <button
            type="button"
            className="v4-titlebar-btn gap-1 px-2 text-xs"
            data-inbox-new-note
            onClick={() => setNoteDialog(true)}
            aria-label={t("workspace:shared.newNote")}
          >
            <RiAddLine size={ICON.sm} />
            <span className="hidden sm:inline">{t("workspace:shared.newNote")}</span>
          </button>
        </Tooltip>
        <Tooltip content={t("common:action.refresh")}>
          <button
            type="button"
            className="v4-titlebar-btn"
            data-inbox-refresh
            onClick={() => void loadFiles({ silent: true })}
            aria-label={t("common:action.refresh")}
          >
            <RiRefreshLine size={ICON.sm} />
          </button>
        </Tooltip>
      </TitleBarActions>
      {files.length > 0 ? (
        <div className="mb-2.5 flex flex-wrap items-center gap-1" role="tablist" aria-label={t("workspace:inbox.filterLabel")}>
          {visible.length > 0 ? (
            <Tooltip content={allSelected ? t("workspace:inbox.deselectAll") : t("workspace:inbox.selectAll")}>
              <Button variant="outline" size="sm" onClick={toggleAll} className="h-7 w-7 p-0">
                {allSelected ? <RiCheckboxLine size={ICON.sm} /> : <RiCheckboxBlankLine size={ICON.sm} />}
              </Button>
            </Tooltip>
          ) : null}
          {filterChips.map((chip) => (
            <FilterChip
              key={chip.id}
              active={filter === chip.id}
              label={chip.label}
              count={chip.count}
              onClick={() => setFilter(chip.id)}
            />
          ))}
        </div>
      ) : null}

      {someSelected ? (
        <BatchToolbar
          count={selected.size}
          paths={[...selected]}
          onDone={() => {
            setSelected(new Set());
            void loadFiles({ silent: true });
          }}
        />
      ) : null}

      {files.length === 0 ? (
        <EmptyState
          icon={<RiInboxUnarchiveLine size={ICON.md} />}
          title={t("workspace:inbox.emptyTitle")}
          hint={t("workspace:inbox.emptyHint")}
          action={
            <Button variant="outline" size="sm" onClick={() => openOverlay("quick-capture")}>
              <RiPencilLine size={ICON.sm} /> {t("workspace:inbox.captureBtn")}
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<RiInboxUnarchiveLine size={ICON.md} />}
          title={t("workspace:inbox.emptyNoMatchTitle")}
          hint={t("workspace:inbox.emptyNoMatchHint")}
          action={
            <Button size="sm" variant="outline" onClick={() => setFilter("all")}>
              {t("workspace:inbox.viewAll")}
            </Button>
          }
        />
      ) : (
      <FeedColumn collection>
        <FeedChrome>
          <FeedLayoutToggle value={feedLayout} onChange={setFeedLayout} />
        </FeedChrome>
        <CollectionFeed layout={feedLayout}>
          <RowList>
            {visible.map((f) => (
              <InboxFileRow
                key={f.relativePath}
                file={f}
                active={selection.kind === "file" && selection.path === f.relativePath}
                checked={selected.has(f.relativePath)}
                onToggleCheck={() => toggleOne(f.relativePath)}
                onSelect={() => select({ kind: "file", path: f.relativePath })}
                onContextMenu={(e) =>
                  fileMenu.open(e, {
                    path: f.relativePath,
                    label: f.name,
                    kind: "inbox",
                  })
                }
              />
            ))}
          </RowList>
        </CollectionFeed>
      </FeedColumn>
      )}

      <WorkspaceFileContextMenu
        menu={fileMenu.menu}
        onClose={fileMenu.close}
        onMutated={() => void loadFiles({ silent: true })}
      />
      <PromptDialog
        open={noteDialog}
        title={t("workspace:shared.newNote")}
        defaultValue={`${t("common:action.newNote")}.md`}
        onConfirm={(v) => void confirmNewNote(v)}
        onCancel={() => setNoteDialog(false)}
      />
      <ErrorDialog
        open={!!errorDialog}
        title={t("common:status.error")}
        message={errorDialog ?? ""}
        onClose={() => setErrorDialog(null)}
      />
    </ViewContainer>
  );
}

/* ── Batch toolbar ── */

function BatchToolbar({
  count,
  paths,
  onDone,
}: {
  count: number;
  paths: string[];
  onDone: () => void;
}) {
  const { t } = useTranslation(["workspace", "common"]);
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const { groups, loading } = useSharedTopicGroups(open);

  const handleBatchMove = async (topicId: string) => {
    setMoving(true);
    try {
      const res = await api.ws.batchMove({ paths, targetTopicId: topicId });
      emitLocal("workspace:file-changed");
      emitLocal(
        "toast:show",
        res.failed
          ? { text: t("workspace:inbox.batchMoveToastPartial", { moved: res.moved, failed: res.failed }), kind: "error" }
          : { text: t("workspace:inbox.batchMoveToast", { moved: res.moved }), kind: "success" },
      );
      setOpen(false);
      onDone();
    } catch (e) {
      emitLocal("toast:show", { text: t("workspace:inbox.batchMoveFail", { error: e instanceof Error ? e.message : String(e) }), kind: "error" });
    } finally {
      setMoving(false);
    }
  };

  const handleBatchDelete = async () => {
    setConfirmDeleteOpen(true);
  };

  const confirmBatchDelete = async () => {
    setMoving(true);
    let ok = 0;
    for (const p of paths) {
      try {
        await api.ws.del(p);
        ok++;
      } catch {
        /* continue */
      }
    }
    emitLocal("workspace:file-changed");
    emitLocal(
      "toast:show",
      { text: t("workspace:inbox.batchDeleteToast", { count: ok, total: paths.length }), kind: "success" },
    );
    setMoving(false);
    onDone();
  };

  return (
    <div
      className="sticky top-0 z-local mb-2.5 flex flex-wrap items-center gap-2 rounded-[var(--radius-lg)] border border-accent-border-subtle/80 bg-surface px-2.5 py-2 shadow-[inset_0_1px_0_0_var(--color-accent-border-subtle),var(--shadow-xs)]"
      role="toolbar"
      aria-label={t("workspace:inbox.selectedCount", { count })}
    >
      <span className="text-3xs font-semibold tabular-nums text-accent-color">{t("workspace:inbox.selectedCount", { count })}</span>
      <DropdownMenu
        open={open}
        onOpenChange={setOpen}
        align="start"
        minWidth={260}
        maxHeight={360}
        matchTriggerWidth={false}
        trigger={
          <Tooltip content={t("workspace:inbox.batchMoveTooltip")}>
            <Button
              variant="default"
              size="sm"
              disabled={moving}
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
            >
              {moving ? (
                <RiLoader4Line size={ICON.sm} className="animate-spin" />
              ) : (
                <RiFolderReceivedLine size={ICON.sm} />
              )}
              {t("workspace:inbox.batchMoveBtn")}
              <RiArrowDownSLine
                size={ICON.xs}
                className={cn("transition-transform", open && "rotate-180")}
              />
            </Button>
          </Tooltip>
        }
      >
        <SharedTopicPickerList
          groups={groups}
          loading={loading}
          busy={moving}
          onPick={(id) => void handleBatchMove(id)}
        />
      </DropdownMenu>
      <Tooltip content={t("workspace:inbox.batchDeleteTooltip")}>
        <Button
          variant="outline"
          size="sm"
          disabled={moving}
          onClick={() => void handleBatchDelete()}
          className="text-error hover:bg-status-error-bg"
        >
          <RiDeleteBin6Line size={ICON.sm} /> {t("workspace:inbox.batchDeleteBtn")}
        </Button>
      </Tooltip>
      <button
        type="button"
        className="ml-auto text-3xs text-text-quaternary underline-offset-2 hover:text-accent-color hover:underline v4-focus-ring"
        onClick={() => useViewStore.getState().select({ kind: "archive" })}
      >
        {t("workspace:inbox.openArchiveBtn")}
      </button>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={t("workspace:inbox.batchDeleteBtn")}
        description={t("workspace:inbox.confirmBatchDelete", { count })}
        destructive
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={() => {
          setConfirmDeleteOpen(false);
          void confirmBatchDelete();
        }}
      />
    </div>
  );
}

/* ── Row ── */

function sourceBadge(file: InboxFileMeta, t: (key: string, options?: Record<string, unknown>) => string) {
  if (file.source_type === "external-capture") {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-accent-bg-subtle px-1.5 py-0.5 text-3xs font-medium text-accent-color"
        title={file.source || t("workspace:inbox.badgeExcerpt")}
      >
        <RiLink size={ICON.micro} aria-hidden />
        {t("workspace:inbox.badgeExcerpt")}
      </span>
    );
  }
  if (file.source_type === "user-original") {
    return (
      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-surface-muted px-1.5 py-0.5 text-3xs font-medium text-text-tertiary">
        <RiQuillPenLine size={ICON.micro} aria-hidden />
        {t("workspace:inbox.badgeOriginal")}
      </span>
    );
  }
  return null;
}

function InboxFileRow({
  file,
  active,
  checked,
  onToggleCheck,
  onSelect,
  onContextMenu,
}: {
  file: InboxFileMeta;
  active: boolean;
  checked: boolean;
  onToggleCheck: () => void;
  onSelect: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const { t } = useTranslation(["workspace", "common"]);
  const layout = useCollectionLayout();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `inbox-${file.relativePath}`,
    data: { type: "inbox-file", relativePath: file.relativePath },
  });

  const displayName = displayNoteTitle(file.name, file.title);
  const showFileHint = noteTitleDiffersFromFile(file.name, file.title);
  const secondary = file.source
    ? file.source
    : showFileHint
      ? file.name
      : null;

  return (
    <li
      ref={setNodeRef}
      data-collection-item
      {...attributes}
      onContextMenu={onContextMenu}
      className={
        layout === "card"
          ? cn(
              "v4-dense-row flex min-h-[3.25rem] items-center gap-2",
              isDragging && "opacity-50",
              (active || checked) && "ring-1 ring-inset ring-accent-color/25",
            )
          : listRowClass(
              active || checked,
              cn("v4-dense-row", isDragging && "opacity-50", "min-h-[36px] items-center gap-2 py-1.5"),
            )
      }
    >
      <Tooltip content={checked ? t("workspace:inbox.deselectItem") : t("workspace:inbox.selectItem")}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCheck();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] transition-colors",
            "v4-focus-ring",
            checked
              ? "bg-accent-bg-subtle text-accent-color shadow-[inset_0_0_0_1px_var(--color-accent-border-subtle)]"
              : "text-text-tertiary hover:bg-surface-muted hover:text-text-primary",
          )}
          aria-pressed={checked}
          aria-label={checked ? t("workspace:inbox.deselectItem") : t("workspace:inbox.selectItem")}
        >
          {checked ? <RiCheckboxLine size={ICON.sm} aria-hidden /> : <RiCheckboxBlankLine size={ICON.sm} aria-hidden />}
        </button>
      </Tooltip>

      <Tooltip content={t("workspace:inbox.dragToSidebar")}>
        <div
          {...listeners}
          className="flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-[var(--radius-md)] text-text-quaternary hover:bg-surface-muted hover:text-text-secondary active:cursor-grabbing"
          aria-label={t("workspace:inbox.dragToSidebar")}
        >
          <RiDraggable size={ICON.sm} aria-hidden />
        </div>
      </Tooltip>

      <button
        type="button"
        onClick={onSelect}
        onPointerDown={(e) => e.stopPropagation()}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[var(--radius-sm)] text-left v4-focus-ring"
        title={showFileHint ? `${displayName}\n${file.name}` : displayName}
      >
        <RiFileTextLine size={ICON.sm} className="shrink-0 text-text-tertiary opacity-80" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-sm font-normal text-text-primary group-hover:text-accent-color">
              {displayName}
            </span>
            {sourceBadge(file, t)}
          </div>
          {secondary ? (
            <div className="mt-0.5 truncate font-mono text-3xs text-text-quaternary" title={secondary}>
              {secondary}
            </div>
          ) : null}
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-1.5">
        <MetaText className="hidden sm:inline">
          {formatRelativeTime(file.mtime)} · {Math.max(1, Math.ceil(file.size / 1024))}KB
        </MetaText>
        <MoveToTopicButton file={file} />
        <DeleteInboxFileButton file={file} />
      </div>
    </li>
  );
}

function MoveToTopicButton({ file }: { file: InboxFileMeta }) {
  const { t } = useTranslation(["workspace", "common"]);
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const { groups, loading } = useSharedTopicGroups(open);

  const handleMove = async (topicId: string) => {
    setMoving(true);
    try {
      const res = await api.ws.move({
        relativePath: file.relativePath,
        targetTopicId: topicId,
      });
      emitLocal("workspace:file-changed");
      const media =
        typeof res.mediaMoved === "number" && res.mediaMoved > 0
          ? ` · ${t("workspace:menu.mediaAssetCount", { count: res.mediaMoved })}`
          : "";
      toastWriteback(t("workspace:menu.toastMovedToTopic", { media }), res);
      setOpen(false);
    } catch (e) {
      toastWritebackError(t("workspace:menu.failMove"), e);
    } finally {
      setMoving(false);
    }
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      align="end"
      minWidth={260}
      maxHeight={360}
      matchTriggerWidth={false}
      trigger={
        <Tooltip content={t("workspace:inbox.moveToTopicTooltip")}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen((v) => !v)}
            disabled={moving}
            aria-expanded={open}
            aria-label={t("workspace:menu.moveToTopic")}
            className="gap-1.5"
          >
            {moving ? (
              <RiLoader4Line size={ICON.sm} className="animate-spin" />
            ) : (
              <RiFolderReceivedLine size={ICON.sm} />
            )}
            <span className="hidden min-[480px]:inline">{t("workspace:inbox.organize")}</span>
            <RiArrowDownSLine
              size={ICON.xs}
              className={cn("transition-transform", open && "rotate-180")}
            />
          </Button>
        </Tooltip>
      }
    >
      <SharedTopicPickerList
        groups={groups}
        loading={loading}
        busy={moving}
        onPick={(id) => void handleMove(id)}
      />
    </DropdownMenu>
  );
}

function DeleteInboxFileButton({ file }: { file: InboxFileMeta }) {
  const { t } = useTranslation(["workspace", "common"]);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setDeleting(true);
    try {
      const res = await api.ws.del(file.relativePath);
      emitLocal("workspace:file-changed");
      toastWriteback(t("workspace:menu.toastDeleted"), res);
    } catch (e) {
      toastWritebackError(t("workspace:menu.failDelete"), e);
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <Tooltip
      content={
        confirming
          ? t("workspace:inbox.confirmDeleteOnceMore")
          : t("workspace:inbox.deleteToArchive")
      }
    >
      <Button
        variant={confirming ? "destructive" : "ghost"}
        size="icon"
        onClick={() => void handleDelete()}
        disabled={deleting}
        aria-label={confirming ? t("common:action.confirm") : t("common:action.delete")}
      >
        {deleting ? (
          <RiLoader4Line size={ICON.sm} className="animate-spin" />
        ) : (
          <RiDeleteBin6Line size={ICON.sm} />
        )}
      </Button>
    </Tooltip>
  );
}
