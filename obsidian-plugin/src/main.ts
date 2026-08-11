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

import { Plugin, WorkspaceLeaf, Notice } from "obsidian";
import { DEFAULT_SETTINGS, migrateSettings, hasConfiguredProvider, type TopmindSettings } from "./types";
import {
  VIEW_TYPE_STREAM_WORKBENCH,
  VIEW_TYPE_SIDEBAR_DOCK,
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
import { TopmindSettingTab } from "./settings/settings-tab";
import { StreamWorkbenchView } from "./views/stream-workbench-view";
import { SidebarDockView } from "./views/sidebar-dock-view";
import { QuickCaptureModal } from "./views/quick-capture-modal";
import { setLocale, t } from "./i18n";

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

  // Also check legacy fields
  if (!merged.aiApiKey && backup.aiApiKey) {
    merged.aiApiKey = String(backup.aiApiKey);
  }
  if (!merged.aiBaseUrl && backup.aiBaseUrl) {
    merged.aiBaseUrl = String(backup.aiBaseUrl);
  }
  if (!merged.aiModel && backup.aiModel) {
    merged.aiModel = String(backup.aiModel);
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

    // ── Register views ──
    this.registerView(
      VIEW_TYPE_STREAM_WORKBENCH,
      (leaf: WorkspaceLeaf) => new StreamWorkbenchView(leaf, this),
    );
    this.registerView(
      VIEW_TYPE_SIDEBAR_DOCK,
      (leaf: WorkspaceLeaf) => new SidebarDockView(leaf, this),
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
      callback: () => this.openProfile(),
    });

    this.addCommand({
      id: CMD_OPEN_INBOX,
      name: t("cmd_open_inbox"),
      callback: () => this.openInbox(),
    });

    // ── Settings tab ──
    this.addSettingTab(new TopmindSettingTab(this.app, this));

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
        this.kernelService.runOperation("todo_maintain").catch((err) => {
          console.error("[topmind] auto todo_maintain failed:", err);
        });
      });
    }
  }

  onunload(): void {
    this.kernelService?.dispose();
  }

  // ── Settings ──────────────────────────────────────────────────────────

  async loadSettings(): Promise<void> {
    const raw = (await this.loadData()) as Record<string, unknown> | null;
    if (raw) {
      this.settings = migrateSettings(raw);
    } else {
      this.settings = { ...DEFAULT_SETTINGS };
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
    // Ensure .topmind/ directory exists
    const dir = ".topmind";
    try {
      if (!await adapter.exists(dir)) {
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
      await this.kernelService.runOperation("todo_maintain");
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
    await this.kernelService.generateSuggestions();
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_STREAM_WORKBENCH);
    for (const leaf of leaves) {
      if (leaf.view instanceof StreamWorkbenchView) {
        await leaf.view.refreshSuggestions();
      }
    }
  }

  private async maintainTodos(): Promise<void> {
    if (!this.kernelService.isWorkspaceReady()) {
      new Notice(t("notice_workspace_not_ready"));
      return;
    }
    new Notice(t("notice_todo_running"));
    const result = await this.kernelService.runOperation("todo_maintain", { force: true });
    if (result.ok) {
      new Notice(t("notice_todo_done"));
    } else {
      new Notice(`${t("notice_execute_failed")}: ${result.summary}`);
    }
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR_DOCK);
    for (const leaf of leaves) {
      if (leaf.view instanceof SidebarDockView) {
        await leaf.view.refresh();
      }
    }
  }

  private async classifyTopics(): Promise<void> {
    if (!this.kernelService.isWorkspaceReady()) {
      new Notice(t("notice_workspace_not_ready"));
      return;
    }
    new Notice(t("notice_classify_running"));
    const result = await this.kernelService.runOperation("topic_classify", { force: true });
    if (result.ok) {
      new Notice(result.summary || t("notice_classify_done"));
    } else {
      new Notice(`${t("notice_execute_failed")}: ${result.summary}`);
    }
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_STREAM_WORKBENCH);
    for (const leaf of leaves) {
      if (leaf.view instanceof StreamWorkbenchView) {
        await leaf.view.refreshSuggestions();
      }
    }
  }

  private async organizeMemory(): Promise<void> {
    if (!this.kernelService.isWorkspaceReady()) {
      new Notice(t("notice_workspace_not_ready"));
      return;
    }
    new Notice(t("notice_memory_running"));
    const result = await this.kernelService.runOperation("memory_organize", { force: true });
    if (result.ok) {
      new Notice(result.summary || t("notice_memory_done"));
    } else {
      new Notice(`${t("notice_execute_failed")}: ${result.summary}`);
    }
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_STREAM_WORKBENCH);
    for (const leaf of leaves) {
      if (leaf.view instanceof StreamWorkbenchView) {
        await leaf.view.refreshAll();
      }
    }
  }

  private async openProfile(): Promise<void> {
    if (!this.kernelService.isWorkspaceReady()) {
      new Notice(t("notice_workspace_not_ready"));
      return;
    }
    await this.app.workspace.openLinkText("memory/profile.md", "", false);
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
