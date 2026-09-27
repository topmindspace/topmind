/**
 * Goal-oriented agent protocol — shared by Desktop Pi/SDK loops and Obsidian chat.
 *
 * Product intent: multi-step work (including multi-stage creative / drawing-like
 * tasks) must plan, execute toward acceptance criteria, verify, and continue
 * under step/context pressure instead of dying halfway.
 *
 * Pure helpers only — no I/O, no Electron, no Obsidian. Hosts inject prompts
 * and decide when to compact/continue.
 */

/** Marker tags the model is asked to emit (and we parse). */
export const PLAN_OPEN = "[PLAN]";
export const PLAN_CLOSE = "[/PLAN]";
export const DONE_MARK = "[DONE]";
export const INCOMPLETE_MARK = "[INCOMPLETE";
/** Model explicitly needs user input / decision to proceed (G7). */
export const NEEDS_USER_MARK = "[NEEDS-USER";

/** Sticky ledger header that must survive context compaction. */
export const TASK_LEDGER_HEADER = "[TASK-LEDGER]";

/** Path-receipt harvest: relative-looking paths in tool results / final text. */
const PATH_RE =
  /(?:^|[\s`"'（(])((?:\d{2}-[^/\s`"'）)]+[\\/])[^\s`"'）)]+\.[A-Za-z0-9]{1,8}|memory[\\/][^\s`"'）)]+|topmind\.yaml)/gu;

/**
 * @typedef {object} GoalState
 * @property {string} goal
 * @property {string[]} plan
 * @property {string[]} criteria
 * @property {string[]} doneCriteria
 * @property {string[]} pathReceipts
 * @property {"idle"|"planning"|"working"|"verifying"|"done"|"incomplete"|"blocked"} status
 * @property {string|null} blockReason
 */

/**
 * Fresh goal state from the user's first message.
 * @param {string} userGoal
 * @returns {GoalState}
 */
export function createGoalState(userGoal) {
  const goal = String(userGoal || "").replace(/\s+/gu, " ").trim().slice(0, 400);
  return {
    goal,
    plan: [],
    criteria: [],
    doneCriteria: [],
    pathReceipts: [],
    status: "idle",
    blockReason: null,
  };
}

/**
 * Parse a `[PLAN]…[/PLAN]` block from assistant text.
 * Accepts bullet steps (`1) …` / `- …`) and `done-when:` criteria lines.
 * @param {string} text
 * @returns {{ plan: string[], criteria: string[] }|null}
 */
export function parsePlanBlock(text) {
  const raw = String(text || "");
  const start = raw.indexOf(PLAN_OPEN);
  const end = raw.indexOf(PLAN_CLOSE);
  if (start < 0 || end <= start) return null;
  const body = raw.slice(start + PLAN_OPEN.length, end);
  /** @type {string[]} */
  const plan = [];
  /** @type {string[]} */
  const criteria = [];
  let inDone = false;
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (/^done[-\s_]?when\s*[:：]/iu.test(t) || /^验收\s*[:：]/u.test(t) || /^完成标准\s*[:：]/u.test(t)) {
      inDone = true;
      const rest = t.replace(/^(?:done[-\s_]?when|验收|完成标准)\s*[:：]\s*/iu, "").trim();
      if (rest) criteria.push(stripBullet(rest));
      continue;
    }
    if (inDone) {
      if (/^(?:steps?|步骤|计划)\s*[:：]/iu.test(t)) {
        inDone = false;
      } else {
        criteria.push(stripBullet(t));
        continue;
      }
    }
    if (/^(?:goal|目标)\s*[:：]/iu.test(t)) continue;
    if (/^(?:steps?|步骤|计划)\s*[:：]/iu.test(t)) {
      const rest = t.replace(/^(?:steps?|步骤|计划)\s*[:：]\s*/iu, "").trim();
      if (rest) plan.push(...splitNumberedSteps(rest));
      continue;
    }
    plan.push(...splitNumberedSteps(t));
  }
  return {
    plan: plan.filter(Boolean).slice(0, 24),
    criteria: criteria.filter(Boolean).slice(0, 16),
  };
}

/**
 * Split `1) a 2) b 3) c` / `1. a 2. b` into separate steps.
 * @param {string} s
 * @returns {string[]}
 */
function splitNumberedSteps(s) {
  const raw = String(s || "").trim();
  if (!raw) return [];
  const parts = raw
    .split(/(?:^|\s)(?=\d+[.)、]\s*)/u)
    .map((p) => stripBullet(p))
    .filter(Boolean);
  return parts.length > 0 ? parts : [stripBullet(raw)];
}

