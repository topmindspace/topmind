// ── Kernel Service: wraps Kernel operations for Obsidian plugin ────────────
//
// All view/modal components call this service instead of directly accessing
// the Kernel. This centralizes:
// - Kernel context creation (with AI provider from settings)
// - Writeback mode override (from plugin settings)
// - Error handling and evidence extraction
// - Backup/receipt keep count wiring (via process.env)

import type { App } from "obsidian";
import { Notice, type Plugin } from "obsidian";
import type { TopmindSettings, StreamPeriod, StreamEntry, SuggestionCard, TodoItem } from "../types";
import type { AiProvider } from "../bridge/ai-provider";
import { createAiProvider, resolveAiEndpoint } from "../bridge/ai-provider";
import { createKernelContextFromApp, type KernelContext, getKernel } from "../bridge/kernel-loader";
import { getVaultBasePath, getEngineRoot } from "../bridge/vault-bridge";
import {
  parseStreamEntries,
  normalizeSuggestionList,
  mapKernelSuggestion,
  mapApplySuggestionResult,
} from "../utils";
import { AI_PROVIDER_PRESETS, PROVIDER_DEFAULT_MODELS } from "../constants";
import {
  captureToWorkspace,
  listStreamPeriodsForWorkspace,
  reconcilePeriodNote,
  readTodosFromWorkspace,
  initWorkspaceStructure,
} from "./kernel-workspace-ops";
import { t } from "../i18n";
import { hasConfiguredProvider, getProviderKey } from "../types";

// ── Node.js built-ins ──
// esbuild platform:'node' keeps these as require() calls (works in Electron).
// Using ESM imports for type safety — esbuild converts to CJS require in output.
import fs from "node:fs";
import path from "node:path";

interface CachedModel {
  model: { categories: { role: string; directory: string; name: string }[]; contract?: Record<string, unknown> };
  contractMtime: number; // topmind.yaml mtime when cached
}

export class KernelService {
  private app: App;
  private plugin: Plugin;
  private settings: TopmindSettings;
  private context: KernelContext | null = null;
  private lastSettingsHash: string = "";
  private cachedModel: CachedModel | null = null;

  constructor(app: App, plugin: Plugin, settings: TopmindSettings) {
    this.app = app;
    this.plugin = plugin;
    this.settings = settings;
    this.applyRuntimeSettings();
  }

  /** Update settings (rebuilds context if AI config changed) */
  updateSettings(settings: TopmindSettings): void {
    // Hash includes both new multi-provider keys and legacy fields
    const aiManual = settings.ai?.manual
      ? Object.values(settings.ai.manual).join("|")
      : "";
    const hash = `${settings.ai?.sourcePreference || settings.aiProvider}|${aiManual}|${settings.aiApiKey}|${settings.aiBaseUrl}|${settings.aiModel}`;
    if (hash !== this.lastSettingsHash) {
      this.context = null; // Force rebuild on next call
    }
    this.settings = settings;
    this.lastSettingsHash = hash;
    this.applyRuntimeSettings();
  }

  /** Invalidate cached model (call when topmind.yaml or dir structure changes) */
  invalidateCache(): void {
    this.cachedModel = null;
  }

  /** Clean up resources on plugin unload */
  dispose(): void {
    this.context = null;
    this.cachedModel = null;
    this.lastSettingsHash = "";
  }

  /**
   * Apply settings that affect Kernel runtime behavior via env vars.
   *
   * The Kernel's writeback-engine reads BACKUP_KEEP and RECEIPT_KEEP from
   * process.env at write time. This is the only bridge available because
   * the Kernel is bundled (no direct config injection point).
   *
   * Side effect: modifies process.env globally within the plugin's process.
   * This is safe because Obsidian plugins share the same Electron renderer
   * process, and these env vars are topmind-specific (no naming collision risk).
   */
  private applyRuntimeSettings(): void {
    // Wire backupKeep to Kernel's expected env var
    process.env.BACKUP_KEEP = String(this.settings.backupKeep);
    // Wire receiptKeep to Kernel's receipt rotation env var
    process.env.RECEIPT_KEEP = String(this.settings.receiptKeep);
  }

