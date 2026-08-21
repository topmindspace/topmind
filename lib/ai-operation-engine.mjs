// ── topmind AI Operation Engine (Unified) ─────────────────────────────────
// 
// Provides a registry-based framework for AI operations that:
// - Scan workspace data → Plan changes → Execute via writeback-engine
// - Track processed state to avoid redundant AI calls
// - Support force re-processing (clear state + re-run)
// - Are extensible via registration (no engine changes for new types)
//
// Design principles:
// 1. Each operation type owns its domain logic (scan/plan/execute)
// 2. The engine provides the framework (registry, state, lifecycle)
// 3. State tracking is per-domain (todo state in todo.md, others in .ai-ops.json)
// 4. All writes go through writeback-engine (the write gate)
// 5. Operations can be auto-execute or require confirmation
//
// Relationship to existing engines:
// - todo-engine.mjs: maintainTodos/extractTodos → registered as operation types
// - suggest-engine.mjs: generateSuggestions/applySuggestion → coexists (suggestions
//   are the "confirm" path; operations are the "auto-execute" path)
// - lifecycle-engine.mjs: scanLifecycle → feeds into workspace_health operation
//
// Anti-re-processing strategy (unified):
// - processedScope: periods/paths that have been analyzed
// - contentHashes: content fingerprints for change detection
// - lastRun: timestamp for time-decay decisions
// - force option: clears state for a scope before re-running

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadContract } from "./contract-engine.mjs";
import { ensureTodoFile, readTodoList, writeTodoList, maintainTodos } from "./todo-engine.mjs";
import {
  resolveActivityWindow,
  buildActivityCorpus,
  periodItemsFromWindow,
  isSafePeriodStem,
  SUGGEST_CORPUS_MAX_CHARS,
} from "./activity-window.mjs";
import {
  resolveWorkspaceModel,
  sanitizeCategorySegment,
  isValidCategoryName,
  TOPIC_DISALLOWED_ROLES,
} from "./workspace-model.mjs";
import { readProfileActiveBody, readGlobalMemory, resolveProfileSectionTitle, periodMemoryRelPath } from "./memory-engine.mjs";
import { resolveAiLocale, resolveProductAiLanguage } from "./ai-content-sanitize.mjs";

/**
 * Load user profile content for AI context — gives memory_organize AI awareness
 * of what's already known, enabling it to identify truly new information.
 * Archived facts are collapsed to a count line: they are not current truth and
 * must not crowd active sections out of the prompt budget.
 * @param {string} workspaceRoot
 * @returns {string}
 */
function loadProfileForPrompt(workspaceRoot) {
  try {
    const c = readProfileActiveBody(workspaceRoot);
    if (!c) return "";
    return c.length > 3000 ? c.slice(0, 3000) + "\n...(截断)" : c;
  } catch { return ""; }
}

/** @typedef {{ generate: (prompt: string, context?: object) => Promise<string> }} AiProvider */

/**
 * @typedef {Object} OperationResult
 * @property {boolean} ok
 * @property {string} [reason] — "already-processed" | "no-changes" | "no-ai-provider" | "ai-failed" | "no-scope" | "needs-confirm" | "failed"
 * @property {Array} changes — what was changed (type-specific shape)
 * @property {string} summary — human-readable summary
 * @property {Object} [scope] — what was processed
 * @property {string[]} [scope.periods]
 * @property {string[]} [scope.paths]
 * @property {string} [targetPath] — main file affected
 * @property {Array} [suggestions] — for confirm-mode operations
 * @property {string} [period] — source period (if applicable)
 */

/**
 * @typedef {Object} OperationContext
 * @property {string} workspaceRoot
 * @property {string} [engineRoot]
 * @property {object} [contract]
 * @property {AiProvider} [aiProvider]
 * @property {{ force?: boolean, depth?: number, confirmed?: boolean, scope?: object }} [options]
 */

/**
 * @typedef {Object} OperationType
 * @property {string} id — unique identifier (e.g., "todo_maintain")
 * @property {string} label — display label
 * @property {string} domain — "todo" | "memory" | "topic" | "workspace"
 * @property {string} description — what it does
 * @property {boolean} requiresConfirm — auto-execute vs suggestion strip
 * @property {boolean} [disabled] — if true, not listed in listOperationTypes (placeholder/experimental)
 * @property {number} [defaultDepth] — how many periods/files to scan
 * @property {(ctx: OperationContext) => Promise<OperationResult>} run — main execution
 * @property {(ctx: OperationContext) => object} [getState] — current processing state
 * @property {(ctx: OperationContext, scope?: object) => void} [clearState] — clear state for re-processing
 */

