/**
 * Global registry for ephemeral AI complete work (selection polish, composer polish).
 *
 * Product lock:
 * - StatusBar surfaces a named chip so users see progress (not silent work).
 * - Navigation away while protected work is in flight → ConfirmDialog (not window.confirm).
 * - Guard runs BEFORE selection changes (pending nav held until user confirms).
 * - Chat streaming stays on AiStore; this only covers ai.complete one-shots.
 */
import { create } from "zustand";
import type { Selection } from "../types";

export type InlineAiKind = "selection" | "polish" | "compose";

/** Where the in-flight AI work is bound — used to decide leave risk. */
export type InlineAiAnchor =
  | { type: "file"; path: string }
  | { type: "stream" }
  | { type: "any" };

export type InlineAiSession = {
  id: string;
  kind: InlineAiKind;
  /** Short status label (already localized by caller) */
  label: string;
  /**
   * Navigation scope for this session.
   * - file: only block leaving that path
   * - stream: only block leaving stream selection
   * - any: block any selection change
   */
  anchor: InlineAiAnchor;
  /**
   * When true, leaving the anchor should confirm first.
   * running + unapplied preview for selection; running for polish.
   */
  blocksNavigation: boolean;
};

export type PendingNavKind = "select" | "back" | "forward";

export type PendingNavigation = {
  kind: PendingNavKind;
  /** For select: the next selection. For back/forward: ignored (uses history). */
  next?: Selection;
};

type InlineAiState = {
  sessions: InlineAiSession[];
  begin: (session: InlineAiSession) => void;
  update: (id: string, patch: Partial<Omit<InlineAiSession, "id">>) => void;
  end: (id: string) => void;
  clearAll: () => void;

  /** Pending navigation blocked by AI — Shell shows ConfirmDialog. */
  pendingNav: PendingNavigation | null;
  requestNavConfirm: (pending: PendingNavigation) => void;
  clearPendingNav: () => void;
};

export const useInlineAiStore = create<InlineAiState>((set) => ({
  sessions: [],
  begin: (session) =>
    set((s) => ({
      sessions: [...s.sessions.filter((x) => x.id !== session.id), session],
    })),
  update: (id, patch) =>
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    })),
  end: (id) =>
    set((s) => ({
      sessions: s.sessions.filter((x) => x.id !== id),
    })),
  clearAll: () => set({ sessions: [] }),

  pendingNav: null,
  requestNavConfirm: (pending) => set({ pendingNav: pending }),
  clearPendingNav: () => set({ pendingNav: null }),
}));

/** Snapshot helpers for non-React callers (view-store select guard). */
export function getInlineAiBusySummary(): {
  busy: boolean;
  count: number;
  label: string | null;
  blocksNavigation: boolean;
} {
  const sessions = useInlineAiStore.getState().sessions;
  const count = sessions.length;
  const blocking = sessions.filter((s) => s.blocksNavigation);
  const primary = sessions[sessions.length - 1] ?? null;
  return {
    busy: count > 0,
    count,
    label: primary?.label ?? null,
    blocksNavigation: blocking.length > 0,
  };
}

/**
 * True when navigating to `next` would abandon protected inline AI work.
 * Same selection identity (e.g. focusHeading only on same file) does not block.
 */
export function wouldAbandonInlineAi(
  current: Selection,
  next: Selection,
): boolean {
  const sessions = useInlineAiStore.getState().sessions.filter((s) => s.blocksNavigation);
  if (sessions.length === 0) return false;
  if (sameNavTarget(current, next)) return false;

  return sessions.some((s) => sessionWouldAbandon(s, current, next));
}

function sessionWouldAbandon(
  session: InlineAiSession,
  current: Selection,
  next: Selection,
): boolean {
  const anchor = session.anchor;
  if (!anchor || anchor.type === "any") return true;

  if (anchor.type === "file") {
    // Only protect while viewing that file (or still bound after soft nav)
    const leavingFile =
      (current.kind === "file" && current.path === anchor.path)
      || session.kind === "selection";
    if (!leavingFile) return false;
    // Staying on same file path is fine
    if (next.kind === "file" && next.path === anchor.path) return false;
    return true;
  }

  if (anchor.type === "stream") {
    // Protect stream compose/polish: any leave from stream selection
    if (current.kind !== "stream") return false;
    return next.kind !== "stream";
  }

  return true;
}

export function sameNavTarget(a: Selection, b: Selection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "file" && b.kind === "file") return a.path === b.path;
  if (a.kind === "topic" && b.kind === "topic") return a.topicId === b.topicId;
  if (a.kind === "category" && b.kind === "category") return a.category === b.category;
  if (a.kind === "connector" && b.kind === "connector") return a.id === b.id;
  return a.kind === b.kind;
}
