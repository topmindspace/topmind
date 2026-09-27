/** v4 AiService — sessions + invoke + one-shot complete (inline edit). */
import { promises as fs } from "node:fs";
import path from "node:path";
import { generateText } from "ai";
import { readJson, writeText, ensureDir, readText } from "./lib/fs-utils.mjs";
import { logInfo, logError, logWarn } from "./lib/writeback.mjs";
import { buildSystemPrompt, assembleContext, resolvePromptLocale } from "./ai-prompts.mjs";
import { createStreamRegistry, runStream } from "./ai-stream.mjs";
import { resolveModel, getRuntimeStatus, noteAgentLoop } from "./ai-model.mjs";
import { resolveDataRoot } from "./lib/path-model.mjs";
import { t as ei18n } from "./lib/electron-i18n.mjs";
import { assertPathWithin } from "./lib/path-safety.mjs";
import { loadAppSettings } from "./settings.mjs";
import { compactMessagesForModel, resolveCompactBudget } from "./lib/ai-session-compact.mjs";
import { sanitizeInlineAiResult } from "./lib/inline-ai-result.mjs";
import { rememberDistillHint } from "./lib/ai-tool-evidence.mjs";
import {
  applyGoalUpdate,
  assessGoalCompletion,
  buildContinuePrompt,
  buildGoalEvaluatorPrompt,
  buildTaskLedger,
  decideAutoContinue,
  harvestPathReceipts,
  mergeRunGoal,
  parseGoalEvaluatorResult,
  prepareTurnGoal,
  reconcileGoalVerdicts,
  rejectBareDone,
  resolveMaxAutoContinues,
} from "./lib/agent-goal-protocol.mjs";
import {
  INLINE_SYSTEM,
  buildInlineCompletePrompt,
  resolveCompleteMaxTokens,
} from "./lib/inline-complete-prompt.mjs";

export { getRuntimeStatus };
// Re-export pure assembly for tests / callers that want the same path without generateText
export { INLINE_SYSTEM, buildInlineCompletePrompt, resolveCompleteMaxTokens } from "./lib/inline-complete-prompt.mjs";
export { resolvePromptLocale } from "./ai-prompts.mjs";

/**
 * Chrome / system-prompt shell language. UI locale when the user picked one;
 * otherwise workspace locale. Not used as a content force.
 * @param {object} [settings]
 * @param {object} [c]
 * @returns {Promise<"zh"|"en">}
 */
async function resolveChromeLocale(settings, c) {
  const uiLocale = settings?.ui?.locale;
  if (uiLocale && uiLocale !== "auto") {
    return resolvePromptLocale(uiLocale);
  }
  try {
    const { loadKernelApi, workspaceRootOf } = await import("./lib/kernel-api.mjs");
    const root = workspaceRootOf(c?.workspaceRoot);
    if (root) {
      const kernel = await loadKernelApi();
      const contract = kernel.loadContract(root);
      const loc = contract?.workspace?.locale || contract?.locale;
      if (loc) return resolvePromptLocale(loc);
    }
  } catch {
    /* contract unavailable — fall through */
  }
  return "zh";
}

/**
 * 3-tier language for user-visible / durable model text (same function Kernel uses).
 * Agent turns pass focusPath + mountedFiles; inline complete passes editedSpan/sourceText.
 * Profile / overview are never source.
 * @param {{
 *   userText?: string,
 *   sourceText?: string,
 *   editedSpan?: string,
 *   focusPath?: string,
 *   mountedFiles?: Array<{ name?: string, path?: string, content?: string }>,
 *   c?: object,
 * }} opts
 * @returns {Promise<"zh"|"en">}
 */
async function resolveDurableOutputLocale({
  userText,
  sourceText,
  editedSpan,
  focusPath,
  mountedFiles,
  c,
} = {}) {
  try {
    const { loadKernelApi, workspaceRootOf } = await import("./lib/kernel-api.mjs");
    const kernel = await loadKernelApi();
    const root = workspaceRootOf(c?.workspaceRoot);
    let contract;
    if (root && typeof kernel.loadContract === "function") {
      try {
        contract = kernel.loadContract(root);
      } catch {
        contract = undefined;
      }
    }
    if (typeof kernel.resolveAgentOutputLanguage === "function") {
      return kernel.resolveAgentOutputLanguage({
        userText,
        sourceText,
        editedSpan,
        focusPath,
        mountedFiles,
        contract,
      });
    }
    if (typeof kernel.resolveOutputLanguage === "function") {
      return kernel.resolveOutputLanguage({ userText, sourceText, editedSpan, contract });
    }
  } catch {
    /* kernel unavailable — fall through */
  }
  return "zh";
}

/** In-flight inline complete requests — abortSignal for true cancel. */
const completeControllers = new Map();

function isAbortError(err) {
  if (!err) return false;
  if (err.name === "AbortError") return true;
  const msg = String(err.message || err || "");
  return /abort|cancel|已取消/iu.test(msg);
}

