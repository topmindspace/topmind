/**
 * Engine-job completion follow-up — whether to re-scan suggestions vs only
 * open the confirm surface.
 *
 * Analysis (`ai_digest` / organize-week activity ops) already merged cards;
 * a second `suggestions:refresh` races that merge. Reconcile may refresh
 * only when the period note changed or it produced candidates.
 */

export type EngineJobType = "reconcile" | "ai_digest";

export type EngineJobFollowUpInput = {
  type: EngineJobType;
  /** Cards merged from activity ops (ai_digest / organize-week analysis). */
  merged?: number;
  /** Reconcile actually mutated the period note. */
  changed?: boolean;
  /** Reconcile produced core/topic candidates. */
  hasCandidates?: boolean;
  /** Visible suggestion cards after analysis. */
  suggestionCount?: number;
};

export type EngineJobFollowUp = {
  /** Emit suggestions:refresh (ActionStore re-scan). */
  emitSuggestionsRefresh: boolean;
  /** Open the unified suggest confirm surface. */
  openSuggestSurface: boolean;
  /** Period note mutated — notify file watchers. */
  emitWorkspaceFileChanged: boolean;
};

export function engineJobSuggestionFollowUp(
  input: EngineJobFollowUpInput,
): EngineJobFollowUp {
  if (input.type === "ai_digest") {
    const hasCards = (input.merged ?? 0) > 0 || (input.suggestionCount ?? 0) > 0;
    return {
      emitSuggestionsRefresh: false,
      openSuggestSurface: hasCards,
      emitWorkspaceFileChanged: false,
    };
  }

  const hasCandidates = input.hasCandidates === true;
  const changed = input.changed === true;
  return {
    emitSuggestionsRefresh: changed || hasCandidates,
    openSuggestSurface: hasCandidates,
    emitWorkspaceFileChanged: changed || hasCandidates,
  };
}

/** Esc always dismisses; outside click/scroll only when no engine job is in flight. */
export function shouldDismissTaskPanel(opts: {
  runningOrQueued: boolean;
  event: "escape" | "outside-click" | "outside-scroll";
}): boolean {
  if (opts.event === "escape") return true;
  return !opts.runningOrQueued;
}