/**
 * @param {string} s
 */
function stripBullet(s) {
  return String(s)
    .replace(/^\s*(?:[-*+]|\d+[.)、])\s*/u, "")
    .trim();
}

/**
 * Harvest workspace-relative path receipts from tool output / text.
 * @param {string} text
 * @param {string[]} [into]
 * @returns {string[]}
 */
export function harvestPathReceipts(text, into = []) {
  const raw = String(text || "");
  for (const m of raw.matchAll(PATH_RE)) {
    const p = m[1].replace(/\\/g, "/").replace(/[.,;:]+$/u, "");
    if (p && !into.includes(p)) into.push(p);
  }
  return into;
}

/**
 * Fold a running goal state with the latest assistant / tool text.
 * Mutates a shallow copy — returns the next state.
 * @param {GoalState} state
 * @param {{ text?: string, toolName?: string, toolOk?: boolean }} update
 * @returns {GoalState}
 */
export function applyGoalUpdate(state, update) {
  const next = {
    ...state,
    plan: [...state.plan],
    criteria: [...state.criteria],
    doneCriteria: [...state.doneCriteria],
    pathReceipts: [...state.pathReceipts],
  };
  const text = String(update.text || "");
  if (text) harvestPathReceipts(text, next.pathReceipts);
  const plan = parsePlanBlock(text);
  if (plan && (plan.plan.length || plan.criteria.length)) {
    if (plan.plan.length) next.plan = plan.plan;
    if (plan.criteria.length) {
      next.criteria = plan.criteria;
      next.doneCriteria = plan.criteria.slice();
    }
    next.status = "working";
  }
  const upper = text.toUpperCase();
  // Meta-instruction text (continue prompts / task ledger / system) quotes the
  // markers as documentation — never treat those literals as worker claims.
  const isMeta = isMetaInstructionText(text);
  if (!isMeta && upper.includes(DONE_MARK)) {
    next.doneCriteria = [];
    next.status = "done";
    next.blockReason = null;
  } else if (!isMeta && upper.includes(NEEDS_USER_MARK)) {
    // Explicit user-input stop (G7) — terminal until the user replies.
    next.status = "blocked";
    const reasonMatch = text.match(/\[NEEDS-USER[:\s]+([^\]]{0,120})\]/iu);
    next.blockReason = (reasonMatch?.[1] || "needs-user").trim();
  } else if (!isMeta && upper.includes(INCOMPLETE_MARK)) {
    next.status = "incomplete";
  }
  return next;
}

/**
 * True when text is host-injected instruction (continue prompt, task ledger,
 * system note) rather than worker output. Those quote `[DONE]`/`[INCOMPLETE`/
 * `[NEEDS-USER` as documentation and must not flip GoalState.
 * @param {string} text
 * @returns {boolean}
 */
