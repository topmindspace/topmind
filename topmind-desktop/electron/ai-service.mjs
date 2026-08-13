/** v4 AiService — sessions + invoke + one-shot complete (inline edit). */
import { promises as fs } from "node:fs";
import path from "node:path";
import { generateText } from "ai";
import { readJson, writeText, ensureDir, readText } from "./lib/fs-utils.mjs";
import { logInfo, logError, logWarn } from "./lib/writeback.mjs";
import { buildSystemPrompt, assembleContext, resolvePromptLocale } from "./ai-prompts.mjs";
import { createStreamRegistry, runStream } from "./ai-stream.mjs";
import { resolveModel, getRuntimeStatus } from "./ai-model.mjs";
import { resolveDataRoot } from "./lib/path-model.mjs";
import { t as ei18n } from "./lib/electron-i18n.mjs";
import { assertPathWithin } from "./lib/path-safety.mjs";
import { loadAppSettings } from "./settings.mjs";
import { compactMessagesForModel } from "./lib/ai-session-compact.mjs";
import { sanitizeInlineAiResult } from "./lib/inline-ai-result.mjs";
import {
  INLINE_SYSTEM,
  buildInlineCompletePrompt,
} from "./lib/inline-complete-prompt.mjs";

export { getRuntimeStatus };
// Re-export pure assembly for tests / callers that want the same path without generateText
export { INLINE_SYSTEM, buildInlineCompletePrompt } from "./lib/inline-complete-prompt.mjs";
export { resolvePromptLocale } from "./ai-prompts.mjs";

/**
 * Resolve AI prompt language for user-visible / durable AI text.
 * Order: settings.ui.locale (if not auto) → workspace contract locale → zh.
 * @param {object} [settings]
 * @param {object} [c] — service context with workspaceRoot
 * @returns {Promise<"zh"|"en">}
 */
async function resolveAiPromptLocale(settings, c) {
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

    const locale = await resolveAiPromptLocale(settings, c);

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
        maxOutputTokens: resolvedMode === "summarize" ? 2048 : 4096,
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
    await ensureDir(msgDir(c));
    return readJson(path.join(msgDir(c), sessionId + ".json"), []);
  },
  async saveMessages({ sessionId, messages }, c) {
    await ensureDir(msgDir(c));
    await writeText(path.join(msgDir(c), sessionId + ".json"), JSON.stringify(messages, null, 2));
    return { ok: true };
  },
  async clearSession({ sessionId }, c) {
    await fs.unlink(path.join(msgDir(c), sessionId + ".json")).catch(() => {});
    const s = await lst(c);
    delete (s.sessions || {})[sessionId];
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
    const ctxFiles = assembleContext({ files: resolvedFiles }).files;
    // AI SDK v7: system prompt via `system` param; messages = user/assistant only.
    const cleanMsgs = messages.filter((m) => m.role !== "system");
    // Smart compaction: long sessions keep recent turns + middle summary (not a hard cut).
    const compact = compactMessagesForModel(cleanMsgs, {
      maxMessages: settings?.ai?.maxContextMessages,
      keepRecent: settings?.ai?.keepRecentMessages,
      maxChars: settings?.ai?.maxContextChars,
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
    const { resolveWorkspaceWritebackMode } = await import("./lib/kernel-api.mjs");
    const effectiveMode =
      writebackMode === "confirm" || writebackMode === "auto" ? writebackMode : undefined;
    const contractMode = await resolveWorkspaceWritebackMode(c, {
      writebackMode: effectiveMode,
    });
    const toolCtx = {
      ...c,
      explicitWritebackMode: effectiveMode,
      appSettings: { ...settings, writebackMode: contractMode },
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
    const locale = await resolveAiPromptLocale(settings, c);
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
    const result = await runStream({
      model: res.model,
      system: sysPrompt,
      messages: compact.messages,
      tools,
      emit,
      sessionId,
      maxAgentSteps,
    }, sr);
    if (result.error) logError("ai", "invoke failed", { sessionId, error: result.error.message });
    const batchEvidence = toolCtx._batchCollector?.summary?.() || null;
    if (batchEvidence) {
      emit?.({ type: "batch-evidence", batchEvidence, sessionId });
      logInfo("ai", "multi-file writeback summary", {
        sessionId,
        writeCount: batchEvidence.writeCount,
      });
    }
    const followUps = Array.isArray(result.followUps) ? result.followUps : [];
    if (followUps.length) {
      emit?.({ type: "follow-up-ready", count: followUps.length, sessionId });
    }
    return {
      ok: !result.error,
      text: result.text,
      error: result.error ? result.error.message : "",
      usage: result.usage,
      model: { modelId: res.modelId },
      batchEvidence,
      followUps,
      steerApplyCount: result.steerApplyCount || 0,
      compactNote: compact.compacted ? compact.note : null,
      estimatedTokens: compact.estimatedTokens,
    };
  },
};
