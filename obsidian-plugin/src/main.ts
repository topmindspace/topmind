// ── topmind Stream for Obsidian — Plugin Main Entry ────────────────────────
//
// This is the single entry point loaded by Obsidian (manifest.json → main.js).
// It registers views, commands, settings, and ribbon icon.
//
// AI Key Persistence: In addition to Obsidian's data.json, AI keys are backed
// up to {vault}/.topmind/ai-keys-backup.json on every save. On load, if the
// main data has no AI keys but a backup exists, keys are restored from backup.
// This protects against data.json being wiped during plugin updates (BRAT,
// manual install, Obsidian sync conflicts, etc.).

import { Plugin, WorkspaceLeaf, Notice, setIcon } from "obsidian";
import { DEFAULT_SETTINGS, migrateSettings, hasConfiguredProvider, type TopmindSettings } from "./types";
import {
  VIEW_TYPE_STREAM_WORKBENCH,
  VIEW_TYPE_SIDEBAR_DOCK,
  VIEW_TYPE_MEMORY_BROWSE,
  CMD_QUICK_CAPTURE,
  CMD_OPEN_WORKBENCH,
  CMD_OPEN_SIDEBAR,
  CMD_ORGANIZE_PERIOD,
  CMD_REFRESH_SUGGESTIONS,
  CMD_MAINTAIN_TODOS,
  CMD_TOPIC_CLASSIFY,
  CMD_MEMORY_ORGANIZE,
  CMD_OPEN_PROFILE,
  CMD_OPEN_INBOX,
} from "./constants";
import { KernelService } from "./services/kernel-service";
import { aiTaskManager, type TaskProgress } from "./services/ai-task-manager";
import { TopmindSettingTab } from "./settings/settings-tab";
import { StreamWorkbenchView } from "./views/stream-workbench-view";
import { SidebarDockView } from "./views/sidebar-dock-view";
import { MemoryBrowseView } from "./views/memory-browse-view";
import { QuickCaptureModal } from "./views/quick-capture-modal";
import { setLocale, t, type LocaleKey } from "./i18n";

// ── AI Key Backup / Restore ───────────────────────────────────────────────
//
// Backup file path relative to vault root.
const AI_KEYS_BACKUP_PATH = ".topmind/ai-keys-backup.json";

/**
 * Extract only the AI-relevant fields for backup (don't backup everything —
 * just the irreplaceable key material that users would have to re-enter).
 */
function extractAiBackup(settings: TopmindSettings): Record<string, unknown> {
  return {
    ai: JSON.parse(JSON.stringify(settings.ai)),
    aiProvider: settings.aiProvider,
    aiApiKey: settings.aiApiKey,
    aiBaseUrl: settings.aiBaseUrl,
    aiModel: settings.aiModel,
    backupVersion: 1,
    backupAt: new Date().toISOString(),
  };
}

/**
 * Merge AI keys from backup into settings (only fills missing keys —
 * never overwrites keys that already exist in the current settings).
 */