export function isMetaInstructionText(text) {
  const s = String(text || "");
  if (!s) return false;
  if (isTaskLedgerText(s)) return true;
  if (/^\[系统\]|^\[System\]/u.test(s.trim())) return true;
  // Continue prompts describe markers and acceptance criteria as instructions.
  if (
    /继续完成原目标|continue from the latest tool results|同轮续跑|in-run follow-up|验收项|acceptance criteria|done-when/iu.test(s)
    && (s.includes(DONE_MARK) || s.includes(INCOMPLETE_MARK) || s.includes(NEEDS_USER_MARK) || /`\[DONE\]`|`\[INCOMPLETE|`\[NEEDS-USER/u.test(s))
  ) {
    return true;
  }
  // Quoted markers in backticks only (documentation).
  if (!s.includes("[PLAN]") && /`\[(?:DONE|INCOMPLETE[^\]]*|NEEDS-USER[^\]]*)\]`/u.test(s) && s.length < 800) {
    return true;
  }
  return false;
}

/**
 * Merge a per-run GoalState into the session/outer GoalState.
 * Never clobber a richer plan/criteria set with an empty rebuild —
 * auto-continue must keep working the original acceptance criteria.
 * @param {GoalState} outer
 * @param {GoalState|null|undefined} inner
 * @returns {GoalState}
 */
export function mergeGoalState(outer, inner) {
  if (!inner) return outer;
  const next = {
    ...outer,
    plan: inner.plan?.length ? [...inner.plan] : [...(outer.plan || [])],
    criteria: inner.criteria?.length ? [...inner.criteria] : [...(outer.criteria || [])],
    doneCriteria: inner.doneCriteria?.length
      ? [...inner.doneCriteria]
      : [...(outer.doneCriteria || [])],
    pathReceipts: [...new Set([...(outer.pathReceipts || []), ...(inner.pathReceipts || [])])],
    goal: inner.goal || outer.goal,
    // A fresh idle shell (session restore / empty per-run rebuild) must not
    // wipe a saved terminal status. A real inner status still wins below.
    status: inner.status && inner.status !== "idle" ? inner.status : (outer.status || inner.status || "idle"),
    blockReason: inner.blockReason || outer.blockReason || null,
  };
  // Terminal status in the inner run wins (done / incomplete / blocked).
  if (inner.status === "done") {
    next.status = "done";
    next.doneCriteria = [];
    next.blockReason = null;
  } else if (inner.status === "incomplete" || inner.status === "blocked") {
    next.status = inner.status;
    next.blockReason = inner.blockReason || outer.blockReason || null;
  } else if (next.doneCriteria.length && (next.status === "done" || next.status === "idle")) {
    // Open criteria mean work is not idle — keep the goal live across continues.
    next.status = "working";
    next.blockReason = null;
  }
  return next;
}

/**
 * A real workspace path, harvested from state or from the text.
 * The words "路径回执" / "path receipt" / "affected files" are not a receipt.
 * @param {GoalState} state
 * @param {string} body
 */
function claimHasPathEvidence(state, body) {
  const found = [...(state?.pathReceipts || [])];
  harvestPathReceipts(body, found);
  return found.length > 0;
}

/**
 * Host resume prompt, task ledger, or a short "继续" / "continue" cue.
 * A longer new request is a new task and must not inherit the saved ledger.
 * @param {string} text
 * @returns {boolean}
 */
export function isContinuationTurn(text) {
  const s = String(text || "").trim();
  if (!s) return false;
  if (isMetaInstructionText(s)) return true;
  return /^(?:继续|接着做|接着|继续吧|继续做|往下(?:做|干)?|continue|resume|go on|keep going)\s*[.。!！]?$/iu.test(s);
}

/**
 * Fold a saved goal into this turn. Continuation text keeps the saved plan,
 * open criteria, and path receipts, and does not replace the goal sentence
 * with "继续" or the resume prompt. A different task starts clean.
 * @param {GoalState & { openCriteria?: string[] }|null|undefined} prior
 * @param {string} userText
 * @returns {GoalState}
 */
export function restoreSessionGoal(prior, userText) {
  const raw = String(userText || "");
  const cont = isContinuationTurn(raw);
  const fresh = createGoalState(cont ? "" : raw);
  if (!prior) return fresh;
  const priorGoal = String(prior.goal || "").trim();
  const current = createGoalState(raw).goal || "";
  const same =
    Boolean(priorGoal) &&
    (current === priorGoal ||
      current.startsWith(priorGoal.slice(0, 40)) ||
      priorGoal.startsWith(current.slice(0, 40)));
  if (!same && !cont) return fresh;
  const open = Array.isArray(prior.doneCriteria) && prior.doneCriteria.length
    ? [...prior.doneCriteria]
    : (Array.isArray(prior.openCriteria) ? [...prior.openCriteria] : []);
  const restored = {
    goal: (cont && priorGoal) ? priorGoal : (priorGoal || fresh.goal),
    plan: [...(prior.plan || [])],
    criteria: prior.criteria?.length ? [...prior.criteria] : [...open],
    doneCriteria: [...open],
    pathReceipts: [...(prior.pathReceipts || [])],
    status: /** @type {GoalState["status"]} */ (
      prior.status && prior.status !== "idle"
        ? prior.status
        : (open.length ? "working" : "idle")
    ),
    blockReason: prior.blockReason ?? null,
  };
  harvestPathReceipts(raw, restored.pathReceipts);
  const shell = {
    ...fresh,
    goal: restored.goal,
    plan: [],
    criteria: [],
    doneCriteria: [],
    pathReceipts: [],
    status: /** @type {const} */ ("idle"),
    blockReason: null,
  };
  return mergeGoalState(restored, shell);
}

/**
 * @param {{ role?: string, content?: string|Array<{ text?: string }> }} message
 * @returns {string}
 */
function messageText(message) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) return message.content.map((b) => b?.text || "").join(" ");
  return "";
}

/**
 * Fold transcript text into a goal. A `[DONE]` with no harvested path does not
 * complete the ledger or clear open criteria — that claim is not evidence.
 * @param {GoalState} state
 * @param {Array<{ role?: string, content?: string|Array<{ text?: string }> }>} [messages]
 * @returns {GoalState}
 */