/** Load settings with secret decryption — must be used instead of raw readJson
 * because API keys are encrypted via safeStorage and stored in secureStorage.manual.
 * Raw readJson sees empty key strings and reports "not configured". */
async function loadSettingsWithSecrets(c) {
  return loadAppSettings(
    c.workspaceStatePaths.settingsFilePath,
    c.workspaceRoot?.userWorkspaceRoot || "",
    { secretAdapter: c.secretAdapter },
  );
}

const sr = createStreamRegistry();

/**
 * Resolve mounted file references (workspace-relative path strings) into
 * `{ name, content }` records by reading each file from disk with path-safety
 * containment. Unreadable / out-of-root entries are skipped, never fatal.
 */
async function resolveMountedFiles(workspaceContext, refs) {
  if (!Array.isArray(refs) || refs.length === 0) return [];
  const dataRoot = resolveDataRoot(workspaceContext);
  const out = [];
  for (const ref of refs) {
    const rel = typeof ref === "string" ? ref : ref?.path;
    if (!rel) continue;
    try {
      const abs = path.resolve(dataRoot, rel);
      await assertPathWithin(dataRoot, abs, { allowMissing: false });
      out.push({ name: rel, content: await readText(abs) });
    } catch (err) {
      logWarn("ai", "mounted file skipped", { rel, error: err.message });
    }
  }
  return out;
}

async function lst(c) {
  return readJson(c.workspaceStatePaths.aiWorkspaceStateFilePath, { sessions: {}, history: [] });
}
async function sst(c, s) {
  await writeText(c.workspaceStatePaths.aiWorkspaceStateFilePath,
    JSON.stringify({ ...s, updatedAt: new Date().toISOString() }, null, 2));
}
function msgDir(c) { return c.workspaceStatePaths.aiSessionMessagesDirPath; }

/**
 * Validate sessionId shape — reject path separators and `..` so a compromised
 * renderer cannot escape aiSessionMessagesDirPath via crafted ids.
 * @param {string} sessionId
 * @returns {string} sanitized id
 */
function safeSessionId(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id) || id.includes("..")) {
    throw new Error(`Invalid sessionId: ${id}`);
  }
  return id;
}

/** Session-level GoalState persistence (G2) — next to messages JSON. */
function sessionGoalPath(sessionId, c) {
  const id = safeSessionId(sessionId);
  return path.join(msgDir(c), id + ".goal.json");
}

async function loadSessionGoal(sessionId, c) {
  try {
    return await readJson(sessionGoalPath(sessionId, c), null);
  } catch {
    return null;
  }
}

async function saveSessionGoal(sessionId, goalState, c) {
  try {
    await ensureDir(msgDir(c));
    await writeText(
      sessionGoalPath(sessionId, c),
      JSON.stringify({
        goal: goalState?.goal || "",
        plan: goalState?.plan || [],
        criteria: goalState?.criteria || [],
        doneCriteria: goalState?.doneCriteria || [],
        pathReceipts: (goalState?.pathReceipts || []).slice(-24),
        status: goalState?.status || "idle",
        blockReason: goalState?.blockReason || null,
        updatedAt: new Date().toISOString(),
      }, null, 2),
    );
  } catch { /* goal persistence must not break invoke */ }
}

