import { useEffect, useState, useCallback, useRef, lazy } from "react";
import {
  Database, AlertCircle, RefreshCw, Puzzle, ChevronDown, ChevronRight,
  CalendarDays, UserRound,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRegistry } from "../../plugins/registry";
import { useViewStore, loadExpandedState, type SidebarViewMode } from "../../stores/view-store";
import { TreeView } from "../sidebar/TreeView";
import { TreeToolbar } from "../sidebar/tree-toolbar";
import { ViewSwitcher } from "../sidebar/ViewSwitcher";
import { LazyBoundary } from "../ui/LazyBoundary";
import { api } from "../../services/api";
import { emitLocal, onLocal } from "../../plugins/host";
import type { TreeNode, SidebarSlot } from "../../plugins/types";
import { ICON } from "../../lib/icons";
import { patchCachedSettings } from "../../lib/settings-cache";
import {
  defaultExpandIds,
  expandIdsForSelection,
} from "../../lib/tree-reveal";
import {
  classifyTreeFileChange,
  inboxChildCount,
  shouldExpandInboxSection,
} from "../../lib/tree-listing-change";
import { EmptyState } from "../ui/view";
import { Tooltip } from "../ui/tooltip";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import type { FileFilterMode } from "../../types";

const TimelineView = lazy(() =>
  import("../sidebar/TimelineView").then((m) => ({ default: m.TimelineView })),
);
const TagsView = lazy(() =>
  import("../sidebar/TagsView").then((m) => ({ default: m.TagsView })),
);
const KanbanView = lazy(() =>
  import("../sidebar/KanbanView").then((m) => ({ default: m.KanbanView })),
);

const VALID_MODES: SidebarViewMode[] = ["stream", "category", "timeline", "tags", "kanban"];
const StreamView = lazy(() =>
  import("../sidebar/StreamView").then((m) => ({ default: m.StreamView })),
);

/** Topic / folder path id (e.g. `20-专题/2026-foo`) — not cat/section. */
function idLooksLikeTopicPath(id: string): boolean {
  return Boolean(id && id.includes("/") && !id.startsWith("cat/") && !id.startsWith("section/") && !id.startsWith("folder/"));
}

/** Resolve the lazy-load FS path for a tree node (shared by softRefresh + loadChildren). */
function nodeLazyPath(node: TreeNode): string | null {
  return (
    (typeof node.meta?.lazyPath === "string" && node.meta.lazyPath) ||
    (node.selection?.kind === "topic" ? node.selection.topicId : null) ||
    (node.kind === "folder" && node.id.startsWith("folder/")
      ? node.id.slice("folder/".length)
      : null) ||
    (idLooksLikeTopicPath(node.id) ? node.id : null)
  );
}

/** Build TreeNode children from directory entries (shared by softRefresh + loadChildren). */
function buildChildrenFromEntries(
  entries: Array<{ kind: "dir" | "file"; relativePath: string; name: string; childCount?: number; mtime?: string | null; title?: string | null; ext?: string }>,
  topicId: string | undefined,
  readOnly: boolean,
): TreeNode[] {
  return (entries || []).map((e) => {
    if (e.kind === "dir") {
      return {
        id: `folder/${e.relativePath}`,
        label: e.name,
        kind: "folder" as const,
        children: [],
        meta: {
          lazy: true,
          lazyPath: e.relativePath,
          fileCount: e.childCount ?? 0,
          mtime: e.mtime || null,
          topicId,
          readOnly,
        },
      };
    }
    return {
      id: e.relativePath,
      label: e.name,
      kind: "file" as const,
      selection: {
        kind: "file" as const,
        path: e.relativePath,
        topicId,
        readOnly: readOnly || undefined,
      },
      meta: { mtime: e.mtime || null, title: e.title ?? null, ext: e.ext },
    };
  });
}

interface SidebarPins {
  periodRelPath: string | null;
  profileRelPath: string | null;
  periodLabel: string;
}