function mergeAiBackup(settings: TopmindSettings, backup: Record<string, unknown>): TopmindSettings {
  const merged = { ...settings };
  // Deep-clone ai to avoid mutating the original
  merged.ai = {
    sourcePreference: settings.ai.sourcePreference,
    defaultModel: settings.ai.defaultModel,
    manual: { ...settings.ai.manual },
  };

  const backupAi = backup.ai as Record<string, unknown> | undefined;
  if (backupAi && typeof backupAi === "object") {
    const backupManual = backupAi.manual as Record<string, unknown> | undefined;
    if (backupManual && typeof backupManual === "object") {
      // Fill missing keys from backup — cast through unknown for safe key iteration
      const manualTarget = merged.ai.manual as unknown as Record<string, string>;
      for (const key of Object.keys(backupManual)) {
        const currentVal = manualTarget[key] || "";
        const backupVal = String(backupManual[key] || "");
        if (!currentVal && backupVal) {
          manualTarget[key] = backupVal;
        }
      }
    }
    if (!merged.ai.sourcePreference && backupAi.sourcePreference) {
      merged.ai.sourcePreference = String(backupAi.sourcePreference);
    }
    if (!merged.ai.defaultModel && backupAi.defaultModel) {
      merged.ai.defaultModel = String(backupAi.defaultModel);
    }
  }

  // Also check legacy fields. aiBaseUrl / aiModel defaults are non-empty
  // sentinels — "unset" means "still default", so restore when current is the
  // default AND the backup carries a non-default value (the old
  // `!merged.aiBaseUrl` guard could never fire).
  const LEGACY_BASEURL_DEFAULT = "https://api.deepseek.com/v1";
  const LEGACY_MODEL_DEFAULT = "deepseek-chat";
  if (!merged.aiApiKey && backup.aiApiKey) {
    merged.aiApiKey = String(backup.aiApiKey);
  }
  if (
    merged.aiBaseUrl === LEGACY_BASEURL_DEFAULT &&
    typeof backup.aiBaseUrl === "string" &&
    backup.aiBaseUrl &&
    backup.aiBaseUrl !== LEGACY_BASEURL_DEFAULT
  ) {
    merged.aiBaseUrl = backup.aiBaseUrl;
  }
  if (
    merged.aiModel === LEGACY_MODEL_DEFAULT &&
    typeof backup.aiModel === "string" &&
    backup.aiModel &&
    backup.aiModel !== LEGACY_MODEL_DEFAULT
  ) {
    merged.aiModel = backup.aiModel;
  }
  if (merged.aiProvider === "none" && backup.aiProvider) {
    merged.aiProvider = backup.aiProvider as TopmindSettings["aiProvider"];
  }

  return merged;
}

/**
 * Check if settings have any AI keys configured.
 */
function settingsHaveAiKeys(settings: TopmindSettings): boolean {
  return hasConfiguredProvider(settings.ai) || Boolean(settings.aiApiKey);
}

export default class TopmindPlugin extends Plugin {
  declare settings: TopmindSettings;
  kernelService!: KernelService;
  private statusBarEl: HTMLElement | null = null;
  private aiTaskUnsub: (() => void) | null = null;

  async onload(): Promise<void> {
    try {
      await this._onload();
    } catch (err) {
      const msg = err instanceof Error ? `${err.message}\n${err.stack || ""}` : String(err);
      console.error("[topmind] onload failed:", err);
      // Show a visible notice so users know what went wrong (esp. on Windows)
      new Notice(`[topmind] ${t("notice_load_failed")}: ${msg.slice(0, 200)}`, 10000);
      throw err; // Re-throw so Obsidian also reports it
    }
  }

