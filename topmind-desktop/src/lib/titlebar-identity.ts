/**
 * TitleBar identity — crumbs, title, stats derived from the current selection.
 * Pure so tests can drive the same function TitleBar uses.
 */
import type { Selection } from "../types";
import {
  isBufferRootPath,
  isDeliveryRootPath,
  isMemoryPath,
  isStreamRootPath,
  isSystemRootPath,
} from "./tree-listing-change";

export type TitleBarCrumb = {
  label: string;
  /** Jump target. Omitted when the crumb is not clickable. */
  target?: Selection;
};

export type TitleBarIdentity = {
  crumbs: TitleBarCrumb[];
  title: string;
  stats: string;
};

export type TitleBarIdentityLabels = {
  stream: string;
  inbox: string;
  outputs: string;
  memory: string;
  archive: string;
};

/** Live overlay from the active canvas (period name, counts, …). */
export type TitleBarLive = {
  title?: string;
  stats?: string;
};

export { isStreamRootPath };

/** Hide `.md` on file titles — same honesty as the sidebar tree. */
export function displayPathSegment(seg: string): string {
  return String(seg || "").replace(/\.md$/iu, "");
}

/**
 * PrimaryNav kinds for the sidebar destinations row / TitleBar compact fallback.
 * File / topic / memory / archive must not impersonate 动态.
 * StatusBar no longer hosts PrimaryNav (status, not navigation).
 */
export function primaryViewSwitchKind(
  kind: Selection["kind"] | undefined | null,
): "stream" | "inbox" | "outputs" | null {
  if (kind === "stream" || kind === "inbox" || kind === "outputs") return kind;
  return null;
}

function posixParts(rel: string): string[] {
  return String(rel || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//u, "")
    .split("/")
    .filter(Boolean);
}

/**
 * Map a workspace-relative prefix to the selection that crumb should open.
 * Topic folders (`{category}/{YYYY-主题}`) select that topic — not a fake category.
 * Role roots (inbox / stream / outputs / archive / memory) stay on that view.
 */
export function ancestorSelection(prefix: string): Selection | undefined {
  const parts = posixParts(prefix);
  if (parts.length === 0) return undefined;
  const root = parts[0];
  if (isBufferRootPath(root)) return { kind: "inbox" };
  if (isDeliveryRootPath(root)) return { kind: "outputs" };
  if (isSystemRootPath(root)) return { kind: "archive" };
  if (isMemoryPath(root)) return { kind: "memory" };
  if (isStreamRootPath(root)) return { kind: "stream" };
  if (parts.length === 1) return { kind: "category", category: root };
  return { kind: "topic", topicId: `${parts[0]}/${parts[1]}` };
}

function crumbsForPath(rel: string): { crumbs: TitleBarCrumb[]; title: string } {
  const parts = posixParts(rel);
  if (parts.length === 0) return { crumbs: [], title: "" };
  if (parts.length === 1) {
    return { crumbs: [], title: displayPathSegment(parts[0]) };
  }
  const crumbs: TitleBarCrumb[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const path = parts.slice(0, i + 1).join("/");
    crumbs.push({
      label: displayPathSegment(parts[i]),
      target: ancestorSelection(path),
    });
  }
  return { crumbs, title: displayPathSegment(parts[parts.length - 1]) };
}

function withLive(base: TitleBarIdentity, live?: TitleBarLive): TitleBarIdentity {
  const title = live?.title?.trim() ? live.title : base.title;
  const stats = live?.stats ?? base.stats;
  return { crumbs: base.crumbs, title, stats };
}

/**
 * Derive TitleBar crumbs + title + stats from selection.
 * `live` overlays the canvas-provided page title (period name) and stats.
 * Empty / root / single-segment paths do not invent crumbs.
 */
export function resolveTitleBarIdentity(
  selection: Selection | null | undefined,
  labels: TitleBarIdentityLabels,
  live?: TitleBarLive,
): TitleBarIdentity {
  if (!selection || typeof selection !== "object" || !("kind" in selection)) {
    return withLive({ crumbs: [], title: "", stats: "" }, live);
  }

  switch (selection.kind) {
    case "stream":
      return withLive({ crumbs: [], title: labels.stream, stats: "" }, live);
    case "inbox":
      return withLive({ crumbs: [], title: labels.inbox, stats: "" }, live);
    case "outputs":
      return withLive({ crumbs: [], title: labels.outputs, stats: "" }, live);
    case "memory":
      return withLive({ crumbs: [], title: labels.memory, stats: "" }, live);
    case "archive":
      return withLive({ crumbs: [], title: labels.archive, stats: "" }, live);
    case "connector":
      return withLive({ crumbs: [], title: selection.id, stats: "" }, live);
    case "category": {
      const parts = posixParts(selection.category);
      if (parts.length <= 1) {
        return withLive(
          { crumbs: [], title: selection.category || "", stats: "" },
          live,
        );
      }
      const crumbs: TitleBarCrumb[] = [];
      for (let i = 0; i < parts.length - 1; i++) {
        const path = parts.slice(0, i + 1).join("/");
        crumbs.push({
          label: displayPathSegment(parts[i]),
          target: ancestorSelection(path),
        });
      }
      return withLive(
        { crumbs, title: displayPathSegment(parts[parts.length - 1]), stats: "" },
        live,
      );
    }
    case "topic": {
      const { crumbs, title } = crumbsForPath(selection.topicId);
      return withLive({ crumbs, title: title || selection.topicId, stats: "" }, live);
    }
    case "file": {
      const { crumbs, title } = crumbsForPath(selection.path);
      return withLive({ crumbs, title: title || selection.path, stats: "" }, live);
    }
    default:
      return withLive({ crumbs: [], title: "", stats: "" }, live);
  }
}