export function Sidebar() {
  const { t } = useTranslation("shell");
  const dataSources = useRegistry((s) => s.dataSources);
  const sidebarSlots = useRegistry((s) => s.sidebarSlots);
  const select = useViewStore((s) => s.select);
  const viewMode = useViewStore((s) => s.sidebarView);
  const setSidebarView = useViewStore((s) => s.setSidebarView);
  const [enabledViews, setEnabledViews] = useState<SidebarViewMode[] | undefined>(undefined);
  const [pins, setPins] = useState<SidebarPins>({
    periodRelPath: null,
    profileRelPath: null,
    periodLabel: t("sidebar.streamDefault"),
  });

  useEffect(() => {
    void api.sys
      .getWorkspaceConfig()
      .then((cfg) => {
        const enabled = cfg.views?.enabled;
        if (Array.isArray(enabled) && enabled.length > 0) {
          setEnabledViews(enabled.filter((m): m is SidebarViewMode => VALID_MODES.includes(m as SidebarViewMode)));
        }
      })
      .catch(() => {});
    void api.ws
      .getStreamContext()
      .then((ctx) => {
        setPins({
          periodRelPath: ctx.periodRelPath,
          profileRelPath: ctx.memory?.profileRelPath || null,
          periodLabel: ctx.periodTitle || t("sidebar.streamDefault"),
        });
      })
      .catch(() => {});
  }, [t]);

  // Only reload stream context pins when the event has no relativePath
  // (structural change like organize/move). Content-only saves (auto-save)
  // carry a relativePath and don't change the period path — skip to avoid flicker.
  useEffect(() => {
    return onLocal("workspace:file-changed", (payload) => {
      const rel =
        payload && typeof payload === "object" && "relativePath" in payload
          ? String((payload as { relativePath?: string }).relativePath || "")
          : "";
      // Content-only save: period path unchanged — skip stream context reload
      if (rel) return;
      void api.ws
        .getStreamContext()
        .then((ctx) => {
          setPins({
            periodRelPath: ctx.periodRelPath,
            profileRelPath: ctx.memory?.profileRelPath || null,
            periodLabel: ctx.periodTitle || t("sidebar.streamDefault"),
          });
        })
        .catch(() => {});
    });
  }, [t]);

  const handleViewModeChange = useCallback((mode: SidebarViewMode) => {
    // Canonical persistence: settings.ui.sidebarView (Shell debounced write)
    setSidebarView(mode);
  }, [setSidebarView]);

  // If active view was disabled in config, fall back to first enabled
  useEffect(() => {
    if (!enabledViews || enabledViews.length === 0) return;
    if (!enabledViews.includes(viewMode)) {
      handleViewModeChange(enabledViews[0]);
    }
  }, [enabledViews, viewMode, handleViewModeChange]);

  // Home / shortcuts can switch sidebar mode without prop drilling
  useEffect(() => {
    return onLocal("sidebar:set-view", (payload) => {
      const mode = typeof payload === "string" ? payload : (payload as { mode?: string })?.mode;
      if (mode && VALID_MODES.includes(mode as SidebarViewMode)) {
        if (enabledViews && enabledViews.length > 0 && !enabledViews.includes(mode as SidebarViewMode)) {
          return;
        }
        handleViewModeChange(mode as SidebarViewMode);
      }
    });
  }, [handleViewModeChange, enabledViews]);

  const handleNavigate = useCallback(
    (selection: { kind: string; path: string; focusHeading?: string }) => {
      // Timeline / Tags / Kanban / Stream emit path-based file navigation
      if (selection.kind === "file" && selection.path) {
        select({
          kind: "file",
          path: selection.path,
          ...(selection.focusHeading?.trim()
            ? { focusHeading: selection.focusHeading.trim() }
            : {}),
        });
        return;
      }
      if (selection.kind === "inbox" || selection.kind === "outputs" || selection.kind === "archive" || selection.kind === "stream") {
        select({ kind: selection.kind });
      }
    },
    [select],
  );

  const renderView = () => {
    switch (viewMode) {
      case "stream":
        return (
          <LazyBoundary label={t("sidebar.loadingStream")}>
            <StreamView onNavigate={handleNavigate} />
          </LazyBoundary>
        );
      case "category":
        if (dataSources.length === 0) {
          return (
            <div className="px-2 py-4">
              <EmptyState
                compact
                icon={<Database size={ICON.sm} />}
                title={t("sidebar.waitingDataSources")}
                hint={t("sidebar.loadingPlugins")}
              />
            </div>
          );
        }
        return dataSources.map((ds) => (
          <DataSourceSection
            key={ds.id}
            dataSource={ds}
            compactHeader={dataSources.length === 1}
            pins={pins}
          />
        ));
      case "timeline":
        return (
          <LazyBoundary label={t("sidebar.loadingTimeline")}>
            <TimelineView onNavigate={handleNavigate} />
          </LazyBoundary>
        );
      case "tags":
        return (
          <LazyBoundary label={t("sidebar.loadingTags")}>
            <TagsView onNavigate={handleNavigate} />
          </LazyBoundary>
        );
      case "kanban":
        return (
          <LazyBoundary label={t("sidebar.loadingKanban")}>
            <KanbanView onNavigate={handleNavigate} />
          </LazyBoundary>
        );
    }
  };

  return (
    <div className="v4-panel-contain v4-sidebar-rail flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-0.5 pb-1" data-sidebar-header>
        <ErrorBoundary label={t("sidebar.viewSwitcher.ariaTablist")}>
          <ViewSwitcher active={viewMode} onChange={handleViewModeChange} enabled={enabledViews} />
        </ErrorBoundary>
        <span className="flex shrink-0 items-center pr-1.5">
          <ProfileButton />
        </span>
      </div>
      {/* Period pin — timeline/tags/kanban only.
          Stream has its own period header; category merges the pin into DataSourceSection. */}
      {viewMode !== "category" && viewMode !== "stream" ? (
        <div className="flex shrink-0 items-center gap-1 px-1.5 py-1" data-sidebar-pins>
          <PeriodPill pins={pins} />
        </div>
      ) : null}
      <div className="v4-sidebar-scroll min-h-0 flex-1 overflow-auto px-1 py-1">
        <ErrorBoundary label={t("sidebar.loading")}>
          {renderView()}
        </ErrorBoundary>
      </div>
      {sidebarSlots.length > 0 ? <PluginSlotsSection slots={sidebarSlots} /> : null}
    </div>
  );
}