  private async _onload(): Promise<void> {
    // ── Load settings (with migration from old single-provider model) ──
    await this.loadSettings();

    // ── i18n ──
    const obsLocale = (this.app as unknown as { locale?: string }).locale || "zh-CN";
    const locale = this.settings.localeOverride || (obsLocale.startsWith("en") ? "en-US" : "zh-CN");
    setLocale(locale);

    // ── Kernel Service ──
    this.kernelService = new KernelService(this.app, this, this.settings);
    // Display cache only: operational writeback is topmind.yaml
    this.kernelService.hydrateWritebackModeFromContract();

    // ── Register views ──
    this.registerView(
      VIEW_TYPE_STREAM_WORKBENCH,
      (leaf: WorkspaceLeaf) => new StreamWorkbenchView(leaf, this),
    );
    this.registerView(
      VIEW_TYPE_SIDEBAR_DOCK,
      (leaf: WorkspaceLeaf) => new SidebarDockView(leaf, this),
    );
    this.registerView(
      VIEW_TYPE_MEMORY_BROWSE,
      (leaf: WorkspaceLeaf) => new MemoryBrowseView(leaf, this),
    );

    // ── Ribbon icon (DESIGN §7: waves) ──
    this.addRibbonIcon("waves", t("quick_capture_title"), () => {
      this.openQuickCapture();
    });

    // ── Commands ──
    this.addCommand({
      id: CMD_QUICK_CAPTURE,
      name: t("cmd_quick_capture"),
      callback: () => this.openQuickCapture(),
    });

    this.addCommand({
      id: CMD_OPEN_WORKBENCH,
      name: t("cmd_open_workbench"),
      callback: () => this.openWorkbench(),
    });

    this.addCommand({
      id: CMD_OPEN_SIDEBAR,
      name: t("cmd_open_sidebar"),
      callback: () => this.openSidebar(),
    });

    this.addCommand({
      id: CMD_ORGANIZE_PERIOD,
      name: t("cmd_organize_period"),
      callback: () => this.organizePeriod(),
    });

    this.addCommand({
      id: CMD_REFRESH_SUGGESTIONS,
      name: t("cmd_refresh_suggestions"),
      callback: () => this.refreshSuggestions(),
    });

    this.addCommand({
      id: CMD_MAINTAIN_TODOS,
      name: t("cmd_maintain_todos"),
      callback: () => this.maintainTodos(),
    });

    this.addCommand({
      id: CMD_TOPIC_CLASSIFY,
      name: t("cmd_topic_classify"),
      callback: () => this.classifyTopics(),
    });

    this.addCommand({
      id: CMD_MEMORY_ORGANIZE,
      name: t("cmd_memory_organize"),
      callback: () => this.organizeMemory(),
    });

    this.addCommand({
      id: CMD_OPEN_PROFILE,
      name: t("cmd_open_profile"),
      callback: () => this.openMemoryBrowse(),
    });

    this.addCommand({
      id: CMD_OPEN_INBOX,
      name: t("cmd_open_inbox"),
      callback: () => this.openInbox(),
    });

    // ── Settings tab ──
    this.addSettingTab(new TopmindSettingTab(this.app, this));

    // ── Status bar entry — AI task state + one-click copilot open ──
    this.initStatusBarItem();

    // ── Auto-open workbench + sidebar on startup ──
    if (this.settings.autoOpenWorkbench) {
      this.app.workspace.onLayoutReady(() => {
        this.openWorkbench();
        // Also open sidebar for unified AI access
        this.openSidebar();
      });
    }

    // ── Auto-maintain todos if enabled ──
    if (this.settings.autoMaintainTodos && this.kernelService.isWorkspaceReady()) {
      this.app.workspace.onLayoutReady(() => {
        // Queued (not direct) so the task badge/history observes boot work too
        this.enqueueAiOperation("todo_maintain", "op_label_todo_maintain", "notice_todo_done", "sidebar", true);
      });
    }
  }

  onunload(): void {
    this.aiTaskUnsub?.();
    this.aiTaskUnsub = null;
    this.kernelService?.dispose();
  }

  // ── Settings ──────────────────────────────────────────────────────────

