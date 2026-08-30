// ── Sidebar Dock View: AI Copilot Panel in Obsidian right sidebar ───────────
//
// Design: tabbed command center — all AI capabilities in one place.
// - Header: AI status + model badge + quick settings button + task badge
// - Tab bar: Todos | Suggestions | Chat | Stream | History
// - Tab content: rich, interactive panels
// - Quick actions row at bottom with optional labels
//
// UIUX (2026-08-11 refactor):
// - Header buttons: icon + text labels (with responsive hide on narrow)
// - Bottom actions: default show labels (showActionLabels = true)
// - Chat message buttons: icon-only with tooltips
// - Suggestion refresh: icon-only
// - Todo open file: icon-only
// - Chat send: icon-only with send icon
// - All loading states use spinners

import { ItemView, WorkspaceLeaf, Notice, MarkdownRenderer, setIcon } from "obsidian";
import type TopmindPlugin from "../main";
import { t } from "../i18n";
import { VIEW_TYPE_SIDEBAR_DOCK, VIEW_TYPE_STREAM_WORKBENCH } from "../constants";
import { AI_PROVIDER_PRESETS, PROVIDER_DEFAULT_MODELS } from "../constants";
import type { SuggestionCard } from "../types";
import { prepareStreamEntryTextForDisplay } from "../utils";
import { renderSuggestionCard } from "./suggestion-card";
import { hasConfiguredProvider } from "../types";
import { aiTaskManager, type TaskProgress, type AiTask } from "../services/ai-task-manager";
import { resolveProviderCatalog, applyModelOptions, credentialsForProvider } from "../services/models-dev";

// ── Node.js built-ins (esbuild platform:'node' converts to require) ──
import fs from "node:fs";
import path from "node:path";

type SidebarTab = "todos" | "suggestions" | "chat" | "stream" | "history";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Folded chain-of-thought (not the visible answer). */
  reasoning?: string;
  /** Whether this message was an error */
  isError?: boolean;
  /** The user message that triggered this AI response (for regenerate) */
  prompt?: string;
}

