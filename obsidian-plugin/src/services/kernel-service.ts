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
  stripFrontmatter,
  extractFrontmatter,
  seedPeriodFrontmatter,
  sanitizeFileName,
} from "../utils";
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

  /** Initialize workspace structure in current vault */
  initWorkspace(templateId: string = "stream"): { ok: boolean; error?: string } {
    try {
      const kernel = getKernel();
      const workspaceRoot = this.getVaultPath();
      const engineRoot = this.getEngineRoot();

      // ensureRequiredStructure loads the template internally and creates
      // required role dirs (buffer/delivery/system) + v4 contract.
      // It won't revive user-deleted optional categories.
      kernel.ensureRequiredStructure(workspaceRoot, { engineRoot, templateId });

      // Invalidate cache — new topmind.yaml and dirs were created
      this.invalidateCache();

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
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

  /** Get current stream period info */
  getStreamContext(): { periods: StreamPeriod[]; current: StreamPeriod | null } {
    const kernel = getKernel();
    const workspaceRoot = this.getVaultPath();

    try {
      const model = this.getResolvedModel();

      // Find stream category
      const streamCat = kernel.findStreamCategory(model);
      if (!streamCat) return { periods: [], current: null };

      const periods = kernel.listStreamPeriods(workspaceRoot, streamCat.directory);

      const streamPeriods: StreamPeriod[] = periods.map((p: { period: string; relPath: string; title: string; entryCount: number; mtime: number }) => ({
        period: p.period,
        relPath: p.relPath,
        title: p.title,
        entryCount: p.entryCount,
        mtime: p.mtime,
      }));

      const current = streamPeriods[0] || null;
      return { periods: streamPeriods, current };
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
    // Pre-flight: workspace must be ready
    if (!this.isWorkspaceReady()) {
      new Notice(t("notice_workspace_not_ready"));
      return { ok: false, error: "workspace-not-ready" };
    }

    // Guard against empty / whitespace-only text
    const trimmed = text.trim();
    if (!trimmed) {
      return { ok: false, error: "empty-text" };
    }

    // Guard against excessively long input (prevents pathological file names)
    const MAX_CAPTURE_LEN = 10_000;
    const safeText = trimmed.length > MAX_CAPTURE_LEN
      ? trimmed.slice(0, MAX_CAPTURE_LEN) + "…(truncated)"
      : trimmed;

    try {
      const kernel = getKernel();
      const workspaceRoot = this.getVaultPath();
      const target = opts.target || "stream";
      const model = this.getResolvedModel();
      const contract = model.contract || this.loadContract();

      let relPath: string;
      let content: string;

      if (target === "stream") {
        const streamCat = kernel.findStreamCategory(model);
        if (!streamCat) throw new Error("No stream category found in workspace");

        const contractData = model.contract as { stream?: { packing?: string; appendHeading?: string } } | undefined;
        const packing = contractData?.stream?.packing || "weekly";
        const streamTarget = kernel.resolveStreamTarget({
          workspaceRoot,
          categoryDir: streamCat.directory,
          packing,
        });
        relPath = streamTarget.relPath;

        // Build content with tags appended
        const tagSuffix = opts.tags?.length ? ` ${opts.tags.map((tag) => `#${tag}`).join(" ")}` : "";
        const captureContent = `${safeText}${tagSuffix}`;

        // Read existing body (strip frontmatter for appendToPeriodBody)
        const absPath = path.join(workspaceRoot, relPath);
        const raw = fs.existsSync(absPath) ? fs.readFileSync(absPath, "utf-8") : "";
        const body = stripFrontmatter(raw);

        // Use Kernel's appendToPeriodBody — handles day headings, seeding, bullet format
        const newBody = kernel.appendToPeriodBody(body, {
          content: captureContent,
          packing,
          appendHeading: contractData?.stream?.appendHeading || "day",
        });

        // Re-attach frontmatter (or seed if new)
        const fm = extractFrontmatter(raw) || seedPeriodFrontmatter(relPath);
        content = `${fm}${newBody}`;
      } else {
        // Inbox — use the buffer directory directly (already includes NN- prefix)
        const inboxDir = this.getInboxDir(model);
        relPath = `${inboxDir}/${Date.now()}-${sanitizeFileName(safeText.slice(0, 30))}.md`;
        const tagSuffix = opts.tags?.length ? ` ${opts.tags.map((tag) => `#${tag}`).join(" ")}` : "";
        content = `---\nsource_type: external-capture\ncreated: ${new Date().toISOString()}\ntags: [${(opts.tags || []).join(", ")}]\n---\n\n# ${safeText.slice(0, 80)}\n\n${safeText}${tagSuffix}\n`;
      }

      // Write via writeback-engine (唯一写闸)
      // skipShadow: true — shadow copy is not needed for stream captures
      //   (the user's content is immediately visible in the period note;
      //   shadow copies are for long-form edits where undo recovery matters).
      const targetPath = path.join(workspaceRoot, relPath);
      const isUpdate = fs.existsSync(targetPath);
      const result = kernel.executeWrite({
        targetPath,
        content,
        workspaceRoot,
        contract,
        operation: isUpdate ? "update" : "create",
        actor: "user",
        confirmed: true,
        skipShadow: true,
        writebackModeOverride: this.writebackModeOverride,
      });

      if (result.pending) {
        new Notice(t("notice_write_pending"));
        return { ok: false, error: "pending-confirmation" };
      }

      const displayPath = relPath.replace(/\\/g, "/");
      new Notice(`${t("notice_written")} → ${displayPath}`);
      return { ok: true, path: displayPath };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`${t("notice_write_failed")}: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  /**
   * Reconcile a period note — merges scattered entries, fixes day headings,
   * and cleans up structure. Uses Kernel's reconcilePeriodBody.
   */
  reconcilePeriod(relPath: string): { ok: boolean; reconciled: boolean; error?: string } {
    try {
      const kernel = getKernel();
      const workspaceRoot = this.getVaultPath();
      const model = this.getResolvedModel();
      const contract = model.contract || this.loadContract();

      const absPath = path.join(workspaceRoot, relPath);
      if (!fs.existsSync(absPath)) {
        return { ok: false, reconciled: false, error: "period note not found" };
      }

      const raw = fs.readFileSync(absPath, "utf-8");
      const fm = extractFrontmatter(raw) || seedPeriodFrontmatter(relPath);
      const body = stripFrontmatter(raw);

      const contractData = contract as { stream?: { packing?: string; appendHeading?: string } } | undefined;
      const packing = contractData?.stream?.packing || "weekly";
      const appendHeading = contractData?.stream?.appendHeading || "day";

      const result = kernel.reconcilePeriodBody({ body, packing, appendHeading });

      if (!result.reconciled) {
        return { ok: true, reconciled: false };
      }

      // Write reconciled content via writeback-engine
      const content = `${fm}${result.body}`;
      kernel.executeWrite({
        targetPath: absPath,
        content,
        workspaceRoot,
        contract,
        operation: "update",
        actor: "user",
        confirmed: true,
        skipShadow: true,
        writebackModeOverride: this.writebackModeOverride,
      });

      return { ok: true, reconciled: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reconciled: false, error: msg };
    }
  }

  // ── Suggestions ────────────────────────────────────────────────────────

  /** Generate AI suggestions */
  async generateSuggestions(): Promise<SuggestionCard[]> {
    if (!this.settings.autoSuggest) return [];

    try {
      const ctx = this.getContext();
      const raw = await ctx.generateSuggestions({ force: false });

      // Kernel's suggest-engine returns a Suggestion[] directly (synchronous).
      // Handle both direct array and legacy { suggestions: [] } wrapper shapes.
      const items = Array.isArray(raw)
        ? raw
        : ((raw as { suggestions?: unknown[] })?.suggestions || []);

      return (items as Record<string, unknown>[]).map((s) => ({
        id: String(s.id || ""),
        kind: (s.kind as SuggestionCard["kind"]) || "promote_memory",
        title: String(s.title || ""),
        summary: String(s.summary || ""),
        impact: (s.impact as SuggestionCard["impact"]) || "low",
        payload: s.payload as Record<string, unknown> | undefined,
        targetPath: s.targetPath as string | undefined,
      }));
    } catch (err) {
      console.error("[topmind] generateSuggestions failed:", err);
      return [];
    }
  }

  /** Apply (accept) a suggestion */
  async applySuggestion(suggestion: SuggestionCard): Promise<{ ok: boolean; error?: string }> {
    try {
      const ctx = this.getContext();
      // Kernel's applySuggestion expects (suggestion, opts) where suggestion
      // is the full suggestion object. targetPath is needed for some kinds
      // (inbox_review, stale_topic, catch_all, archive_path).
      await ctx.applySuggestion({
        id: suggestion.id,
        kind: suggestion.kind,
        title: suggestion.title,
        summary: suggestion.summary,
        impact: suggestion.impact,
        payload: suggestion.payload,
        targetPath: suggestion.targetPath,
      });
      new Notice(`${t("notice_executed")}: ${suggestion.title}`);
      return { ok: true };
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
        suggestions: ((result.suggestions || []) as Record<string, unknown>[]).map((s) => ({
          id: String(s.id || ""),
          kind: (s.kind as SuggestionCard["kind"]) || "promote_memory",
          title: String(s.title || ""),
          summary: String(s.summary || ""),
          impact: (s.impact as SuggestionCard["impact"]) || "low",
          payload: s.payload as Record<string, unknown> | undefined,
          targetPath: s.targetPath as string | undefined,
        })),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, summary: msg };
    }
  }

  // ── Todo ────────────────────────────────────────────────────────────────

  /** Read todo list (read-only — does NOT create the todo file as a side effect) */
  readTodos(): TodoItem[] {
    try {
      const kernel = getKernel();
      const workspaceRoot = this.getVaultPath();
      // Use readTodoList directly — ensureTodoFile is a write side effect
      // that should only happen on explicit user action, not on every UI refresh.
      const list = kernel.readTodoList(workspaceRoot);
      if (!list) return [];
      return ((list.items || []) as Record<string, unknown>[]).map((item) => ({
        id: String(item.id || ""),
        text: String(item.text || ""),
        completed: Boolean(item.completed),
        dueDate: item.dueDate as string | undefined,
        createdAt: item.createdAt as string | undefined,
        source: item.source as string | undefined,
      }));
    } catch {
      return [];
    }
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

  private getInboxDir(model: { categories: { role: string; directory: string }[] }): string {
    const buffer = model.categories.find((c) => c.role === "buffer");
    return buffer?.directory || "00-Inbox";
  }
}