// ── Registry ──────────────────────────────────────────────────────────────

/** @type {Map<string, OperationType>} */
const REGISTRY = new Map();

/**
 * Register an operation type.
 * @param {OperationType} def
 */
export function registerOperationType(def) {
  if (!def?.id) throw new Error("Operation type requires id");
  if (REGISTRY.has(def.id)) {
    // Allow re-registration (hot reload / testing)
  }
  REGISTRY.set(def.id, def);
}

/**
 * List all registered operation types (for UI / discovery).
 * @param {object} [contract] — when given, `agent.ai_ops.disabled` entries are hidden
 * @returns {Array<{ id: string, label: string, domain: string, description: string, requiresConfirm: boolean }>}
 */
export function listOperationTypes(contract) {
  const cfg = resolveAiOpsConfig(contract);
  const locale = resolveAiLocale(contract);
  return Array.from(REGISTRY.values())
    .filter((d) => !d.disabled && !cfg.disabled.has(d.id))
    .map((d) => ({
      id: d.id,
      label: d.labelKey ? label(d.labelKey, locale) : d.label,
      domain: d.domain,
      description: d.descKey ? label(d.descKey, locale) : d.description,
      requiresConfirm: d.requiresConfirm ?? false,
    }));
}

/**
 * Workspace-level AI ops config (config-driven registration, no code change):
 * topmind.yaml → agent.ai_ops: { disabled: ["topic_classify"], options: { todo_maintain: { depth: 3 } } }
 * @param {object} [contract]
 * @returns {{ disabled: Set<string>, options: Record<string, object> }}
 */
export function resolveAiOpsConfig(contract) {
  const raw = contract?.agent?.ai_ops;
  const disabled = new Set(
    Array.isArray(raw?.disabled) ? raw.disabled.map(String) : [],
  );
  const options =
    raw?.options && typeof raw.options === "object" && !Array.isArray(raw.options)
      ? raw.options
      : {};
  return { disabled, options };
}

/**
 * Get a registered operation type.
 * @param {string} id
 * @returns {OperationType | undefined}
 */
export function getOperationType(id) {
  return REGISTRY.get(id);
}

// ── Unified State Store ───────────────────────────────────────────────────
// For operations that don't have their own state file (e.g., memory_organize).
// Stored in .topmind/ai-ops.json (system plane — machine state, deletable/rebuildable).
// Todo operations use todo.md frontmatter (existing, not duplicated here).

const AI_OPS_REL_PATH = ".topmind/ai-ops.json";

/**
 * Resolve the AI ops state file path.
 * @param {string} workspaceRoot
 * @returns {string}
 */
function resolveAiOpsPath(workspaceRoot) {
  return path.join(workspaceRoot, AI_OPS_REL_PATH);
}

/**
 * Read the unified AI ops state.
 * @param {string} workspaceRoot
 * @returns {Record<string, object>}
 */