export function foldGoalHistory(state, messages) {
  let next = state;
  for (const m of messages || []) {
    if (m?.role !== "assistant" && m?.role !== "user") continue;
    const text = messageText(m);
    if (!text || isTaskLedgerText(text) || isMetaInstructionText(text)) continue;
    const before = next;
    next = applyGoalUpdate(next, { text });
    const bareDone = String(text).toUpperCase().includes(DONE_MARK)
      && !claimHasPathEvidence({ pathReceipts: [] }, text);
    if (!bareDone) continue;
    const parsed = parsePlanBlock(text);
    next = {
      ...next,
      status: parsed?.criteria?.length ? "working" : before.status,
      blockReason: parsed?.criteria?.length ? null : before.blockReason,
      criteria: parsed?.criteria?.length ? [...parsed.criteria] : [...(before.criteria || [])],
      doneCriteria: parsed?.criteria?.length ? [...parsed.criteria] : [...(before.doneCriteria || [])],
    };
  }
  return next;
}

/**
 * Goal sentence for a run. "继续" keeps the previous task sentence.
 * @param {Array<{ role?: string, content?: string|Array<{ text?: string }> }>} [messages]
 * @returns {GoalState}
 */
export function seedGoalFromMessages(messages) {
  let lastUser = "";
  let lastTask = "";
  for (const m of messages || []) {
    if (m?.role !== "user") continue;
    const c = messageText(m);
    if (!c || isTaskLedgerText(c)) continue;
    lastUser = c;
    if (!isMetaInstructionText(c) && !isContinuationTurn(c)) lastTask = c;
  }
  const sentence = isContinuationTurn(lastUser) ? (lastTask || "") : (lastUser || lastTask);
  return createGoalState(sentence);
}

/**
 * What Pi's prelude used to seed: the latest user sentence, so "继续" is the goal.
 * @param {Array<{ role?: string, content?: string|Array<{ text?: string }> }>} [messages]
 */
function piContinuationSeed(messages) {
  let last = "";
  for (const m of messages || []) {
    if (m?.role !== "user") continue;
    const c = messageText(m);
    if (c && !isTaskLedgerText(c) && !/^\[系统\]|^\[System\]/u.test(c.trim())) last = c;
  }
  return createGoalState(last);
}

/**
 * Merge a per-run goal. A continuation seed ("继续") does not replace the saved
 * goal sentence. A done claim with no harvested path does not clear open criteria.
 * @param {GoalState} outer
 * @param {GoalState|null|undefined} inner
 * @returns {GoalState}
 */
export function mergeRunGoal(outer, inner) {
  if (!inner) return outer;
  const continuationSeed = !inner.goal || isContinuationTurn(inner.goal);
  const falseDone = inner.status === "done" && !claimHasPathEvidence(inner, "");
  return mergeGoalState(outer, {
    ...inner,
    plan: [...(inner.plan || [])],
    criteria: [...(inner.criteria || [])],
    doneCriteria: falseDone ? [] : [...(inner.doneCriteria || [])],
    pathReceipts: [...(inner.pathReceipts || [])],
    goal: continuationSeed ? "" : inner.goal,
    status: falseDone ? "idle" : (inner.status || "idle"),
    blockReason: falseDone ? null : (inner.blockReason ?? null),
  });
}

/**
 * Restore the saved ledger, fold the transcript, then merge Pi's continuation
 * seed. One prelude for Desktop: a bare historical `[DONE]` plus goal "继续"
 * must not replace the saved sentence, open criteria, or incomplete status.
 * @param {{
 *   saved?: GoalState & { openCriteria?: string[] }|null,
 *   messages?: Array<{ role?: string, content?: string|Array<{ text?: string }> }>,
 *   piState?: GoalState|null,
 * }} [input]
 * @returns {GoalState}
 */
export function prepareTurnGoal({ saved = null, messages = [], piState = null } = {}) {
  let lastUser = "";
  let lastTask = "";
  for (const m of messages || []) {
    if (m?.role !== "user") continue;
    const c = messageText(m);
    if (!c || isTaskLedgerText(c)) continue;
    lastUser = c;
    if (!isMetaInstructionText(c) && !isContinuationTurn(c)) lastTask = c;
  }
  let state = restoreSessionGoal(saved, lastUser || lastTask);
  if (!state.goal && lastTask) state = { ...state, goal: createGoalState(lastTask).goal };
  state = foldGoalHistory(state, messages);
  state = mergeRunGoal(state, foldGoalHistory(piContinuationSeed(messages), messages));
  if (piState) state = mergeRunGoal(state, piState);
  return state;
}