export class SidebarDockView extends ItemView {
  plugin: TopmindPlugin;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private activeTab: SidebarTab = "todos";
  private chatHistory: ChatMessage[] = [];
  private chatThinking = false;
  /** Set on user-initiated chat renders (tab open / send) — never on vault-event refreshes. */
  private chatFocusOnRender = false;
  /** Re-entrancy guard for suggestion generation (workbench parity). */
  private suggestionsInFlight = false;
  private showActionLabels = true;
  private contentContainer!: HTMLElement;
  private taskUnsub: (() => void) | null = null;
  /** Currently selected provider in chat model switcher */
  private chatProviderOverride = "";
  /** Currently selected model in chat model switcher */
  private chatModelOverride = "";

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
    return "sparkles";
  }

  async onOpen(): Promise<void> {
    await this.loadChatHistory();
    await this.render();
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file.path === "topmind.yaml") {
          this.plugin.kernelService.invalidateCache();
        }
        if (this.plugin.kernelService.isStreamRelevantPath(file.path) || file.path === "topmind.yaml") {
          this.scheduleContentRefresh(450);
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (this.plugin.kernelService.isStreamRelevantPath(file.path)) {
          this.scheduleContentRefresh(450);
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (this.plugin.kernelService.isStreamRelevantPath(file.path)) {
          this.scheduleContentRefresh(450);
        }
      }),
    );

    // Subscribe to AI task progress
    this.taskUnsub = aiTaskManager.subscribe((progress) => {
      // Only re-render if history tab is active
      if (this.activeTab === "history") {
        this.renderActiveTab();
      }
      // Update header task badge
      this.updateHeaderTaskBadge(progress);
    });
  }

  async onClose(): Promise<void> {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.taskUnsub?.();
  }

  // ── Chat History Persistence ──────────────────────────────────────────

  /** Chat history file path: {vault}/.topmind/chat-history.json */
  private get chatHistoryPath(): string {
    return path.join(this.plugin.kernelService.getVaultPath(), ".topmind", "chat-history.json");
  }

  /** Load persisted chat history from disk (best-effort, non-fatal). */
  private async loadChatHistory(): Promise<void> {
    try {
      const filePath = this.chatHistoryPath;
      if (!fs.existsSync(filePath)) return;
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.chatHistory = parsed.slice(-50); // Keep last 50 messages
      }
    } catch {
      // Corrupt or missing file — start fresh
    }
  }

  /** Save chat history to disk (best-effort, non-fatal). */
  private saveChatHistory(): void {
    try {
      const filePath = this.chatHistoryPath;
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Keep last 50 messages to avoid unbounded growth
      const toSave = this.chatHistory.slice(-50);
      fs.writeFileSync(filePath, JSON.stringify(toSave, null, 2), "utf-8");
    } catch {
      // Disk full / permissions — non-fatal
    }
  }

  private scheduleRefresh(delay: number): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refreshActiveTab(), delay);
  }

  /**
   * Vault-edit refresh: content tabs only. Suggestions regenerate via the
   * explicit refresh button (kernel fingerprints guard the AI pass), and chat
   * must never re-render mid-typing — it would lose the draft input.
   */
  private scheduleContentRefresh(delay: number): void {
    if (this.activeTab === "chat" || this.activeTab === "suggestions") return;
    this.scheduleRefresh(delay);
  }

  /** Full re-render (header + tabs + content) */
  private async render(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tm-sidebar-dock");

    if (!this.plugin.kernelService.isWorkspaceReady()) {
      this.renderWorkspaceInit(contentEl);
      return;
    }

    // ── Header ──
    this.renderHeader(contentEl);

    // ── Tab Bar ──
    this.renderTabBar(contentEl);

    // ── Tab Content ──
    this.contentContainer = contentEl.createDiv({ cls: "tm-tab-content" });
    await this.renderActiveTab();

    // ── Bottom Quick Actions ──
    this.renderBottomActions(contentEl);
  }

  /** Refresh only the active tab content (lighter than full render) */
  private async refreshActiveTab(): Promise<void> {
    if (this.contentContainer) {
      await this.renderActiveTab();
    }
  }

  // ── Header ─────────────────────────────────────────────────────────────

  private renderHeader(container: HTMLElement): void {
    const header = container.createDiv({ cls: "tm-sidebar-header" });

    // AI status (clickable for quick test)
    const aiReady = hasConfiguredProvider(this.plugin.settings.ai);
    const statusDiv = header.createDiv({ cls: "tm-sidebar-status" });
    statusDiv.setAttribute("role", "button");
    statusDiv.setAttribute("tabindex", "0");
    statusDiv.setAttribute("title", aiReady ? t("settings_ai_quick_test") : t("chat_configure_ai"));
    const dot = statusDiv.createSpan({ cls: `tm-status-dot ${aiReady ? "tm-dot-ok" : "tm-dot-off"}` });
    dot.setAttribute("aria-hidden", "true");
    statusDiv.createSpan({
      text: aiReady ? t("sidebar_ai_ready") : t("sidebar_ai_off"),
      cls: "tm-status-label",
    });
    // Click: if AI ready, run quick test; if not, open settings
    statusDiv.addEventListener("click", () => {
      if (aiReady) {
        this.runAiQuickTest(statusDiv);
      } else {
        this.openSettings();
      }
    });
    statusDiv.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        statusDiv.click();
      }
    });

    // Model badge (clickable to open settings)
    if (aiReady) {
      const modelLabel = this.plugin.kernelService.getActiveModelLabel();
      if (modelLabel) {
        const badge = header.createDiv({ cls: "tm-model-badge", text: modelLabel });
        badge.setAttribute("title", modelLabel);
        badge.setAttribute("role", "button");
        badge.setAttribute("tabindex", "0");
        badge.addEventListener("click", () => this.openSettings());
        badge.addEventListener("keydown", (e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            badge.click();
          }
        });
      }
    }

    // Task progress badge (updated by subscribe)
    const taskBadge = header.createDiv({ cls: "tm-task-badge tm-task-badge-hidden" });
    taskBadge.setAttribute("data-header-badge", "true");

    // Right-side buttons (icon-only with tooltips — no text overflow)
    const headerActions = header.createDiv({ cls: "tm-sidebar-header-actions" });

    // Open workbench button
    const workbenchBtn = headerActions.createEl("button", {
      cls: "tm-sidebar-icon-btn tm-sidebar-btn-labeled",
    });
    setIcon(workbenchBtn, "waves");
    workbenchBtn.createSpan({ text: t("sidebar_btn_workbench"), cls: "tm-sidebar-btn-label" });
    workbenchBtn.setAttribute("aria-label", t("sidebar_open_workbench"));
    workbenchBtn.setAttribute("title", t("sidebar_open_workbench"));
    workbenchBtn.addEventListener("click", () => this.openWorkbench());

    // Settings button
    const settingsBtn = headerActions.createEl("button", {
      cls: "tm-sidebar-icon-btn tm-sidebar-btn-labeled",
    });
    setIcon(settingsBtn, "settings");
    settingsBtn.createSpan({ text: t("sidebar_open_settings"), cls: "tm-sidebar-btn-label" });
    settingsBtn.setAttribute("aria-label", t("sidebar_open_settings"));
    settingsBtn.setAttribute("title", t("sidebar_open_settings"));
    settingsBtn.addEventListener("click", () => this.openSettings());
  }

  /** Open plugin settings tab */
  private openSettings(): void {
    const setting = (this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting;
    setting?.open();
    setting?.openTabById("topmind-stream");
  }

  /** Run AI quick test and update the status indicator */
  private async runAiQuickTest(statusEl: HTMLElement): Promise<void> {
    const labelEl = statusEl.querySelector(".tm-status-label");
    const dotEl = statusEl.querySelector(".tm-status-dot");
    if (!labelEl || !dotEl) return;

    const originalText = labelEl.textContent;
    labelEl.textContent = t("ai_checking");
    dotEl.className = "tm-status-dot tm-dot-checking";

    const result = await this.plugin.kernelService.quickTestAi();
    if (result.ok) {
      labelEl.textContent = t("ai_test_ok");
      dotEl.className = "tm-status-dot tm-dot-ok";
    } else {
      labelEl.textContent = t("ai_test_fail");
      dotEl.className = "tm-status-dot tm-dot-error";
      new Notice(`${t("ai_test_fail")}: ${result.error || ""}`);
    }

    // Restore original after 3 seconds
    setTimeout(() => {
      labelEl.textContent = originalText;
      dotEl.className = `tm-status-dot ${result.ok ? "tm-dot-ok" : "tm-dot-off"}`;
    }, 3000);
  }

  /** Update header task badge from progress */
  private updateHeaderTaskBadge(progress: TaskProgress): void {
    const badge = this.contentEl.querySelector("[data-header-badge]");
    if (!badge) return;

    const el = badge as HTMLElement;
    if (progress.multiActive === 0) {
      el.addClass("tm-task-badge-hidden");
      el.empty();
      return;
    }

    el.removeClass("tm-task-badge-hidden");
    el.empty();

    const active = progress.active;
    if (active) {
      el.addClass("tm-task-badge-active");
      const label = el.createSpan({ cls: "tm-task-badge-label" });
      label.textContent = active.label;
      const dot = el.createSpan({ cls: "tm-task-badge-dot" });
      dot.setAttribute("aria-hidden", "true");
    } else if (progress.queued.length > 0) {
      el.createSpan({
        text: t("task_queued_count").replace("{{count}}", String(progress.queued.length)),
        cls: "tm-task-badge-label",
      });
    }
  }

  // ── Tab Bar ────────────────────────────────────────────────────────────

  private renderTabBar(container: HTMLElement): void {
    const tabBar = container.createDiv({ cls: "tm-tab-bar" });

    const tabs: { id: SidebarTab; label: string; icon: string }[] = [
      { id: "todos", label: t("sidebar_tab_todos"), icon: "list-checks" },
      { id: "suggestions", label: t("sidebar_tab_suggestions"), icon: "lightbulb" },
      { id: "chat", label: t("sidebar_tab_chat"), icon: "message-circle" },
      { id: "stream", label: t("sidebar_tab_stream"), icon: "waves" },
      { id: "history", label: t("sidebar_tab_history"), icon: "history" },
    ];

    for (const tab of tabs) {
      const btn = tabBar.createEl("button", {
        cls: `tm-tab-btn ${this.activeTab === tab.id ? "tm-tab-active" : ""}`,
      });
      const iconSpan = btn.createSpan({ cls: "tm-tab-icon" });
      setIcon(iconSpan, tab.icon);
      btn.createSpan({ text: tab.label, cls: "tm-tab-label" });
      btn.setAttribute("aria-label", tab.label);
      btn.addEventListener("click", () => {
        // Update tab active states without full re-render
        this.activeTab = tab.id;
        if (tab.id === "chat") this.chatFocusOnRender = true;
        const allBtns = tabBar.querySelectorAll(".tm-tab-btn");
        allBtns.forEach((b) => {
          b.classList.remove("tm-tab-active");
        });
        btn.classList.add("tm-tab-active");
        // Only re-render tab content, not the full view
        this.renderActiveTab();
      });
    }
  }

  // ── Tab Content Dispatcher ─────────────────────────────────────────────

  private async renderActiveTab(): Promise<void> {
    if (!this.contentContainer) return;
    this.contentContainer.empty();

    switch (this.activeTab) {
      case "todos":
        this.renderTodosTab(this.contentContainer);
        break;
      case "suggestions":
        await this.renderSuggestionsTab(this.contentContainer);
        break;
      case "chat":
        this.renderChatTab(this.contentContainer);
        break;
      case "stream":
        await this.renderStreamTab(this.contentContainer);
        break;
      case "history":
        this.renderHistoryTab(this.contentContainer);
        break;
    }
  }

  // ── Todos Tab ──────────────────────────────────────────────────────────

  private renderTodosTab(container: HTMLElement): void {
    const todoSection = container.createDiv({ cls: "tm-sidebar-section" });

    // Open todo file button — icon-only at top of todos tab
    const openFileBar = todoSection.createDiv({ cls: "tm-todo-open-file-bar" });
    const openFileBtn = openFileBar.createEl("button", {
      cls: "tm-btn-secondary tm-btn-icon-only",
    });
    setIcon(openFileBtn, "file-text");
    openFileBtn.setAttribute("aria-label", t("todo_open_file"));
    openFileBtn.setAttribute("title", t("todo_open_file"));
    openFileBtn.addEventListener("click", () => {
      this.app.workspace.openLinkText(this.plugin.kernelService.todoRelPath(), "", false);
    });

    const todos = this.plugin.kernelService.readTodos();
    const activeTodos = todos.filter((item) => !item.done);
    const doneTodos = todos.filter((item) => item.done);

    if (activeTodos.length === 0) {
      const empty = todoSection.createDiv({ cls: "tm-empty-state tm-empty-compact" });
      const icon = empty.createDiv({ cls: "tm-empty-icon" });
      setIcon(icon, "check-check");
      empty.createDiv({ text: t("sidebar_no_todos") });
    } else {
      for (const todo of activeTodos.slice(0, 20)) {
        const item = todoSection.createDiv({ cls: "tm-todo-item" });
        const checkbox = item.createEl("input", {
          attr: { type: "checkbox", "aria-label": todo.text },
          cls: "tm-todo-checkbox",
        });
        checkbox.addEventListener("change", () => {
          const toggled = this.plugin.kernelService.toggleTodo(todo.id);
          if (!toggled.ok) {
            checkbox.checked = !checkbox.checked;
            return;
          }
          if (checkbox.checked) {
            item.classList.add("tm-completed");
          }
        });
        item.createSpan({ cls: "tm-todo-text", text: todo.text });
        if (todo.sourcePeriod) {
          const srcBtn = item.createEl("button", {
            cls: "tm-todo-source",
            attr: { "aria-label": t("todo_open_source") },
          });
          setIcon(srcBtn, "external-link");
          srcBtn.createSpan({ text: ` ${todo.sourcePeriod}` });
          srcBtn.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            // Prefer the live stream category from the workspace model; if the
            // role is missing, fall back to a bare-filename link (Obsidian
            // resolves it vault-wide) instead of a hardcoded "10-动态" path.
            const streamDir =
              this.plugin.kernelService.getResolvedModel()?.categories
                ?.find((c) => c.role === "loose-stream")?.directory;
            const link = streamDir
              ? `${streamDir}/${todo.sourcePeriod}.md`
              : `${todo.sourcePeriod}.md`;
            this.app.workspace.openLinkText(link, "", false);
          });
        }
        if (todo.dueDate) {
          const dueSpan = item.createSpan({ cls: "tm-todo-due" });
          setIcon(dueSpan, "calendar");
          dueSpan.createSpan({ text: ` ${todo.dueDate}` });
        }
        // Hover delete button (shown on hover)
        const deleteBtn = item.createEl("button", {
          cls: "tm-todo-delete",
          attr: { "aria-label": t("todo_row_delete"), title: t("todo_row_delete") },
        });
        setIcon(deleteBtn, "trash-2");
        deleteBtn.addEventListener("click", (e: MouseEvent) => {
          e.stopPropagation();
          item.classList.add("tm-card-removing");
          setTimeout(() => {
            this.plugin.kernelService.deleteTodo(todo.id);
            this.refreshActiveTab();
          }, 150);
        });
      }

      if (doneTodos.length > 0) {
        const doneHeader = todoSection.createDiv({ cls: "tm-todo-done-header" });
        const doneIcon = doneHeader.createSpan({ cls: "tm-todo-done-label" });
        setIcon(doneIcon, "check");
        doneIcon.createSpan({ text: ` ${doneTodos.length} ${t("sidebar_todos_done")}` });
        // Clear completed button
        const clearDoneBtn = doneHeader.createEl("button", {
          cls: "tm-btn-mini tm-todo-clear-done",
        });
        setIcon(clearDoneBtn, "trash-2");
        clearDoneBtn.setAttribute("aria-label", t("todo_clear_completed"));
        clearDoneBtn.setAttribute("title", t("todo_clear_completed"));
        clearDoneBtn.addEventListener("click", () => {
          for (const done of doneTodos) {
            this.plugin.kernelService.deleteTodo(done.id);
          }
          this.refreshActiveTab();
        });
      }

      if (activeTodos.length > 20) {
        const viewAllBtn = todoSection.createEl("button", {
          cls: "tm-btn-mini tm-view-all",
          text: t("sidebar_view_all_todos"),
        });
        viewAllBtn.addEventListener("click", () => {
          this.app.workspace.openLinkText(this.plugin.kernelService.todoRelPath(), "", false);
        });
      }
    }
  }

  // ── Suggestions Tab ────────────────────────────────────────────────────

  private renderPendingWrites(container: HTMLElement): number {
    const pending = this.plugin.kernelService.listPendingWrites();
    if (pending.length === 0) return 0;
    const section = container.createDiv({ cls: "tm-sidebar-section tm-pending-writes" });
    section.createDiv({ cls: "tm-suggestion-summary", text: t("pending_writes_title") });
    for (const item of pending) {
      const card = section.createDiv({ cls: "tm-suggestion-card tm-pending-write-card" });
      card.createDiv({ cls: "tm-suggestion-title", text: item.relativePath });
      const actions = card.createDiv({ cls: "tm-suggestion-actions" });
      // Confirm must not be blind: the stashed content is inspectable in place.
      const preview = actions.createEl("button", {
        cls: "tm-btn-secondary",
        text: t("pending_writes_preview"),
      });
      preview.setAttribute("aria-label", t("pending_writes_preview"));
      preview.setAttribute("aria-expanded", "false");
      let previewBox: HTMLElement | null = null;
      preview.addEventListener("click", () => {
        if (previewBox) {
          previewBox.remove();
          previewBox = null;
          preview.setText(t("pending_writes_preview"));
          preview.setAttribute("aria-expanded", "false");
          return;
        }
        previewBox = card.createDiv({ cls: "tm-pending-preview" });
        const meta = previewBox.createDiv({ cls: "tm-pending-preview-meta" });
        meta.setText(
          t("pending_writes_preview_meta").replace("{{chars}}", String(item.content.length)),
        );
        previewBox.createEl("pre", { text: item.content });
        preview.setText(t("pending_writes_hide_preview"));
        preview.setAttribute("aria-expanded", "true");
      });
      const accept = actions.createEl("button", {
        cls: "tm-btn-primary",
        text: t("pending_writes_accept"),
      });
      accept.setAttribute("aria-label", t("pending_writes_accept"));
      accept.addEventListener("click", () => {
        this.plugin.kernelService.acceptPendingWrite(item.id);
        void this.renderSuggestionsTab(container);
      });
      const reject = actions.createEl("button", {
        cls: "tm-btn-secondary",
        text: t("pending_writes_reject"),
      });
      reject.setAttribute("aria-label", t("pending_writes_reject"));
      reject.addEventListener("click", () => {
        this.plugin.kernelService.rejectPendingWrite(item.id);
        void this.renderSuggestionsTab(container);
      });
    }
    return pending.length;
  }

  private async renderSuggestionsTab(container: HTMLElement, opts: { force?: boolean } = {}): Promise<void> {
    container.empty();
    const pendingCount = this.renderPendingWrites(container);
    const aiConfigured = hasConfiguredProvider(this.plugin.settings.ai);
    if (!aiConfigured) {
      if (pendingCount === 0) {
        this.renderEmptyState(container, t("suggestions_no_ai"), t("suggestions_no_ai_hint"), "lightbulb");
      }
      return;
    }
    // Re-entrancy guard: tab render + refresh button can both call this while
    // a kernel AI pass is running — never run two generateSuggestions in
    // parallel (they would clobber suggestionSession).
    if (this.suggestionsInFlight) {
      const progressEl = container.createDiv({ cls: "tm-task-progress-inline" });
      progressEl.createDiv({ cls: "tm-loading-spinner tm-loading-spinner-sm" });
      progressEl.createSpan({ text: t("suggestions_loading") });
      return;
    }

    // Refresh suggestions button at top of suggestions tab (icon-only)
    this.renderSuggestionRefreshButton(container);

    // Loading indicator
    const loadingEl = container.createDiv({ cls: "tm-loading tm-loading-spinner" });
    loadingEl.createSpan({ text: t("suggestions_loading") });

    this.suggestionsInFlight = true;
    try {
      const suggestions = await this.plugin.kernelService.generateSuggestions({
        force: opts.force === true,
      });
      container.empty();
      const pendingAfter = this.renderPendingWrites(container);

      // Re-add refresh button after container.empty()
      this.renderSuggestionRefreshButton(container);

      if (suggestions.length === 0) {
        if (pendingAfter === 0) {
          const emptyTitle = this.plugin.settings.autoSuggest
            ? t("sidebar_no_suggestions")
            : t("suggestions_disabled");
          const emptyHint = this.plugin.settings.autoSuggest
            ? t("suggestions_empty_hint")
            : t("suggestions_disabled_hint");
          this.renderEmptyState(container, emptyTitle, emptyHint, "lightbulb");
        }
        return;
      }

      // Suggestion count badge
      const summaryEl = container.createDiv({ cls: "tm-suggestion-summary" });
      summaryEl.createSpan({
        text: t("sidebar_suggestions_count").replace("{{count}}", String(suggestions.length)),
        cls: "tm-suggestion-count-badge",
      });

      for (const sugg of suggestions) {
        this.renderSuggestionCard(container, sugg);
      }
    } catch (err) {
      container.empty();
      this.renderEmptyState(
        container,
        t("error"),
        err instanceof Error ? err.message : String(err),
        "alert-circle",
      );
    } finally {
      this.suggestionsInFlight = false;
    }
  }

  /** Force-refresh button — single guarded path via renderSuggestionsTab. */
  private renderSuggestionRefreshButton(container: HTMLElement): void {
    const refreshBar = container.createDiv({ cls: "tm-suggestion-refresh-bar" });
    const refreshBtn = refreshBar.createEl("button", { cls: "tm-btn-secondary tm-btn-icon-only" });
    setIcon(refreshBtn, "refresh-cw");
    refreshBtn.setAttribute("aria-label", t("cmd_refresh_suggestions"));
    refreshBtn.setAttribute("title", t("cmd_refresh_suggestions"));
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.disabled = true;
      await this.renderSuggestionsTab(container, { force: true });
    });
  }

  private renderSuggestionCard(container: HTMLElement, sugg: SuggestionCard): void {
    // Shared card surface — 动作词汇与 Desktop 对齐（见 views/suggestion-card.ts）
    renderSuggestionCard(container, sugg, {
      apply: (s) => this.plugin.kernelService.applySuggestion(s),
      dismiss: (s) => this.plugin.kernelService.dropSuggestion(s.id),
      refresh: () => this.refreshActiveTab(),
      openVaultPath: async (p) => {
        await this.app.workspace.openLinkText(p, "", false);
      },
    });
  }

  // ── Chat Tab ───────────────────────────────────────────────────────────

  private renderChatTab(container: HTMLElement): void {
    const aiConfigured = hasConfiguredProvider(this.plugin.settings.ai);
    if (!aiConfigured) {
      this.renderEmptyState(container, t("chat_no_ai"), t("chat_no_ai_hint"), "message-circle");
      // Add actionable configure button
      const actionDiv = container.createDiv({ cls: "tm-empty-action" });
      const configureBtn = actionDiv.createEl("button", {
        cls: "tm-btn-init-workspace",
        text: t("empty_action_configure"),
      });
      configureBtn.addEventListener("click", () => this.openSettings());
      return;
    }

    container.addClass("tm-chat-container");

    // ── Model switcher bar ──
    this.renderChatModelSwitcher(container);

    // Chat messages area
    const messagesEl = container.createDiv({ cls: "tm-chat-messages" });

    if (this.chatHistory.length === 0) {
      const emptyDiv = messagesEl.createDiv({ cls: "tm-chat-empty" });
      const chatIcon = emptyDiv.createDiv({ cls: "tm-chat-empty-icon" });
      setIcon(chatIcon, "message-circle");
      emptyDiv.createDiv({ text: t("chat_empty"), cls: "tm-chat-empty-title" });
      emptyDiv.createDiv({ text: t("chat_empty_hint"), cls: "tm-chat-empty-hint" });
    } else {
      for (const msg of this.chatHistory) {
        this.renderChatMessage(messagesEl, msg);
      }
      // Scroll to bottom
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // Thinking indicator
    if (this.chatThinking) {
      const thinkingEl = messagesEl.createDiv({ cls: "tm-chat-message tm-chat-ai tm-chat-thinking" });
      thinkingEl.createSpan({ cls: "tm-chat-role", text: t("chat_ai") });
      thinkingEl.createSpan({ cls: "tm-chat-thinking-dots", text: t("chat_thinking") });
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // Chat input area
    const inputArea = container.createDiv({ cls: "tm-chat-input-area" });
    const input = inputArea.createEl("textarea", {
      cls: "tm-chat-input",
      attr: {
        placeholder: t("chat_placeholder"),
        rows: "2",
        "aria-label": t("chat_title"),
      },
    });

    // Send button (icon-only)
    const sendBtn = inputArea.createEl("button", {
      cls: "tm-chat-send-btn",
    });
    setIcon(sendBtn, "send");
    sendBtn.setAttribute("aria-label", t("chat_send"));
    sendBtn.setAttribute("title", t("chat_send"));

    // Clear button (only if history exists)
    if (this.chatHistory.length > 0) {
      const clearBtn = inputArea.createEl("button", {
        cls: "tm-chat-clear-btn",
      });
      setIcon(clearBtn, "x");
      clearBtn.setAttribute("aria-label", t("chat_clear"));
      clearBtn.setAttribute("title", t("chat_clear"));
      clearBtn.addEventListener("click", () => {
        this.chatHistory = [];
        this.saveChatHistory();
        this.renderActiveTab();
      });
    }

    // Auto-grow textarea
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 100) + "px";
    });

    // Enter to send, Shift+Enter for newline
    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendChatMessage(input);
      }
    });

    sendBtn.addEventListener("click", () => this.sendChatMessage(input));

    // Focus only on user-initiated renders — vault-event refreshes must not
    // steal focus from the editor while the user is typing elsewhere.
    if (this.chatFocusOnRender) {
      this.chatFocusOnRender = false;
      setTimeout(() => input.focus(), 50);
    }
  }

  /** Render the model/provider switcher bar above chat messages */
  private renderChatModelSwitcher(container: HTMLElement): void {
    const switcherBar = container.createDiv({ cls: "tm-chat-model-switcher" });

    const providers = this.plugin.kernelService.getConfiguredProviders();
    const activeProvider = this.chatProviderOverride || this.plugin.settings.ai.sourcePreference || providers[0]?.id || "";

    // Provider dropdown
    if (providers.length > 0) {
      const providerWrap = switcherBar.createDiv({ cls: "tm-chat-switcher-item" });
      providerWrap.createSpan({ text: t("chat_provider_select"), cls: "tm-chat-switcher-label" });
      const providerSelect = providerWrap.createEl("select", { cls: "tm-chat-switcher-select" });
      providerSelect.setAttribute("aria-label", t("chat_provider_select"));
      for (const p of providers) {
        providerSelect.createEl("option", { value: p.id, text: p.label });
      }
      providerSelect.value = activeProvider;
      providerSelect.addEventListener("change", async () => {
        this.chatProviderOverride = providerSelect.value;
        // Clear model override when provider changes
        this.chatModelOverride = "";
        // Update settings preference
        this.plugin.settings.ai.sourcePreference = providerSelect.value;
        await this.plugin.saveSettings();
        this.renderActiveTab();
      });
    }

    // Model dropdown
    const modelWrap = switcherBar.createDiv({ cls: "tm-chat-switcher-item" });
    modelWrap.createSpan({ text: t("chat_model"), cls: "tm-chat-switcher-label" });
    const modelSelect = modelWrap.createEl("select", { cls: "tm-chat-switcher-select tm-chat-model-select" });
    modelSelect.setAttribute("aria-label", t("chat_model_select"));

    // Add default option
    modelSelect.createEl("option", { value: "", text: t("settings_ai_model_default") });

    // Add static models for the active provider
    const preset = AI_PROVIDER_PRESETS[activeProvider];
    if (preset?.model) {
      modelSelect.createEl("option", {
        value: preset.model,
        text: `${preset.model} (${t("settings_ai_model_default")})`,
      });
    }
    const fallback = PROVIDER_DEFAULT_MODELS[activeProvider] || [];
    for (const m of fallback) {
      if (m.id !== preset?.model) {
        modelSelect.createEl("option", { value: m.id, text: m.label });
      }
    }

    // Set current value — keep a custom id visible before the dynamic list arrives
    const currentModel = this.chatModelOverride || this.plugin.settings.ai.defaultModel || "";
    if (currentModel && !Array.from(modelSelect.options).some((o) => o.value === currentModel)) {
      modelSelect.createEl("option", { value: currentModel, text: currentModel });
    }
    modelSelect.value = currentModel;

    modelSelect.addEventListener("change", async () => {
      this.chatModelOverride = modelSelect.value;
      // Also update global settings so it persists
      this.plugin.settings.ai.defaultModel = modelSelect.value;
      this.plugin.settings.aiModel = modelSelect.value;
      await this.plugin.saveSettings();
    });

    // Curated defaults already rendered; enrich from official / community
    this.loadChatModels(activeProvider, modelSelect, currentModel);

    // Honest scoping: switching here also updates the global default model.
    switcherBar.createDiv({
      cls: "tm-chat-switcher-hint",
      text: t("chat_model_switch_hint"),
    });
  }

  /** Resolve official + community + curated and update the chat model select. */
  private async loadChatModels(providerId: string, selectEl: HTMLSelectElement, currentValue: string): Promise<void> {
    try {
      const creds = credentialsForProvider(providerId, this.plugin.settings.ai.manual);
      const result = await resolveProviderCatalog(providerId, creds);
      const preset = AI_PROVIDER_PRESETS[providerId];
      applyModelOptions(selectEl, result.models, {
        currentValue,
        presetModel: preset?.model || null,
        defaultLabel: t("settings_ai_model_default"),
      });
    } catch {
      // Network failed — curated options already on screen
    }
  }

  private renderChatMessage(container: HTMLElement, msg: ChatMessage): void {
    const msgEl = container.createDiv({
      cls: `tm-chat-message ${msg.role === "user" ? "tm-chat-user" : "tm-chat-ai"}${msg.isError ? " tm-chat-error-msg" : ""}`,
    });
    msgEl.createSpan({ cls: "tm-chat-role", text: msg.role === "user" ? t("chat_you") : t("chat_ai") });

    if (msg.role === "assistant" && !msg.isError && msg.reasoning?.trim()) {
      const fold = msgEl.createEl("details", { cls: "tm-chat-reasoning" });
      const summary = fold.createEl("summary", { cls: "tm-chat-reasoning-summary" });
      summary.setText(t("chat_reasoning"));
      const pre = fold.createEl("pre", { cls: "tm-chat-reasoning-body" });
      pre.setText(msg.reasoning);
    }

    const bodyEl = msgEl.createDiv({ cls: "tm-chat-body" });

    if (msg.role === "assistant" && !msg.isError) {
      // Render markdown for AI responses (answer only)
      void MarkdownRenderer.render(this.app, msg.content, bodyEl, "", this);
      // Add action buttons for AI messages (icon-only with tooltips)
      const actionsEl = msgEl.createDiv({ cls: "tm-chat-msg-actions" });

      // Copy button
      const copyBtn = actionsEl.createEl("button", { cls: "tm-chat-msg-btn" });
      setIcon(copyBtn, "copy");
      copyBtn.setAttribute("aria-label", t("chat_copy"));
      copyBtn.setAttribute("title", t("chat_copy"));
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(msg.content).then(() => {
          copyBtn.addClass("tm-copied");
          setTimeout(() => copyBtn.removeClass("tm-copied"), 1500);
        });
      });

      // Regenerate button (only if there's a prompt)
      if (msg.prompt) {
        const regenBtn = actionsEl.createEl("button", { cls: "tm-chat-msg-btn" });
        setIcon(regenBtn, "refresh-cw");
        regenBtn.setAttribute("aria-label", t("chat_regenerate"));
        regenBtn.setAttribute("title", t("chat_regenerate"));
        regenBtn.addEventListener("click", () => {
          // Remove this message and regenerate
          const idx = this.chatHistory.lastIndexOf(msg);
          if (idx >= 0) {
            this.chatHistory.splice(idx, 1);
            this.regenerateResponse(msg.prompt!);
          }
        });
      }
    } else if (msg.role === "assistant" && msg.isError) {
      // Error message with retry button
      bodyEl.textContent = msg.content;
      const actionsEl = msgEl.createDiv({ cls: "tm-chat-msg-actions" });
      if (msg.prompt) {
        const retryBtn = actionsEl.createEl("button", { cls: "tm-chat-msg-btn tm-chat-retry-btn" });
        setIcon(retryBtn, "refresh-cw");
        retryBtn.setAttribute("aria-label", t("chat_retry"));
        retryBtn.setAttribute("title", t("chat_retry"));
        retryBtn.addEventListener("click", () => {
          const idx = this.chatHistory.lastIndexOf(msg);
          if (idx >= 0) {
            this.chatHistory.splice(idx, 1);
            this.regenerateResponse(msg.prompt!);
          }
        });
      }
    } else {
      bodyEl.textContent = msg.content;
    }
  }

  private async sendChatMessage(input: HTMLTextAreaElement): Promise<void> {
    const text = input.value.trim();
    if (!text || this.chatThinking) return;

    // Add user message
    this.chatHistory.push({ role: "user", content: text });
    this.saveChatHistory();
    input.value = "";
    input.style.height = "auto";

    this.chatThinking = true;
    this.chatFocusOnRender = true;
    this.renderActiveTab();

    try {
      const response = await this.plugin.kernelService.chat(text, this.chatHistory.slice(0, -1));
      this.chatHistory.push({
        role: "assistant",
        content: response.content || "...",
        reasoning: response.reasoning || undefined,
        prompt: text,
      });
      this.saveChatHistory();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.chatHistory.push({
        role: "assistant",
        content: `${t("chat_error")}: ${msg}`,
        isError: true,
        prompt: text,
      });
      this.saveChatHistory();
    } finally {
      this.chatThinking = false;
      this.chatFocusOnRender = true;
      this.renderActiveTab();
    }
  }

  /** Regenerate the AI response for a given prompt */
  private async regenerateResponse(prompt: string): Promise<void> {
    if (this.chatThinking) return;

    this.chatThinking = true;
    this.renderActiveTab();

    try {
      // Context = history up to (excluding) the user message being regenerated,
      // so the prompt is sent exactly once as the final turn.
      let lastUserIdx = -1;
      for (let i = this.chatHistory.length - 1; i >= 0; i--) {
        const m = this.chatHistory[i];
        if (m.role === "user" && m.content === prompt) {
          lastUserIdx = i;
          break;
        }
      }
      const history = lastUserIdx >= 0
        ? this.chatHistory.slice(0, lastUserIdx)
        : [...this.chatHistory];
      const response = await this.plugin.kernelService.chat(prompt, history);
      this.chatHistory.push({
        role: "assistant",
        content: response.content || "...",
        reasoning: response.reasoning || undefined,
        prompt,
      });
      this.saveChatHistory();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.chatHistory.push({
        role: "assistant",
        content: `${t("chat_error")}: ${msg}`,
        isError: true,
        prompt,
      });
      this.saveChatHistory();
    } finally {
      this.chatThinking = false;
      this.renderActiveTab();
    }
  }

  // ── Stream Tab ─────────────────────────────────────────────────────────

  private async renderStreamTab(container: HTMLElement): Promise<void> {
    const streamSection = container.createDiv({ cls: "tm-sidebar-section" });

    const ctx = await this.plugin.kernelService.getStreamContext();
    const currentPeriod = ctx.current;

    if (currentPeriod) {
      const { entries } = this.plugin.kernelService.readPeriodNote(currentPeriod.relPath);
      const recent = [...entries].reverse().slice(0, 10);

      if (recent.length === 0) {
        this.renderEmptyState(streamSection, t("sidebar_no_stream"), "", "waves");
      } else {
        for (const entry of recent) {
          const item = streamSection.createDiv({ cls: "tm-sidebar-stream-item" });
          item.createSpan({ cls: "tm-sidebar-stream-time", text: entry.time });
          const display = prepareStreamEntryTextForDisplay(entry.text);
          const textPart = display.slice(0, 80) + (display.length > 80 ? "..." : "");
          item.createSpan({ cls: "tm-sidebar-stream-text", text: textPart });
          item.addEventListener("click", () => {
            this.app.workspace.openLinkText(currentPeriod.relPath, "", false);
          });
        }
      }
    } else {
      this.renderEmptyState(streamSection, t("sidebar_no_stream"), "", "waves");
    }
  }

  // ── History Tab (AI Task History) ───────────────────────────────────────

  private renderHistoryTab(container: HTMLElement): void {
    const section = container.createDiv({ cls: "tm-sidebar-section" });
    const progress = aiTaskManager.getProgress();

    // Active task (if any)
    if (progress.active) {
      const activeEl = section.createDiv({ cls: "tm-history-active" });
      this.renderTaskItem(activeEl, progress.active, true);
    }

    // Queued tasks
    if (progress.queued.length > 0) {
      const queuedHeader = section.createDiv({ cls: "tm-history-section-header" });
      queuedHeader.createSpan({
        text: t("task_queued_count").replace("{{count}}", String(progress.queued.length)),
      });
      for (const task of progress.queued) {
        this.renderTaskItem(section, task, false);
      }
    }

    // Recent history
    const recent = progress.recent.slice().reverse(); // newest first
    if (recent.length === 0) {
      this.renderEmptyState(section, t("task_no_history"), "", "history");
    } else {
      const recentHeader = section.createDiv({ cls: "tm-history-section-header" });
      recentHeader.createSpan({ text: t("task_recent") });

      // Clear history button
      const clearBtn = recentHeader.createEl("button", {
        cls: "tm-btn-mini tm-history-clear",
      });
      setIcon(clearBtn, "trash-2");
      clearBtn.setAttribute("aria-label", t("task_clear_history"));
      clearBtn.setAttribute("title", t("task_clear_history"));
      clearBtn.addEventListener("click", () => {
        aiTaskManager.clearHistory();
      });

      for (const task of recent) {
        this.renderTaskItem(section, task, false);
      }
    }
  }

  private renderTaskItem(container: HTMLElement, task: AiTask, isActive: boolean): void {
    const item = container.createDiv({
      cls: `tm-history-item tm-history-${task.status}${isActive ? " tm-history-item-active" : ""}`,
    });

    // Status icon
    const iconSpan = item.createDiv({ cls: "tm-history-icon" });
    const iconName = this.getTaskStatusIcon(task.status);
    setIcon(iconSpan, iconName);

    // Label + status
    const body = item.createDiv({ cls: "tm-history-body" });
    body.createDiv({ cls: "tm-history-label", text: task.label });

    const meta = body.createDiv({ cls: "tm-history-meta" });
    meta.createSpan({ text: this.getTaskStatusLabel(task.status), cls: `tm-history-status tm-history-status-${task.status}` });

    if (task.result?.summary) {
      meta.createSpan({ text: ` · ${task.result.summary.slice(0, 60)}`, cls: "tm-history-summary" });
    }
    if (task.error) {
      meta.createSpan({ text: ` · ${task.error.slice(0, 60)}`, cls: "tm-history-error" });
    }

    // Time
    if (task.finishedAt) {
      const elapsed = task.finishedAt - (task.startedAt || task.finishedAt);
      if (elapsed > 0) {
        meta.createSpan({ text: ` · ${(elapsed / 1000).toFixed(1)}s`, cls: "tm-history-duration" });
      }
    }

    // Abort button for active task
    if (isActive) {
      const abortBtn = item.createEl("button", { cls: "tm-btn-mini tm-history-abort" });
      setIcon(abortBtn, "x");
      abortBtn.setAttribute("aria-label", t("task_abort"));
      abortBtn.setAttribute("title", t("task_abort"));
      abortBtn.addEventListener("click", (e: MouseEvent) => {
        e.stopPropagation();
        aiTaskManager.abort();
      });
    }
  }

  private getTaskStatusIcon(status: string): string {
    switch (status) {
      case "pending": return "clock";
      case "running": return "loader";
      case "done": return "check-circle";
      case "error": return "alert-circle";
      case "aborted": return "x-circle";
      default: return "circle";
    }
  }

  private getTaskStatusLabel(status: string): string {
    switch (status) {
      case "pending": return t("task_pending");
      case "running": return t("task_running");
      case "done": return t("task_done");
      case "error": return t("task_error");
      case "aborted": return t("task_aborted");
      default: return status;
    }
  }

  // ── Bottom Actions ─────────────────────────────────────────────────────

  private renderBottomActions(container: HTMLElement): void {
    const actionsBar = container.createDiv({ cls: "tm-sidebar-bottom-actions" });

    // Quick capture (always available)
    this.addActionButton(actionsBar, "zap", t("sidebar_quick_capture"), () => this.plugin.openQuickCapture(), false);

    // Organize (always available)
    this.addActionButton(actionsBar, "refresh-cw", t("sidebar_quick_organize"), async () => {
      new Notice(t("notice_organizing"));
      const streamCtx = await this.plugin.kernelService.getStreamContext();
      if (streamCtx.current) {
        this.plugin.kernelService.reconcilePeriod(streamCtx.current.relPath);
      }
      // Shared serial lane; its own completion notice is the feedback — a
      // premature "done" here would lie about the still-queued AI pass.
      const aiQueued = this.plugin.settings.autoMaintainTodos
        && hasConfiguredProvider(this.plugin.settings.ai);
      if (aiQueued) {
        this.plugin.enqueueAiOperation("todo_maintain", "op_label_todo_maintain", "notice_todo_done", "sidebar", true);
      } else {
        new Notice(t("notice_organize_done"));
      }
      this.refreshActiveTab();
    }, false);

    // AI operations (only if AI configured) — same shared lane as the command
    // palette, so the task badge + history observe every AI pass.
    if (hasConfiguredProvider(this.plugin.settings.ai)) {
      this.addActionButton(actionsBar, "list-checks", t("sidebar_op_todo"), () => {
        this.plugin.enqueueAiOperation("todo_maintain", "op_label_todo_maintain", "notice_todo_done", "sidebar");
      }, true);

      this.addActionButton(actionsBar, "tag", t("sidebar_op_classify"), () => {
        this.plugin.enqueueAiOperation("topic_classify", "op_label_topic_classify", "notice_classify_done", "suggest");
      }, true);

      this.addActionButton(actionsBar, "brain", t("sidebar_op_memory"), () => {
        this.plugin.enqueueAiOperation("memory_organize", "op_label_memory_organize", "notice_memory_done", "all");
      }, true);
    }

    // Toggle labels button
    const toggleBtn = actionsBar.createEl("button", {
      cls: "tm-sidebar-action-btn tm-action-toggle-labels",
    });
    setIcon(toggleBtn, this.showActionLabels ? "eye-off" : "eye");
    toggleBtn.setAttribute("aria-label", this.showActionLabels ? t("sidebar_action_label_hide") : t("sidebar_action_label_show"));
    toggleBtn.setAttribute("title", this.showActionLabels ? t("sidebar_action_label_hide") : t("sidebar_action_label_show"));
    toggleBtn.addEventListener("click", () => {
      this.showActionLabels = !this.showActionLabels;
      this.render();
    });
  }

  private addActionButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    handler: () => void | Promise<void>,
    _requiresAi: boolean,
  ): void {
    const btn = parent.createEl("button", {
      cls: `tm-sidebar-action-btn${this.showActionLabels ? " tm-action-with-label" : ""}`,
    });
    const iconSpan = btn.createSpan({ cls: "tm-action-icon-span" });
    setIcon(iconSpan, icon);
    if (this.showActionLabels) {
      btn.createSpan({ text: label, cls: "tm-action-label-span" });
    }
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);
    btn.addEventListener("click", () => { void handler(); });
  }

  /** Enqueue an AI task with progress tracking */
  // ── Helpers ────────────────────────────────────────────────────────────

  private renderEmptyState(container: HTMLElement, title: string, hint: string, iconName?: string): void {
    const div = container.createDiv({ cls: "tm-empty-state tm-empty-compact" });
    if (iconName) {
      const iconDiv = div.createDiv({ cls: "tm-empty-icon" });
      setIcon(iconDiv, iconName);
    }
    div.createDiv({ text: title, cls: "tm-empty-title" });
    if (hint) {
      div.createDiv({ text: hint, cls: "tm-empty-hint" });
    }
  }

  private renderWorkspaceInit(container: HTMLElement): void {
    const emptyDiv = container.createDiv({ cls: "tm-empty-state tm-workspace-init" });
    emptyDiv.createDiv({ text: t("init_workspace_desc"), cls: "tm-init-desc" });
    const initBtn = emptyDiv.createEl("button", {
      cls: "tm-btn-init-workspace",
      text: t("init_workspace"),
    });
    initBtn.setAttribute("aria-label", t("init_workspace"));
    initBtn.addEventListener("click", () => {
      const result = this.plugin.kernelService.initWorkspace("stream");
      if (result.ok) {
        new Notice(t("init_workspace_success"));
        this.render();
      } else {
        new Notice(`${t("init_workspace_failed")}: ${result.error || ""}`);
      }
    });
  }

  /** Public refresh — called from main.ts after operations */
  async refresh(): Promise<void> {
    await this.render();
  }

  private async openWorkbench(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_STREAM_WORKBENCH);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    // New leaf — never replace the tab the user is currently reading.
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE_STREAM_WORKBENCH, active: true });
  }
}
