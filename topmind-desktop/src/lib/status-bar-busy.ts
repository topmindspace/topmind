/**
 * Pure StatusBar busy derivation — single source for which chips/labels show.
 *
 * Product locks:
 * 1. Never dual-label the **same** work as both generic「AI 工作中」and its named chip.
 * 2. When **multiple distinct** works run, stay honest: multiActive + job list for tips;
 *    keep ≤2 named chips (priority) so chrome stays quiet.
 * 3. Agent stream is user-primary → AI pill busy; background prep uses named chips.
 *
 * Background prep (suggest · todo) is also serialized in `ai-background-lane`
 * so dual-prep concurrency is rare; multiActive still covers agent+prep / tasks+prep.
 */

export type StatusBarBusyKind = "agent" | "task" | "todo" | "suggest" | "inline";

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
  /** Dedicated AI todo-maintain chip */
  showTodoChip: boolean;
  /** Dedicated suggest-prepare chip */
  showSuggestChip: boolean;
  /** Dedicated inline/polish complete chip */
  showInlineChip: boolean;
  /**
   * AI pill spinner + “working” chrome.
   * False when the only in-flight work is already named by a dedicated chip
   * (todo/suggest/inline-only) so we do not dual-label that same work.
   */
  aiPillBusy: boolean;
  /** Any named busy chip before the AI pill (for dividers) */
  hasNamedBusyChip: boolean;
  /** All concurrent work kinds (stable priority order) — for multi tip */
  activeKinds: StatusBarBusyKind[];
  /** Two or more distinct works — tip should list them; optional multi chrome */
  multiActive: boolean;
  /** Count of concurrent kinds (0 when idle/offline) */
  concurrentCount: number;
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
      activeKinds: [],
      multiActive: false,
      concurrentCount: 0,
    };
  }

  // Full activity set (honest concurrent inventory)
  const activeKinds: StatusBarBusyKind[] = [];
  if (streaming) activeKinds.push("agent");
  if (taskCount > 0) activeKinds.push("task");
  if (todoMaintaining) activeKinds.push("todo");
  if (suggestLoading) activeKinds.push("suggest");
  if (inlineBusy) activeKinds.push("inline");

  const concurrentCount = activeKinds.length;
  const multiActive = concurrentCount >= 2;

  // Named chips: priority task > todo > suggest > inline.
  // Allow one prep chip alongside agent stream (user sees "对话 + 建议/待办").
  // Cap prep visibility: at most one of todo/suggest/inline to avoid 4-chip spam.
  const showTaskChip = taskCount > 0;
  const showTodoChip = todoMaintaining && !showTaskChip;
  // Suggest may show while streaming (unlike older exclusive-with-stream policy)
  // so agent+autoPrepare is not invisible — still demoted under todo/task.
  const showSuggestChip = suggestLoading && !showTaskChip && !showTodoChip;
  const showInlineChip =
    inlineBusy &&
    !showTaskChip &&
    !showTodoChip &&
    !showSuggestChip &&
    !streaming; // inline short; agent pill covers while streaming

  // Pill busy: agent stream or engine tasks — not solo named prep (own chips)
  const aiPillBusy = streaming || showTaskChip;

  const aiLabelMode: StatusBarAiLabelMode = aiPillBusy ? "working" : "ready";

  return {
    aiLabelMode,
    showTaskChip,
    showTodoChip,
    showSuggestChip,
    showInlineChip,
    aiPillBusy,
    hasNamedBusyChip: showTaskChip || showTodoChip || showSuggestChip || showInlineChip,
    activeKinds,
    multiActive,
    concurrentCount,
  };
}

/** Build a stable multi-work tip key list for i18n join (caller localizes). */
export function statusBarBusyKindLabelKeys(kinds: StatusBarBusyKind[]): string[] {
  const map: Record<StatusBarBusyKind, string> = {
    agent: "statusBar.jobAgent",
    task: "statusBar.jobTask",
    todo: "statusBar.jobTodo",
    suggest: "statusBar.jobSuggest",
    inline: "statusBar.jobInline",
  };
  return kinds.map((k) => map[k]);
}