/**
 * Heuristic done-verdict. Used only to decide auto-continue — never to claim success to the user.
 * @param {{ state: GoalState, lastBody: string, stepLimitHit?: boolean, toolCallCount?: number }} input
 * @returns {{ finished: boolean, reason: string, confidence: "high"|"medium"|"low" }}
 */
export function assessGoalCompletion({ state, lastBody, stepLimitHit, toolCallCount }) {
  const body = String(lastBody || "").trim();
  const upper = body.toUpperCase();
  const meta = isMetaInstructionText(body);
  if (!meta && upper.includes(NEEDS_USER_MARK)) {
    return { finished: false, reason: "blocked", confidence: "high" };
  }
  if (!meta && upper.includes(INCOMPLETE_MARK)) {
    return { finished: false, reason: "incomplete-mark", confidence: "high" };
  }
  // Verification-before-done: tools ran (or a prior fold already rejected the
  // claim) and `[DONE]` has no path receipt. A bare marker is not success.
  const toolsRan = Number(toolCallCount) > 0;
  const bareDone =
    !meta &&
    upper.includes(DONE_MARK) &&
    (toolsRan || state?.blockReason === "missing-path-receipts") &&
    !claimHasPathEvidence(state, body);
  if (bareDone) {
    return { finished: false, reason: "missing-path-receipts", confidence: "high" };
  }
  if (!meta && upper.includes(DONE_MARK)) {
    return { finished: true, reason: "done-mark", confidence: "high" };
  }
  if (state.status === "incomplete" || state.status === "blocked") {
    return { finished: false, reason: state.status, confidence: "high" };
  }
  if (Array.isArray(state.doneCriteria) && state.doneCriteria.length > 0) {
    return { finished: false, reason: "open-criteria", confidence: "high" };
  }
  if (stepLimitHit) {
    return { finished: false, reason: "step-limit", confidence: "high" };
  }
  // No plan captured and model produced a closing answer (optionally with receipts).
  const hasReceipt = claimHasPathEvidence(state, body);
  const looksClosed =
    /(?:^|\n)\s*(?:#+\s*)?(?:done|完成|已完成|结论|summary|finished)\b/iu.test(body) ||
    /\b(?:done|finished|complete)\s*[.。!！]?\s*$/iu.test(body.trim()) ||
    (body.length > 200 && /(?:完成|已完成|结论|done|complete|finished|summary)/iu.test(body.slice(-300)));
  if (hasReceipt && looksClosed) {
    return { finished: true, reason: "closing-answer", confidence: "medium" };
  }
  if (looksClosed && body.length < 400 && !/\[PLAN\]/u.test(body)) {
    return { finished: true, reason: "closing-answer", confidence: "medium" };
  }
  if (toolCallCount && toolCallCount > 0 && body.length < 80 && !hasReceipt) {
    return { finished: false, reason: "thin-answer", confidence: "medium" };
  }
  return { finished: false, reason: "no-verdict", confidence: "low" };
}

/**
 * Fold a `[DONE]` claim that has no path evidence back to incomplete.
 * Shared by Desktop (Pi + SDK) and Obsidian so neither surface treats a bare
 * marker as success after tools ran. Restores acceptance criteria as open.
 * @param {GoalState} state
 * @param {{ toolCallCount?: number, lastBody?: string }} [opts]
 * @returns {GoalState}
 */
export function rejectBareDone(state, opts = {}) {
  const assessment = assessGoalCompletion({
    state,
    lastBody: opts.lastBody || "",
    toolCallCount: opts.toolCallCount || 0,
  });
  if (assessment.reason !== "missing-path-receipts") return state;
  const open = state.criteria?.length ? [...state.criteria] : [...(state.doneCriteria || [])];
  return {
    ...state,
    status: "incomplete",
    blockReason: "missing-path-receipts",
    doneCriteria: open,
  };
}

/**
 * Honesty footer model. Path receipts are a change footprint, never Verified.
 * Empty segments stay empty so the UI can say "none" instead of inventing checks.
 * @param {{
 *   pathReceipts?: string[],
 *   checksRun?: string[],
 *   assumptions?: string[],
 *   openCriteria?: string[],
 *   doneCriteria?: string[],
 *   status?: string,
 *   blockReason?: string|null,
 * }|null|undefined} goal
 * @returns {{ changes: string[], verified: string[], assumed: string[], couldNot: string[] }|null}
 */
export function buildResultFooter(goal) {
  if (!goal) return null;
  const status = goal.status || "";
  if (status !== "done" && status !== "incomplete" && status !== "blocked") return null;
  const couldNot = [...(goal.openCriteria?.length ? goal.openCriteria : (goal.doneCriteria || []))];
  if (status === "blocked" && goal.blockReason) couldNot.push(goal.blockReason);
  return {
    changes: [...(goal.pathReceipts || [])],
    verified: [...(goal.checksRun || [])],
    assumed: [...(goal.assumptions || [])],
    couldNot,
  };
}

/**
 * External goal evaluator (industry /goal pattern): a separate judge — never
 * the worker self-grading. Host injects a one-shot LLM; this module only builds
 * the prompt and parses the verdict. Falls back to assessGoalCompletion when
 * the evaluator is unavailable.
 */

/**
 * @param {{ state: GoalState, lastBody: string, toolSummaries?: string[] }} input
 * @returns {string}
 */
export function buildGoalEvaluatorPrompt({ state, lastBody, toolSummaries = [] }) {
  const open = (state.doneCriteria || []).join("\n- ") || "(none captured)";
  const plan = (state.plan || []).join("\n- ") || "(none)";
  const receipts = (state.pathReceipts || []).slice(-12).join(", ") || "(none)";
  const tools = toolSummaries.slice(-12).join("\n- ") || "(none)";
  return [
    "You are a goal-completion judge. Decide whether the worker finished the user goal.",
    "Do NOT praise. Do NOT continue the work. Answer with exactly one JSON object.",
    "",
    `GOAL: ${state.goal || "(none)"}`,
    `PLAN:\n- ${plan}`,
    `ACCEPTANCE CRITERIA (all must hold):\n- ${open}`,
    `PATH RECEIPTS: ${receipts}`,
    `RECENT TOOLS:\n- ${tools}`,
    `LAST WORKER REPLY:\n${String(lastBody || "").slice(0, 4000)}`,
    "",
    "Reply JSON only:",
    '{"verdict":"met|not_met|impossible","reason":"one sentence","openCriteria":["…"]}',
    "- met = every acceptance criterion is satisfied by evidence (paths/tools).",
    "- not_met = work remains or evidence is missing.",
    "- impossible = blocked and cannot proceed without the user.",
  ].join("\n");
}

/**
 * @param {string} text
 * @returns {{ verdict: "met"|"not_met"|"impossible", reason: string, openCriteria: string[] }|null}
 */
export function parseGoalEvaluatorResult(text) {
  const raw = String(text || "");
  const m = raw.match(/\{[\s\S]*\}/u);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    const verdict = obj?.verdict;
    if (verdict !== "met" && verdict !== "not_met" && verdict !== "impossible") return null;
    return {
      verdict,
      reason: String(obj.reason || "").slice(0, 200),
      openCriteria: Array.isArray(obj.openCriteria) ? obj.openCriteria.map(String).slice(0, 16) : [],
    };
  } catch {
    return null;
  }
}