  async loadSettings(): Promise<void> {
    const raw = (await this.loadData()) as Record<string, unknown> | null;
    if (raw) {
      this.settings = migrateSettings(raw);
    } else {
      // Deep clone: a shallow copy shares the `ai` object reference with the
      // module-level DEFAULT_SETTINGS constant — editing keys in the settings
      // tab would mutate the constant for the rest of the session.
      this.settings = structuredClone(DEFAULT_SETTINGS);
    }

    // ── AI Key Restore: if data.json had no AI keys, try backup ──
    if (!settingsHaveAiKeys(this.settings)) {
      try {
        const backup = await this.loadAiKeysBackup();
        if (backup) {
          this.settings = mergeAiBackup(this.settings, backup);
          if (settingsHaveAiKeys(this.settings)) {
            console.info("[topmind] AI keys restored from backup file");
            // Persist the restored settings so data.json is back in sync
            await this.saveData(this.settings);
          }
        }
      } catch (err) {
        console.warn("[topmind] AI keys backup restore failed:", err);
      }
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.kernelService?.updateSettings(this.settings);
    // Write backup in background (non-blocking — main data.json is already saved)
    void this.saveAiKeysBackup().catch((err) => {
      console.warn("[topmind] AI keys backup save failed:", err);
    });
  }

  /**
   * Save AI keys backup to vault's .topmind/ directory.
   * This survives plugin updates even if data.json is wiped.
   */
  private async saveAiKeysBackup(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const backupData = extractAiBackup(this.settings);
    const json = JSON.stringify(backupData, null, 2);
    // Only write inside an existing system plane: a random vault where the
    // plugin is merely enabled must not grow a `.topmind/` machine dir.
    // After workspace init (topmind.yaml exists) the dir may be created.
    const dir = ".topmind";
    const dirExists = await adapter.exists(dir);
    if (!dirExists && !this.kernelService?.isWorkspaceReady()) return;
    try {
      if (!dirExists) {
        await adapter.mkdir(dir);
      }
    } catch {
      // Directory may already exist — ignore
    }
    await adapter.write(AI_KEYS_BACKUP_PATH, json);
  }

  /**
   * Load AI keys backup from vault's .topmind/ directory.
   * Returns null if backup doesn't exist or is invalid.
   */
  private async loadAiKeysBackup(): Promise<Record<string, unknown> | null> {
    const adapter = this.app.vault.adapter;
    try {
      if (!await adapter.exists(AI_KEYS_BACKUP_PATH)) return null;
      const json = await adapter.read(AI_KEYS_BACKUP_PATH);
      const parsed = JSON.parse(json);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  // ── View openers ──────────────────────────────────────────────────────

  openQuickCapture(): void {
    new QuickCaptureModal(this.app, this).open();
  }

  async openWorkbench(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_STREAM_WORKBENCH);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({
      type: VIEW_TYPE_STREAM_WORKBENCH,
      active: true,
    });
  }

  async openSidebar(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR_DOCK);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({
      type: VIEW_TYPE_SIDEBAR_DOCK,
      active: true,
    });
  }

  // ── Command handlers ──────────────────────────────────────────────────

  private async organizePeriod(): Promise<void> {
    if (!this.kernelService.isWorkspaceReady()) {
      new Notice(t("notice_workspace_not_ready"));
      return;
    }

    const ctx = await this.kernelService.getStreamContext();
    if (ctx.current) {
      this.kernelService.reconcilePeriod(ctx.current.relPath);
    }

    if (this.settings.autoMaintainTodos) {
      // Queued quiet — badge/history observes it; reconcile itself is sync-scheduled
      this.enqueueAiOperation("todo_maintain", "op_label_todo_maintain", "notice_todo_done", "sidebar", true);
    }

    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_STREAM_WORKBENCH);
    for (const leaf of leaves) {
      if (leaf.view instanceof StreamWorkbenchView) {
        await leaf.view.refreshAll();
      }
    }
  }