  /** Get or create the kernel context */
  private getContext(): KernelContext {
    if (!this.context) {
      const aiProvider = createAiProvider(this.settings);
      const localeOverride = this.settings.localeOverride || null;
      this.context = createKernelContextFromApp(this.app, this.plugin, aiProvider, localeOverride);
    }
    return this.context;
  }

  /** Get writeback mode override from settings */
  private get writebackModeOverride(): "auto" | "confirm" | undefined {
    return this.settings.writebackMode;
  }

  // ── Workspace ──────────────────────────────────────────────────────────

  /** Check if current vault is a topmind workspace */
  isWorkspaceReady(): boolean {
    try {
      const basePath = this.getVaultPath();
      return fs.existsSync(path.join(basePath, "topmind.yaml"));
    } catch {
      return false;
    }
  }

  /**
   * Initialize workspace structure in current vault.
   * First-time (no NN- categories): seed full template layout (Desktop parity)
   * so loose-stream「动态」exists. Subsequent calls only ensure required roles.
   */
  initWorkspace(templateId: string = "stream"): { ok: boolean; error?: string } {
    const result = initWorkspaceStructure(
      getKernel(),
      this.getVaultPath(),
      this.getEngineRoot(),
      templateId,
    );
    if (result.ok) this.invalidateCache();
    return result;
  }

  /** Load contract from topmind.yaml (reads file each call, but cached at model level) */
  loadContract(): Record<string, unknown> {
    const kernel = getKernel();
    return kernel.loadContract(this.getVaultPath());
  }

  /**
   * Resolve workspace model with caching.
   * Exposed for command handlers that need category info (e.g., open inbox).
   */
  getResolvedModel(): { categories: { role: string; directory: string; name: string }[]; contract?: Record<string, unknown> } {
    return this.getResolvedModelInternal();
  }

  /**
   * Resolve workspace model with caching.
   * Caches based on topmind.yaml mtime — invalidates when config changes.
   * This avoids repeated disk scans (discoverCategoryDirs) on every UI refresh.
   */
  private getResolvedModelInternal(): { categories: { role: string; directory: string; name: string }[]; contract?: Record<string, unknown> } {
    const kernel = getKernel();
    const workspaceRoot = this.getVaultPath();
    const engineRoot = this.getEngineRoot();
    const yamlPath = path.join(workspaceRoot, "topmind.yaml");

    let contractMtime = 0;
    try {
      contractMtime = fs.statSync(yamlPath).mtimeMs;
    } catch {
      // topmind.yaml missing — mtime 0 forces fresh resolve
    }

    if (this.cachedModel && this.cachedModel.contractMtime === contractMtime) {
      return this.cachedModel.model;
    }

    const contract = this.loadContract();
    const model = kernel.resolveWorkspaceModel({
      workspaceRoot,
      engineRoot,
      config: contract,
    });

    this.cachedModel = { model, contractMtime };
    return model;
  }

  // ── Stream ─────────────────────────────────────────────────────────────

  /**
   * Get stream period list (newest first).
   * Awaits Kernel `listStreamPeriods({ workspaceRoot, engineRoot, config })`.
   */
  async getStreamContext(): Promise<{ periods: StreamPeriod[]; current: StreamPeriod | null }> {
    try {
      return await listStreamPeriodsForWorkspace(
        getKernel(),
        this.getVaultPath(),
        this.getEngineRoot(),
      );
    } catch (err) {
      console.error("[topmind] getStreamContext failed:", err);
      return { periods: [], current: null };
    }
  }

  /** Read a period note and parse entries */
  readPeriodNote(relPath: string): { content: string; entries: StreamEntry[] } {
    const workspaceRoot = this.getVaultPath();
    const absPath = path.join(workspaceRoot, relPath);

    try {
      const content = fs.readFileSync(absPath, "utf-8");
      const entries = parseStreamEntries(content);
      return { content, entries };
    } catch {
      return { content: "", entries: [] };
    }
  }

