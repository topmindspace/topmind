// ── topmind Stream for Obsidian — Plugin Main Entry ────────────────────────
//
// This is the single entry point loaded by Obsidian (manifest.json → main.js).
// It registers views, commands, settings, and ribbon icon.

import { Plugin, WorkspaceLeaf, Notice } from "obsidian";
import { DEFAULT_SETTINGS, type TopmindSettings } from "./types";
import {
  VIEW_TYPE_STREAM_WORKBENCH,
  VIEW_TYPE_SIDEBAR_DOCK,
  CMD_QUICK_CAPTURE,
  CMD_OPEN_WORKBENCH,
  CMD_OPEN_SIDEBAR,
  CMD_ORGANIZE_PERIOD,
  CMD_REFRESH_SUGGESTIONS,
  CMD_MAINTAIN_TODOS,
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
    // ── Load settings ──
    await this.loadSettings();

    // ── i18n ──
    const locale = (this.app as unknown as { locale?: string }).locale || "zh-CN";
    setLocale(locale.startsWith("en") ? "en-US" : "zh-CN");

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

    // ── Ribbon icon ──
    this.addRibbonIcon("zap", t("quick_capture_title"), () => {
      this.openQuickCapture();
    });

    // ── Commands ──
    this.addCommand({
      id: CMD_QUICK_CAPTURE,
      name: t("cmd_quick_capture"),
      callback: () => this.openQuickCapture(),
      // No default hotkey — Obsidian guidelines advise against setting
      // default hotkeys to avoid conflicts with other plugins.
      // Users can configure their own hotkey in Settings → Hotkeys.
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

    // ── Settings tab ──
    this.addSettingTab(new TopmindSettingTab(this.app, this));

    // ── Auto-open workbench on startup ──
    if (this.settings.autoOpenWorkbench) {
      this.app.workspace.onLayoutReady(() => {
        this.openWorkbench();
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
    // KernelService context is per-workspace — no global state to clean.
    // Obsidian automatically removes registered views, commands, and events.
    // Views handle their own timer cleanup in onClose().
    this.kernelService?.dispose();
  }

  // ── Settings ──────────────────────────────────────────────────────────

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData(),
    );
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
    // Reuse existing leaf if the workbench is already open
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

    // Reconcile the current period note via Kernel
    const ctx = this.kernelService.getStreamContext();
    if (ctx.current) {
      this.kernelService.reconcilePeriod(ctx.current.relPath);
    }

    // Try AI maintain todos if enabled
    if (this.settings.autoMaintainTodos) {
      await this.kernelService.runOperation("todo_maintain");
    }

    // Refresh the workbench view if open
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
    const suggestions = await this.kernelService.generateSuggestions();
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
    const result = await this.kernelService.runOperation("todo_maintain", { force: true });
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR_DOCK);
    for (const leaf of leaves) {
      if (leaf.view instanceof SidebarDockView) {
        await leaf.view.refresh();
      }
    }
  }
}
