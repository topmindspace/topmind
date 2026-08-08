// ── Sidebar Dock View: compact widget in Obsidian sidebar ──────────────────

import { ItemView, WorkspaceLeaf } from "obsidian";
import type TopmindPlugin from "../main";
import { t } from "../i18n";
import { VIEW_TYPE_SIDEBAR_DOCK, VIEW_TYPE_STREAM_WORKBENCH } from "../constants";
import type { TodoItem, StreamEntry } from "../types";
import { isStreamOrTodoPath } from "../utils";

export class SidebarDockView extends ItemView {
  plugin: TopmindPlugin;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: TopmindPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_SIDEBAR_DOCK;
  }

  getDisplayText(): string {
    return t("sidebar_dock_title");
  }

  getIcon(): string {
    return "list-todo";
  }

  async onOpen(): Promise<void> {
    await this.refresh();
    // Listen for vault changes instead of polling (filtered to stream/todo paths)
    // Also invalidate kernel cache on topmind.yaml changes
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file.path === "topmind.yaml") {
          this.plugin.kernelService.invalidateCache();
        }
        if (isStreamOrTodoPath(file.path) || file.path === "topmind.yaml") {
          this.scheduleRefresh(450);
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (isStreamOrTodoPath(file.path)) {
          this.scheduleRefresh(450);
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (isStreamOrTodoPath(file.path)) {
          this.scheduleRefresh(450);
        }
      }),
    );
  }

  async onClose(): Promise<void> {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
  }

  private scheduleRefresh(delay: number): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refresh(), delay);
  }

  async refresh(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tm-sidebar-dock");

    if (!this.plugin.kernelService.isWorkspaceReady()) {
      contentEl.createDiv({
        cls: "tm-empty-state",
        text: t("init_workspace"),
      });
      return;
    }

    // ── Today's Todos ──
    const todoSection = contentEl.createDiv({ cls: "tm-sidebar-section" });
    todoSection.createDiv({
      cls: "tm-sidebar-section-title",
      text: "📋 " + t("sidebar_today_todos"),
    });

    const todos = this.plugin.kernelService.readTodos();
    const activeTodos = todos.filter((item) => !item.completed).slice(0, 5);

    if (activeTodos.length === 0) {
      todoSection.createDiv({
        cls: "tm-empty-state",
        text: t("sidebar_no_todos"),
      });
    } else {
      for (const todo of activeTodos) {
        const item = todoSection.createDiv({
          cls: "tm-todo-item",
        });
        const checkbox = item.createEl("input", {
          attr: { type: "checkbox", "aria-label": todo.text },
          cls: "tm-todo-checkbox",
        });
        checkbox.addEventListener("change", () => {
          this.plugin.kernelService.toggleTodo(todo.id);
          // Optimistic UI: strike through the item instead of full refresh
          // (the vault.on("modify") event will trigger a debounced refresh anyway)
          if (checkbox.checked) {
            item.classList.add("tm-completed");
          }
        });
        item.createSpan({ text: todo.text });
      }
    }

    // ── Recent Stream ──
    const streamSection = contentEl.createDiv({ cls: "tm-sidebar-section" });
    streamSection.createDiv({
      cls: "tm-sidebar-section-title",
      text: "🌊 " + t("sidebar_recent_stream"),
    });

    const ctx = this.plugin.kernelService.getStreamContext();
    const currentPeriod = ctx.current;

    if (currentPeriod) {
      const { entries } = this.plugin.kernelService.readPeriodNote(currentPeriod.relPath);
      const recent = [...entries].reverse().slice(0, 3);

      if (recent.length === 0) {
        streamSection.createDiv({
          cls: "tm-empty-state",
          text: t("sidebar_no_stream"),
        });
      } else {
        for (const entry of recent) {
          const item = streamSection.createDiv({ cls: "tm-sidebar-stream-item" });
          item.createSpan({
            cls: "tm-sidebar-stream-time",
            text: entry.time,
          });
          item.createSpan({
            text: entry.text.slice(0, 50) + (entry.text.length > 50 ? "..." : ""),
          });
          item.addEventListener("click", () => {
            this.openWorkbench();
          });
        }
      }
    } else {
      streamSection.createDiv({
        cls: "tm-empty-state",
        text: t("sidebar_no_stream"),
      });
    }

    // ── Open Workbench Button ──
    const openBtn = contentEl.createEl("button", {
      cls: "tm-sidebar-open-btn",
      text: t("sidebar_open_workbench") + " →",
    });
    openBtn.setAttribute("aria-label", t("sidebar_open_workbench"));
    openBtn.addEventListener("click", () => this.openWorkbench());
  }

  private async openWorkbench(): Promise<void> {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE_STREAM_WORKBENCH, active: true });
  }
}