/**
 * Combine heuristic + optional external evaluator into a continue decision input.
 * @param {{ heuristic: { finished: boolean, reason: string, confidence: string }, evaluator?: { verdict: string, reason: string, openCriteria?: string[] }|null }} input
 * @returns {{ finished: boolean, reason: string, confidence: "high"|"medium"|"low", source: "evaluator"|"heuristic" }}
 */
export function reconcileGoalVerdicts({ heuristic, evaluator }) {
  if (!evaluator) {
    return {
      finished: Boolean(heuristic.finished),
      reason: heuristic.reason,
      confidence: /** @type {"high"|"medium"|"low"} */ (heuristic.confidence || "low"),
      source: "heuristic",
    };
  }
  if (evaluator.verdict === "impossible") {
    return { finished: false, reason: `impossible:${evaluator.reason}`, confidence: "high", source: "evaluator" };
  }
  if (evaluator.verdict === "met") {
    // Evaluator met overrides a medium heuristic "not finished" but never
    // overrides an explicit [INCOMPLETE] / blocked (those are worker honesty).
    if (
      heuristic.reason === "incomplete-mark" ||
      heuristic.reason === "blocked" ||
      heuristic.reason === "missing-path-receipts"
    ) {
      return { finished: false, reason: heuristic.reason, confidence: "high", source: "heuristic" };
    }
    return { finished: true, reason: `met:${evaluator.reason}`, confidence: "high", source: "evaluator" };
  }
  // not_met — keep working unless the worker explicitly closed with done-mark
  // AND the evaluator still says not_met with empty open list (rare; trust worker).
  if (heuristic.reason === "done-mark" && !(evaluator.openCriteria || []).length) {
    return { finished: true, reason: "done-mark", confidence: "high", source: "heuristic" };
  }
  return {
    finished: false,
    reason: `not_met:${evaluator.reason}`,
    confidence: "high",
    source: "evaluator",
  };
}