/** Period label pill — navigates to stream or opens quick capture. */
function PeriodPill({ pins }: { pins: SidebarPins }) {
  const { t } = useTranslation("shell");
  const select = useViewStore((s) => s.select);
  return (
    <Tooltip content={pins.periodRelPath || t("sidebar.streamPinTip")}>
      <button
        type="button"
        onClick={() => {
          if (pins.periodRelPath) select({ kind: "stream" });
          else emitLocal("overlay:open", { kind: "quick-capture" });
        }}
        className="inline-flex min-w-0 flex-1 items-center gap-1 truncate rounded-full bg-surface-muted/40 px-2 py-0.5 text-3xs text-text-secondary transition-colors hover:bg-surface-muted"
        aria-label={pins.periodLabel || t("sidebar.streamPinTip")}
      >
        <CalendarDays size={ICON.nano} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{pins.periodLabel}</span>
      </button>
    </Tooltip>
  );
}

/** Profile button — ensures core profile exists and navigates to it. */
function ProfileButton() {
  const { t } = useTranslation("shell");
  const select = useViewStore((s) => s.select);
  return (
    <Tooltip content={t("sidebar.profileTip")}>
      <button
        type="button"
        onClick={() => {
          void (async () => {
            try {
              const ensured = await api.ws.ensureCoreProfile();
              if (ensured.profileRelPath) {
                select({ kind: "file", path: ensured.profileRelPath });
                if (ensured.created) emitLocal("workspace:file-changed");
              }
            } catch {
              /* ignore */
            }
          })();
        }}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-muted/40 text-text-secondary transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
        aria-label={t("sidebar.myProfile")}
      >
        <UserRound size={ICON.nano} className="shrink-0" />
      </button>
    </Tooltip>
  );
}

