/**
 * Pure StatusBar busy derivation — single source for which chips/labels show.
 *
 * Product lock: never dual-label the same work as both generic「AI 工作中」and a
 * dedicated chip (todo maintain / suggest prepare / inline complete). Streaming +
 * background tasks still use the AI pill (and optional task chip).
 */

export type StatusBarBusyInput = {
  ready: boolean;
  streaming: boolean;
  activeTaskCount: number;
  todoMaintaining: boolean;
  suggestLoading: boolean;
  /** Ephemeral ai.complete (selection polish / composer polish) */
  inlineBusy?: boolean;
  /** Localized label for the inline chip (caller supplies) */
  inlineLabel?: string | null;
};

export type StatusBarAiLabelMode = "offline" | "ready" | "working";

export type StatusBarBusyView = {
  aiLabelMode: StatusBarAiLabelMode;
  /** Dedicated background-task chip */
  showTaskChip: boolean;
  /** Dedicated AI todo-maintain chip (exclusive when only that path is busy) */
  showTodoChip: boolean;
  /** Dedicated suggest-prepare chip */
  showSuggestChip: boolean;
  /** Dedicated inline/polish complete chip */
  showInlineChip: boolean;
  /**
   * AI pill spinner + “working” chrome.
   * False when the only in-flight work is already named by a dedicated chip
   * (todo/suggest/inline-only) so we do not show dual labels.
   */
  aiPillBusy: boolean;
  /** Any named busy chip before the AI pill (for dividers) */
  hasNamedBusyChip: boolean;
};

/**
 * Map runtime flags → which status affordances to show.
 * Pure: no i18n, no stores — unit-testable.
 */
export function deriveStatusBarBusy(input: StatusBarBusyInput): StatusBarBusyView {
  const ready = input.ready === true;
  const streaming = input.streaming === true;
  const taskCount = Math.max(0, Number(input.activeTaskCount) || 0);
  const todoMaintaining = input.todoMaintaining === true;
  const suggestLoading = input.suggestLoading === true;
  const inlineBusy = input.inlineBusy === true;

  if (!ready) {
    return {
      aiLabelMode: "offline",
      showTaskChip: false,
      showTodoChip: false,
      showSuggestChip: false,
      showInlineChip: false,
      aiPillBusy: false,
      hasNamedBusyChip: false,
    };
  }

  // Single-path named busy priority: tasks > todo > suggest > inline.
  // Avoid equal-weight multi-chip spam for concurrent prep paths.
  const showTaskChip = taskCount > 0;
  const showTodoChip = todoMaintaining && !showTaskChip;
  const showSuggestChip =
    suggestLoading && !streaming && !showTaskChip && !showTodoChip;
  // Inline complete: named chip when not covered by higher chips / streaming pill
  const showInlineChip =
    inlineBusy && !streaming && !showTaskChip && !showTodoChip && !showSuggestChip;

  // Generic AI pill “working” for streaming, background tasks, or multi-path that
  // already took a higher chip — not for solo todo/suggest/inline (own chips).
  const aiPillBusy = streaming || showTaskChip;

  // Label: “working” when pill is busy; otherwise “ready” (named chip owns the message)
  const aiLabelMode: StatusBarAiLabelMode = aiPillBusy ? "working" : "ready";

  return {
    aiLabelMode,
    showTaskChip,
    showTodoChip,
    showSuggestChip,
    showInlineChip,
    aiPillBusy,
    hasNamedBusyChip: showTaskChip || showTodoChip || showSuggestChip || showInlineChip,
  };
}