/**
 * Should the host auto-continue the turn?
 * @param {{
 *   assessment: ReturnType<typeof assessGoalCompletion>,
 *   autoContinues: number,
 *   maxAutoContinues: number,
 *   hasTools: boolean,
 *   error?: boolean,
 *   cancelled?: boolean,
 * }} input
 * @returns {{ continue: boolean, reason: string }}
 */
export function decideAutoContinue({
  assessment,
  autoContinues,
  maxAutoContinues,
  hasTools,
  error,
  cancelled,
}) {
  if (error || cancelled) return { continue: false, reason: "error-or-cancelled" };
  if (!hasTools) return { continue: false, reason: "no-tools" };
  // Terminal honesty: blocked / incomplete-mark / impossible never auto-continue.
  if (
    assessment.reason === "blocked" ||
    assessment.reason === "incomplete-mark" ||
    String(assessment.reason || "").startsWith("impossible")
  ) {
    return { continue: false, reason: assessment.reason };
  }
  if (assessment.finished && assessment.confidence === "high") {
    return { continue: false, reason: assessment.reason };
  }
  if (autoContinues >= maxAutoContinues) {
    return { continue: false, reason: "continue-budget" };
  }
  if (assessment.finished && assessment.confidence === "medium") {
    return { continue: false, reason: assessment.reason };
  }
  return { continue: true, reason: assessment.reason };
}

/**
 * Continuation prompt that survives compaction: goal + plan + open criteria + receipts.
 * @param {string} locale
 * @param {GoalState} state
 * @param {{ extra?: string }} [opts]
 * @returns {string}
 */