function readAiOpsState(workspaceRoot) {
  try {
    const abs = resolveAiOpsPath(workspaceRoot);
    if (!fs.existsSync(abs)) return {};
    const raw = fs.readFileSync(abs, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Write the unified AI ops state.
 * @param {string} workspaceRoot
 * @param {Record<string, object>} state
 */
function writeAiOpsState(workspaceRoot, state) {
  try {
    const sysDir = path.join(workspaceRoot, ".topmind");
    if (!fs.existsSync(sysDir)) fs.mkdirSync(sysDir, { recursive: true });
    const abs = resolveAiOpsPath(workspaceRoot);
    // Atomic tmp+rename: a crash mid-write must not leave truncated JSON that
    // silently resets every op to "not yet processed".
    const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmp, abs);
  } catch {
    // Non-critical: state is best-effort
  }
}

/**
 * Get state for a specific operation type.
 * @param {string} workspaceRoot
 * @param {string} opId
 * @returns {object}
 */
export function getOpState(workspaceRoot, opId) {
  const state = readAiOpsState(workspaceRoot);
  return state[opId] || {};
}

/**
 * Set state for a specific operation type.
 * @param {string} workspaceRoot
 * @param {string} opId
 * @param {object} opState
 */
export function setOpState(workspaceRoot, opId, opState) {
  const state = readAiOpsState(workspaceRoot);
  state[opId] = { ...opState, lastRun: new Date().toISOString() };
  writeAiOpsState(workspaceRoot, state);
}

/**
 * Clear state for a specific operation type (force re-process).
 * @param {string} workspaceRoot
 * @param {string} opId
 * @param {object} [scope] — optional scope to clear (if undefined, clears all)
 */
export function clearOpState(workspaceRoot, opId, scope) {
  const state = readAiOpsState(workspaceRoot);
  if (!scope) {
    delete state[opId];
  } else {
    const opState = state[opId] || {};
    if (scope.periods && opState.processedPeriods) {
      opState.processedPeriods = opState.processedPeriods.filter(
        (p) => !scope.periods.includes(p),
      );
    }
    if (scope.paths && opState.contentHashes) {
      for (const p of scope.paths) {
        delete opState.contentHashes[p];
      }
    }
    state[opId] = opState;
  }
  writeAiOpsState(workspaceRoot, state);
}

// ── Content Hash Helpers ──────────────────────────────────────────────────

/**
 * Compute a content hash for change detection (same algo as todo-engine).
 * @param {string} content
 * @returns {string}
 */
export function contentHash(content) {
  return createHash("sha1").update(String(content || "")).digest("hex").slice(0, 16);
}


// ── Engine Run ────────────────────────────────────────────────────────────

/**
 * Run an AI operation by type id.
 * 
 * Lifecycle:
 * 1. Look up operation type
 * 2. Call run() — the type handles its own scan/plan/execute
 * 3. Return unified result
 * 
 * The `force` option in options tells the operation to clear its state
 * and re-process from scratch.
 * 
 * @param {object} params
 * @param {string} params.id — operation type id
 * @param {string} params.workspaceRoot
 * @param {string} [params.engineRoot]
 * @param {object} [params.contract]
 * @param {AiProvider} [params.aiProvider]
 * @param {{ force?: boolean, depth?: number, confirmed?: boolean, scope?: object }} [params.options]
 * @returns {Promise<OperationResult>}
 */
export async function runOperation({ id, workspaceRoot, engineRoot, contract, aiProvider, options = {} }) {
  const def = REGISTRY.get(id);
  if (!def) {
    return {
      ok: false,
      reason: "unknown-operation",
      changes: [],
      summary: `Unknown operation: ${id}`,
    };
  }

  const resolvedContract = contract || loadContract(workspaceRoot);
  // Config-driven gating: workspace can disable an op via agent.ai_ops.disabled
  const cfg = resolveAiOpsConfig(resolvedContract);
  if (def.disabled || cfg.disabled.has(id)) {
    return {
      ok: false,
      reason: "operation-disabled",
      changes: [],
      summary: `Operation disabled: ${id}`,
    };
  }
  // Workspace default options (agent.ai_ops.options[id]); explicit call options win
  const mergedOptions = { ...(cfg.options[id] || {}), ...options };
  /** @type {OperationContext} */
  const ctx = {
    workspaceRoot,
    engineRoot,
    contract: resolvedContract,
    aiProvider,
    options: mergedOptions,
    localeOverride: options?.localeOverride,
  };

  // If force is requested, clear state before running
  if (mergedOptions.force && def.clearState) {
    def.clearState(ctx, mergedOptions.scope);
  }

  try {
    const result = await def.run(ctx);
    return result;
  } catch (err) {
    return {
      ok: false,
      reason: "failed",
      changes: [],
      summary: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Get the current state of an operation (for UI display).
 * @param {string} workspaceRoot
 * @param {string} opId
 * @returns {object}
 */
export function getOperationState(workspaceRoot, opId) {
  const def = REGISTRY.get(opId);
  if (!def) return {};

  // If the type has its own getState, use it (e.g., todo reads from todo.md)
  if (def.getState) {
    try {
      return def.getState({ workspaceRoot });
    } catch {
      return {};
    }
  }

  // Fall back to unified state store
  return getOpState(workspaceRoot, opId);
}

/**
 * Clear the state of an operation (for force re-processing).
 * @param {string} workspaceRoot
 * @param {string} opId
 * @param {object} [scope]
 */
export function clearOperationState(workspaceRoot, opId, scope) {
  const def = REGISTRY.get(opId);
  if (!def) return;

  if (def.clearState) {
    def.clearState({ workspaceRoot }, scope);
  } else {
    clearOpState(workspaceRoot, opId, scope);
  }
}

// ── Auto-registration of operation types ───────────────────────────────
// This runs on module load to register built-in operation types.
// This design avoids circular dependencies in ESM: ai-operation-engine
// imports other engines (todo-engine, contract-engine) to register their types.

// NOTE: Labels are Chinese (default locale). When the Desktop builds an AI operations
// UI panel, it should provide its own i18n overlay for these labels/descriptions
// rather than relying on engine-level strings. The engine is locale-agnostic.
const I18N = {
  zh: {
    todoMaintain: "AI 维护待办",
    todoMaintainDesc: "从动态提取新待办 · 检测完成 · 更新状态",
    memoryOrganize: "AI 整理我的情况",
    memoryOrganizeDesc: "从近期活动提取稳定信息 →「我的情况」与周期反思（非专题）",
    topicClassify: "AI 建议专题",
    topicClassifyDesc: "从近期活动建议在内容大类下建立/归入专题（不进 memory）",
  },
  en: {
    todoMaintain: "AI Maintain Todos",
    todoMaintainDesc: "Extract new todos from stream · detect completion · update status",
    memoryOrganize: "AI Organize My profile",
    memoryOrganizeDesc: "Extract stable info from recent activity → profile & periodic reflection (not topics)",
    topicClassify: "AI Suggest Topics",
    topicClassifyDesc: "Suggest creating/joining topics under content categories from recent activity (not memory)",
  },
};

/**
 * Get locale-aware label.
 * @param {string} key
 * @param {"en"|"zh"} [locale="zh"]
 * @returns {string}
 */
function label(key, locale = "zh") {
  return (I18N[locale] || I18N.zh)[key] || (I18N.zh)[key] || key;
}

/**
 * @param {OperationContext} ctx
 * @returns {{ corpus: string, fingerprint: string, primaryPeriod: string|null, paths: string[], categories: Array<{ directory: string, role: string, name: string }> }}
 */
function loadOpActivity(ctx) {
  const window = resolveActivityWindow({
    workspaceRoot: ctx.workspaceRoot,
    engineRoot: ctx.engineRoot,
    contract: ctx.contract,
    options: {
      minContentLength: 10,
      loadContent: true,
    },
  });
  // Exclude the memory plane (this engine writes profile/periodic): its own
  // writes must not re-trigger runs, and profile enters prompts separately.
  const items = window.items.filter((i) => i.kind !== "memory" && !String(i.relPath || "").startsWith("memory/"));
  const corpus = buildActivityCorpus({ ...window, items }, { maxChars: SUGGEST_CORPUS_MAX_CHARS });
  const periods = periodItemsFromWindow(window);
  const primaryPeriod = isSafePeriodStem(periods[0]?.period) ? periods[0].period : null;
  const paths = items.map((i) => i.relPath);
  // Content hash only — mtime noise (re-saves, sync tools) must not re-run ops.
  const fingerprint = contentHash(
    items.map((i) => {
      const ch = contentHash(i.content || "");
      return `${i.relPath}:${ch}`;
    }).join("|"),
  );
  /** @type {Array<{ directory: string, role: string, name: string }>} */
  let categories = [];
  try {
    const model = resolveWorkspaceModel({
      workspaceRoot: ctx.workspaceRoot,
      engineRoot: ctx.engineRoot,
      config: ctx.contract,
    });
    // Topic parents: first-level content categories only.
    // Align with TOPIC_DISALLOWED_ROLES / sanitizeTopicPlacement role gate.
    const skipRoles = new Set(TOPIC_DISALLOWED_ROLES);
    categories = (model.categories || [])
      .filter((c) => c.directory && !skipRoles.has(c.role))
      .map((c) => ({
        directory: c.directory,
        role: c.role || "deep-work",
        name: c.name || c.directory,
      }));
  } catch {
    categories = [];
  }
  return { corpus, fingerprint, primaryPeriod, paths, categories };
}

// Register todo_maintain
registerOperationType({
id: "todo_maintain",
labelKey: "todoMaintain",
domain: "todo",
descKey: "todoMaintainDesc",
requiresConfirm: false,
defaultDepth: 2,
  async run(ctx) {
    const { workspaceRoot, engineRoot, contract, aiProvider, options } = ctx;
    const resolvedContract = contract || loadContract(workspaceRoot);

    const result = await maintainTodos({
      workspaceRoot,
      engineRoot,
      contract: resolvedContract,
      aiProvider,
      options,
    });

    const parts = [];
    if (result.added?.length > 0) parts.push(`新增 ${result.added.length} 条`);
    if (result.completed?.length > 0) parts.push(`完成 ${result.completed.length} 条`);
    if (result.updated?.length > 0) parts.push(`更新 ${result.updated.length} 条`);

    return {
      ok: result.ok,
      reason: result.reason,
      changes: [...(result.added || []), ...(result.completed || []), ...(result.updated || [])],
      summary: parts.length > 0 ? `${parts.join(" · ")}（来自 ${result.period || "未知周期"}）` : "无变化",
      scope: { periods: [result.period].filter(Boolean) },
      targetPath: result.targetPath,
      period: result.period,
      added: result.added,
      completed: result.completed,
      updated: result.updated,
    };
  },
  getState(ctx) {
    const existing = readTodoList(ctx.workspaceRoot);
    return {
      processedPeriods: existing?.processedPeriods || [],
      dismissed: existing?.dismissed || [],
      lastRun: existing?.lastRun || null,
    };
  },
  clearState(ctx, scope) {
    const existing = readTodoList(ctx.workspaceRoot);
    let processedPeriods = existing?.processedPeriods || [];
    let processedHashes = { ...(existing?.processedHashes || {}) };

    if (scope?.periods) {
      // Clear specific periods + their corpus hashes
      const clear = new Set(scope.periods);
      processedPeriods = processedPeriods.filter((p) => !clear.has(p));
      for (const p of clear) delete processedHashes[p];
    } else {
      // No specific scope → clear all (force re-process everything)
      processedPeriods = [];
      processedHashes = {};
    }

    writeTodoList(ctx.workspaceRoot, existing?.items || [], ctx.contract, {
      prevContent: existing?.rawContent,
      actor: "user",
      processedPeriods,
      processedHashes,
      dismissed: existing?.dismissed || [],
      dismissedAt: existing?.dismissedAt || {},
      dismissedTexts: existing?.dismissedTexts || {},
    });
  },
});

// Register memory_organize — profile + periodic only (confirm). Never topic folders.
registerOperationType({
id: "memory_organize",
labelKey: "memoryOrganize",
domain: "memory",
descKey: "memoryOrganizeDesc",
requiresConfirm: true,
disabled: false,
  defaultDepth: 4,
  async run(ctx) {
    const { aiProvider, options } = ctx;
    if (!aiProvider || typeof aiProvider.generate !== "function") {
      return {
        ok: false,
        reason: "no-ai-provider",
        changes: [],
        summary: "需要配置 AI 才能整理我的情况",
      };
    }
    const act = loadOpActivity(ctx);
    if (!act.corpus || act.corpus.length < 40) {
      return {
        ok: false,
        reason: "no-scope",
        changes: [],
        summary: "近期活动窗口为空",
      };
    }
    const opState = getOpState(ctx.workspaceRoot, "memory_organize");
    if (!options?.force && opState.contentHashes?.activity === act.fingerprint) {
      return {
        ok: true,
        reason: "already-processed",
        changes: [],
        summary: "活动窗口未变化，跳过",
        suggestions: [],
      };
    }

    const profileCtx = loadProfileForPrompt(ctx.workspaceRoot);
    const locale = resolveProductAiLanguage({
      uiLocale: ctx.localeOverride ?? options?.localeOverride ?? options?.uiLocale,
      contract: ctx.contract,
      userText: options?.userText,
    });
    const profileSection = profileCtx
      ? (locale === "en"
        ? `\n## Existing User Profile (memory/profile)\n---\n${profileCtx}\n---\n\nOnly extract information NOT already in the profile above.\n`
        : `\n## 已有用户画像（memory/profile）\n---\n${profileCtx}\n---\n\n只提取上述画像中尚未包含的新信息。\n`)
      : "";
    const prompt = locale === "en"
      ? `Extract "My profile / period reflection" candidates from the following recent activity materials. Include only:
1) Stable information worth writing to "My profile" (memory/profile) — focus on NEW facts not already in the profile
2) Period highlights worth writing to period reflection (memory/periodic) — insights, not event summaries
3) Retire candidates — facts ALREADY in the existing profile above that the materials show are finished, obsolete, or no longer true (quote each fact verbatim or near-verbatim from the profile; max 3; empty array if none)
Do NOT suggest creating topics or writing to memory/topics.
${profileSection}
Materials:
---
${act.corpus}
---

Analyze the full semantic context of the materials. Do not simply match keywords —
understand what the user is doing, thinking, and changing, and extract genuine
insights about their preferences, goals, and patterns.

Output strictly JSON (no markdown fences, no thinking process, no thinking tags, no prefix/suffix):
{
  "profile": ["new stable fact not in existing profile", ...],
  "periodic": "an 80-200 word period reflection focusing on insights and patterns, not event recap (can be empty string)",
  "retire": ["existing profile fact that is now finished/stale (quote from the profile above)", ...]
}
Output content in English.`
      : `请从以下近期活动材料中整理「我的情况 / 周期反思」候选。只包含：
1) 值得写入「我的情况」(memory/profile) 的稳定信息——重点关注已有画像中尚未包含的新事实
2) 值得写入周期反思 (memory/periodic) 的阶段要点——洞察与模式，不是事件摘要
3) 可归档候选——上方已有画像中已被材料证明「已完成 / 已过期 / 不再成立」的条目（逐字或近似引用画像原文；最多 3 条；没有则空数组）
不要建议创建专题或写入 memory/topics。
${profileSection}
材料：
---
${act.corpus}
---

分析材料的完整语义上下文。不要简单匹配关键字——
理解用户在做什么、想什么、有什么变化，提取关于其偏好、目标和模式的真正洞察。

请严格输出 JSON（不要 markdown 围栏、不要思考过程、不要 thinking 标签、不要前缀后缀语）：
{
  "profile": ["已有画像中尚无的新稳定事实", ...],
  "periodic": "一段 80-200 字的周期反思，关注洞察与模式，不是事件回顾（可空字符串）",
  "retire": ["画像中已完成/已过期的条目（引用画像原文）", ...]
}
用中文输出内容。`;

    let raw = "";
    try {
      raw = await aiProvider.generate(prompt, {
        workspaceRoot: ctx.workspaceRoot,
        operation: "memory_organize",
        period: act.primaryPeriod,
        sourcePath: "activity-window",
      });
    } catch {
      return { ok: false, reason: "ai-failed", changes: [], summary: "AI 调用失败" };
    }

    let profile = [];
    let periodic = "";
    let retire = [];
    // Import sanitize at call site to avoid circular deps with memory/suggest.
    // Parse tool JSON from *raw* first — whole-payload sanitize would wipe JSON dumps.
    // Then sanitize each extracted string field (never write raw thinking/JSON as body).
    const {
      isPlaceholderOrPolluted,
      sanitizeAiContent,
      validateAiOutput,
    } = await import("./ai-content-sanitize.mjs");
    try {
      const jsonMatch = String(raw || "").match(/\{[\s\S]*\}/u);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
      profile = Array.isArray(parsed.profile)
        ? parsed.profile
            .filter((s) => typeof s === "string" && s.trim().length > 2)
            .map((s) => sanitizeAiContent(s))
            .filter((s) => s && !isPlaceholderOrPolluted(s))
            .slice(0, 5)
        : [];
      const perRaw = typeof parsed.periodic === "string" ? parsed.periodic : "";
      const perUsable = validateAiOutput(perRaw, "memory", { minLength: 10 });
      periodic = perUsable.ok ? perUsable.text : "";
      retire = Array.isArray(parsed.retire)
        ? parsed.retire
            .filter((s) => typeof s === "string" && s.trim().length > 2)
            .map((s) => sanitizeAiContent(s))
            .filter((s) => s && !isPlaceholderOrPolluted(s))
            .slice(0, 3)
        : [];
    } catch {
      // Soft parse: only clean bullet lines — never inject raw thinking/JSON dumps as profile
      const salvaged = validateAiOutput(raw, "profile-lines", {
        max: 3,
        minLen: 3,
        maxLen: 200,
      });
      profile = salvaged.ok ? salvaged.lines : [];
      periodic = "";
    }

    const day = new Date().toISOString().slice(0, 10);
    const inProgressSection = resolveProfileSectionTitle(
      readGlobalMemory(ctx.workspaceRoot),
      "inProgress",
      locale,
    );
    const copy = locale === "en"
      ? {
          appendTitle: "Write to My profile",
          retireTitle: "Archive a stale My profile fact",
          retireSummary: (s) => `Finished or stale: ${s}`,
          digestTitle: (p) => `Period reflection: ${p}`,
          summarySome: (n) => `Generated ${n} memory suggestion(s) (needs confirm)`,
          summaryNone: "No durable memory candidates",
        }
      : {
          appendTitle: "写入「我的情况」",
          retireTitle: "归档「我的情况」旧条目",
          retireSummary: (s) => `已完成/过期：${s}`,
          digestTitle: (p) => `周期反思：${p}`,
          summarySome: (n) => `生成 ${n} 条记忆建议（待确认）`,
          summaryNone: "未发现可沉淀记忆",
        };
    /** @type {object[]} */
    const suggestions = [];
    for (const line of profile) {
      const cleanLine = line.replace(/^[-*]\s*/u, "").trim();
      if (!cleanLine || isPlaceholderOrPolluted(cleanLine)) continue;
      const entry = `- （${day}）${cleanLine}`;
      suggestions.push({
        id: `mem-profile-${contentHash(cleanLine)}`,
        kind: "promote_memory",
        title: copy.appendTitle,
        summary: cleanLine.slice(0, 100),
        impact: "high",
        targetPath: "memory/profile.md",
        payload: {
          action: "append_profile",
          section: inProgressSection,
          entry: { section: inProgressSection, content: entry },
        },
      });
    }
    if (periodic.length > 10 && !isPlaceholderOrPolluted(periodic) && isSafePeriodStem(act.primaryPeriod)) {
      const period = act.primaryPeriod;
      const sourcePath = act.paths.find((p) => isSafePeriodStem(path.basename(String(p || ""), ".md"))) || "";
      suggestions.push({
        id: `mem-periodic-${period}`,
        kind: "ai_summary",
        title: copy.digestTitle(period),
        summary: periodic.slice(0, 120),
        impact: "medium",
        targetPath: sourcePath || undefined,
        payload: {
          period,
          sourcePath,
          sourcePaths: act.paths.slice(0, 8),
          analysis: periodic,
          action: "write_digest",
          digestPath: periodMemoryRelPath(period),
        },
      });
    }
    // Retire candidates: profile facts the activity window shows as finished/stale.
    // Confirm-gated — applySuggestion moves the line to the history section; nothing is deleted.
    for (const line of retire) {
      const cleanLine = line.replace(/^[-*]\s*/u, "").trim();
      if (!cleanLine || isPlaceholderOrPolluted(cleanLine)) continue;
      suggestions.push({
        id: `mem-retire-${contentHash(cleanLine)}`,
        kind: "promote_memory",
        title: copy.retireTitle,
        summary: copy.retireSummary(cleanLine.slice(0, 100)),
        impact: "medium",
        targetPath: "memory/profile.md",
        payload: {
          action: "retire_profile",
          match: cleanLine,
        },
      });
    }

    setOpState(ctx.workspaceRoot, "memory_organize", {
      contentHashes: { activity: act.fingerprint },
      lastRun: new Date().toISOString(),
    });

    return {
      ok: true,
      reason: suggestions.length ? "needs-confirm" : "no-changes",
      changes: [],
      suggestions,
      summary:
        suggestions.length > 0
          ? copy.summarySome(suggestions.length)
          : copy.summaryNone,
      scope: { paths: act.paths, periods: act.primaryPeriod ? [act.primaryPeriod] : [] },
    };
  },
  getState(ctx) {
    return getOpState(ctx.workspaceRoot, "memory_organize");
  },
  clearState(ctx) {
    clearOpState(ctx.workspaceRoot, "memory_organize");
  },
});

// Register topic_classify — content categories / topic folders only (never memory plane).
registerOperationType({
id: "topic_classify",
labelKey: "topicClassify",
domain: "topic",
descKey: "topicClassifyDesc",
requiresConfirm: true,
disabled: false,
  defaultDepth: 4,
  async run(ctx) {
    const { aiProvider, options } = ctx;
    if (!aiProvider || typeof aiProvider.generate !== "function") {
      return {
        ok: false,
        reason: "no-ai-provider",
        changes: [],
        summary: "需要配置 AI 才能建议专题",
      };
    }
    const act = loadOpActivity(ctx);
    if (!act.corpus || act.corpus.length < 40) {
      return {
        ok: false,
        reason: "no-scope",
        changes: [],
        summary: "近期活动窗口为空",
      };
    }
    const opState = getOpState(ctx.workspaceRoot, "topic_classify");
    if (!options?.force && opState.contentHashes?.activity === act.fingerprint) {
      return {
        ok: true,
        reason: "already-processed",
        changes: [],
        summary: "活动窗口未变化，跳过",
        suggestions: [],
      };
    }

    // No discovered content categories → nowhere safe to place a topic.
    // Never fabricate a hardcoded category the prompt would then suggest.
    if (act.categories.length === 0) {
      return {
        ok: true,
        reason: "no-changes",
        changes: [],
        suggestions: [],
        summary: "未发现可用的内容大类，跳过专题建议",
        scope: { paths: act.paths },
      };
    }

    const catList = act.categories.map((c) => `- ${c.directory} (role:${c.role})`).join("\n");

    const year = new Date().getFullYear();
    const locale = resolveProductAiLanguage({
      uiLocale: ctx.localeOverride ?? options?.localeOverride ?? options?.uiLocale,
      contract: ctx.contract,
      userText: options?.userText,
    });
    const prompt = locale === "en"
      ? `Based on the recent activity materials, suggest topics to create or join under content categories (filesystem topic folders).
Rules:
- Topic path format: {category}/{YYYY-topic-name}/
- Do NOT write to memory/ or memory/topics
- Category must be one of the directories listed below
- At most 3 suggestions; if no clear themes, return empty array

Available categories:
${catList}

Materials:
---
${act.corpus}
---

Output strictly JSON array (no markdown fences, no thinking process, no thinking tags):
[
  { "category": "20-Topics", "name": "${year}-example-topic", "title": "Example Topic", "reason": "one-sentence reason" }
]
Output content in English.`
      : `请根据近期活动材料，建议在「内容大类」下建立或归入的专题（文件系统专题夹）。
规则：
- 专题路径形态：{大类目录}/{YYYY-主题名}/
- 不要写入 memory/ 或 memory/topics
- 大类必须来自下列目录之一
- 最多 3 条；若无明显主题则返回空数组

可选大类：
${catList}

材料：
---
${act.corpus}
---

严格输出 JSON 数组（不要 markdown 围栏、不要思考过程、不要 thinking 标签）：
[
  { "category": "20-专题", "name": "${year}-示例主题", "title": "示例主题", "reason": "一句话理由" }
]
用中文输出内容。`;

    let raw = "";
    try {
      raw = await aiProvider.generate(prompt, {
        workspaceRoot: ctx.workspaceRoot,
        operation: "topic_classify",
        period: act.primaryPeriod,
        sourcePath: "activity-window",
      });
    } catch {
      return { ok: false, reason: "ai-failed", changes: [], summary: "AI 调用失败" };
    }

    /** @type {Array<{ category: string, name: string, title?: string, reason?: string }>} */
    let topics = [];
    try {
      const arrMatch = raw.match(/\[[\s\S]*\]/u);
      const parsed = JSON.parse(arrMatch ? arrMatch[0] : raw);
      if (Array.isArray(parsed)) {
        topics = parsed
          .filter((t) => t && typeof t.category === "string" && typeof t.name === "string")
          .slice(0, 3);
      }
    } catch {
      topics = [];
    }

    // Sanitize category: single segment, no `..`; map onto known workspace categories.
    // Never emit raw AI multi-path / traversal categories into create_topic payload.
    const catDirs = new Set(
      (act.categories || []).map((c) => c.directory).filter(Boolean),
    );
    const deepFallback =
      act.categories.find((c) => c.role === "deep-work")?.directory ||
      act.categories[0]?.directory ||
      "";
    const suggestions = [];
    for (const t of topics) {
      let category = sanitizeCategorySegment(t.category);
      if (catDirs.size > 0) {
        if (!category || !catDirs.has(category)) {
          category = deepFallback;
        }
      } else if (!category || !isValidCategoryName(category)) {
        // No discovered categories — cannot safely place a topic
        continue;
      }
      if (!category) continue;

      let name = String(t.name || "").trim().replace(/\\/g, "/");
      if (name.includes("..") || path.isAbsolute(name)) continue;
      name = name.replace(/[\\/]/g, "-").replace(/\.\./g, "").slice(0, 80);
      if (!/^\d{4}-.+/u.test(name)) {
        name = `${year}-${name.replace(/^\d{4}-/u, "")}`;
      }
      if (!name || name.length < 6 || name.includes("..")) continue;
      const title = String(t.title || name.replace(/^\d{4}-/u, "")).trim();
      const reason = String(t.reason || "").trim();
      // Final containment check for payload paths
      const rel = `${category}/${name}`;
      if (rel.includes("..") || path.isAbsolute(rel)) continue;
      suggestions.push({
        id: `topic-${contentHash(rel)}`,
        kind: "create_topic",
        title: locale === "en" ? `Suggested topic: ${title}` : `建议专题：${title}`,
        summary: reason || (locale === "en"
          ? `Create ${name} under ${category}`
          : `在 ${category} 下创建 ${name}`),
        targetPath: rel,
        impact: "high",
        payload: {
          category,
          name,
          title,
          reason,
          action: "create_topic",
        },
      });
    }

    setOpState(ctx.workspaceRoot, "topic_classify", {
      contentHashes: { activity: act.fingerprint },
      lastRun: new Date().toISOString(),
    });

    return {
      ok: true,
      reason: suggestions.length ? "needs-confirm" : "no-changes",
      changes: [],
      suggestions,
      summary:
        suggestions.length > 0
          ? (locale === "en"
            ? `Generated ${suggestions.length} topic suggestion(s) (needs confirm)`
            : `生成 ${suggestions.length} 条专题建议（待确认 · 内容大类）`)
          : (locale === "en"
            ? "No topic worth creating"
            : "未发现值得建立的专题"),
      scope: { paths: act.paths },
    };
  },
  getState(ctx) {
    return getOpState(ctx.workspaceRoot, "topic_classify");
  },
  clearState(ctx) {
    clearOpState(ctx.workspaceRoot, "topic_classify");
  },
});
