/**
 * Apply settings.ui patches to the live view-store.
 *
 * IMPORTANT: only keys **own-present on the patch delta** are live-applied.
 * GeneralPanel must send partial `{ ui: { aiPanelOpen } }` not full `{ ...ui }`,
 * otherwise a stale settings snapshot would clobber live shell resize widths.
 *
 * Shell listens for UI_SETTINGS_APPLIED_EVENT and skips one auto-persist so
 * settings-driven writes are not immediately overwritten by layout debounce.
 */
import { type AppSettings, type FeedLayout, type SidebarViewMode, isFeedLayout } from "../types";

export type LiveUiSnapshot = {
  sidebarWidth?: number;
  sidebarCollapsed?: boolean;
  sidebarView?: SidebarViewMode;
  aiPanelOpen?: boolean;
  aiPanelWidth?: number;
  feedLayout?: FeedLayout;
};

const SIDEBAR_VIEWS = new Set<string>(["stream", "category", "timeline", "tags", "kanban"]);

/** Shell layout keys that may be live-synced from Settings. */
export const LIVE_UI_KEYS = [
  "sidebarWidth",
  "sidebarCollapsed",
  "sidebarView",
  "aiPanelOpen",
  "aiPanelWidth",
  "feedLayout",
] as const;

export function isSidebarViewMode(v: unknown): v is SidebarViewMode {
  return typeof v === "string" && SIDEBAR_VIEWS.has(v);
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Extract live shell fields from a **partial** ui patch only.
 * `fullUi` is ignored for extraction (kept in signature for call-site compat /
 * tests that document the old bug) — only `patchUi` own keys count.
 */
export function extractLiveUiFromSettingsPatch(
  patchUi: Partial<NonNullable<AppSettings["ui"]>> | undefined | null,
  _fullUi?: Partial<NonNullable<AppSettings["ui"]>> | null,
): LiveUiSnapshot {
  if (!patchUi || typeof patchUi !== "object") return {};
  const out: LiveUiSnapshot = {};

  if (hasOwn(patchUi, "sidebarWidth")) {
    const w = patchUi.sidebarWidth;
    if (typeof w === "number" && w >= 180 && w <= 480) out.sidebarWidth = w;
  }
  if (hasOwn(patchUi, "sidebarCollapsed") && typeof patchUi.sidebarCollapsed === "boolean") {
    out.sidebarCollapsed = patchUi.sidebarCollapsed;
  }
  if (hasOwn(patchUi, "sidebarView") && isSidebarViewMode(patchUi.sidebarView)) {
    out.sidebarView = patchUi.sidebarView;
  }
  if (hasOwn(patchUi, "aiPanelOpen") && typeof patchUi.aiPanelOpen === "boolean") {
    out.aiPanelOpen = patchUi.aiPanelOpen;
  }
  if (hasOwn(patchUi, "aiPanelWidth")) {
    const w = patchUi.aiPanelWidth;
    if (typeof w === "number" && w >= 280 && w <= 800) out.aiPanelWidth = w;
  }
  if (hasOwn(patchUi, "feedLayout") && isFeedLayout(patchUi.feedLayout)) {
    out.feedLayout = patchUi.feedLayout;
  }
  return out;
}

export type ViewStoreUiApplier = {
  setSidebarWidth: (w: number) => void;
  setSidebarCollapsed: (v: boolean) => void;
  setSidebarView: (m: SidebarViewMode) => void;
  setAiPanelOpen: (v: boolean) => void;
  setAiPanelWidth: (w: number) => void;
  setFeedLayout: (m: FeedLayout) => void;
};

/** Apply extracted snapshot to a view-store-like object. Returns true if anything applied. */
export function applyLiveUiSnapshot(
  snap: LiveUiSnapshot,
  store: ViewStoreUiApplier,
): boolean {
  let applied = false;
  if (typeof snap.sidebarWidth === "number") {
    store.setSidebarWidth(snap.sidebarWidth);
    applied = true;
  }
  if (typeof snap.sidebarCollapsed === "boolean") {
    store.setSidebarCollapsed(snap.sidebarCollapsed);
    applied = true;
  }
  if (snap.sidebarView) {
    store.setSidebarView(snap.sidebarView);
    applied = true;
  }
  if (typeof snap.aiPanelOpen === "boolean") {
    store.setAiPanelOpen(snap.aiPanelOpen);
    applied = true;
  }
  if (typeof snap.aiPanelWidth === "number") {
    store.setAiPanelWidth(snap.aiPanelWidth);
    applied = true;
  }
  if (snap.feedLayout) {
    store.setFeedLayout(snap.feedLayout);
    applied = true;
  }
  return applied;
}

/** Event name: Shell should skip the next UI auto-persist (settings just wrote disk). */
export const UI_SETTINGS_APPLIED_EVENT = "ui:settings-applied";