  /** Capture text to stream (or inbox) via writeback-engine */
  capture(text: string, opts: { target?: "stream" | "inbox"; tags?: string[] } = {}): {
    ok: boolean;
    path?: string;
    error?: string;
  } {
    if (!this.isWorkspaceReady()) {
      new Notice(t("notice_workspace_not_ready"));
      return { ok: false, error: "workspace-not-ready" };
    }

    const result = captureToWorkspace(
      getKernel(),
      this.getVaultPath(),
      this.getEngineRoot(),
      text,
      {
        target: opts.target,
        tags: opts.tags,
        writebackMode: this.writebackModeOverride,
      },
    );

    if (result.ok) {
      new Notice(`${t("notice_written")} → ${result.path}`);
    } else if (result.error === "pending-confirmation") {
      new Notice(t("notice_write_pending"));
    } else if (result.error && result.error !== "empty-text") {
      new Notice(`${t("notice_write_failed")}: ${result.error}`);
    }
    return result;
  }

  /**
   * Reconcile a period note — deterministic Kernel reconcilePeriodBody(body, opts)
   * returns `{ body, changed }` (not `{ reconciled }`).
   */
  reconcilePeriod(relPath: string): { ok: boolean; reconciled: boolean; error?: string } {
    return reconcilePeriodNote(
      getKernel(),
      this.getVaultPath(),
      this.getEngineRoot(),
      relPath,
      { writebackMode: this.writebackModeOverride },
    );
  }

  // ── Suggestions ────────────────────────────────────────────────────────

  /** Generate AI suggestions */
  async generateSuggestions(): Promise<SuggestionCard[]> {
    if (!this.settings.autoSuggest) return [];

    try {
      const ctx = this.getContext();
      const raw = await ctx.generateSuggestions({ force: false });
      // Kernel returns Suggestion[] directly; normalizeSuggestionList also
      // accepts legacy { suggestions: [] } for forward compatibility.
      return normalizeSuggestionList(raw).map(mapKernelSuggestion);
    } catch (err) {
      console.error("[topmind] generateSuggestions failed:", err);
      return [];
    }
  }

