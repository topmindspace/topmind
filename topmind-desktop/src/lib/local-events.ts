/**
 * Typed local event bus map — single source of truth for in-renderer events
 * flowing through `emitLocal` / `onLocal` (src/plugins/host.ts).
 *
 * Add new events here first; both emit and subscribe sides are type-checked
 * against this map. Payload `undefined` = event carries no payload.
 */
import type { OverlayKind, Selection, WritebackEvidence } from "../types";
import type { SuggestionsRefreshPayload } from "./ai-rail-events";
import type { LiveUiSnapshot } from "./ui-settings-sync";

/** Structured toast payload — when evidence has a backupPath, the Toast
 * renders an interactive「撤销」button that can restore the file. */
export interface ToastPayload {
  text: string;
  evidence?: WritebackEvidence | null;
}

export interface LocalEventMap {
  /** A workspace file changed on disk (relativePath and/or topicId hint). */
  "workspace:file-changed": { relativePath?: string; topicId?: string } | undefined;
  /** Transient toast message (already localized). Structured payload enables undo button. */
  "toast:show": string | ToastPayload;
  /** Request opening an overlay from outside the shell. */
  "overlay:open": {
    kind: OverlayKind;
    intent?: "capture" | "memory";
    topicId?: string;
  };
  /** Plugin/host-driven navigation to a selection. */
  "navigate:select": Selection;
  /** Suggestion strips should re-fetch. */
  "suggestions:refresh": SuggestionsRefreshPayload | undefined;
  /** Pending AI writes list changed (source = originating surface/tool). */
  "pending-writes:changed": { source?: string; tool?: string } | undefined;
  /** UI settings snapshot just persisted; Shell skips one auto-persist. */
  "ui:settings-applied": LiveUiSnapshot | undefined;
  /** Switch sidebar primary view (stream | kanban | ...). */
  "sidebar:set-view": string;
  /** Sidebar file filter text changed (string or { filter }). */
  "sidebar:file-filter-changed": string | { filter?: string };
  /** AI provider settings changed; consumers reload runtime status. */
  "ai:settings-changed": unknown;
  /** Open the AI chat rail. */
  "ai-panel:open": unknown;
  /** Open / toggle the task (background jobs) panel. */
  "task-panel:open": unknown;
  "task-panel:toggle": unknown;
  /** Open / toggle the todo popover. */
  "todo:open-popover": unknown;
  "todo:toggle-popover": unknown;
  /** Open the unified suggest surface (popover). */
  "suggest-surface:open": unknown;
  /** Toggle the TitleBar workspace switcher. */
  "titlebar:workspace-switcher-toggle": undefined;
  /** Trigger weekly organize flow. */
  "organize:week": unknown;
  /** Create a new topic under a category. */
  "workspace:new-topic": { category: string };
  /** Create a new note inside a topic. */
  "workspace:new-note": { topicId: string };
  /** WeRead sync progress / completion (connector hub). */
  "weread:sync-progress": unknown;
  "weread:sync-done": unknown;
  /** Ingest queue list changed / single job updated. */
  "ingest:queue-changed": unknown;
  "ingest:job-updated": unknown;
  /** X connector asks the composer to open with a draft. */
  "x:open-prompt": { mode?: string; text?: string } | null;
  /** Plugin settings changed; host re-activates as needed. */
  "plugins:settings-changed": null;
  /** Background update check found a new Desktop version. */
  "update:available": {
    currentVersion: string;
    latestVersion: string;
    releaseUrl: string | null;
    tagName: string | null;
  };
}

export type LocalEventName = keyof LocalEventMap;
