/**
 * Built-in workspace DataSource — walks the Category+Topic filesystem.
 * Role-based category grouping (template-driven; not hardcoded 00/88/99 only).
 * Groups: buffer (inbox) / category nodes / delivery (outputs) / system (archive).
 *
 * v4.11: Parallel category loading + lazy topic file loading.
 * - buildTree() loads all categories in parallel (Promise.all) for ~3x speedup.
 * - Topic children are NOT loaded upfront — TreeView lazy-loads them on expand
 *   via api.ws.topicFiles(topicId), reducing initial load from O(N*M) to O(N).
 */
import { api } from "../../services/api";
import { onLocal } from "../host";
import i18n from "../../locales";
import type { Category, DirEntry, LooseNote, Topic } from "../../types";
import type { DataSourceSlot, TreeNode } from "../types";

type TopicsResult = { topics: Topic[]; looseNotes: LooseNote[] };

function isContentCategory(c: Category): boolean {
  return c.role !== "buffer" && c.role !== "delivery" && c.role !== "system";
}

async function buildTree(): Promise<TreeNode[]> {
  const { categories: rawCategories } = await api.ws.categories().catch(() => ({ categories: [] as Category[], rootPath: "" }));
  // listCategories already drops hidden by default; keep guard for older bridges
  const categories = (rawCategories || []).filter((c) => !c.hidden);

  // Group categories by role
  const bufferCat = categories.find((c) => c.role === "buffer");
  const deliveryCat = categories.find((c) => c.role === "delivery");
  const systemCat = categories.find((c) => c.role === "system");

  // Load inbox + top-level outputs/archive dirs (not recursive) + categories + memory
  const [inbox, outputsTop, archiveTop, memoryTop, ...categoryResults] = await Promise.all([
    api.ws.inbox().catch(() => ({ files: [], folders: [] })),
    api.ws
      .outputs({ recursiveFlat: false })
      .catch(() => ({ files: [], outputsName: "", entries: [] as DirEntry[] })),
    api.ws
      .archive({ recursiveFlat: false })
      .catch(() => ({ items: [], archiveName: "", entries: [] as DirEntry[] })),
    api.ws
      .listDir("memory")
      .catch(() => ({ relativePath: "memory", filter: "default", entries: [] as DirEntry[] })),
    // Load all non-system categories in parallel
    ...categories
      .filter(isContentCategory)
      .map((cat) =>
        api.ws.topics(cat.name).catch((): TopicsResult => ({ topics: [], looseNotes: [] })),
      ),
  ]);

  // Buffer (Inbox) — flat list of files
  const inboxChildren: TreeNode[] = (inbox.files || []).map((f) => ({
    id: `inbox/${f.relativePath}`,
    label: f.name,
    kind: "file" as const,
    selection: { kind: "file", path: f.relativePath },
    meta: { mtime: f.mtime || null },
  }));

  // Build category nodes from parallel results — always NN/slot order (sort mode never reorders)
  const regularCategories = categories
    .filter(isContentCategory)
    .slice()
    .sort((a, b) => {
      const sa = String(a.slot ?? a.name ?? "");
      const sb = String(b.slot ?? b.name ?? "");
      return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: "base" });
    });
  // Remap topic results: original Promise.all index was pre-sort filter order
  const unsortedRegular = categories.filter(isContentCategory);
  const resultByName = new Map(
    unsortedRegular.map((cat, i) => [cat.name, categoryResults[i] as TopicsResult]),
  );

  const categoryNodes: TreeNode[] = regularCategories.map((cat) => {
    const { topics, looseNotes } = resultByName.get(cat.name) || { topics: [], looseNotes: [] };
    const children: TreeNode[] = [];

    // Topic nodes — children are lazy-loaded (meta.fileCount indicates count)
    for (const t of topics) {
      children.push({
        id: t.id,
        label: t.name,
        kind: "topic",
        selection: { kind: "topic", topicId: t.id },
        children: [],
        meta: {
          fileCount: t.fileCount,
          lazy: true,
          lazyPath: t.id,
          topicName: t.name,
          mtime: t.mtime || null,
        },
      });
    }
    // Loose notes at category root
    for (const n of looseNotes) {
      children.push({
        id: n.relativePath,
        label: n.name,
        kind: "file",
        selection: { kind: "file", path: n.relativePath },
        meta: { mtime: n.mtime || null },
      });
    }

    return {
      id: `cat/${cat.name}`,
      label: cat.name,
      kind: "category",
      selection: { kind: "category", category: cat.name },
      children,
      meta: {
        slot: cat.slot ?? (String(cat.name).match(/^\d{1,3}/u)?.[0] || null),
        role: cat.role || null,
      },
    };
  });

  // Delivery (Outputs) — top-level dirs + files (nested via lazy folder expand)
  const outEntries: DirEntry[] =
    (outputsTop as { entries?: DirEntry[] }).entries || [];
  const outputsName =
    (outputsTop as { outputsName?: string }).outputsName
    || deliveryCat?.name
    || i18n.t("common:category.outputs");
  const outputsChildren: TreeNode[] = outEntries.slice(0, 50).map((e) => {
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
          section: "delivery",
        },
      };
    }
    return {
      id: `output/${e.relativePath}`,
      label: e.name,
      kind: "file" as const,
      selection: { kind: "file" as const, path: e.relativePath },
      meta: { mtime: e.mtime || null },
    };
  });
  if (outEntries.length > 50) {
    outputsChildren.push({
      id: "output/__more__",
      label: i18n.t("workspace:outputsView.title"),
      kind: "group",
      selection: { kind: "outputs" },
      children: [],
      meta: { more: true },
    });
  }

  // System (Archive) — top-level real structure (read-only nested via folders)
  const archEntries: DirEntry[] =
    (archiveTop as { entries?: DirEntry[] }).entries || [];
  const archiveName =
    (archiveTop as { archiveName?: string }).archiveName
    || systemCat?.name
    || i18n.t("common:category.archive");
  const archiveChildren: TreeNode[] = archEntries.slice(0, 40).map((e) => {
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
          readOnly: true,
          section: "system",
        },
      };
    }
    return {
      id: `archive/${e.relativePath}`,
      label: e.name,
      kind: "file" as const,
      selection: { kind: "file" as const, path: e.relativePath, readOnly: true },
      meta: { mtime: e.mtime || null },
    };
  });

  const inboxLabel = bufferCat?.name ?? i18n.t("common:category.inbox");
  const outputsLabel = outputsName;
  const archiveLabel = archiveName;
  const outCount = outEntries.length;
  const outLabel = outCount > 0 ? `${outputsLabel} · ${outCount}` : outputsLabel;

  // Memory — semantic plane (profile / todo / periodic / topics)
  const memoryEntries: DirEntry[] = memoryTop.entries || [];
  const memoryChildren: TreeNode[] = memoryEntries.map((e) => {
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
          section: "memory",
        },
      };
    }
    return {
      id: `memory/${e.relativePath}`,
      label: e.name,
      kind: "file" as const,
      selection: { kind: "file" as const, path: e.relativePath },
      meta: { mtime: e.mtime || null, section: "memory" },
    };
  });

  return [
    {
      id: "section/inbox",
      label: inboxLabel,
      kind: "group",
      selection: { kind: "inbox" },
      children: inboxChildren,
      meta: { section: "buffer", fileCount: inboxChildren.length },
    },
    ...categoryNodes,
    // Memory — semantic plane (after categories, before delivery)
    ...(memoryChildren.length > 0
      ? [{
          id: "section/memory",
          label: i18n.t("common:category.memory"),
          kind: "group" as const,
          selection: { kind: "category" as const, category: "memory" },
          children: memoryChildren,
          meta: { section: "memory", fileCount: memoryChildren.length },
        }]
      : []),
    // Fixed after categories (like a workspace “library” rail — not plugin chrome)
    {
      id: "section/outputs",
      label: outLabel,
      kind: "group",
      selection: { kind: "outputs" },
      children: outputsChildren,
      meta: { section: "delivery", fileCount: outCount },
    },
    {
      id: "section/archive",
      label: archiveLabel,
      kind: "group",
      selection: { kind: "archive" },
      children: archiveChildren,
      meta: { section: "system", fileCount: archEntries.length },
    },
  ];
}

