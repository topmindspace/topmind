// ── topmind Stream for Obsidian — Plugin Main Entry ────────────────────────
//
// This is the single entry point loaded by Obsidian (manifest.json → main.js).
// It registers views, commands, settings, and ribbon icon.

import { Plugin, WorkspaceLeaf, Notice } from "obsidian";
import { DEFAULT_SETTINGS, migrateSettings, type TopmindSettings } from "./types";
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

export default class TopmindPlugin extends Plugin {
  declare settings: TopmindSettings;
  kernelService!: KernelService;

  async onload(): Promise<void> {
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
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.kernelService?.updateSettings(this.settings);
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
