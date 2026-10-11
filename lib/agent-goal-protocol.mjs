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
 * External source receipts: http(s) URLs cited in tool results / final text.
 * Kept separate from workspace path receipts so the honesty footer can say
 * "checked this workspace file" vs "retrieved from this URL".
 */
const URL_RE = /https?:\/\/[^\s`"'）)<>]+/gu;

/**
 * Harvest external source URLs (deduped, capped).
 * @param {string} text
 * @param {string[]} [into]
 * @returns {string[]}
 */
export function harvestSourceUrls(text, into = []) {
  const raw = String(text || "");
  for (const m of raw.matchAll(URL_RE)) {
    let u = m[0].replace(/[.,;:]+$/u, "");
    // Strip trailing punctuation that regexes catch after URLs in prose.
    u = u.replace(/[.,;:!?）)》」』]+$/u, "");
    if (!u || !/^https?:\/\//iu.test(u)) continue;
    // Skip obvious non-citable noise (data URIs already excluded; skip our own tool docs).
    if (/duckduckgo\.com\/y\.js/iu.test(u)) continue;
    if (!into.includes(u)) {
      into.push(u);
      if (into.length >= 16) break;
    }
  }
  return into;
}

/**
 * Turn kind — gates whether the goal protocol applies at all.
 * - light: greeting / chit-chat / pure opinion. No PLAN, no [DONE], no footer.
 * - query: read-only workspace lookup (memories / stream / todos / search).
 *          Tools yes; goal ceremony optional (receipts only when files touched).
 * - task:  write / organize / multi-step delivery. Full goal protocol.
 * @typedef {"light"|"query"|"task"} TurnKind
 */

/**
 * @typedef {object} GoalState
 * @property {string} goal
 * @property {string[]} plan
 * @property {string[]} criteria
 * @property {string[]} doneCriteria
 * @property {string[]} pathReceipts
 * @property {string[]} [sourceUrls]
 * @property {"idle"|"planning"|"working"|"verifying"|"done"|"incomplete"|"blocked"} status
 * @property {string|null} blockReason
 * @property {TurnKind} [kind]
 */

/** Short user turns with no verb-object work — greeting / politeness / filler. */
const LIGHT_TURN_RE =
 /^(?:hi|hello|hey|yo|嗨|你好|您好|哈喽|哈啰|哈囉|在吗|在么|在不在|早|早上好|中午好|下午好|晚上好|晚安|谢谢|多谢|感谢|好的?|ok|okay|嗯|哦|噢|呀|啊|哈|哈哈|嘿嘿|嘻嘻|～|~|!|！|\?|？|。|\.|,|，)+[!！?？.。~～\s]*$/iu;

/** Workspace lookup intents → the read tool that answers them. First match wins —
 *  keep the more specific phrase in the earlier rule. */
const QUERY_INTENT_RULES = [
  {
    re: /(?:最近|近期|刚才|之前)?(?:的)?(?:记忆|memories|memory|情况|画像|profile)|我的情况|我记过什么|remember/iu,
    tools: ["list_recent_memories"],
    note: "memories",
  },
  {
    re: /(?:最近|近期|这几天|本周|今天)?(?:的)?(?:动态|stream|笔记流|记了什么|写了什么|日志)|最近记(?!忆)|最近写|最近捕获|recent/iu,
    tools: ["list_recent_stream"],
    note: "stream",
  },
  {
    re: /(?:待办|todo|清单|任务清单|最近的?任务|有什么任务|任务有|还有什么没做|未完成的事项|需要做什么|该做什么|要做什么|接下来做什么|还有什么要做)/iu,
    tools: ["list_todos"],
    note: "todos",
  },
  {
    re: /(?:收件箱|inbox)里有|有哪些.*收件|待整理/iu,
    tools: ["list_inbox"],
    note: "inbox",
  },
  {
    re: /(?:交付|outputs?|成果)里有|有哪些.*交付/iu,
    tools: ["list_outputs"],
    note: "outputs",
  },
  {
    re: /(?:搜一下|搜索|搜搜|查一下|查查|google|百度|search)\s*[：:]?\s*\S+/iu,
    tools: ["web_search"],
    note: "web",
  },
  {
    re: /(?:最新|现在的|目前的|current|latest)\s*\S{2,}/iu,
    tools: ["web_search"],
    note: "web-latest",
  },
];

/** Question-shaped text is never a greeting, however short. */
const QUESTION_RE = /[?？]|什么|哪些|哪个|谁|几[个次]|如何|怎样|怎么样|吗|呢|么|多少|为什么|咋|啥/u;

/**
 * Classify a user turn so the host can gate goal ceremony / auto-continue /
 * result footer. Conservative: unknown verbs fall through to "task" only when
 * they look like work; pure questions stay "query"; greetings stay "light".
 * @param {string} text
 * @returns {TurnKind}
 */
export function classifyTurn(text) {
  const s = String(text || "").replace(/\s+/gu, " ").trim();
  if (!s) return "light";
  if (LIGHT_TURN_RE.test(s)) return "light";
  // Very short non-question filler ("嗯" / "ok" / "哈哈") is light. A short
  // question ("待办有哪些") is not — fall through to query/task routing.
  if (s.length <= 6 && !QUESTION_RE.test(s) && !/[记写做改删建整理归档搜索查找分析帮我]/u.test(s)) {
    return "light";
  }
  // Workspace lookup (read-only) — includes "最近记忆 / 有什么 / 看一下 …"
  const lookupOnly =
    /^(?:请)?(?:帮(?:我)?(?:看看|查查|查一下|看一下|找找|找一下|搜一下|搜搜)|看看|查查|查一下|看一下|找找|找一下|搜一下)?\s*(?:最近|近期|今天|本周|现在|目前|我|我的|工作区)?\s*(?:有(?:什么|哪些|啥)?|是(?:什么|哪些)|哪些|什么|谁|多少|几个|怎么样|如何|怎样)/u.test(
      s,
    );
  const hasWriteVerb =
    /(?:记一下|记下|写|改|编辑|润色|整理|归档|删除|新建|创建|建个|建立|发布|移动|重命名|补|更新|修复|完成|做一?个|做一?篇|生成|导出|抓取|抓|下载|研究|调研|综述|对比分析)/u.test(
      s,
    );
  if (!hasWriteVerb && (lookupOnly || QUERY_INTENT_RULES.some((r) => r.re.test(s)))) {
    return "query";
  }
  if (hasWriteVerb) return "task";
  // Default: medium+ length instructions are tasks; short questions are queries.
  return s.length > 40 || /[，,。；;：:].{10,}/u.test(s) ? "task" : "query";
}

/**
 * Map a query-like turn to the read tool(s) that answer it.
 * Compound questions ("tasks and memories") collect every matching rule.
 * @param {string} text
 * @returns {{ tools: string[], note: string }|null}
 */
export function matchQueryIntents(text) {
  const s = String(text || "");
  /** @type {string[]} */
  const tools = [];
  /** @type {string[]} */
  const notes = [];
  for (const rule of QUERY_INTENT_RULES) {
    if (!rule.re.test(s)) continue;
    for (const t of rule.tools) {
      if (!tools.includes(t)) tools.push(t);
    }
    if (!notes.includes(rule.note)) notes.push(rule.note);
  }
  if (tools.length === 0) return null;
  return { tools, note: notes.join("+") };
}

/**
 * Fresh goal state from the user's first message.
 * @param {string} userGoal
 * @param {TurnKind} [kind]
 * @returns {GoalState}
 */
export function createGoalState(userGoal, kind) {
  const goal = String(userGoal || "").replace(/\s+/gu, " ").trim().slice(0, 400);
  const resolvedKind = kind || classifyTurn(goal);
  return {
    goal,
    plan: [],
    criteria: [],
    doneCriteria: [],
    pathReceipts: [],
    sourceUrls: [],
    status: "idle",
    blockReason: null,
    kind: resolvedKind,
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
    sourceUrls: [...(state.sourceUrls || [])],
  };
  const text = String(update.text || "");
  if (text) {
    harvestPathReceipts(text, next.pathReceipts);
    harvestSourceUrls(text, next.sourceUrls);
  }
  const plan = parsePlanBlock(text);
  if (plan && (plan.plan.length || plan.criteria.length)) {
    if (plan.plan.length) next.plan = plan.plan;
    if (plan.criteria.length) {
      next.criteria = plan.criteria;
      next.doneCriteria = plan.criteria.slice();
    }
    next.status = "working";
    // A real [PLAN] upgrades the turn to task — never treat planned work as light.
    next.kind = "task";
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
  // Light turns are finished as soon as the model says anything at all —
  // never require [DONE], path receipts, or acceptance criteria for a greeting.
  // A turn that grew a real plan/criteria is no longer light; a step-limit hit
  // means a task loop is still open and must not be waved through.
  const grewPlan = (state?.plan?.length || 0) > 0 || (state?.criteria?.length || 0) > 0;
  if (state?.kind === "light" && body && !grewPlan && !stepLimitHit) {
    return { finished: true, reason: "light-turn", confidence: "high" };
  }
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
  // Empty turn (no text, no tools) is not "keep going" — the model produced
  // nothing and another continue almost always produces nothing again. Treat
  // as terminal so the user gets an honest incomplete + Regenerate affordance
  // instead of silently burning the continue budget.
  if (!body && !toolsRan) {
    return { finished: false, reason: "empty-turn", confidence: "high" };
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
  turnKind,
}) {
  if (error || cancelled) return { continue: false, reason: "error-or-cancelled" };
  // Light turns (greetings / chit-chat) never burn continue budget — one reply
  // is the whole deliverable. Query turns only continue when tools actually
  // failed to answer (the model produced nothing usable).
  if (turnKind === "light") return { continue: false, reason: "light-turn" };
  if (turnKind === "query" && assessment.finished) {
    return { continue: false, reason: assessment.reason };
  }
  if (!hasTools) return { continue: false, reason: "no-tools" };
  // Terminal honesty: blocked / incomplete-mark / impossible / empty-turn never auto-continue.
  if (
    assessment.reason === "blocked" ||
    assessment.reason === "incomplete-mark" ||
    assessment.reason === "empty-turn" ||
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
      "",
      "### Turn layers (classify first)",
      "- **Light turn** (greeting / chit-chat / thanks): reply naturally. **Never** emit [PLAN], [DONE], path receipts, or step narration. Do not call tools.",
      "- **Query turn** (what's in my workspace: recent memories / stream / todos / inbox): **call the matching read tool first**, then answer from the real entries. Do NOT answer from general AI-memory knowledge. Usually no [PLAN]; never invent path receipts when no file changed.",
      "- **Task turn** (capture / edit / organize / deliver / multi-step creative): full protocol below.",
      "",
      "### Query intent → read tool (always fetch before answering)",
      "- 'recent memories / my profile / what do I remember' → `list_recent_memories`",
      "- 'recent stream / what did I log' → `list_recent_stream`",
      "- 'todos / checklist' → `list_todos`",
      "- 'inbox' → `list_inbox`; 'outputs' → `list_outputs`",
      "- 'search the web for X / latest X' (outside the workspace) → `web_search`, then `fetch_url` the best hits",
      "Answer with the tool results. If empty, say so honestly.",
      "",
      "### External retrieval & citations",
      "1. `web_search` first for current facts / docs / news; shortlist 1–3 pages.",
      "2. `fetch_url` those pages for full text; URLs in tool results are source receipts.",
      "3. Cite sources (title + URL) next to key claims; say 'per [source]' when uncertain.",
      "4. Workspace material beats the open web; path receipts for files, URL sources for pages.",
      "5. Never invent URLs or papers. If search is empty, say so — do not pass training data off as live facts.",
      "",
      "### Deep research (multi-hop search → fetch → cross-check)",
      "For surveys / comparisons / anything needing corroboration. **Budget**: ≤3 search rounds · ≤5 page fetches · truncate long pages.",
      "1. **Plan**: split the question into 2–4 searchable sub-questions.",
      "2. **Hop 1**: `web_search` each sub-question; prefer high-score sources (official / edu / gov / major press).",
      "3. **Deep read**: `fetch_url` 1–3 complementary pages (dedupe hosts; cross domains).",
      "4. **Refine**: on gaps or conflicts, rewrite keywords and search once more (max 3 rounds).",
      "5. **Cross-check**: key claims need ≥2 independent sources; single-source → 'per [source]'; present conflicts side by side.",
      "6. **Ingest (optional)**: `capture_url` saves a page into the workspace with its source URL.",
      "7. **Close**: conclusion + source list (title+URL) + what remains unverified. No absolute claims on a single source.",
      "",
      "### Autopilot (finish the work before you stop)",
      "- Task turns: keep calling tools until acceptance criteria hold — do not pause to ask 'continue?'.",
      "- Tool failure: retry once with adjusted args; only then report the reason and a fallback path.",
      "- Use `[NEEDS-USER short reason]` only for real decisions/permissions — otherwise drive to completion.",
      "- Closing requires verification against done-when; never 'looks good enough'.",
      "",
      "1. PLAN (**task turns only**, first action when the task needs 2+ tool steps or multi-part deliverables). Emit exactly one block then keep working:",
      `${PLAN_OPEN}`,
      "goal: one sentence",
      "steps: 1) … 2) … 3) …",
      "done-when:",
      "- observable criterion 1",
      "- observable criterion 2",
      PLAN_CLOSE,
      "2. EXECUTE with tools. Prefer small reversible steps; record path receipts in tool results.",
      "3. VERIFY before closing: re-check every done-when item against files/paths. If any fail, continue — do not claim done.",
      "4. CLOSE only when all criteria hold (or you are blocked). Final user-visible answer: conclusion + path receipts + `[DONE]`, or `[INCOMPLETE reason]`. Path receipts are real file paths — never narrate 'Step 1: understood intent' as a receipt.",
      "5. NEEDS USER: if you must wait for a decision/permission/input (not just a confirm dialog), emit `[NEEDS-USER short reason]` and stop — the host will pause for the user. Do not fake progress.",
      "Multi-stage creative work: split into stages with a checkable artifact each. Never announce completion before checking the output file(s) exist and match the brief.",
      "Under step/context pressure: keep working the open criteria; if the host continues you, resume from the task ledger and path receipts — do not restart from scratch.",
    ].join("\n");
  }
  return [
    "## 目标协议（多步任务）",
    "多步工作按「目标 + 验收标准」推进，不是一句话回复。",
    "",
    "### 回合分层（先判断，再决定是否走协议）",
    "- **轻量回合**（问候/闲聊/谢谢/在吗/一句情绪或寒暄）：直接自然回复即可。**禁止**输出 [PLAN]、[DONE]、路径回执、步骤叙述或结果页脚。不要调用工具。",
    "- **查询回合**（问工作区里有什么：最近记忆/动态/待办/收件箱…）：**先调对应读工具**再回答，用事实说话，不要用训练知识里的「AI 记忆原理」作答。结论可简短，通常不需要 [PLAN]；未改文件则不要编造路径回执。",
    "- **任务回合**（记一下/改文件/整理/写交付/多步创作）：走下面完整协议。",
    "",
    "### 查询意图 → 读工具（必须先查再答）",
    "- 「最近记忆 / 我的情况 / 我记过什么 / memories」→ `list_recent_memories`（不要猜 memory/ 路径，也不要用通用 AI 记忆科普作答）",
    "- 「最近动态 / 最近记了什么 / stream」→ `list_recent_stream`",
    "- 「待办 / 清单 / todos」→ `list_todos`",
    "- 「收件箱 / inbox」→ `list_inbox`；「交付 / outputs」→ `list_outputs`",
    "- 「搜一下 / 搜索 / 查一下 X / 最新的 X」（工作区外知识）→ `web_search`，命中后 `fetch_url` 取全文",
    "以上查询命中时：先调工具，把查到的真实条目作为回答；工具空则如实说「目前没有」。",
    "",
    "### 外部检索与引用（研究类回合）",
    "1. 需要最新/事实/文档时先 `web_search` 找候选来源。",
    "2. 对 1–3 个高相关链接 `fetch_url` 取正文；工具结果里的 URL 是**来源回执**。",
    "3. 回答时在关键论断旁标注来源（标题 + URL）；不确定就写「据 [来源]」。",
    "4. 工作区已有材料优先于联网；引用工作区文件用路径回执，引用网页用 URL 来源。",
    "5. 禁止编造 URL 或文献；没搜到就说没有，不要用训练数据冒充实时事实。",
    "",
    "### 深度研究（多跳 search → fetch → 交叉引用）",
    "适用：调研 / 对比 / 综述 / 需要多方印证的任务。**预算**：搜索 ≤3 轮 · 抓取 ≤5 页 · 单页截断即可。",
    "1. **规划**：把用户问题拆成 2–4 个可检索子问题（写进 [PLAN] 或心里）。",
    "2. **第一跳**：对每个子问题 `web_search`，按 score 选来源（官方/edu/gov/权威媒体优先）。",
    "3. **深读**：`fetch_url` 1–3 篇互补来源（同域去重，跨域交叉）。",
    "4. **补搜**：发现证据缺口或矛盾时，改写关键词再 `web_search` 一轮（最多 3 轮）。",
    "5. **交叉引用**：关键论断至少 2 个独立来源印证；单源写「据 [来源]」；冲突并列呈现。",
    "6. **落库（可选）**：用户要求保存时 `capture_url` 一键入库（带 source URL）。",
    "7. **收尾**：结论 + 来源列表（标题+URL）+ 证据缺口说明。禁止单源绝对化断言。",
    "",
    "### 自动驾驶（把活干完再停）",
    "- 任务回合：目标未达成就继续调工具，不要中途问用户「要继续吗」。",
    "- 工具失败：改参数重试一次；仍失败才告知原因并给出替代路径。",
    "- 需要用户决策/授权时用 `[NEEDS-USER 简短原因]`，除此之外一路干到底。",
    "- 收尾必须验收（done-when 逐条对照），禁止「我觉得差不多了」。",
    "",
    "1. 规划（**仅任务回合**，且需要 2 步以上工具、或多段交付物时，先做且仅做一次）：输出下面块后立即继续执行，禁止停在计划：",
    `${PLAN_OPEN}`,
    "goal: 一句话目标",
    "steps: 1) … 2) … 3) …",
    "done-when:",
    "- 可观察的验收项 1",
    "- 可观察的验收项 2",
    PLAN_CLOSE,
    "2. 执行：用工具推进；步骤可逆优先；工具结果里留下路径回执。",
    "3. 收尾前验收：对照 done-when 逐项核对文件/路径；任一项未达成就继续做，禁止宣布完成。",
    "4. 仅当全部验收达成（或明确受阻）才收尾。用户可见结论：结论 + 路径回执 + `[DONE]`，或 `[INCOMPLETE 原因]`。路径回执=真实文件路径，不要把「第 1 步：识别意图」这类叙述当回执。",
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