function DataSourceSection({
  dataSource,
  compactHeader = false,
  pins,
}: {
  dataSource: ReturnType<typeof useRegistry.getState>["dataSources"][number];
  /** Single workspace DS: hide Database eyebrow chrome thrift */
  compactHeader?: boolean;
  /** Sidebar pins (period label + profile) — merged into header row */
  pins: SidebarPins;
}) {
  const { t } = useTranslation("shell");
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // File filter state — synced with settings, used for tree children lazy-loading
  const [fileFilter, setFileFilter] = useState<FileFilterMode>("default");
  const fileFilterRef = useRef<FileFilterMode>("default");
  fileFilterRef.current = fileFilter;

  // Lazy-loading state for topic children
  const [childrenCache, setChildrenCache] = useState<Map<string, TreeNode[]>>(new Map());
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  const bootstrappedExpand = useRef(false);

  // Ref mirror of childrenCache so loadChildren / effects don't depend on the
  // ever-changing Map reference — eliminates cascading re-renders on every cache update.
  const childrenCacheRef = useRef(childrenCache);
  childrenCacheRef.current = childrenCache;

  const selection = useViewStore((s) => s.selection);
  const expandedNodeIds = useViewStore((s) => s.expandedNodeIds);
  const expandNodes = useViewStore((s) => s.expandNodes);
  const setExpandedNodes = useViewStore((s) => s.setExpandedNodes);

  const applyTree = useCallback(
    (t: TreeNode[]) => {
      setTree(t);
      // Only auto-expand defaults when user has NEVER saved expand state.
      // Empty saved set means "user collapsed everything" — respect it.
      if (!bootstrappedExpand.current && t.length > 0) {
        bootstrappedExpand.current = true;
        const ws = useViewStore.getState().workspaceRoot;
        const { hasStored } = loadExpandedState(ws);
        if (!hasStored && expandedNodeIds.size === 0) {
          const defaults = defaultExpandIds(t);
          if (defaults.length) setExpandedNodes(defaults);
        }
      }
    },
    [expandedNodeIds.size, setExpandedNodes],
  );

  const hasTreeRef = useRef(false);
  hasTreeRef.current = tree.length > 0;
  const treeRef = useRef(tree);
  treeRef.current = tree;

  /**
   * Soft refresh: listing/topology changes rebuild the tree (inbox, outputs,
   * archive, category-root, add/unlink). Topic-internal content saves stay
   * targeted so the tree does not flicker. Stale childrenCache was the root
   * cause of “fileCount updates but topic files stay old after organize / move”.
   */
  const softRefresh = useCallback(async (payload?: unknown) => {
    const decision = classifyTreeFileChange(payload);

    // Targeted refresh (content-only save): skip full tree rebuild entirely.
    // Topology hasn't changed — only mtime of the saved file. Rebuilding the tree
    // replaces all node object references, causing the entire TreeView to re-render
    // and visually flicker. Instead, just reload the affected topic's children.
    if (decision.kind === "content" && decision.relativePath) {
      try {
        const topicId = decision.topicId;
        const expanded = useViewStore.getState().expandedNodeIds;

        // Only reload children for the specific topic that changed (updates mtime in cache)
        if (topicId && expanded.has(topicId)) {
          const lazyPath = topicId;
          setLoadingNodes((prev) => new Set(prev).add(topicId));
          try {
            const filter = fileFilterRef.current;
            const { entries } = await api.ws.listDir(lazyPath, filter);
            const readOnly =
              topicId.startsWith("99") || topicId.startsWith("folder/99");
            const kids = buildChildrenFromEntries(entries, topicId, readOnly);
            setChildrenCache((prev) => {
              const next = new Map(prev);
              next.set(topicId, kids);
              return next;
            });
          } catch {
            /* silent */
          } finally {
            setLoadingNodes((prev) => {
              const next = new Set(prev);
              next.delete(topicId);
              return next;
            });
          }
        }
        setError(null);
      } catch (e) {
        // Keep previous tree visible on transient errors during soft refresh
        if (!hasTreeRef.current) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
      return;
    }

    // Listing / topology: rebuild tree + reload all expanded topics.
    // NOTE: do NOT clear entire childrenCache upfront — that causes a visual gap
    // where expanded topics momentarily show "暂无笔记" before rehydrate finishes.
    // Old cache entries stay valid until each topic is reloaded atomically.
    try {
      const prevInbox = inboxChildCount(treeRef.current);
      const t = await dataSource.getTree();
      applyTree(t);
      setError(null);
      if (
        shouldExpandInboxSection({
          prevInboxCount: prevInbox,
          nextInboxCount: inboxChildCount(t),
          selection: useViewStore.getState().selection,
        })
      ) {
        useViewStore.getState().expandNodes(["section/inbox"]);
      }
      const expanded = useViewStore.getState().expandedNodeIds;
      // Collect lazy nodes that are currently expanded (from new tree + known expanded ids)
      const toReload: TreeNode[] = [];
      const walk = (nodes: TreeNode[]) => {
        for (const n of nodes) {
          if (expanded.has(n.id) && n.meta?.lazy) toReload.push(n);
          if (n.children?.length) walk(n.children);
        }
      };
      walk(t);
      // Also cover expanded ids that may not carry meta on topology nodes (topic paths)
      for (const id of expanded) {
        if (toReload.some((n) => n.id === id)) continue;
        if (id.startsWith("cat/") || id.startsWith("section/")) continue;
        if (!id.includes("/")) continue;
        toReload.push({
          id,
          label: id,
          kind: "topic",
          selection: { kind: "topic", topicId: id },
          meta: { lazy: true, lazyPath: id },
        });
      }
      // Parallel rehydrate (force — cache was cleared)
      await Promise.all(
        toReload.map(async (node) => {
          const lazyPath = nodeLazyPath(node);
          if (!lazyPath) return;
          setLoadingNodes((prev) => new Set(prev).add(node.id));
          try {
            const filter = fileFilterRef.current;
            const { entries } = await api.ws.listDir(lazyPath, filter);
            const topicId =
              node.selection?.kind === "topic"
                ? node.selection.topicId
                : typeof node.meta?.topicId === "string"
                  ? node.meta.topicId
                  : lazyPath.split("/").length >= 2
                    ? lazyPath.split("/").slice(0, 2).join("/")
                    : undefined;
            const readOnly =
              node.meta?.readOnly === true
              || node.id.startsWith("folder/99")
              || node.id.startsWith("folder/archive");
            const kids = buildChildrenFromEntries(entries, topicId, readOnly);
            setChildrenCache((prev) => new Map(prev).set(node.id, kids));
          } catch {
            /* silent — user can expand again */
          } finally {
            setLoadingNodes((prev) => {
              const next = new Set(prev);
              next.delete(node.id);
              return next;
            });
          }
        }),
      );
    } catch (e) {
      // Keep previous tree visible on transient errors during soft refresh
      if (!hasTreeRef.current) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }, [dataSource, applyTree]);

  const hardRefresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Reuse soft path (topology + force children rehydrate) then drop spinner
      await softRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [softRefresh]);

  // Load file filter from settings on mount + listen for external changes
  useEffect(() => {
    void api.sys
      .settings()
      .then((settings) => {
        const f = (settings.ui as { fileFilter?: string } | undefined)?.fileFilter;
        if (f === "default" || f === "markdown" || f === "all") {
          setFileFilter(f);
        }
      })
      .catch(() => {});
    return onLocal("sidebar:file-filter-changed", (payload) => {
      const f = typeof payload === "string" ? payload : (payload as { filter?: string })?.filter;
      if (f === "default" || f === "markdown" || f === "all") {
        setFileFilter(f);
      }
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    bootstrappedExpand.current = false;
    (async () => {
      // Cold start / reinstall: wait for a paint + short settle so WorkspaceService
      // and engine model finish hydrating before the first tree RPC.
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      await new Promise((r) => setTimeout(r, 80));
      if (cancelled) return;
      try {
        const t = await dataSource.getTree();
        if (!cancelled) {
          applyTree(t);
          setError(null);
        }
      } catch (e) {
        if (cancelled) return;
        // One more delayed attempt before surfacing error (covers slow disk / first launch).
        await new Promise((r) => setTimeout(r, 400));
        if (cancelled) return;
        try {
          const t = await dataSource.getTree();
          applyTree(t);
          setError(null);
        } catch (e2) {
          setError(e2 instanceof Error ? e2.message : e instanceof Error ? e.message : String(e2));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const unsub = dataSource.watch?.((payload?: unknown) => {
      void softRefresh(payload);
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
    // Only re-subscribe when data source identity changes — other deps are stable refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource.id]);

  /** Lazy-load topic / folder children when expanded (real FS subdirs + filtered files).
   *  Stable callback (no deps) — uses childrenCacheRef to avoid cascading re-renders. */
  const loadChildren = useCallback(async (node: TreeNode, opts?: { force?: boolean }) => {
    const force = Boolean(opts?.force);
    if (!node.meta?.lazy && !force && !idLooksLikeTopicPath(node.id)) return;
    if (!force && childrenCacheRef.current.has(node.id)) return;

    const lazyPath = nodeLazyPath(node);
    if (!lazyPath) return;

    setLoadingNodes((prev) => new Set(prev).add(node.id));
    try {
      const filter = fileFilterRef.current;
      const { entries } = await api.ws.listDir(lazyPath, filter);
      const topicId =
        node.selection?.kind === "topic"
          ? node.selection.topicId
          : typeof node.meta?.topicId === "string"
            ? node.meta.topicId
            : lazyPath.split("/").length >= 2
              ? lazyPath.split("/").slice(0, 2).join("/")
              : undefined;
      const readOnly = node.meta?.readOnly === true || node.id.startsWith("folder/99") || node.id.startsWith("folder/archive");
      const kids = buildChildrenFromEntries(entries, topicId, readOnly);
      setChildrenCache((prev) => new Map(prev).set(node.id, kids));
    } catch {
      // Silent fail — user can retry by collapsing/expanding
    } finally {
      setLoadingNodes((prev) => {
        const next = new Set(prev);
        next.delete(node.id);
        return next;
      });
    }
  }, []);

  /** File filter change: persist to settings, clear cache, hard refresh, notify other views. */
  const handleFileFilterChange = useCallback(async (f: FileFilterMode) => {
    setFileFilter(f);
    patchCachedSettings({ ui: { fileFilter: f } });
    try {
      await api.sys.update({ ui: { fileFilter: f } });
    } catch {
      /* ignore persistence errors */
    }
    setChildrenCache(new Map());
    void hardRefresh();
    emitLocal("sidebar:file-filter-changed", f);
  }, [hardRefresh]);

  // Reveal: expand ancestors + lazy-load topic files for the active selection.
  // Uses childrenCacheRef so the effect doesn't re-run on every cache update.
  useEffect(() => {
    const ids = expandIdsForSelection(selection);
    if (ids.length) expandNodes(ids);

    // Prefetch lazy topic children when selection needs a topic folder open
    for (const id of ids) {
      if (id.startsWith("cat/") || id.startsWith("section/")) continue;
      // Topic ids look like "10-日常/2024-主题"
      if (!id.includes("/")) continue;
      if (childrenCacheRef.current.has(id)) continue;
      const topicNode: TreeNode = {
        id,
        label: id,
        kind: "topic",
        selection: { kind: "topic", topicId: id },
        meta: { lazy: true },
      };
      void loadChildren(topicNode);
    }
  }, [selection, expandNodes, loadChildren]);

  const treeSortMode = useViewStore((s) => s.treeSortMode);
  const setTreeSortMode = useViewStore((s) => s.setTreeSortMode);

  return (
    <div className="mb-2">
      {/* Unified header: pins (left) + tree tools & file filter (right).
          我的情况 lives on the ViewSwitcher row (global) — not duplicated here. */}
      <div className="flex items-center gap-0.5 px-1.5 pb-1 pt-0.5">
        <PeriodPill pins={pins} />
        <div className="min-w-0 flex-1" />
        <TreeToolbar
          tree={tree}
          sortMode={treeSortMode}
          onSortChange={setTreeSortMode}
          fileFilter={fileFilter}
          onFileFilterChange={handleFileFilterChange}
          onRefresh={() => void hardRefresh()}
          refreshing={loading}
          showStructureTools={!error && tree.length > 0}
        />
      </div>
      {/* Multi-DS: show label eyebrow below merged header */}
      {!compactHeader ? (
        <div className="flex items-center gap-1.5 px-2 pb-0.5 text-3xs font-semibold tracking-wide text-text-quaternary">
          <Database size={ICON.micro} className="shrink-0 text-text-quaternary" aria-hidden />
          <span className="truncate">{dataSource.label}</span>
        </div>
      ) : null}
      {loading ? (
        <div className="flex items-center gap-1.5 px-3 py-1.5 text-3xs text-text-tertiary">
          <span className="v4-save-dot is-saving" />
          {t("sidebar.loading")}
        </div>
      ) : error ? (
        <div className="flex flex-col gap-1 px-3 py-1.5">
          <div className="flex items-center gap-1.5 text-3xs text-error" title={error}>
            <AlertCircle size={ICON.micro} className="shrink-0" />
            <span className="truncate">{t("sidebar.loadFailed")}</span>
          </div>
          <button
            onClick={() => { void hardRefresh(); }}
            className="flex items-center gap-1 self-start rounded-[var(--radius-sm)] border border-border-subtle px-1.5 py-0.5 text-3xs text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
          >
            <RefreshCw size={ICON.nano} aria-hidden /> {t("sidebar.retry")}
          </button>
        </div>
      ) : tree.length === 0 ? (
        <div className="px-3 py-1.5 text-3xs text-text-quaternary">{t("sidebar.empty")}</div>
      ) : (
        <TreeView
          nodes={tree}
          onRefresh={() => void softRefresh()}
          loadChildren={loadChildren}
          childrenCache={childrenCache}
          loadingNodes={loadingNodes}
          sortMode={treeSortMode}
        />
      )}
    </div>
  );
}

/** Plugin sidebar slots — advanced periphery (connectors / ingest).
 *  Default collapsed so stream-first rail stays quiet (DESIGN: 扩展外围). */
function PluginSlotsSection({ slots }: { slots: SidebarSlot[] }) {
  const { t } = useTranslation("shell");
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div
      className="shrink-0 border-t border-border-subtle-dim/40 bg-app-chrome/20"
      data-sidebar-plugins-section
      data-sidebar-plugins-collapsed={collapsed ? "true" : "false"}
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-3xs font-medium tracking-wide text-text-quaternary transition-colors hover:bg-surface-muted/40 hover:text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
        aria-expanded={!collapsed}
        data-sidebar-plugins-toggle
      >
        {collapsed ? <ChevronRight size={ICON.micro} aria-hidden /> : <ChevronDown size={ICON.micro} aria-hidden />}
        <Puzzle size={ICON.micro} className="opacity-70 text-text-quaternary" aria-hidden />
        <span className="flex-1 text-left">{t("sidebar.pluginsSection")}</span>
        <span className="rounded-full bg-surface-muted/80 px-1.5 py-px text-3xs tabular-nums text-text-quaternary">
          {slots.length}
        </span>
      </button>
      {!collapsed ? (
        <ul className="m-0 list-none space-y-0.5 p-0 px-1.5 pb-1.5" data-sidebar-plugins-list>
          {slots.map((slot) => (
            <li key={slot.id}>
              {slot.render ? (
                slot.render()
              ) : (
                <DefaultSidebarEntry slot={slot} />
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Default rendering for simple SidebarSlots (no custom render function). */
function DefaultSidebarEntry({ slot }: { slot: SidebarSlot }) {
  const { t } = useTranslation();
  const label = slot.labelKey ? t(slot.labelKey) : slot.label;
  return (
    <div
      role="button"
      tabIndex={0}
      className="group flex w-full cursor-pointer items-center justify-between gap-1.5 rounded-[var(--radius-md)] px-2 py-1.5 transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
      onClick={() => slot.onSelect?.()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          slot.onSelect?.();
        }
      }}
      data-sidebar-plugin-entry
    >
      <div className="flex flex-1 items-center gap-2 truncate select-none">
        <Puzzle size={ICON.xs} className="shrink-0 text-text-quaternary opacity-80" aria-hidden />
        <div className="flex flex-col truncate leading-tight">
          <span className="truncate text-3xs font-medium text-text-secondary group-hover:text-text-primary">{label}</span>
          {slot.statusText ? (
            <span className="truncate text-3xs text-text-quaternary">{slot.statusText}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