export function buildContinuePrompt(locale, state, opts = {}) {
  const zh = !String(locale || "").startsWith("en");
  const receipts = (state.pathReceipts || []).slice(-12);
  const open = state.doneCriteria || [];
  const plan = state.plan || [];
  const parts = zh
    ? [
        "[系统] 步数/预算用尽或需续跑，任务可能未完成。请继续完成用户原始目标；若已完成则给出简短结论与路径回执。",
        `原目标：${state.goal || "（见会话首条用户消息）"}`,
      ]
    : [
        "[System] Step/context budget exhausted or continuation required; the task may be incomplete. Continue toward the original goal; if finished, give a short conclusion with path receipts.",
        `Original goal: ${state.goal || "(see first user message)"}`,
      ];
  if (plan.length) {
    parts.push(zh ? `计划：\n${plan.map((s, i) => `${i + 1}. ${s}`).join("\n")}` : `Plan:\n${plan.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
  }
  if (open.length) {
    parts.push(
      zh
        ? `未完成验收项：\n${open.map((s) => `- ${s}`).join("\n")}`
        : `Open acceptance criteria:\n${open.map((s) => `- ${s}`).join("\n")}`,
    );
  } else if (plan.length) {
    parts.push(zh ? "验收：对照计划逐步核对；未全部达成前不要宣布完成。" : "Verify each plan item before claiming done.");
  }
  if (receipts.length) {
    parts.push(zh ? `路径回执：\n${receipts.join("\n")}` : `Path receipts:\n${receipts.join("\n")}`);
  }
  if (opts.extra) parts.push(String(opts.extra));
  parts.push(
    zh
      ? "先更新/执行剩余步骤，再收尾。收尾时输出结论 + 路径回执 + [DONE]；若无法完成则 [INCOMPLETE 原因]。"
      : "Continue remaining steps first, then close. Finish with conclusion + path receipts + [DONE]; if blocked use [INCOMPLETE reason].",
  );
  return parts.join("\n");
}

/**
 * Sticky ledger text for compaction: never lose goal/plan/receipts.
 * @param {GoalState} state
 * @param {string} [locale]
 * @returns {string}
 */
export function buildTaskLedger(state, locale = "zh-CN") {
  const zh = !String(locale || "").startsWith("en");
  const lines = [TASK_LEDGER_HEADER, zh ? `目标：${state.goal || "—"}` : `Goal: ${state.goal || "—"}`];
  if (state.plan?.length) {
    lines.push(zh ? "计划：" : "Plan:");
    state.plan.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  }
  if (state.criteria?.length) {
    lines.push(zh ? "验收项：" : "Criteria:");
    state.criteria.forEach((s) => lines.push(`- ${s}`));
    if (state.doneCriteria?.length) {
      lines.push(zh ? `未完成：${state.doneCriteria.length} 项` : `Open: ${state.doneCriteria.length}`);
    }
  }
  if (state.pathReceipts?.length) {
    lines.push(zh ? "路径回执：" : "Path receipts:");
    state.pathReceipts.slice(-12).forEach((p) => lines.push(`- ${p}`));
  }
  lines.push(zh ? `状态：${state.status}` : `Status: ${state.status}`);
  return lines.join("\n");
}

/**
 * True when a message body is the sticky task ledger (skip when re-deriving goal).
 * @param {string} text
 */
export function isTaskLedgerText(text) {
  return String(text || "").includes(TASK_LEDGER_HEADER);
}

/**
 * System-prompt fragment: plan → execute → verify → close.
 * Drawing / multi-stage creative work is called out explicitly.
 * @param {"zh"|"en"} locale
 * @returns {string}
 */
export function buildGoalProtocolPrompt(locale) {
  if (locale === "en") {
    return [
      "## Goal protocol (multi-step tasks)",
      "Treat multi-step work as a goal with acceptance criteria — not a single reply.",
      "1. PLAN (first action when the task needs 2+ tool steps or produces multi-part deliverables). Emit exactly one block then keep working (never stop at the plan):",
      `${PLAN_OPEN}`,
      "goal: one sentence",
      "steps: 1) … 2) … 3) …",
      "done-when:",
      "- observable criterion 1",
      "- observable criterion 2",
      PLAN_CLOSE,
      "2. EXECUTE with tools. Prefer small reversible steps; record path receipts in tool results.",
      "3. VERIFY before closing: re-check every done-when item against files/paths. If any fail, continue — do not claim done.",
      "4. CLOSE only when all criteria hold (or you are blocked). Final user-visible answer: conclusion + path receipts + `[DONE]`, or `[INCOMPLETE reason]`.",
      "5. NEEDS USER: if you must wait for a decision/permission/input (not just a confirm dialog), emit `[NEEDS-USER short reason]` and stop — the host will pause for the user. Do not fake progress.",
      "Multi-stage creative work (illustration / diagrams / long documents / posters): split into stages with a checkable artifact each (brief → draft → final file → spec check). Never announce completion before checking the output file(s) exist and match the brief.",
      "Under step/context pressure: keep working the open criteria; if the host continues you, resume from the task ledger and path receipts — do not restart from scratch.",
    ].join("\n");
  }
  return [
    "## 目标协议（多步任务）",
    "多步工作按「目标 + 验收标准」推进，不是一句话回复。",
    "1. 规划（需要 2 步以上工具、或多段交付物时，先做且仅做一次）：输出下面块后立即继续执行，禁止停在计划：",
    `${PLAN_OPEN}`,
    "goal: 一句话目标",
    "steps: 1) … 2) … 3) …",
    "done-when:",
    "- 可观察的验收项 1",
    "- 可观察的验收项 2",
    PLAN_CLOSE,
    "2. 执行：用工具推进；步骤可逆优先；工具结果里留下路径回执。",
    "3. 收尾前验收：对照 done-when 逐项核对文件/路径；任一项未达成就继续做，禁止宣布完成。",
    "4. 仅当全部验收达成（或明确受阻）才收尾。用户可见结论：结论 + 路径回执 + `[DONE]`，或 `[INCOMPLETE 原因]`。",
    "5. 需要用户：若必须等用户决策/授权/补充输入（不是写回确认框），输出 `[NEEDS-USER 简短原因]` 并停下——宿主会请你介入。禁止假装推进。",
    "多阶段创作（插画/绘图/图表/长文/海报）：拆成阶段，每阶段有可检查产出（需求 → 草稿 → 成稿文件 → 对照规格核对）。产出文件未存在或不符合需求前，不得宣布完成。",
    "步数/上下文吃紧时：优先完成未完成验收项；若宿主续跑，按任务台账与路径回执接着做，不要从头再来。",
  ].join("\n");
}

/**
 * Resolve how many auto-continues to allow for a goal that is clearly incomplete.
 * Long multi-stage tasks may need more than the historical fixed 2.
 * @param {{ assessment: ReturnType<typeof assessGoalCompletion>, baseMax?: number }} input
 */
export function resolveMaxAutoContinues({ assessment, baseMax = 2 }) {
  const base = Number.isFinite(baseMax) ? Math.max(1, Math.floor(baseMax)) : 2;
  if (!assessment.finished && (assessment.reason === "open-criteria" || assessment.reason === "step-limit")) {
    return Math.max(base, 4);
  }
  return base;
}
