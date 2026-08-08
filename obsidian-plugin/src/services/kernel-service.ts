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
import { createAiProvider } from "../bridge/ai-provider";
import { createKernelContextFromApp, type KernelContext, getKernel } from "../bridge/kernel-loader";
import {
  parseStreamEntries,
  normalizeSuggestionList,
  mapKernelSuggestion,
  mapApplySuggestionResult,
} from "../utils";
import {
  captureToWorkspace,
  listStreamPeriodsForWorkspace,
  reconcilePeriodNote,
  readTodosFromWorkspace,
  initWorkspaceStructure,
} from "./kernel-workspace-ops";
import { t } from "../i18n";

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
    const hash = `${settings.aiProvider}|${settings.aiApiKey}|${settings.aiBaseUrl}|${settings.aiModel}`;
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
      this.context = createKernelContextFromApp(this.app, this.plugin, aiProvider);
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
   * Caches based on topmind.yaml mtime — invalidates when config changes.
   * This avoids repeated disk scans (discoverCategoryDirs) on every UI refresh.
   */
  private getResolvedModel(): { categories: { role: string; directory: string; name: string }[]; contract?: Record<string, unknown> } {
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

  private getVaultPath(): string {
    // @ts-expect-error — getBasePath is internal but stable on desktop
    return this.app.vault.adapter.getBasePath();
  }

  private getEngineRoot(): string {
    return this.plugin.manifest.dir || "";
  }
}