  /**
   * Apply (accept) a suggestion after user confirm.
   * Maps Kernel skip/failure (ok:false, wroteFiles:false, operation:skip) to
   * surface failure so the UI keeps the card and does not show a false success.
   */
  async applySuggestion(suggestion: SuggestionCard): Promise<{
    ok: boolean;
    error?: string;
    openPath?: string;
  }> {
    try {
      const ctx = this.getContext();
      const result = await ctx.applySuggestion({
        id: suggestion.id,
        kind: suggestion.kind,
        title: suggestion.title,
        summary: suggestion.summary,
        impact: suggestion.impact,
        payload: suggestion.payload,
        targetPath: suggestion.targetPath,
      });

      const mapped = mapApplySuggestionResult(result, suggestion);
      if (mapped.ok) {
        new Notice(`${t("notice_executed")}: ${suggestion.title}`);
        return mapped;
      }
      new Notice(`${t("notice_execute_failed")}: ${mapped.error || suggestion.title}`);
      return mapped;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`${t("notice_execute_failed")}: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  // ── AI Operations ──────────────────────────────────────────────────────

  /** Run AI operation (todo_maintain, memory_organize, topic_classify) */
  async runOperation(id: string, opts: { force?: boolean } = {}): Promise<{
    ok: boolean;
    summary: string;
    suggestions?: SuggestionCard[];
  }> {
    try {
      const ctx = this.getContext();
      const result = await ctx.runOperation({
        id,
        options: opts,
      });
      return {
        ok: result.ok,
        summary: result.summary || "",
        suggestions: normalizeSuggestionList(result.suggestions).map(mapKernelSuggestion),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, summary: msg };
    }
  }

  // ── Todo ────────────────────────────────────────────────────────────────

  /** Read todo list (read-only — does NOT create the todo file as a side effect) */
  readTodos(): TodoItem[] {
    return readTodosFromWorkspace(getKernel(), this.getVaultPath());
  }

  /** Toggle todo completion */
  toggleTodo(id: string): void {
    try {
      const kernel = getKernel();
      const workspaceRoot = this.getVaultPath();
      const contract = this.loadContract();
      kernel.toggleTodoItem(workspaceRoot, id, contract);
    } catch (err) {
      console.error("[topmind] toggleTodo failed:", err);
      new Notice(`${t("notice_execute_failed")}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── AI Chat ────────────────────────────────────────────────────────────

  /**
   * Chat with AI about the user's notes, todos, and stream.
   * Builds context from recent stream entries + current todos + profile,
   * then calls the AI provider with the user's question.
   * 
   * Uses the cached AI provider from getContext() to avoid creating a new
   * provider on every call. Falls back to createAiProvider if context is
   * not available.
   */
  async chat(
    userMessage: string,
    history: Array<{ role: "user" | "assistant"; content: string }> = [],
  ): Promise<string> {
    // Try to reuse the cached context's AI provider first
    let aiProvider: AiProvider | null = null;
    try {
      const ctx = this.getContext();
      if (ctx?.aiProvider && typeof (ctx.aiProvider as { generate?: unknown }).generate === "function") {
        aiProvider = ctx.aiProvider as unknown as AiProvider;
      }
    } catch {
      // Context creation failed — fall through to manual creation
    }
    
    // Fall back to creating a fresh provider
    if (!aiProvider) {
      aiProvider = createAiProvider(this.settings);
    }
    
    if (!aiProvider) {
      throw new Error(t("settings_ai_test_no_key"));
    }

    // Build context from workspace data
    const contextParts: string[] = [];

    // Recent stream entries (expanded from 15 → 20 for richer context)
    try {
      const ctx = await this.getStreamContext();
      if (ctx.current) {
        const { entries } = this.readPeriodNote(ctx.current.relPath);
        const recent = [...entries].reverse().slice(0, 20);
        if (recent.length > 0) {
          contextParts.push(
            "## Recent Stream Entries\n" +
              recent.map((e) => `- ${e.time} ${e.text}`).join("\n"),
          );
        }
      }
    } catch {
      // Stream context unavailable — skip
    }

    // Current todos
    try {
      const todos = this.readTodos();
      const active = todos.filter((todo) => !todo.done).slice(0, 10);
      if (active.length > 0) {
        contextParts.push(
          "## Current Todos\n" + active.map((todo) => `- ${todo.text}${todo.dueDate ? ` (due: ${todo.dueDate})` : ""}`).join("\n"),
        );
      }
    } catch {
      // Todos unavailable — skip
    }

    // Profile (if exists) — expanded from 2000 → 3000 chars
    try {
      const profilePath = path.join(this.getVaultPath(), "memory", "profile.md");
      if (fs.existsSync(profilePath)) {
        const profile = fs.readFileSync(profilePath, "utf-8");
        const trimmed = profile.slice(0, 3000);
        contextParts.push("## User Profile\n" + trimmed);
      }
    } catch {
      // Profile unavailable — skip
    }

    // Recent periodic reflections (semantic memory — insights about the user)
    try {
      const reflections = this.loadRecentReflections();
      if (reflections) {
        contextParts.push("## Recent Reflections (extracted insights)\n" + reflections);
      }
    } catch {
      // Reflections unavailable — skip
    }

    // Locale-aware system prompt — follows UI language setting
    const locale = this.settings.localeOverride || "zh-CN";
    const isZh = locale.startsWith("zh") || locale === "";
    const systemPrompt = isZh
      ? "你是嵌入在 topmind Obsidian 插件中的 AI 助手。" +
        "你帮助用户反思笔记、规划任务、整理思路。" +
        "回答简洁实用，引用用户的真实数据时要有针对性。\n\n" +
        (contextParts.length > 0
          ? "以下是用户当前的上下文：\n\n" + contextParts.join("\n\n")
          : "暂无工作区上下文。")
      : "You are a helpful AI assistant embedded in the topmind Obsidian plugin. " +
        "You help the user reflect on their notes, plan tasks, and organize their thoughts. " +
        "Be concise, practical, and reference the user's actual data when relevant.\n\n" +
        (contextParts.length > 0
          ? "Here is the user's current context:\n\n" + contextParts.join("\n\n")
          : "No workspace context available yet.");

    // Build conversation prompt from history + current message
    const conversationParts: string[] = [];
    for (const msg of history.slice(-10)) {
      conversationParts.push(`${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`);
    }
    conversationParts.push(`User: ${userMessage}`);
    const prompt = conversationParts.join("\n\n");

    return aiProvider.generate(prompt, {
      operation: "chat",
      systemPrompt,
      maxOutputTokens: 4096,
      temperature: 0.6,
    } as Record<string, unknown>);
  }

  /**
   * Load recent periodic reflections from memory/periodic/ for chat context.
   * Reads the most recent reflection file (current year) and trims to 2000 chars.
   * Returns null if no reflections exist.
   */
  private loadRecentReflections(): string | null {
    try {
      const vaultPath = this.getVaultPath();
      const periodicDir = path.join(vaultPath, "memory", "periodic");
      if (!fs.existsSync(periodicDir)) return null;

      // Check year subdirectory (memory/periodic/{YYYY}/) — aligned with stream yearDir
      const currentYear = String(new Date().getFullYear());
      const yearDir = path.join(periodicDir, currentYear);
      const searchDir = fs.existsSync(yearDir) ? yearDir : periodicDir;

      // Find the most recent .md file
      const files = fs.readdirSync(searchDir)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .reverse();
      if (files.length === 0) return null;

      const content = fs.readFileSync(path.join(searchDir, files[0]), "utf-8");
      // Trim to 2000 chars — enough for key insights without overwhelming context
      return content.slice(0, 2000);
    } catch {
      return null;
    }
  }

  /**
   * Get a display label for the currently active AI provider + model.
   */
  getActiveModelLabel(): string {
    const { provider, model } = resolveAiEndpoint(this.settings);
    if (provider === "none" || !model) return "";
    const preset = AI_PROVIDER_PRESETS[provider];
    const providerLabel = preset?.label || provider;
    return `${providerLabel} · ${model}`;
  }

  // ── AI Availability ──────────────────────────────────────────────────

  /**
   * Check if AI is configured (has at least one provider with keys).
   * This is a synchronous check — does not make network requests.
   */
  isAiConfigured(): boolean {
    return hasConfiguredProvider(this.settings.ai);
  }

  /**
   * Get list of configured providers for model switcher UI.
   * Returns array of { id, label, model } for each provider that has keys.
   */  
  getConfiguredProviders(): { id: string; label: string; model: string }[] {
    const result: { id: string; label: string; model: string }[] = [];
    for (const [pid, meta] of Object.entries(AI_PROVIDER_PRESETS)) {
      if (pid === "custom") {
        if (this.settings.ai.manual.customBaseUrl && this.settings.ai.manual.customKey) {
          result.push({
            id: pid,
            label: meta.label,
            model: this.settings.ai.defaultModel || "",
          });
        }
      } else if (pid === "ollama") {
        if (this.settings.ai.manual.ollamaBaseUrl) {
          result.push({
            id: pid,
            label: meta.label,
            model: this.settings.ai.defaultModel || meta.model,
          });
        }
      } else {
        const key = getProviderKey(pid, this.settings.ai.manual);
        if (key) {
          result.push({
            id: pid,
            label: meta.label,
            model: this.settings.ai.defaultModel || meta.model,
          });
        }
      }
    }
    return result;
  }

  /**
   * Get available models for a provider (from static defaults).
   * For dynamic model lists, use getModelsForProvider from models-dev.ts.
   */
  getProviderModels(providerId: string): { id: string; label: string }[] {
    const preset = AI_PROVIDER_PRESETS[providerId];
    const models = PROVIDER_DEFAULT_MODELS[providerId] || [];
    const result = [...models];
    // Add preset default if not already in list
    if (preset?.model && !result.some((m) => m.id === preset.model)) {
      result.unshift({ id: preset.model, label: `${preset.model} (${t("settings_ai_model_default")})` });
    }
    return result;
  }

  /**
   * Quick AI availability test — sends a minimal request to check connectivity.
   * Returns { ok, error? }.
   */
  async quickTestAi(): Promise<{ ok: boolean; error?: string }> {
    const provider = createAiProvider(this.settings);
    if (!provider) {
      return { ok: false, error: t("settings_ai_test_no_key") };
    }
    try {
      const reply = await provider.generate("Reply with: OK", { operation: "test" });
      if (reply && reply.trim().length > 0) {
        return { ok: true };
      }
      return { ok: false, error: "empty response" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Create an AI provider from current settings for connection testing.
   * Returns the provider without creating a full Kernel context.
   */
  testAiConnection(): AiProvider {
    return createAiProvider(this.settings) || {
      async generate(): Promise<string> {
        throw new Error("AI provider not configured");
      },
    };
  }

  /** Get the vault base path (public for settings tab contract doctor) */
  getVaultPath(): string {
    return getVaultBasePath(this.app);
  }

  private getEngineRoot(): string {
    return getEngineRoot(this.plugin);
  }
}