  private async refreshSuggestions(): Promise<void> {
    if (!this.kernelService.isWorkspaceReady()) {
      new Notice(t("notice_workspace_not_ready"));
      return;
    }
    await this.kernelService.generateSuggestions({ force: true });
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_STREAM_WORKBENCH);
    for (const leaf of leaves) {
      if (leaf.view instanceof StreamWorkbenchView) {
        await leaf.view.refreshSuggestions();
      }
    }
  }

  private maintainTodos(): void {
    if (!this.kernelService.isWorkspaceReady()) {
      new Notice(t("notice_workspace_not_ready"));
      return;
    }
    new Notice(t("notice_todo_running"));
    this.enqueueAiOperation("todo_maintain", "op_label_todo_maintain", "notice_todo_done", "sidebar");
  }

  private classifyTopics(): void {
    if (!this.kernelService.isWorkspaceReady()) {
      new Notice(t("notice_workspace_not_ready"));
      return;
    }
    new Notice(t("notice_classify_running"));
    this.enqueueAiOperation("topic_classify", "op_label_topic_classify", "notice_classify_done", "suggest");
  }

  private organizeMemory(): void {
    if (!this.kernelService.isWorkspaceReady()) {
      new Notice(t("notice_workspace_not_ready"));
      return;
    }
    new Notice(t("notice_memory_running"));
    this.enqueueAiOperation("memory_organize", "op_label_memory_organize", "notice_memory_done", "all");
  }

  // ── Shared AI operation lane ──────────────────────────────────────────

  /**
   * Enqueue an AI operation on the shared serial lane. Command palette, boot
   * auto-maintain, and sidebar buttons all route through the same queue so
   * the task badge + history observe every AI pass (Desktop parity: its
   * background lane is the single writer).
   *
   * @param quiet suppress per-result Notices (boot/background callers) — the
   *              badge/history still observe the task.
   */
  enqueueAiOperation(
    operation: "todo_maintain" | "topic_classify" | "memory_organize",
    labelKey: LocaleKey,
    doneKey: LocaleKey,
    refresh: "sidebar" | "suggest" | "all",
    quiet = false,
  ): void {
    const label = t(labelKey);
    if (aiTaskManager.isOperationActive(operation)) {
      if (!quiet) new Notice(`${label} ${t("task_running")}`);
      return;
    }
    aiTaskManager.enqueue(operation, label, async () => {
      const result = await this.kernelService.runOperation(operation, { force: true });
      if (!quiet) {
        if (result.ok) {
          new Notice(result.summary || t(doneKey));
        } else {
          new Notice(`${t("task_result_failed")}: ${result.summary}`);
        }
      }
      this.refreshPluginViews(refresh);
      return result;
    });
  }

  private refreshPluginViews(scope: "sidebar" | "suggest" | "all"): void {
    const sideLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR_DOCK);
    for (const leaf of sideLeaves) {
      if (leaf.view instanceof SidebarDockView) {
        void leaf.view.refresh();
      }
    }
    if (scope === "sidebar") return;
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_STREAM_WORKBENCH);
    for (const leaf of leaves) {
      if (leaf.view instanceof StreamWorkbenchView) {
        void (scope === "all" ? leaf.view.refreshAll() : leaf.view.refreshSuggestions());
      }
    }
  }

  // ── Status bar entry ──────────────────────────────────────────────────

  /**
   * Persistent Obsidian status bar item (entry-point parity with Desktop's
   * statusbar task toggle): quiet sparkles when idle, spinner + active task
   * label while the AI lane runs. Click opens/reveals the AI copilot sidebar.
   */
  private initStatusBarItem(): void {
    const el = this.addStatusBarItem();
    el.addClass("tm-status-bar-item");
    el.setAttribute("aria-label", t("statusbar_tip"));
    el.setAttribute("data-tooltip-position", "top");
    el.addEventListener("click", () => void this.openSidebar());
    this.statusBarEl = el;
    this.aiTaskUnsub = aiTaskManager.subscribe((progress) => this.updateStatusBarItem(progress));
    this.updateStatusBarItem(aiTaskManager.getProgress());
  }

  private updateStatusBarItem(progress: TaskProgress): void {
    const el = this.statusBarEl;
    if (!el) return;
    el.empty();
    const active = progress.active;
    if (active) {
      el.addClass("tm-status-bar-running");
      el.createSpan({ cls: "tm-status-bar-spinner", attr: { "aria-hidden": "true" } });
      el.createSpan({ text: active.label, cls: "tm-status-bar-label" });
    } else {
      el.removeClass("tm-status-bar-running");
      setIcon(el.createSpan({ cls: "tm-status-bar-icon" }), "sparkles");
      if (progress.queued.length > 0) {
        el.createSpan({
          text: t("task_queued_count").replace("{{count}}", String(progress.queued.length)),
          cls: "tm-status-bar-label",
        });
      }
    }
  }

  async openMemoryBrowse(): Promise<void> {
    if (!this.kernelService.isWorkspaceReady()) {
      new Notice(t("notice_workspace_not_ready"));
      return;
    }
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_MEMORY_BROWSE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      const view = existing[0].view;
      if (view instanceof MemoryBrowseView) await view.refresh();
      return;
    }
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE_MEMORY_BROWSE, active: true });
  }

  private async openInbox(): Promise<void> {
    if (!this.kernelService.isWorkspaceReady()) {
      new Notice(t("notice_workspace_not_ready"));
      return;
    }
    const model = this.kernelService.getResolvedModel();
    const buffer = model.categories.find((c) => c.role === "buffer");
    if (!buffer) {
      new Notice(t("notice_no_inbox"));
      return;
    }
    // Reveal the inbox folder in Obsidian's file explorer (left sidebar)
    try {
      const adapter = this.app.vault.adapter;
      const inboxPath = buffer.directory;
      if (!await adapter.exists(inboxPath)) {
        await adapter.mkdir(inboxPath);
      }
      const fileItem = this.app.vault.getAbstractFileByPath(inboxPath);
      if (fileItem) {
        // @ts-expect-error — internal API: reveal file/folder in explorer
        this.app.explorer?.revealFile?.(fileItem);
      }
    } catch {
      // Fallback: just show a notice
      new Notice(t("notice_no_inbox"));
    }
  }
}
