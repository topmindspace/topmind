import { useState, useCallback, useMemo, useEffect, useRef, memo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { RiAddLine, RiArrowDownSLine, RiArrowRightSLine, RiLoader4Line } from "@remixicon/react";
import { useTranslation } from "react-i18next";
import { TreeNodeIcon } from "./tree-node-icons";
import { TreeNodeContextMenu } from "./tree-node-context-menu";
import { selectionKey } from "../../lib/tree-reveal";
import { pathOfTreeNode } from "../../lib/tree-path";
import type { TreeNode } from "../../plugins/types";
import { useViewStore } from "../../stores/view-store";
import { useRegistry } from "../../plugins/registry";
import { makeMinCtx } from "../../plugins/min-ctx";
import { api } from "../../services/api";
import { emitLocal } from "../../plugins/host";
import { PromptDialog, ConfirmDialog, ErrorDialog } from "../ui/Dialog";
import { Tooltip } from "../ui/tooltip";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import { sortTreeSiblings, type TreeSortMode } from "../../lib/tree-sort";

/** Strip .md extension from file labels for cleaner tree display. */
/** Tree indentation — single source for all depth-based offsets in the tree.
 *  Row padding: TREE_INDENT_BASE + depth * TREE_INDENT_STEP.
 *  Indented child rows (loading / stale-cache / empty state) add the icon gutter
 *  (chevron + node icon) so they visually sit under the parent's label. */
const TREE_INDENT_BASE = 12;
const TREE_INDENT_STEP = 12;
const TREE_INDENT_GUTTER = 8;

function treeIndent(depth: number): number {
  return TREE_INDENT_BASE + depth * TREE_INDENT_STEP;
}

function treeChildIndent(depth: number): number {
  return treeIndent(depth) + TREE_INDENT_GUTTER;
}

function stripMdExt(label: string): string {
  return String(label || "").replace(/\.md$/u, "");
}

/** Format an ISO mtime string into a readable "YYYY-MM-DD HH:mm" string. */
function formatMtime(mtime: unknown): string | null {
  if (typeof mtime !== "string" || !mtime) return null;
  const d = new Date(mtime);
  if (isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Relative time like "刚刚" / "3 分钟前" / "2 天前" for compact display. */
function relativeTime(mtime: unknown): string | null {
  if (typeof mtime !== "string" || !mtime) return null;
  const d = new Date(mtime);
  if (isNaN(d.getTime())) return null;
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return null; // too fresh — don't show "刚刚"
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} d`;
  return formatMtime(mtime); // fallback to absolute for old dates
}

/** Build a rich multi-line tooltip string from node metadata. */
function buildNodeTooltip(node: TreeNode, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const lines: string[] = [];
  const mtime = formatMtime(node.meta?.mtime);
  const relTime = relativeTime(node.meta?.mtime);
  const fileCount = node.meta?.fileCount as number | undefined;

  if (node.kind === "file") {
    // Full filename (with extension) as title
    lines.push(node.label);
    if (node.selection?.kind === "file" && node.selection.topicId) {
      lines.push(`${t("sidebar.treeView.tooltipPath")}: ${node.selection.topicId}`);
    } else if (node.selection?.kind === "file" && node.selection.path) {
      lines.push(`${t("sidebar.treeView.tooltipPath")}: ${node.selection.path}`);
    }
    if (mtime) {
      const rel = relTime ? ` (${relTime})` : "";
      lines.push(`${t("sidebar.treeView.tooltipModified")}: ${mtime}${rel}`);
    }
  } else if (node.kind === "topic" || node.kind === "folder") {
    lines.push(node.label);
    if (typeof fileCount === "number" && fileCount > 0) {
      lines.push(t("sidebar.treeView.tooltipFileCount", { count: fileCount }));
    }
    if (mtime) {
      const rel = relTime ? ` (${relTime})` : "";
      lines.push(`${t("sidebar.treeView.tooltipModified")}: ${mtime}${rel}`);
    }
  } else if (node.kind === "category") {
    lines.push(node.label);
    const childCount = node.children?.length ?? 0;
    if (childCount > 0) {
      lines.push(t("sidebar.treeView.tooltipTopicCount", { count: childCount }));
    }
  } else if (node.kind === "group") {
    lines.push(node.label);
    if (typeof fileCount === "number" && fileCount > 0) {
      lines.push(t("sidebar.treeView.tooltipFileCount", { count: fileCount }));
    }
  } else {
    lines.push(node.label);
  }

  return lines.join("\n");
}

/** Render category/group labels with muted PARA number prefix (e.g. "00-" in "00-收件箱"). */
function renderCategoryLabel(label: string): React.ReactNode {
  const m = String(label || "").match(/^(\d{2}-)(.+)$/u);
  if (!m) return label;
  return (
    <>
      <span className="text-text-quaternary/70">{m[1]}</span>
      <span>{m[2]}</span>
    </>
  );
}

type DialogState =
  | { kind: "none" }
  | { kind: "prompt"; title: string; defaultValue: string; resolve: (v: string | null) => void }
  | { kind: "confirm"; title: string; description: string; resolve: (v: boolean) => void }
  | { kind: "error"; title: string; message: string };

interface Props {
  nodes: TreeNode[];
  depth?: number;
  onRefresh?: () => void;
  loadChildren?: (node: TreeNode, opts?: { force?: boolean }) => Promise<void>;
  childrenCache?: Map<string, TreeNode[]>;
  loadingNodes?: Set<string>;
  /** Sibling sort under each parent (default mtime-desc). */
  sortMode?: TreeSortMode;
}

interface NodeProps {
  node: TreeNode;
  depth: number;
  onRefresh?: () => void;
  loadChildren?: (node: TreeNode, opts?: { force?: boolean }) => Promise<void>;
  childrenCache?: Map<string, TreeNode[]>;
  loadingNodes?: Set<string>;
  sortMode?: TreeSortMode;
}

interface MenuState {
  node: TreeNode;
  x: number;
  y: number;
}

export function TreeView({
  nodes,
  depth = 0,
  onRefresh,
  loadChildren,
  childrenCache,
  loadingNodes,
  sortMode = "mtime-desc",
}: Props) {
  const ordered = useMemo(() => sortTreeSiblings(nodes, sortMode), [nodes, sortMode]);
  return (
    <ul className="m-0 list-none p-0" role={depth === 0 ? "tree" : "group"}>
      {ordered.map((node) => (
        <TreeViewNode
          key={node.id}
          node={node}
          depth={depth}
          onRefresh={onRefresh}
          loadChildren={loadChildren}
          childrenCache={childrenCache}
          loadingNodes={loadingNodes}
          sortMode={sortMode}
        />
      ))}
    </ul>
  );
}

const TreeViewNode = memo(function TreeViewNode({
  node,
  depth,
  onRefresh,
  loadChildren,
  childrenCache,
  loadingNodes,
  sortMode = "mtime-desc",
}: NodeProps) {
  const { t } = useTranslation("shell");
  // Fine-grained selector: only re-render if THIS node's expansion state changes
  const expanded = useViewStore(useCallback((s) => s.expandedNodeIds.has(node.id), [node.id]));
  // Fine-grained selector: only re-render if THIS node's active state changes
  const nodeSelKey = useMemo(() => (node.selection ? selectionKey(node.selection) : null), [node.selection]);
  const isActive = useViewStore(
    useCallback((s) => Boolean(nodeSelKey && selectionKey(s.selection) === nodeSelKey), [nodeSelKey]),
  );
  const toggleNode = useViewStore((s) => s.toggleNode);
  const select = useViewStore((s) => s.select);
  const workspaceRoot = useViewStore((s) => s.workspaceRoot);
  const contextMenuSlots = useRegistry((s) => s.contextMenuSlots);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });

  // Plugin-registered context menu items computed lazily only when context menu opens
  const pluginMenuItems = useMemo(() => {
    if (!menu) return [];
    return contextMenuSlots.filter((slot) => {
      try { return slot.matches(node); } catch { return false; }
    });
  }, [menu, contextMenuSlots, node]);

  const showPrompt = (title: string, defaultValue = "") =>
    new Promise<string | null>((resolve) => setDialog({ kind: "prompt", title, defaultValue, resolve }));
  const showConfirm = (title: string, description: string) =>
    new Promise<boolean>((resolve) => setDialog({ kind: "confirm", title, description, resolve }));
  const showError = (title: string, message: string) => setDialog({ kind: "error", title, message });
  const closeDialog = () => setDialog({ kind: "none" });

  // Resolve children: use cache if available (lazy-loaded topic files), then sort
  const resolvedChildren = useMemo(() => {
    let raw: TreeNode[];
    if (node.meta?.lazy && childrenCache?.has(node.id)) {
      raw = childrenCache.get(node.id)!;
    } else {
      raw = node.children ?? [];
    }
    return sortTreeSiblings(raw, sortMode);
  }, [node.id, node.meta, node.children, childrenCache, sortMode]);

  const hasChildren =
    (resolvedChildren.length > 0)
    || (node.meta?.fileCount as number) > 0
    || (node.kind === "folder" && node.meta?.lazy === true);
  const isGroup = node.kind === "group";
  const isLoading = loadingNodes?.has(node.id) ?? false;

  // Topic nodes are droppable targets for inbox file drag-and-drop
  const topicId = node.kind === "topic" && node.selection?.kind === "topic" ? node.selection.topicId : null;
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-${node.id}`,
    disabled: !topicId,
    data: topicId ? { type: "topic", topicId } : undefined,
  });

  const rowRef = useRef<HTMLDivElement | null>(null);
  const setRowRef = useCallback(
    (el: HTMLDivElement | null) => {
      rowRef.current = el;
      if (topicId) setDropRef(el);
    },
    [topicId, setDropRef],
  );

  // Keep active node in view when selection changes (e.g. from search / recent strip)
  useEffect(() => {
    if (!isActive) return;
    const el = rowRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [isActive, node.id]);

  // Auto-reload stale cache: when a lazy topic/folder is expanded but the cache
  // entry is missing (cleared during refresh) and should have files
  // (fileCount > 0), silently trigger a reload instead of showing "暂无笔记".
  // Guard: only reload when cache entry is MISSING — not when it exists but is
  // empty (empty = no files match the current filter, which is correct).
  const cacheHasEntry = Boolean(childrenCache?.has(node.id));
  useEffect(() => {
    if (
      expanded &&
      node.meta?.lazy &&
      !cacheHasEntry &&
      !isLoading &&
      (node.meta?.fileCount as number) > 0 &&
      loadChildren
    ) {
      void loadChildren(node, { force: true });
    }
  }, [expanded, node, cacheHasEntry, isLoading, loadChildren]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ node, x: e.clientX, y: e.clientY });
  }, [node]);

  const closeMenu = () => setMenu(null);

  const handleClick = useCallback(() => {
    if (hasChildren) toggleNode(node.id);
    if (node.selection) select(node.selection);
    // Lazy load children on first expand (topics + real subfolders)
    if (node.meta?.lazy && !expanded && loadChildren && resolvedChildren.length === 0) {
      void loadChildren(node);
    }
  }, [hasChildren, toggleNode, node, select, expanded, loadChildren, resolvedChildren.length]);

  const handleExpandAllUnder = () => {
    closeMenu();
    // Expand this node + all currently cached descendants
    const expand = useViewStore.getState().expandNodes;
    const ids = [node.id];
    const walk = (n: TreeNode) => {
      const kids =
        (n.meta?.lazy && childrenCache?.has(n.id) ? childrenCache.get(n.id) : n.children) || [];
      for (const c of kids) {
        if (c.kind === "topic" || c.kind === "folder" || c.kind === "category" || c.kind === "group") {
          ids.push(c.id);
          walk(c);
        }
      }
    };
    walk(node);
    expand(ids);
    if (node.meta?.lazy && loadChildren) void loadChildren(node);
  };

  const handleCollapseUnder = () => {
    closeMenu();
    const expanded = useViewStore.getState().expandedNodeIds;
    const next = new Set(expanded);
    next.delete(node.id);
    const drop = (n: TreeNode) => {
      const kids =
        (n.meta?.lazy && childrenCache?.has(n.id) ? childrenCache.get(n.id) : n.children) || [];
      for (const c of kids) {
        next.delete(c.id);
        drop(c);
      }
    };
    drop(node);
    useViewStore.getState().setExpandedNodes(Array.from(next));
  };

  // Keyboard handler — Enter/Space activates, ArrowLeft collapses, ArrowRight expands
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        if (node.selection) select(node.selection);
        break;
      case "ArrowLeft":
        if (hasChildren && expanded) { e.preventDefault(); toggleNode(node.id); }
        break;
      case "ArrowRight":
        if (hasChildren && !expanded) {
          e.preventDefault();
          toggleNode(node.id);
          if (node.meta?.lazy && loadChildren && resolvedChildren.length === 0) {
            void loadChildren(node);
          }
        }
        break;
    }
  }, [hasChildren, expanded, toggleNode, node, select, loadChildren, resolvedChildren.length]);

  const handleNewNote = async () => {
    closeMenu();
    const topicId = node.kind === "topic" ? node.selection?.kind === "topic" ? node.selection.topicId : null : null;
    if (!topicId) return;
    const name = await showPrompt(t("sidebar.treeView.promptNewNote"), t("sidebar.treeView.defaultNewNote"));
    if (!name?.trim()) return;
    try {
      let filename = name.trim();
      if (!filename.endsWith(".md")) filename = `${filename}.md`;
      await api.ws.saveNote({
        topicId,
        filename,
        content: `# ${filename.replace(/\.md$/u, "")}\n\n`,
        sourceType: "user-original",
      });
      select({ kind: "file", path: `${topicId}/${filename}`, topicId });
      onRefresh?.();
    } catch (e) {
      showError(t("sidebar.treeView.errorCreate"), e instanceof Error ? e.message : String(e));
    }
  };

  const handleNewTopic = async () => {
    closeMenu();
    const category = node.id.replace(/^cat\//, "");
    if (!category) return;
    const year = new Date().getFullYear();
    const name = await showPrompt(t("sidebar.treeView.promptNewTopic"), t("sidebar.treeView.defaultNewTopic", { year }));
    if (!name?.trim()) return;
    try {
      const result = await api.ws.createTopic(category, name.trim());
      select({ kind: "topic", topicId: result.topicId });
      // Expand category so the new topic is visible
      if (!expanded) toggleNode(node.id);
      onRefresh?.();
    } catch (e) {
      showError(t("sidebar.treeView.errorCreate"), e instanceof Error ? e.message : String(e));
    }
  };

  const handleNewCategoryNote = async () => {
    closeMenu();
    const category = node.id.replace(/^cat\//, "");
    if (!category) return;
    const name = await showPrompt(t("sidebar.treeView.promptNewNote"), t("sidebar.treeView.defaultNewNote"));
    if (!name?.trim()) return;
    try {
      const relativePath = `${category}/${name.trim()}`;
      await api.ws.save({ relativePath, content: `# ${name.replace(/\.md$/, "")}\n\n` });
      select({ kind: "file", path: relativePath });
      onRefresh?.();
    } catch (e) {
      showError(t("sidebar.treeView.errorCreate"), e instanceof Error ? e.message : String(e));
    }
  };

  const handleDelete = async () => {
    closeMenu();
    if (node.kind === "file" && node.selection?.kind === "file") {
      const ok = await showConfirm(t("sidebar.treeView.confirmDeleteFile"), t("sidebar.treeView.confirmDeleteFileDesc", { name: node.label }));
      if (!ok) return;
      try {
        await api.ws.del(node.selection.path);
        select({ kind: "stream" });
        onRefresh?.();
      } catch (e) {
        showError(t("sidebar.treeView.errorDelete"), e instanceof Error ? e.message : String(e));
      }
    } else if (node.kind === "topic" && node.selection?.kind === "topic") {
      const ok = await showConfirm(t("sidebar.treeView.confirmDeleteTopic"), t("sidebar.treeView.confirmDeleteTopicDesc", { name: node.label }));
      if (!ok) return;
      try {
        await api.ws.deleteTopic(node.selection.topicId);
        select({ kind: "stream" });
        onRefresh?.();
      } catch (e) {
        showError(t("sidebar.treeView.errorDelete"), e instanceof Error ? e.message : String(e));
      }
    }
  };

  const handleRename = async () => {
    closeMenu();
    if (node.kind !== "file" || node.selection?.kind !== "file") return;
    const newName = await showPrompt(t("sidebar.treeView.promptRename"), node.label);
    if (!newName?.trim() || newName === node.label) return;
    try {
      const dir = node.selection.path.split("/").slice(0, -1).join("/");
      const nextPath = dir ? `${dir}/${newName.trim()}` : newName.trim();
      await api.ws.rename({ relativePath: node.selection.path, newName: newName.trim() });
      select({ kind: "file", path: nextPath, topicId: node.selection.topicId });
      onRefresh?.();
    } catch (e) {
      showError(t("sidebar.treeView.errorRename"), e instanceof Error ? e.message : String(e));
    }
  };

  const handleRenameTopic = async () => {
    closeMenu();
    if (node.kind !== "topic" || node.selection?.kind !== "topic") return;
    const topicId = node.selection.topicId;
    const parts = topicId.split("/");
    const category = parts[0];
    const oldName = parts.slice(1).join("/");
    const newName = await showPrompt(t("sidebar.treeView.promptRenameTopic"), oldName);
    if (!newName?.trim() || newName === oldName) return;
    try {
      const result = await api.ws.renameTopic({ topicId, newName: newName.trim() });
      const newTopicId = result.topicId || `${category}/${newName.trim()}`;
      select({ kind: "topic", topicId: newTopicId });
      onRefresh?.();
    } catch (e) {
      showError(t("sidebar.treeView.errorRename"), e instanceof Error ? e.message : String(e));
    }
  };

  const handlePublish = async () => {
    closeMenu();
    if (node.kind !== "file" || node.selection?.kind !== "file") return;
    try {
      await api.ws.publish(node.selection.path);
      onRefresh?.();
    } catch (e) {
      showError(t("sidebar.treeView.errorPublish"), e instanceof Error ? e.message : String(e));
    }
  };

  const handleCopyPath = async () => {
    closeMenu();
    const rel = pathOfTreeNode(node);
    if (!rel) return;
    try {
      await api.ws.copyPath(rel);
      emitLocal("toast:show", { text: t("sidebar.treeView.toastCopiedPath"), kind: "success" });
    } catch (e) {
      showError(t("sidebar.treeView.errorCopy"), e instanceof Error ? e.message : String(e));
    }
  };

  const handleReveal = async () => {
    closeMenu();
    const rel = pathOfTreeNode(node);
    if (!rel) return;
    try {
      await api.ws.reveal(rel);
    } catch (e) {
      showError(t("sidebar.treeView.errorOperation"), e instanceof Error ? e.message : String(e));
    }
  };

  const handleOpenExternal = async () => {
    closeMenu();
    if (node.selection?.kind !== "file") return;
    try {
      await api.ws.open(node.selection.path);
    } catch (e) {
      showError(t("sidebar.treeView.errorOperation"), e instanceof Error ? e.message : String(e));
    }
  };

  const handleOpenSelection = () => {
    closeMenu();
    if (node.selection) select(node.selection);
  };

  const handleDuplicate = async () => {
    closeMenu();
    if (node.selection?.kind !== "file") return;
    try {
      await api.ws.duplicate(node.selection.path);
      onRefresh?.();
    } catch (e) {
      showError(t("sidebar.treeView.errorCopy"), e instanceof Error ? e.message : String(e));
    }
  };

  const fileSelection = node.kind === "file" && node.selection?.kind === "file" ? node.selection : null;
  const isFileNode = fileSelection !== null;
  const isReadOnly = isFileNode && fileSelection.readOnly === true;

  return (
    <li role="none">
      <div
        ref={setRowRef}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
        role="treeitem"
        aria-expanded={hasChildren ? expanded : undefined}
        aria-selected={isActive}
        data-tree-node-id={node.id}
        tabIndex={isGroup ? -1 : 0}
        className={cn(
          "v4-tree-node group flex min-h-(--density-tree-row,30px) cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 outline-none select-none",
          "transition-[background-color,color,box-shadow] duration-(--duration-fast)",
          "focus-visible:ring-2 focus-visible:ring-ring/35",
          node.kind === "group" || node.kind === "category"
            ? "text-xs font-medium text-text-primary"
            : node.kind === "topic" || node.kind === "folder"
            ? "text-xs font-normal text-text-secondary"
            : "text-xs font-normal text-text-tertiary group-hover:text-text-primary",
          isActive && "is-selected text-accent-color",
          isActive && "font-medium",
          "v4-drop-target",
          isOver && "v4-drop-target-active",
        )}
        style={{ "--tree-indent": `${treeIndent(depth)}px`, paddingLeft: "var(--tree-indent)" } as React.CSSProperties}
      >
        {hasChildren ? (
          expanded ? (
            <RiArrowDownSLine size={ICON.micro} className={cn("shrink-0 transition-transform", isActive ? "text-accent-color" : "text-text-tertiary group-hover:text-text-secondary")} />
          ) : (
            <RiArrowRightSLine size={ICON.micro} className={cn("shrink-0 transition-transform", isActive ? "text-accent-color" : "text-text-tertiary group-hover:text-text-secondary")} />
          )
        ) : (
          <span className="w-2.75 shrink-0" />
        )}
        <TreeNodeIcon node={node} expanded={expanded} isActive={isActive} />
        <Tooltip content={buildNodeTooltip(node, t)} side="right" sideOffset={4}>
          <span className="min-w-0 flex-1 truncate">
            {node.kind === "file"
              ? stripMdExt(node.label)
              : node.kind === "category" || node.kind === "group"
                ? renderCategoryLabel(node.label)
                : node.label}
          </span>
        </Tooltip>
        {/* Hover quick actions — modern density, no clutter when idle */}
        {node.kind === "group" && node.id === "section/inbox" ? (
          <Tooltip content={t("titleBar.capture")}>
            <button
              type="button"
              aria-label={t("titleBar.capture")}
              className="mr-0.5 hidden h-5 w-5 shrink-0 items-center justify-center rounded-sm text-text-quaternary opacity-0 pointer-events-none transition-[opacity,background-color,color] duration-(--duration-fast) hover:bg-surface hover:text-accent-color focus-visible:inline-flex focus-visible:opacity-100 focus-visible:pointer-events-auto v4-focus-ring group-hover:inline-flex group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:inline-flex group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
              onClick={(e) => {
                e.stopPropagation();
                // Select inbox first so QuickCapture defaults to inbox dest
                select({ kind: "inbox" });
                emitLocal("overlay:open", { kind: "quick-capture" });
              }}
            >
              <RiAddLine size={ICON.micro} aria-hidden />
            </button>
          </Tooltip>
        ) : null}
        {node.kind === "category" ? (
          <Tooltip content={t("sidebar.treeView.tooltipNewTopic")}>
            <button
              type="button"
              aria-label={t("sidebar.treeView.ariaNewTopic")}
              className="mr-0.5 hidden h-5 w-5 shrink-0 items-center justify-center rounded-sm text-text-quaternary opacity-0 pointer-events-none transition-[opacity,background-color,color] duration-(--duration-fast) hover:bg-surface hover:text-accent-color focus-visible:inline-flex focus-visible:opacity-100 focus-visible:pointer-events-auto v4-focus-ring group-hover:inline-flex group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:inline-flex group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
              onClick={(e) => {
                e.stopPropagation();
                void handleNewTopic();
              }}
            >
              <RiAddLine size={ICON.micro} aria-hidden />
            </button>
          </Tooltip>
        ) : null}
        {node.kind === "topic" ? (
          <Tooltip content={t("sidebar.treeView.tooltipNewNote")}>
            <button
              type="button"
              aria-label={t("sidebar.treeView.ariaNewNote")}
              className="mr-0.5 hidden h-5 w-5 shrink-0 items-center justify-center rounded-sm text-text-quaternary opacity-0 pointer-events-none transition-[opacity,background-color,color] duration-(--duration-fast) hover:bg-surface hover:text-accent-color focus-visible:inline-flex focus-visible:opacity-100 focus-visible:pointer-events-auto v4-focus-ring group-hover:inline-flex group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:inline-flex group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
              onClick={(e) => {
                e.stopPropagation();
                void handleNewNote();
              }}
            >
              <RiAddLine size={ICON.micro} aria-hidden />
            </button>
          </Tooltip>
        ) : null}
        {isLoading ? (
          <RiLoader4Line size={ICON.micro} className="mr-1 shrink-0 animate-spin text-text-tertiary" />
        ) : null}
        {isOver ? (
          <span
            className="v4-drop-dot mr-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-color"
            aria-hidden
            title={t("sidebar.treeView.dropHintTopic")}
          />
        ) : null}
        {/* Subtle file count for topics / folders */}
        {(node.kind === "topic" || node.kind === "folder")
          && typeof node.meta?.fileCount === "number"
          && !isLoading ? (
          <span className="mr-1 shrink-0 rounded-full bg-surface-muted/90 px-1.5 py-0.5 text-3xs tabular-nums text-text-quaternary opacity-70 group-hover:opacity-100">
            {node.meta.fileCount as number}
          </span>
        ) : null}
      </div>
      {expanded ? (
        isLoading ? (
          <div
            className="flex items-center gap-1.5 py-1 text-3xs text-text-tertiary"
            style={{ paddingLeft: `${treeChildIndent(depth)}px` }}
            role="status"
          >
            <RiLoader4Line size={ICON.micro} className="animate-spin" aria-hidden /> {t("sidebar.treeView.loadingFiles")}
          </div>
        ) : resolvedChildren.length > 0 ? (
          <TreeView
            nodes={resolvedChildren}
            depth={depth + 1}
            onRefresh={onRefresh}
            loadChildren={loadChildren}
            childrenCache={childrenCache}
            loadingNodes={loadingNodes}
            sortMode={sortMode}
          />
        ) : (node.kind === "topic" || node.kind === "category") &&
          node.meta?.lazy &&
          (node.meta?.fileCount as number) > 0 &&
          !childrenCache?.has(node.id) ? (
          /* Stale cache guard: lazy topic/category with fileCount > 0 but cache
             entry is missing (cleared during refresh). Show loading instead of
             "暂无笔记" and auto-trigger a reload via the effect above. */
          <div
            className="flex items-center gap-1.5 py-1 text-3xs text-text-tertiary"
            style={{ paddingLeft: `${treeChildIndent(depth)}px` }}
            role="status"
          >
            <RiLoader4Line size={ICON.micro} className="animate-spin" aria-hidden /> {t("sidebar.treeView.loadingFiles")}
          </div>
        ) : node.kind === "topic" || node.kind === "category" ? (
          <div
            className="mx-2 mb-1 mt-0.5 rounded-md border border-dashed border-border-subtle bg-surface-muted/25 px-2 py-2 text-3xs text-text-quaternary"
            style={{ marginLeft: `${treeIndent(depth)}px` }}
          >
            {node.kind === "category" ? (
              <button
                type="button"
                className="flex w-full items-center gap-1.5 text-left transition-colors hover:text-accent-color v4-focus-ring"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleNewTopic();
                }}
              >
                <RiAddLine size={ICON.micro} className="shrink-0" aria-hidden />
                {t("sidebar.treeView.emptyCategory")}
              </button>
            ) : (
              <button
                type="button"
                className="flex w-full items-center gap-1.5 text-left transition-colors hover:text-accent-color v4-focus-ring"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleNewNote();
                }}
              >
                <RiAddLine size={ICON.micro} className="shrink-0" aria-hidden />
                {t("sidebar.treeView.emptyTopic")}
              </button>
            )}
          </div>
        ) : null
      ) : null}

      <TreeNodeContextMenu
        open={!!menu}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        node={node}
        expanded={expanded}
        isFileNode={isFileNode}
        isReadOnly={isReadOnly}
        pluginMenuItems={pluginMenuItems}
        h={{
          closeMenu,
          handleOpenSelection,
          handleNewTopic,
          handleNewCategoryNote,
          handleNewNote,
          handleExpandAllUnder,
          handleCollapseUnder,
          handleCopyPath,
          handleReveal,
          handleDelete,
          handleRename,
          handleRenameTopic,
          handleDuplicate,
          handlePublish,
          handleOpenExternal,
          openQuickCapture: () => {
            closeMenu();
            // Select inbox first so QuickCapture defaults to inbox dest
            if (node.kind === "group" && node.id === "section/inbox") {
              select({ kind: "inbox" });
            }
            emitLocal("overlay:open", { kind: "quick-capture" });
          },
          expandFolderIfNeeded: () => {
            closeMenu();
            if (!expanded) {
              toggleNode(node.id);
              if (node.meta?.lazy && loadChildren) void loadChildren(node);
            }
          },
          runPlugin: (slot) => {
            closeMenu();
            void slot.run(makeMinCtx(workspaceRoot), node);
          },
        }}
      />

      {/* Dialogs (replacing native prompt/confirm/alert) */}
      {dialog.kind === "prompt" && (
        <PromptDialog
          open
          title={dialog.title}
          defaultValue={dialog.defaultValue}
          maxWidth="max-w-lg"
          onConfirm={(v) => { dialog.resolve(v); closeDialog(); }}
          onCancel={() => { dialog.resolve(null); closeDialog(); }}
        />
      )}
      {dialog.kind === "confirm" && (
        <ConfirmDialog
          open
          title={dialog.title}
          description={dialog.description}
          destructive
          onConfirm={() => { dialog.resolve(true); closeDialog(); }}
          onCancel={() => { dialog.resolve(false); closeDialog(); }}
        />
      )}
      {dialog.kind === "error" && (
        <ErrorDialog
          open
          title={dialog.title}
          message={dialog.message}
          onClose={closeDialog}
        />
      )}
    </li>
  );
});