/** Timeout guard — if any RPC in buildTree hangs (bridge not ready, handler
 *  missing), reject after 8s so Sidebar's finally block fires and loading
 *  state clears. Without this, a hanging Promise keeps loading === true forever. */
function withTimeout<T>(p: Promise<T>, ms = 8000): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(i18n.t("workspace:shared.toastFailOrganize", { defaultValue: `Timeout (${ms}ms)` }))), ms),
    ),
  ]);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function createWorkspaceDataSource(): DataSourceSlot {
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  return {
    kind: "dataSource",
    id: "topmind-workspace.data-source",
    label: "Workspace",
    order: 10,
    async getTree() {
      // Cold start / reinstall: engine model + workspace FS may not be ready on first tick.
      // Retry once so users don't hit a permanent "加载失败" that only clears on Retry.
      let last: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await withTimeout(buildTree(), attempt === 0 ? 6000 : 10000);
        } catch (e) {
          last = e;
          if (attempt < 1) await sleep(300);
        }
      }
      throw last instanceof Error ? last : new Error(String(last || "getTree failed"));
    },
    async refresh() {
      // No-op: getTree is the source of truth. Sidebar re-fetches on demand.
    },
    watch(cb) {
      // Debounce file-change events (autosave fires often). Soft-refresh only —
      // Sidebar must not flip loading spinner on every save (was causing flicker).
      // 200ms: responsive enough for external changes without flicker on bulk saves.
      // Pass payload to cb so Sidebar can do targeted refresh (only reload affected topic).
      let lastPayload: unknown = undefined;
      const unsub = onLocal("workspace:file-changed", (payload?: unknown) => {
        lastPayload = payload;
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => { cb(lastPayload); lastPayload = undefined; }, 200);
      });
      return () => {
        if (refreshTimer) clearTimeout(refreshTimer);
        unsub();
      };
    },
  };
}