export const AiService = {
  async getRuntimeStatus(_p, c) {
    return getRuntimeStatus(await loadSettingsWithSecrets(c));
  },

  /**
   * One-shot completion for editor AI (selection rewrite / continue / summarize).
   * No tools, no chat session — shares model config with the main AI panel.
   * Pass `requestId` and call `cancelComplete` to abort in-flight generateText.
   * Pass `documentText` so polish/format match whole-file structure (not selection-only).
   * @param {{
   *   text?: string,
   *   instruction?: string,
   *   action?: string,
   *   mode?: "rewrite" | "continue" | "summarize" | "generate",
   *   model?: string,
   *   requestId?: string,
   *   documentText?: string,
   * }} p
   */
  async complete({ text, instruction, action, mode, model, requestId, documentText }, c) {
    const settings = await loadSettingsWithSecrets(c);
    const res = resolveModel(settings, model);
    if (!res) throw new Error("No AI provider configured. Add API keys in Settings.");
    const src = String(text || "").trim();
    const resolvedMode =
      mode ||
      (action === "continue"
        ? "continue"
        : action === "summarize"
          ? "summarize"
          : action === "generate"
            ? "generate"
            : "rewrite");

    if (resolvedMode === "rewrite" || resolvedMode === "summarize") {
      if (!src) throw new Error(ei18n("ai.noSelection"));
    }
    if (src.length > 32_000) throw new Error(ei18n("ai.textTooLong"));

    const locale = await resolveDurableOutputLocale({
      userText: String(instruction || "").trim(),
      editedSpan: src,
      sourceText: documentText != null ? String(documentText) : src,
      c,
    });

    const actionHint = {
      polish: ei18n("ai.polish"),
      shorter: ei18n("ai.shorter"),
      expand: ei18n("ai.expand"),
      bullets: ei18n("ai.bullets"),
      formal: ei18n("ai.formal"),
      casual: ei18n("ai.casual"),
      fix: ei18n("ai.fix"),
      format: ei18n("ai.format"),
      continue: ei18n("ai.continue"),
      summarize: ei18n("ai.summarize"),
      generate: ei18n("ai.generate"),
      translate: ei18n("ai.translate"),
    }[String(action || "")] || "";

    // Default instr is locale-aware inside buildInlineCompletePrompt when empty
    const userInstr = String(instruction || actionHint || "").trim();
    // Pure assembly — same path unit tests drive (whole-doc format context)
    const assembled = buildInlineCompletePrompt({
      text: src,
      mode: resolvedMode,
      userInstr: userInstr || undefined,
      documentText: documentText != null ? String(documentText) : undefined,
      action: action || "",
      locale,
    });
    const prompt = assembled.prompt;

    const rid =
      typeof requestId === "string" && requestId.trim()
        ? requestId.trim().slice(0, 80)
        : `complete-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    // Supersede same id if client retries
    try {
      completeControllers.get(rid)?.abort();
    } catch {
      /* ignore */
    }
    const ac = new AbortController();
    completeControllers.set(rid, ac);

    logInfo("ai", "complete started", {
      model: res.modelId,
      action: action || "custom",
      mode: resolvedMode,
      chars: src.length,
      documentContext: assembled.hasDocumentContext,
      documentContextChars: assembled.documentContextChars,
      requestId: rid,
    });
    try {
      const out = await generateText({
        model: res.model,
        system: assembled.system || INLINE_SYSTEM,
        prompt,
        maxOutputTokens: resolveCompleteMaxTokens(resolvedMode, src.length),
        abortSignal: ac.signal,
      });
      if (ac.signal.aborted) {
        const err = new Error("已取消");
        err.code = "aborted";
        throw err;
      }
      // Prefer provider "text" only — never fold reasoning/thinking fields into apply payload.
      // Some reasoners still leak tags into text; sanitize strips them server-side.
      let result = sanitizeInlineAiResult(out.text || "");
      if (!result) throw new Error("模型返回为空");
      return {
        ok: true,
        text: result,
        model: { modelId: res.modelId },
        usage: out.usage || null,
        requestId: rid,
      };
    } catch (err) {
      if (isAbortError(err) || ac.signal.aborted) {
        logInfo("ai", "complete aborted", { requestId: rid });
        const e = new Error("已取消");
        e.code = "aborted";
        throw e;
      }
      // Self-heal: system message unsupported by model (e.g. o1/o1-mini/deepseek-reasoner) → merge into prompt and retry
      const errMsg = err?.message || String(err);
      const systemPrompt = assembled.system || INLINE_SYSTEM;
      if (systemPrompt && /(?:system|developer).*(?:not supported|unsupported|invalid|role|message)/i.test(errMsg)) {
        logInfo("ai", "complete: system message unsupported by model, self-healing by merging into prompt", {
          model: res.modelId,
          requestId: rid,
        });
        try {
          const healedOut = await generateText({
            model: res.model,
            prompt: `${systemPrompt}\n\n${prompt}`,
            maxOutputTokens: resolveCompleteMaxTokens(resolvedMode, src.length),
            abortSignal: ac.signal,
          });
          let result = sanitizeInlineAiResult(healedOut.text || "");
          if (result) {
            return {
              ok: true,
              text: result,
              model: { modelId: res.modelId },
              usage: healedOut.usage || null,
              requestId: rid,
            };
          }
        } catch (healErr) {
          logWarn("ai", "complete: self-heal retry failed", { error: healErr?.message, requestId: rid });
        }
      }
      logError("ai", "complete failed", { error: err?.message || String(err), requestId: rid });
      throw err;
    } finally {
      completeControllers.delete(rid);
    }
  },

  /**
   * Abort an in-flight `complete` by requestId (best-effort; provider may finish network round-trip).
   * @param {{ requestId?: string }} p
   */
  async cancelComplete({ requestId }, _c) {
    const rid = String(requestId || "").trim();
    if (!rid) return { ok: false, reason: "missing requestId" };
    const ac = completeControllers.get(rid);
    if (!ac) return { ok: false, reason: "not_found" };
    try {
      ac.abort();
    } catch {
      /* ignore */
    }
    completeControllers.delete(rid);
    logInfo("ai", "complete cancel requested", { requestId: rid });
    return { ok: true };
  },
  async getState(_p, c) { return lst(c); },
  async listSessions(_p, c) {
    const s = await lst(c);
    return Object.entries(s.sessions || {}).map(([id, v]) => ({ id, ...v }));
  },
  async loadMessages({ sessionId }, c) {
    const id = safeSessionId(sessionId);
    await ensureDir(msgDir(c));
    return readJson(path.join(msgDir(c), id + ".json"), []);
  },
  async saveMessages({ sessionId, messages }, c) {
    const id = safeSessionId(sessionId);
    await ensureDir(msgDir(c));
    await writeText(path.join(msgDir(c), id + ".json"), JSON.stringify(messages, null, 2));
    return { ok: true };
  },
  async clearSession({ sessionId }, c) {
    const id = safeSessionId(sessionId);
    await fs.unlink(path.join(msgDir(c), id + ".json")).catch(() => {});
    await fs.unlink(path.join(msgDir(c), id + ".goal.json")).catch(() => {});
    const s = await lst(c);
    delete (s.sessions || {})[id];
    await sst(c, s);
    return { ok: true };
  },
  async clearAllSessions(_p, c) {
    const d = msgDir(c);
    const es = await fs.readdir(d).catch(() => []);
    await Promise.all(es.map((e) => fs.unlink(path.join(d, e)).catch(() => {})));
    await sst(c, { sessions: {}, history: [] });
    return { ok: true };
  },
  async cancelStream({ sessionId }) { return { ok: sr.cancel(sessionId) }; },
  /**
   * Mid-turn steer: inject after current tool step (prepareStep).
   * Only works while a stream is active for sessionId.
   */
  async steerStream({ sessionId, text }) {
    const ok = sr.steer(sessionId, text);
    if (ok) logInfo("ai", "steer queued", { sessionId, chars: String(text || "").length });
    return { ok, mode: "steer" };
  },
  /**
   * Queue a follow-up prompt delivered after the current agent turn finishes.
   * Renderer should auto-send remaining follow-ups from invoke result.
   */
  async queueFollowUp({ sessionId, text }) {
    const ok = sr.followUp(sessionId, text);
    if (ok) logInfo("ai", "follow-up queued", { sessionId, chars: String(text || "").length });
    return { ok, mode: "followUp" };
  },
  async updateSession({ sessionId, patch }, c) {
    const s = await lst(c);
    if (!s.sessions) s.sessions = {};
    s.sessions[sessionId] = { ...s.sessions[sessionId], ...patch };
    await sst(c, s);
    return s.sessions[sessionId];
  },
  async invoke({
    messages, topicId, mountedFiles, model, sessionId, useTools, writebackMode, activeSkillId,
    focusPath, focusHint,
  }, c, emitFromArg) {
    // Prefer ctx.emit (unified RPC bridge path); fall back to 3rd arg for direct calls.
    const emit = (chunk) => {
      const e = c?.emit ?? emitFromArg;
      if (e) e("ai:stream", { ...chunk, sessionId });
    };
    const settings = await loadSettingsWithSecrets(c);
    const res = resolveModel(settings, model);
    if (!res) throw new Error("No AI provider configured. Add API keys in Settings.");

    // Ambient file: if UI passed focusPath and it is not already mounted, include for this turn only.
    const mountList = Array.isArray(mountedFiles) ? [...mountedFiles] : [];
    const ambient = typeof focusPath === "string" ? focusPath.trim() : "";
    if (ambient && !mountList.some((m) => m === ambient || m?.path === ambient)) {
      mountList.push(ambient);
    }
    const resolvedFiles = await resolveMountedFiles(c.workspaceRoot, mountList);
    // Prefer the ambient focus path so multi-mount never mid-slices the primary doc.
    const ctxFiles = assembleContext({
      files: resolvedFiles,
      preferPaths: ambient ? [ambient] : [],
    }).files;
    // AI SDK v7: system prompt via `system` param; messages = user/assistant only.
    const cleanMsgs = messages.filter((m) => m.role !== "system");
    // Dynamic budget: scale by the model's real context window when known.
    const modelContextWindow =
      Number(res.contextWindow || res.model?.contextLimit || res.model?.contextWindow || 0) || undefined;
    const dynamicBudget = resolveCompactBudget(modelContextWindow);
    // Smart compaction: long sessions keep recent turns + middle summary (not a hard cut).
    // Explicit settings override the dynamic budget; otherwise scale with the model window.
    const compact = compactMessagesForModel(cleanMsgs, {
      maxMessages: settings?.ai?.maxContextMessages ?? dynamicBudget.maxMessages,
      keepRecent: settings?.ai?.keepRecentMessages ?? dynamicBudget.keepRecent,
      maxChars: settings?.ai?.maxContextChars ?? dynamicBudget.maxChars,
      maxPerMessage: settings?.ai?.maxContextChars ? undefined : dynamicBudget.maxPerMessage,
      locale: settings?.ui?.locale === "en-US" ? "en-US" : "zh-CN",
    });
    if (compact.compacted) {
      emit?.({
        type: "status",
        status: "compacting",
        sessionId,
      });
      logInfo("ai", "session compacted", {
        sessionId,
        dropped: compact.dropped,
        note: compact.note,
        before: cleanMsgs.length,
        after: compact.messages.length,
      });
    }

    // Per-call override only when the invoke payload explicitly set auto|confirm.
    // Renderer must not send view-store defaults — yaml is the write policy.
    const { resolveWorkspaceWritebackMode, workspaceRootOf } = await import("./lib/kernel-api.mjs");
    const effectiveMode =
      writebackMode === "confirm" || writebackMode === "auto" ? writebackMode : undefined;
    const contractMode = await resolveWorkspaceWritebackMode(c, {
      writebackMode: effectiveMode,
    });
    const toolCtx = {
      ...c,
      explicitWritebackMode: effectiveMode,
      appSettings: { ...settings, writebackMode: contractMode },
      // Once-per-task locked snapshot key for writeback-engine.
      aiTaskId: sessionId,
      sessionId,
    };

    // Agent mode default ON: tools unless caller explicitly sets useTools:false.
    // buildAiTools always registers write tools; confirm mode → pending + 待确认写入.
    // Failures degrade to plain streaming. Tools never spawn child Electron processes.
    const enableTools = useTools !== false;
    let tools = null;
    let toolNames = [];
    if (enableTools) {
      try {
        const { ToolService } = await import("./tool-service.mjs");
        tools = await ToolService.buildAiTools({}, toolCtx);
        if (!tools || Object.keys(tools).length === 0) {
          tools = null;
        } else {
          toolNames = Object.keys(tools);
        }
      } catch (err) {
        logError("ai", "buildAiTools failed, degrading to no-tools", { sessionId, error: err.message });
        tools = null;
      }
    }

    // Pre-load workspace context in parallel (reduces agent tool calls for discovery)
    let aiContext = { overview: "", profile: "", topicContext: "" };
    if (enableTools) {
      try {
        const { loadAiContext } = await import("./lib/ai-context-loader.mjs");
        aiContext = await loadAiContext(c, topicId);
      } catch (err) {
        logError("ai", "loadAiContext failed (non-fatal)", { sessionId, error: err.message });
      }
    }

    // System prompt: skill-first protocol + discovery catalog + actual tool names + pre-loaded context.
    const skillsEnabled = settings?.ai?.skillsEnabled !== false;
    const lastUser = [...compact.messages].reverse().find((m) => m.role === "user");
    const lastUserText = typeof lastUser?.content === "string"
      ? lastUser.content
      : Array.isArray(lastUser?.content)
        ? lastUser.content.map((p) => (typeof p === "string" ? p : p?.text || "")).join("\n")
        : "";
    const [locale, outputLocale] = await Promise.all([
      resolveChromeLocale(settings, c),
      resolveDurableOutputLocale({
        userText: lastUserText,
        focusPath: ambient,
        mountedFiles: ctxFiles,
        c,
      }),
    ]);
    const sysPrompt = buildSystemPrompt({
      workspaceContext: c.workspaceRoot,
      topicId,
      mountedFiles: ctxFiles,
      writebackMode: contractMode,
      toolNames,
      skillsEnabled,
      enabledSkillIds: settings?.ai?.enabledSkillIds || null,
      extraSkillsRoots: settings?.ai?.extraSkillsRoots || [],
      engineRoot: c.workspaceRoot?.engineRoot || c.engineRoot,
      activeSkillId: activeSkillId || null,
      focusPath: ambient || null,
      focusHint: typeof focusHint === "string" ? focusHint : null,
      workspaceOverview: aiContext.overview,
      memoryProfile: aiContext.profile,
      topicContext: aiContext.topicContext,
      locale,
      outputLocale,
    });

    const maxAgentSteps = settings?.ai?.maxAgentSteps;
    logInfo("ai", "invoke started", {
      sessionId,
      model: res.modelId,
      tools: toolNames.length,
      writebackMode: effectiveMode,
      agent: Boolean(tools),
      maxAgentSteps: maxAgentSteps ?? undefined,
      compacted: compact.compacted,
    });
    const streamArgs = {
      model: res.model,
      modelId: res.modelId,
      system: sysPrompt,
      messages: compact.messages,
      tools,
      emit,
      sessionId,
      maxAgentSteps,
      workspaceRoot: workspaceRootOf(c.workspaceRoot),
      // Real model window when known — Pi stub otherwise defaults to 128k.
      contextWindow: modelContextWindow,
    };
    let piRuntime = null;
    try {
      piRuntime = await import("./ai-pi-runtime.mjs");
    } catch (err) {
      logError("ai", "pi-agent-core module load failed, falling back to AI SDK streamText", {
        sessionId,
        error: err?.message || String(err),
      });
    }

    // Auto-continue: when the step budget is exhausted mid-task (or the goal
    // still has open acceptance criteria), re-enter the loop with a goal-aware
    // continue prompt instead of dying. Bounded so a runaway agent cannot spin
    // forever; incomplete goals get a slightly higher budget.
    const BASE_MAX_AUTO_CONTINUES = 2;
    let autoContinues = 0;
    let workingMessages = compact.messages;
    let result = null;
    let combinedText = "";
    let combinedReasoning = "";
    let lastFollowUps = [];
    let lastSteerApplyCount = 0;
    let lastRuntime = "ai-sdk";
    let lastUsage = null;
    const savedGoal = await loadSessionGoal(sessionId, c).catch(() => null);
    // Restore, fold history, and merge Pi's "继续" seed as one prelude.
    let goalState = prepareTurnGoal({ saved: savedGoal, messages: compact.messages });
    let contextRetries = 0;
    /** File ops harvested from Pi compaction + tool path receipts (memory distill). */
    const fileOps = { readFiles: [], modifiedFiles: [] };

    for (;;) {
      const runArgs = { ...streamArgs, messages: workingMessages };
      try {
        result = piRuntime?.isPiRuntimeAvailable?.()
          ? await piRuntime.runPiAgent(runArgs, sr)
          : await runStream(runArgs, sr);
      } catch (piErr) {
        // Pi runtime crashed mid-loop — degrade to AI SDK streamText once.
        logError("ai", "pi-agent-core threw, falling back to ai-sdk", {
          sessionId,
          error: piErr instanceof Error ? piErr.message : String(piErr),
        });
        try {
          result = await runStream(runArgs, sr);
          lastRuntime = "ai-sdk";
        } catch (sdkErr) {
          result = {
            text: "",
            error: sdkErr instanceof Error ? sdkErr : new Error(String(sdkErr)),
            runtime: lastRuntime,
          };
        }
      }
      lastRuntime = result.runtime || lastRuntime;
      lastUsage = result.usage || lastUsage;
      lastSteerApplyCount += result.steerApplyCount || 0;
      if (Array.isArray(result.followUps) && result.followUps.length) {
        lastFollowUps = result.followUps;
      }
      // Detect overflow BEFORE appending partial text (P2: avoid duplicated fragments).
      const errText0 = result.error ? String(result.error.message || result.error) : "";
      const willOverflowRetry =
        Boolean(result.error) &&
        /context.?length|maximum context|too many tokens|context.?window/iu.test(errText0) &&
        contextRetries < 3;
      if (result.text && !willOverflowRetry) {
        combinedText = combinedText
          ? `${combinedText}\n\n${result.text}`
          : result.text;
      }
      if (result.reasoning && !willOverflowRetry) {
        combinedReasoning = combinedReasoning
          ? `${combinedReasoning}\n\n${result.reasoning}`
          : result.reasoning;
      }
      // Fold run output into the shared goal ledger (plan / criteria / receipts).
      // MERGE — never clobber the outer plan/criteria with an empty per-run rebuild
      // (Pi runPiAgent starts a fresh GoalState; after auto-continue #1 the model
      // often does not re-emit [PLAN], so replace() would drop open criteria).
      const prevOpen = goalState.doneCriteria?.length || 0;
      const prevPlan = goalState.plan?.length || 0;
      if (result.goalState) {
        goalState = mergeRunGoal(goalState, result.goalState);
      } else if (result.text) {
        goalState = applyGoalUpdate(goalState, { text: result.text });
      }
      if (result.text) harvestPathReceipts(result.text, goalState.pathReceipts);
      // Bare [DONE] after tools, with no path receipt, is not success on either runtime.
      goalState = rejectBareDone(goalState, {
        toolCallCount: Number(result.toolCallCount) || 0,
        lastBody: String(result.text || ""),
      });
      if (result.fileOps) {
        for (const p of result.fileOps.readFiles || []) {
          if (p && !fileOps.readFiles.includes(p)) fileOps.readFiles.push(p);
        }
        for (const p of result.fileOps.modifiedFiles || []) {
          if (p && !fileOps.modifiedFiles.includes(p)) fileOps.modifiedFiles.push(p);
        }
      }
      // Path receipts are also distill candidates (written/updated this run).
      for (const p of goalState.pathReceipts || []) {
        if (p && !fileOps.modifiedFiles.includes(p) && /\.(?:md|txt|json|ya?ml|csv)$/iu.test(p)) {
          fileOps.modifiedFiles.push(p);
        }
      }
      // Live goal chip: emit when plan/criteria first appear or status flips.
      if (
        (goalState.plan?.length || 0) !== prevPlan ||
        (goalState.doneCriteria?.length || 0) !== prevOpen ||
        goalState.status === "done" ||
        goalState.status === "incomplete" ||
        goalState.status === "blocked"
      ) {
        emit?.({
          type: "goal-status",
          sessionId,
          goal: {
            goal: goalState.goal || "",
            plan: goalState.plan || [],
            criteria: goalState.criteria || [],
            openCriteria: goalState.doneCriteria || [],
            pathReceipts: (goalState.pathReceipts || []).slice(-12),
            status: goalState.status || "idle",
            blockReason: goalState.blockReason || null,
            autoContinues,
          },
        });
      }

      // Context overflow: compact harder and retry (G8: up to 3, not tools-gated).
      const errText = result.error ? String(result.error.message || result.error) : "";
      const isContextOverflow = /context.?length|maximum context|too many tokens|context.?window/iu.test(errText);
      if (result.error && isContextOverflow && contextRetries < 3) {
        contextRetries += 1;
        logWarn("ai", "context overflow — compacting and retrying", { sessionId, contextRetries });
        emit?.({ type: "status", status: "compacting", sessionId });
        const hard = compactMessagesForModel(workingMessages, {
          maxMessages: Math.max(8, Math.floor(dynamicBudget.maxMessages / (1 + contextRetries))),
          keepRecent: Math.max(4, Math.floor(dynamicBudget.keepRecent / (1 + contextRetries))),
          maxChars: Math.max(8000, Math.floor(dynamicBudget.maxChars / (1 + contextRetries))),
          locale: settings?.ui?.locale === "en-US" ? "en-US" : "zh-CN",
        });
        workingMessages = [
          { role: "user", content: buildTaskLedger(goalState, locale === "en" ? "en-US" : "zh-CN") },
          ...hard.messages,
        ];
        result.error = null;
        continue;
      }

      if (result.error || result.cancelled) break;
      const heuristic = assessGoalCompletion({
        state: goalState,
        lastBody: String(result.text || ""),
        stepLimitHit: Boolean(result.stepLimitHit),
        toolCallCount: result.toolCallCount || 0,
      });
      // External goal evaluator (industry /goal): a separate judge when the
      // worker claims done or criteria are open — never worker self-grading.
      let evaluator = null;
      const wantsJudge =
        goalState.doneCriteria?.length > 0 ||
        heuristic.reason === "done-mark" ||
        heuristic.confidence === "medium";
      if (wantsJudge && res.modelId && !heuristic.reason?.includes("incomplete-mark")) {
        try {
          const judge = await generateText({
            model: res.model,
            system: "You are a strict goal-completion judge. JSON only.",
            prompt: buildGoalEvaluatorPrompt({
              state: goalState,
              lastBody: String(result.text || ""),
              toolSummaries: (result.toolCallCount
                ? [`toolCallCount=${result.toolCallCount}`]
                : []).concat((goalState.pathReceipts || []).slice(-6)),
            }),
            maxOutputTokens: 200,
            temperature: 0,
          });
          evaluator = parseGoalEvaluatorResult(judge?.text || "");
          if (evaluator) {
            logInfo("ai", "goal evaluator", {
              sessionId,
              verdict: evaluator.verdict,
              reason: evaluator.reason,
            });
          }
        } catch (evalErr) {
          logWarn("ai", "goal evaluator unavailable — heuristic only", {
            sessionId,
            error: evalErr instanceof Error ? evalErr.message : String(evalErr),
          });
        }
      }
      const assessment = reconcileGoalVerdicts({ heuristic, evaluator });
      // Evaluator `met` is a completed verdict — clear open criteria so the
      // persisted session goal does not look perpetually incomplete.
      if (evaluator?.verdict === "met" && assessment.finished) {
        goalState = {
          ...goalState,
          status: "done",
          doneCriteria: [],
          blockReason: null,
        };
      }
      const maxContinues = resolveMaxAutoContinues({
        assessment,
        baseMax: BASE_MAX_AUTO_CONTINUES,
      });
      const decision = decideAutoContinue({
        assessment,
        autoContinues,
        maxAutoContinues: maxContinues,
        hasTools: Boolean(tools),
        error: Boolean(result.error),
        cancelled: Boolean(result.cancelled),
      });
      // High-confidence done always stops — even at the step cap (G5):
      // never spend continue budget re-closing a finished task.
      // Accept both worker `[DONE]` and evaluator `met` verdicts.
      if (
        assessment.finished &&
        assessment.confidence === "high" &&
        (assessment.reason === "done-mark" || String(assessment.reason || "").startsWith("met"))
      ) {
        break;
      }
      // Hard stops win even at stepLimitHit (G7): blocked / incomplete / impossible / no-tools.
      const hardStop =
        decision.reason === "blocked" ||
        decision.reason === "incomplete-mark" ||
        String(decision.reason || "").startsWith("impossible") ||
        decision.reason === "no-tools" ||
        decision.reason === "error-or-cancelled";
      if (hardStop) {
        if (goalState.status !== "done" && decision.reason !== "blocked") {
          // Keep blocked as-is; otherwise honest terminal for the stop reason.
          if (decision.reason === "incomplete-mark" || String(decision.reason || "").startsWith("impossible")) {
            goalState = {
              ...goalState,
              status: "incomplete",
              blockReason: goalState.blockReason || decision.reason,
            };
          }
        }
        break;
      }
      // Budget exhaustion is terminal BEFORE any continue (G6): decideAutoContinue
      // already returns continue:false at budget — terminalize then break.
      if (autoContinues >= maxContinues || (!decision.continue && decision.reason === "continue-budget")) {
        logInfo("ai", "auto-continue budget exhausted", { sessionId, autoContinues, maxContinues });
        if (goalState.status !== "done") {
          goalState = {
            ...goalState,
            status: goalState.status === "blocked" ? "blocked" : "incomplete",
            blockReason: goalState.blockReason || "budget_exhausted",
          };
        }
        break;
      }
      // Step limit offers a continue (fresh budget) unless a hard stop/done; otherwise goal-aware.
      if (!result.stepLimitHit && !decision.continue) break;

      autoContinues += 1;
      emit?.({ type: "status", status: "continuing", sessionId, autoContinues });
      logInfo("ai", "auto-continue after step limit / open goal", {
        sessionId,
        autoContinues,
        reason: assessment.reason,
      });
      const continueBody = buildContinuePrompt(
        settings?.ui?.locale === "en-US" ? "en-US" : "zh-CN",
        goalState,
      );
      const lastBody = String(result.text || "").trim();
      workingMessages = [
        ...workingMessages,
        ...(lastBody ? [{ role: "assistant", content: lastBody }] : []),
        { role: "user", content: continueBody },
      ];
      // Re-compact if the transcript grew past the dynamic budget.
      if (workingMessages.length > dynamicBudget.maxMessages) {
        const recompacted = compactMessagesForModel(workingMessages, {
          maxMessages: dynamicBudget.maxMessages,
          keepRecent: dynamicBudget.keepRecent,
          maxChars: dynamicBudget.maxChars,
          locale: settings?.ui?.locale === "en-US" ? "en-US" : "zh-CN",
        });
        workingMessages = [
          { role: "user", content: buildTaskLedger(goalState, locale === "en" ? "en-US" : "zh-CN") },
          ...recompacted.messages,
        ];
      }
    }

    if (result?.error) logError("ai", "invoke failed", { sessionId, error: result.error.message });
    // Map provider failures to actionable copy (rate limit / auth / network).
    let friendlyError = result?.error ? (result.error.message || String(result.error)) : "";
    if (result?.error) {
      const raw = friendlyError.toLowerCase();
      const zh = locale === "zh";
      if (/401|unauthorized|invalid.?api.?key|authentication/i.test(raw)) {
        friendlyError = zh
          ? "API Key 无效或未配置。请到「设置 → AI」检查密钥。"
          : "Invalid or missing API key. Check Settings → AI.";
      } else if (/429|rate.?limit|too many requests|quota/i.test(raw)) {
        friendlyError = zh
          ? "触发限流/配额。稍后重试，或换一个模型/供应商。"
          : "Rate limited or quota exceeded. Retry later or switch model/provider.";
      } else if (/timeout|etimedout|econnreset|network|fetch failed/i.test(raw)) {
        friendlyError = zh
          ? "网络超时或连接失败。检查网络后重试；长任务可稍后再发。"
          : "Network timeout or connection failed. Check connectivity and retry.";
      } else if (/context.?length|maximum context|too many tokens/i.test(raw)) {
        friendlyError = zh
          ? "上下文超长。请新开会话，或缩短挂载文件/历史。"
          : "Context too long. Start a new session or reduce mounted files/history.";
      }
    }
    noteAgentLoop(lastRuntime);
    const batchEvidence = toolCtx._batchCollector?.summary?.() || null;
    if (batchEvidence) {
      emit?.({ type: "batch-evidence", batchEvidence, sessionId });
      logInfo("ai", "multi-file writeback summary", {
        sessionId,
        writeCount: batchEvidence.writeCount,
      });
    }
    if (lastFollowUps.length) {
      emit?.({ type: "follow-up-ready", count: lastFollowUps.length, sessionId });
    }
    // Goal-layer summary for the renderer (plan / open criteria / incomplete).
    const goalSummary = {
      goal: goalState.goal || "",
      plan: goalState.plan || [],
      criteria: goalState.criteria || [],
      openCriteria: goalState.doneCriteria || [],
      pathReceipts: (goalState.pathReceipts || []).slice(-12),
      status: goalState.status || "idle",
      blockReason: goalState.blockReason || null,
      autoContinues,
    };
    emit?.({ type: "goal-status", goal: goalSummary, sessionId });
    rememberDistillHint(fileOps);
    // Persist session-level GoalState so criteria survive user turns / restart.
    await saveSessionGoal(sessionId, goalState, c).catch(() => {});
    // Stop-reason honesty (G4): cancel ≠ timeout ≠ stall ≠ incomplete.
    const cancelled = Boolean(result?.cancelled);
    const stopReason = result?.stopReason
      || (cancelled ? "cancelled" : result?.error ? "error" : null);
    return {
      ok: !result?.error,
      cancelled,
      stopReason,
      stepLimitHit: Boolean(result?.stepLimitHit),
      text: combinedText || result?.text || "",
      reasoning: combinedReasoning || result?.reasoning || "",
      error: friendlyError,
      usage: lastUsage,
      model: { modelId: res.modelId, contextWindow: modelContextWindow },
      batchEvidence,
      followUps: lastFollowUps,
      steerApplyCount: lastSteerApplyCount,
      autoContinues,
      goal: goalSummary,
      taskLedger: buildTaskLedger(goalState, locale === "en" ? "en-US" : "zh-CN"),
      /** Post-run memory distill candidates (Pi CompactionDetails + path receipts). */
      memoryDistillHint: {
        readFiles: fileOps.readFiles.slice(0, 24),
        modifiedFiles: fileOps.modifiedFiles.slice(0, 24),
      },
      compactNote: compact.compacted ? compact.note : null,
      estimatedTokens: compact.estimatedTokens,
      runtime: lastRuntime,
    };
  },
};
