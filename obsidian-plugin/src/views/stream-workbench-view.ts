// ── Stream Workbench View: main workbench in Obsidian center area ──────────
//
// Design principles:
// - Dense, information-rich layout (max-width 1100px, tighter spacing)
// - Quick input bar at top (always visible, always focused-ready)
// - Toolbar with quick access to sidebar + settings + model info + AI task progress
// - Stream section: period selector + day-grouped entry cards with append
// - AI Suggestions section: contextual empty states (disabled / no AI / loading)
// - All states (loading / empty / error / ready) are visually polished
// - Day grouping: entries grouped by ## day headings within period notes
// - Multi-task progress: AI operations show inline progress badge in toolbar
//
// UIUX (2026-08-11 refactor):
// - Toolbar buttons: icon + text labels (with responsive hide on narrow)
// - Card actions: icon-only with tooltips (compact, no overflow)
// - Suggestion refresh: icon-only
// - Loading states: spinner instead of "..." text
// - Organize button: icon + text (secondary button with refresh-cw icon)
// - Shared renderLayout() eliminates onOpen/refresh duplication

import { ItemView, WorkspaceLeaf, Notice, MarkdownRenderer, setIcon } from "obsidian";
import type TopmindPlugin from "../main";
import { t } from "../i18n";
import { VIEW_TYPE_STREAM_WORKBENCH, VIEW_TYPE_SIDEBAR_DOCK } from "../constants";
import type { StreamEntry, SuggestionCard } from "../types";
import {
  extractTags,
  isStreamOrTodoPath,
  isLoneUrlCapture,
  prepareStreamEntryTextForDisplay,
  SUGGESTION_KIND_META,
} from "../utils";
import { hasConfiguredProvider } from "../types";
import { aiTaskManager, type TaskProgress } from "../services/ai-task-manager";

/** Format entry count for display (uses i18n, kept in view layer). */
function formatEntryCount(count: number): string {
  return t("stream_entry_count").replace("{{count}}", String(count));
}

/** Day group for rendering. */
interface DayGroup {
  label: string;
  entries: StreamEntry[];
}

export class StreamWorkbenchView extends ItemView {
  plugin: TopmindPlugin;
  private inputEl!: HTMLTextAreaElement;
  private submitBtn!: HTMLButtonElement;
  private streamContainer!: HTMLElement;
  private suggestionContainer!: HTMLElement;
  private periodSelect!: HTMLSelectElement;
  private entryCountEl!: HTMLElement;
  private organizeBtn!: HTMLButtonElement;
  private taskBadgeEl: HTMLElement | null = null;
  private currentEntries: StreamEntry[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private suggestionInFlight = false;
  private streamLoading = false;
  private organizing = false;
  private taskUnsub: (() => void) | null = null;
  private urlHintEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: TopmindPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_STREAM_WORKBENCH;
  }

  getDisplayText(): string {
    return t("stream_workbench_title");
  }

  getIcon(): string {
    return "waves";
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tm-stream-workbench");

    // Render layout (shared between onOpen and refresh)
    this.renderLayout(contentEl);

    // Initial load
    await this.refreshAll();

    // Vault change listener (filtered to stream/todo paths)
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

    // Subscribe to AI task progress
    this.taskUnsub = aiTaskManager.subscribe((progress) => this.updateTaskBadge(progress));
  }

  async onClose(): Promise<void> {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.taskUnsub?.();
  }

  // ── Layout (shared between onOpen and refresh) ──────────────────────

  /** Render the full layout: toolbar + input bar + stream section + suggestions section */
  private renderLayout(contentEl: HTMLElement): void {
    // ── Toolbar ──
    this.renderToolbar(contentEl);

    // ── Quick Input Bar ──
    const inputBar = contentEl.createDiv({ cls: "tm-input-bar" });
    const inputWrap = inputBar.createDiv({ cls: "tm-input-wrap" });
    this.inputEl = inputWrap.createEl("textarea", {
      cls: "tm-input-field",
      attr: {
        placeholder: t("quick_capture_placeholder"),
        rows: "1",
        "aria-label": t("quick_capture_log_it"),
      },
    });

    // URL detection hint (visual feedback when typing a lone URL)
    this.urlHintEl = inputWrap.createDiv({ cls: "tm-url-hint tm-url-hint-hidden" });
    const urlHintIcon = this.urlHintEl.createSpan({ cls: "tm-url-hint-icon" });
    setIcon(urlHintIcon, "link");
    this.urlHintEl.createSpan({ text: t("compose_url_hint") });

    this.submitBtn = inputBar.createEl("button", {
      text: t("quick_capture_log_it"),
      cls: "tm-submit-btn",
    });
    this.submitBtn.setAttribute("aria-label", t("quick_capture_log_it"));

    // Interactions
    this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.submitInput();
      }
    });
    this.inputEl.addEventListener("input", () => {
      this.autoGrowTextarea(this.inputEl);
      this.updateUrlHint();
    });
    this.submitBtn.addEventListener("click", () => this.submitInput());

    // ── Stream Section ──
    const streamHeader = contentEl.createDiv({ cls: "tm-section-header" });
    const streamTitleDiv = streamHeader.createDiv({ cls: "tm-section-title" });
    streamTitleDiv.createSpan({ text: t("stream_this_week") });
    this.entryCountEl = streamTitleDiv.createSpan({ cls: "tm-entry-count" });

    const streamControls = streamHeader.createDiv({ cls: "tm-section-controls" });

    // Manual refresh button — reloads stream content from vault
    const refreshStreamBtn = streamControls.createEl("button", {
      cls: "tm-btn-secondary tm-btn-icon-only",
    });
    setIcon(refreshStreamBtn, "refresh-cw");
    refreshStreamBtn.setAttribute("aria-label", t("toolbar_btn_refresh"));
    refreshStreamBtn.setAttribute("title", t("toolbar_btn_refresh"));
    refreshStreamBtn.addEventListener("click", () => {
      refreshStreamBtn.addClass("tm-btn-spinning");
      this.refreshStream().finally(() => {
        refreshStreamBtn.removeClass("tm-btn-spinning");
      });
    });

    this.periodSelect = streamControls.createEl("select", {
      cls: "tm-period-select",
    });
    this.periodSelect.setAttribute("aria-label", t("stream_switch_period"));
    this.periodSelect.addEventListener("change", () => this.refreshStream());

    this.organizeBtn = streamControls.createEl("button", {
      cls: "tm-btn-secondary",
    });
    setIcon(this.organizeBtn, "list-tree");
    this.organizeBtn.createSpan({ text: t("stream_organize") });
    this.organizeBtn.setAttribute("aria-label", t("stream_organize"));
    this.organizeBtn.addEventListener("click", () => this.organizePeriod());

    this.streamContainer = contentEl.createDiv({ cls: "tm-stream-container" });

    // ── Suggestions Section ──
    const suggHeader = contentEl.createDiv({ cls: "tm-section-header" });
    suggHeader.createSpan({ text: t("suggestions_title"), cls: "tm-section-title" });

    const suggControls = suggHeader.createDiv({ cls: "tm-section-controls" });
    const refreshSuggBtn = suggControls.createEl("button", {
      cls: "tm-btn-secondary tm-btn-icon-only",
    });
    setIcon(refreshSuggBtn, "refresh-cw");
    refreshSuggBtn.setAttribute("aria-label", t("cmd_refresh_suggestions"));
    refreshSuggBtn.setAttribute("title", t("cmd_refresh_suggestions"));
    refreshSuggBtn.addEventListener("click", () => this.refreshSuggestions({ force: true }));

    this.suggestionContainer = contentEl.createDiv({ cls: "tm-suggestion-container" });
  }

  // ── Toolbar ────────────────────────────────────────────────────────────

  private renderToolbar(container: HTMLElement): void {
    const toolbar = container.createDiv({ cls: "tm-toolbar" });

    // Left: workspace status badge
    const aiReady = hasConfiguredProvider(this.plugin.settings.ai);
    const statusBadge = toolbar.createDiv({ cls: "tm-toolbar-status" });
    const dot = statusBadge.createSpan({ cls: `tm-status-dot ${aiReady ? "tm-dot-ok" : "tm-dot-off"}` });
    dot.setAttribute("aria-hidden", "true");
    statusBadge.createSpan({
      text: aiReady ? t("sidebar_ai_ready") : t("sidebar_ai_off"),
      cls: "tm-toolbar-status-label",
    });

    // Model badge (if AI configured) — clickable to open settings for model switch
    if (aiReady) {
      const modelLabel = this.plugin.kernelService.getActiveModelLabel();
      if (modelLabel) {
        const modelBadge = toolbar.createDiv({ cls: "tm-toolbar-model", text: modelLabel });
        modelBadge.setAttribute("role", "button");
        modelBadge.setAttribute("tabindex", "0");
        modelBadge.setAttribute("title", t("chat_model_switch"));
        modelBadge.addEventListener("click", () => this.openSettings());
        modelBadge.addEventListener("keydown", (e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            modelBadge.click();
          }
        });
      }
    }

    // AI Task progress badge (updated by subscribe)
    this.taskBadgeEl = toolbar.createDiv({ cls: "tm-task-badge tm-task-badge-hidden" });

    // Right: quick action buttons (icon-only with tooltips — no text overflow)
    const actionsDiv = toolbar.createDiv({ cls: "tm-toolbar-actions" });

    // Open sidebar button
    const sidebarBtn = actionsDiv.createEl("button", { cls: "tm-toolbar-btn tm-toolbar-btn-labeled" });
    setIcon(sidebarBtn, "panel-right");
    sidebarBtn.createSpan({ text: t("toolbar_btn_sidebar"), cls: "tm-toolbar-btn-label" });
    sidebarBtn.setAttribute("aria-label", t("sidebar_open_sidebar"));
    sidebarBtn.setAttribute("title", t("sidebar_open_sidebar"));
    sidebarBtn.addEventListener("click", () => this.openSidebar());

    // Settings button
    const settingsBtn = actionsDiv.createEl("button", { cls: "tm-toolbar-btn tm-toolbar-btn-labeled" });
    setIcon(settingsBtn, "settings");
    settingsBtn.createSpan({ text: t("toolbar_btn_settings"), cls: "tm-toolbar-btn-label" });
    settingsBtn.setAttribute("aria-label", t("sidebar_open_settings"));
    settingsBtn.setAttribute("title", t("sidebar_open_settings"));
    settingsBtn.addEventListener("click", () => this.openSettings());

    // New Note button — creates a new note in the inbox directory
    const newNoteBtn = actionsDiv.createEl("button", { cls: "tm-toolbar-btn tm-toolbar-btn-labeled" });
    setIcon(newNoteBtn, "file-plus");
    newNoteBtn.createSpan({ text: t("toolbar_btn_new_note"), cls: "tm-toolbar-btn-label" });
    newNoteBtn.setAttribute("aria-label", t("toolbar_btn_new_note"));
    newNoteBtn.setAttribute("title", t("toolbar_btn_new_note"));
    newNoteBtn.addEventListener("click", () => this.createNewNote());

    // Profile button
    const profileBtn = actionsDiv.createEl("button", { cls: "tm-toolbar-btn tm-toolbar-btn-labeled" });
    setIcon(profileBtn, "user");
    profileBtn.createSpan({ text: t("toolbar_btn_profile"), cls: "tm-toolbar-btn-label" });
    profileBtn.setAttribute("aria-label", t("cmd_open_profile"));
    profileBtn.setAttribute("title", t("cmd_open_profile"));
    profileBtn.addEventListener("click", () => this.openProfile());
  }

  /** Open plugin settings tab */
  private openSettings(): void {
    const setting = (this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting;
    setting?.open();
    setting?.openTabById("topmind-stream");
  }

  /** Update AI task progress badge in toolbar */
  private updateTaskBadge(progress: TaskProgress): void {
    if (!this.taskBadgeEl) return;

    if (progress.multiActive === 0) {
      this.taskBadgeEl.addClass("tm-task-badge-hidden");
      return;
    }

    this.taskBadgeEl.removeClass("tm-task-badge-hidden");
    this.taskBadgeEl.empty();

    const active = progress.active;
    if (active) {
      const label = this.taskBadgeEl.createSpan({ cls: "tm-task-badge-label" });
      label.textContent = active.label;
      const statusDot = this.taskBadgeEl.createSpan({ cls: "tm-task-badge-dot" });
      statusDot.setAttribute("aria-hidden", "true");
      this.taskBadgeEl.addClass("tm-task-badge-active");

      // Abort button
      const abortBtn = this.taskBadgeEl.createEl("button", { cls: "tm-task-badge-abort" });
      setIcon(abortBtn, "x");
      abortBtn.setAttribute("aria-label", t("task_abort"));
      abortBtn.setAttribute("title", t("task_abort"));
      abortBtn.addEventListener("click", (e: MouseEvent) => {
        e.stopPropagation();
        aiTaskManager.abort();
      });
    } else if (progress.queued.length > 0) {
      this.taskBadgeEl.createSpan({
        text: t("task_queued_count").replace("{{count}}", String(progress.queued.length)),
        cls: "tm-task-badge-label",
      });
    }
  }

  private async openSidebar(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR_DOCK);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: VIEW_TYPE_SIDEBAR_DOCK, active: true });
  }

  /** Create a new untitled inbox note via Kernel writeback, then open it. */
  private async createNewNote(): Promise<void> {
    if (!this.plugin.kernelService.isWorkspaceReady()) {
      new Notice(t("notice_workspace_not_ready"));
      return;
    }

    try {
      const created = this.plugin.kernelService.createInboxNote();
      if (!created.ok || !created.path) return;

      await this.app.workspace.openLinkText(created.path, "", false);
      new Notice(t("notice_new_note_created"));
    } catch (err) {
      console.error("[topmind] createNewNote failed:", err);
      new Notice(t("notice_new_note_failed"));
    }
  }

  private async openProfile(): Promise<void> {
    if (!this.plugin.kernelService.isWorkspaceReady()) {
      new Notice(t("notice_workspace_not_ready"));
      return;
    }
    await this.app.workspace.openLinkText(this.plugin.kernelService.profileRelPath(), "", false);
  }

  // ── Refresh ────────────────────────────────────────────────────────────

  private scheduleRefresh(delay: number): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refreshAll(), delay);
  }

  private autoGrowTextarea(el: HTMLTextAreaElement): void {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  private updateUrlHint(): void {
    if (!this.urlHintEl) return;
    const text = this.inputEl.value.trim();
    const isUrl = isLoneUrlCapture(text);
    if (isUrl) {
      this.urlHintEl.removeClass("tm-url-hint-hidden");
    } else {
      this.urlHintEl.addClass("tm-url-hint-hidden");
    }
  }

  async refreshAll(): Promise<void> {
    await this.refreshStream();
    await this.refreshSuggestions();
  }

  /** Full re-render (toolbar + content) — called after settings changes */
  async refresh(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tm-stream-workbench");
    this.renderLayout(contentEl);
    await this.refreshAll();
  }

  async refreshStream(): Promise<void> {
    const { streamContainer } = this;

    if (!this.streamLoading) {
      this.streamLoading = true;
      streamContainer.empty();
      streamContainer.createDiv({
        cls: "tm-loading tm-loading-spinner",
        text: t("stream_loading"),
      });
    }

    if (!this.plugin.kernelService.isWorkspaceReady()) {
      this.streamLoading = false;
      streamContainer.empty();
      this.renderWorkspaceInit(streamContainer);
      return;
    }

    try {
      const ctx = await this.plugin.kernelService.getStreamContext();

      const prevSelected = this.periodSelect.value;

      while (this.periodSelect.firstChild) {
        this.periodSelect.removeChild(this.periodSelect.firstChild);
      }
      for (const p of ctx.periods) {
        this.periodSelect.createEl("option", {
          value: p.relPath,
          text: p.title,
        });
      }

      if (prevSelected && ctx.periods.some((p) => p.relPath === prevSelected)) {
        this.periodSelect.value = prevSelected;
      } else if (ctx.current?.relPath) {
        this.periodSelect.value = ctx.current.relPath;
      }

      const selectedPath = this.periodSelect.value || ctx.current?.relPath;
      if (!selectedPath) {
        this.streamLoading = false;
        streamContainer.empty();
        this.renderEmptyStream(streamContainer);
        this.updateEntryCount(0);
        return;
      }

      const { content, entries } = this.plugin.kernelService.readPeriodNote(selectedPath);
      this.currentEntries = this.plugin.settings.timelineOrder === "desc"
        ? [...entries].reverse()
        : entries;

      this.streamLoading = false;
      streamContainer.empty();

      if (this.currentEntries.length === 0) {
        this.renderEmptyStream(streamContainer);
        this.updateEntryCount(0);
        return;
      }

      this.updateEntryCount(this.currentEntries.length);

      // Render entries with day grouping (parse from period note content)
      this.renderStreamEntries(streamContainer, this.currentEntries, selectedPath, content);
    } catch (err) {
      this.streamLoading = false;
      streamContainer.empty();
      streamContainer.createDiv({
        cls: "tm-empty-state",
        text: t("error"),
      });
      console.error("[topmind] refreshStream failed:", err);
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
        this.refreshAll();
      } else {
        new Notice(`${t("init_workspace_failed")}: ${result.error || ""}`);
      }
    });
  }

  private renderEmptyStream(container: HTMLElement): void {
    const emptyDiv = container.createDiv({ cls: "tm-empty-state tm-stream-empty" });
    const iconDiv = emptyDiv.createDiv({ cls: "tm-empty-icon" });
    setIcon(iconDiv, "waves");
    emptyDiv.createDiv({ text: t("stream_empty"), cls: "tm-empty-title" });
    emptyDiv.createDiv({ text: t("stream_empty_hint"), cls: "tm-empty-hint" });
  }

  /**
   * Group entries by day heading. The period note may contain `## ` or `### `
   * headings that separate days. We parse these from the raw content to
   * create day groups. If no day headings found, entries are grouped by
   * their time prefix.
   */
  private groupByDayHeading(entries: StreamEntry[], fullContent: string): DayGroup[] {
    if (entries.length === 0) return [];

    // Try to extract ## day headings from content
    // Use match() per line to avoid stateful regex lastIndex bug with exec()
    const headings: { title: string; lineOffset: number }[] = [];
    const lines = fullContent.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^#{2,3}\s+(.+)$/u);
      if (match) {
        headings.push({ title: match[1].trim(), lineOffset: i });
      }
    }

    // If we have headings, group entries by the heading they fall under
    if (headings.length > 0) {
      const groups: DayGroup[] = [];
      let currentGroup: DayGroup | null = null;
      let headingIdx = 0;

      for (const entry of entries) {
        // Find the heading this entry belongs to
        while (headingIdx < headings.length && headings[headingIdx].lineOffset < entry.lineOffset) {
          currentGroup = { label: headings[headingIdx].title, entries: [] };
          groups.push(currentGroup);
          headingIdx++;
        }
        if (currentGroup) {
          currentGroup.entries.push(entry);
        } else {
          // Entry before any heading — create unnamed group
          currentGroup = { label: "", entries: [] };
          groups.push(currentGroup);
          currentGroup.entries.push(entry);
        }
      }
      return groups;
    }

    // No headings — try grouping by time pattern (AM/PM or date-ish)
    // Simple approach: all in one group
    return [{ label: "", entries }];
  }

  private updateEntryCount(count: number): void {
    if (this.entryCountEl) {
      this.entryCountEl.textContent = count > 0 ? ` · ${formatEntryCount(count)}` : "";
    }
  }

  private renderStreamEntries(container: HTMLElement, entries: StreamEntry[], periodPath: string, fullContent: string): void {
    const groups = this.groupByDayHeading(entries, fullContent);

    for (const group of groups) {
      if (groups.length > 1 && group.label) {
        const dayHeader = container.createDiv({ cls: "tm-day-header" });
        dayHeader.createSpan({ text: group.label, cls: "tm-day-label" });
        dayHeader.createSpan({ text: `${group.entries.length}`, cls: "tm-day-count" });
      }
      for (const entry of group.entries) {
        void this.renderStreamCard(container, entry, periodPath);
      }
    }
  }

  private async renderStreamCard(container: HTMLElement, entry: StreamEntry, periodPath: string): Promise<void> {
    const card = container.createDiv({ cls: "tm-card" });

    const header = card.createDiv({ cls: "tm-card-header" });
    const timeIcon = header.createSpan({ cls: "tm-card-time-icon" });
    setIcon(timeIcon, "clock");
    header.createSpan({ cls: "tm-card-time", text: entry.time });

    // Card actions (icon-only with tooltips — compact, no overflow)
    const actionsEl = header.createDiv({ cls: "tm-card-actions" });

    // Copy button
    const copyBtn = actionsEl.createEl("button", {
      cls: "tm-card-action-btn",
      attr: { "aria-label": t("stream_btn_copy"), title: t("stream_btn_copy") },
    });
    setIcon(copyBtn, "copy");
    copyBtn.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      const copyText = prepareStreamEntryTextForDisplay(entry.text);
      navigator.clipboard.writeText(copyText).then(() => {
        new Notice(t("stream_card_copied"));
      });
    });

    // Open in editor button
    const editBtn = actionsEl.createEl("button", {
      cls: "tm-card-action-btn",
      attr: { "aria-label": t("stream_btn_edit"), title: t("stream_open_in_editor") },
    });
    setIcon(editBtn, "pencil");
    editBtn.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      this.app.workspace.openLinkText(periodPath, "", false);
    });

    // Collapse only very long cards (>600 chars or >20 non-empty lines).
    // Desktop feed expand is 480/8; this page uses a looser 600/20 so more cards stay open.
    const displayText = prepareStreamEntryTextForDisplay(entry.text);
    const isLongContent = displayText.length > 600 || displayText.split("\n").filter((l: string) => l.trim()).length > 20;
    const body = card.createDiv({ cls: isLongContent ? "tm-card-body tm-collapsed" : "tm-card-body" });
    if (displayText) {
      try {
        await MarkdownRenderer.render(this.app, displayText, body, "", this);
      } catch {
        body.textContent = displayText;
      }
    }

    // Only attach collapse toggle for long content
    if (isLongContent) {
      const toggleCollapse = () => {
        body.classList.toggle("tm-collapsed");
      };
      body.addEventListener("click", toggleCollapse);
      body.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleCollapse();
        }
      });
      body.setAttribute("role", "button");
      body.setAttribute("tabindex", "0");
      body.setAttribute("aria-label", t("stream_expand_entry"));
    }

    if (entry.tags.length > 0) {
      const footer = card.createDiv({ cls: "tm-card-footer" });
      for (const tag of entry.tags) {
        footer.createSpan({ cls: "tm-card-tag", text: `#${tag}` });
      }
    }
  }

  async refreshSuggestions(opts: { force?: boolean } = {}): Promise<void> {
    if (this.suggestionInFlight) return;
    this.suggestionInFlight = true;

    const { suggestionContainer } = this;
    suggestionContainer.empty();

    // Check states in order: workspace not ready → AI not configured → suggestions disabled → loading → content
    if (!this.plugin.kernelService.isWorkspaceReady()) {
      this.suggestionInFlight = false;
      return;
    }

    const aiConfigured = hasConfiguredProvider(this.plugin.settings.ai);
    if (!aiConfigured) {
      this.renderSuggestionState(suggestionContainer, t("suggestions_no_ai"), t("suggestions_no_ai_hint"));
      // Add actionable configure button
      const actionDiv = suggestionContainer.createDiv({ cls: "tm-empty-action" });
      const configureBtn = actionDiv.createEl("button", {
        cls: "tm-btn-init-workspace",
        text: t("empty_action_configure"),
      });
      configureBtn.addEventListener("click", () => this.openSettings());
      this.suggestionInFlight = false;
      return;
    }

    // Show loading
    const loadingEl = suggestionContainer.createDiv({ cls: "tm-loading tm-loading-spinner" });
    loadingEl.createSpan({ text: t("suggestions_loading") });

    try {
      const suggestions = await this.plugin.kernelService.generateSuggestions(opts);

      suggestionContainer.empty();

      if (suggestions.length === 0) {
        if (!this.plugin.settings.autoSuggest && opts.force !== true) {
          this.renderSuggestionState(suggestionContainer, t("suggestions_disabled"), t("suggestions_disabled_hint"));
        } else {
          this.renderSuggestionState(suggestionContainer, t("suggestions_empty"), t("suggestions_empty_hint"));
        }
        return;
      }

      // Suggestion count badge
      const countEl = suggestionContainer.createDiv({ cls: "tm-suggestion-summary" });
      countEl.createSpan({
        text: t("sidebar_suggestions_count").replace("{{count}}", String(suggestions.length)),
        cls: "tm-suggestion-count-badge",
      });

      for (const sugg of suggestions) {
        this.renderSuggestionCard(suggestionContainer, sugg);
      }
    } finally {
      this.suggestionInFlight = false;
    }
  }

  private renderSuggestionState(container: HTMLElement, title: string, hint: string): void {
    const div = container.createDiv({ cls: "tm-empty-state tm-suggestion-empty" });
    const iconDiv = div.createDiv({ cls: "tm-empty-icon" });
    setIcon(iconDiv, "lightbulb");
    div.createDiv({ text: title, cls: "tm-empty-title" });
    div.createDiv({ text: hint, cls: "tm-empty-hint" });
  }

  private renderSuggestionCard(container: HTMLElement, sugg: SuggestionCard): void {
    const card = container.createDiv({
      cls: `tm-suggestion-card tm-suggestion-${sugg.kind.replace(/_/g, "-")}`,
    });

    const meta = SUGGESTION_KIND_META[sugg.kind] || SUGGESTION_KIND_META.promote_memory;

    const header = card.createDiv({ cls: "tm-suggestion-header" });
    const iconSpan = header.createSpan({ cls: "tm-suggestion-icon" });
    setIcon(iconSpan, meta.icon);
    header.createSpan({ cls: "tm-suggestion-title", text: sugg.title });

    if (sugg.impact && sugg.impact !== "low") {
      const impactLabel = sugg.impact === "high"
        ? t("suggestion_impact_high")
        : t("suggestion_impact_medium");
      header.createSpan({ cls: `tm-impact-badge tm-impact-${sugg.impact}`, text: impactLabel });
    }

    card.createDiv({ cls: "tm-suggestion-body", text: sugg.summary });

    const actions = card.createDiv({ cls: "tm-suggestion-actions" });
    const confirmBtn = actions.createEl("button", {
      text: t("suggestions_confirm"),
      cls: "tm-btn-confirm",
    });
    confirmBtn.setAttribute("aria-label", t("suggestions_confirm"));
    confirmBtn.addEventListener("click", async () => {
      confirmBtn.disabled = true;
      confirmBtn.empty();
      confirmBtn.createSpan({ cls: "tm-btn-spinner" });
      const result = await this.plugin.kernelService.applySuggestion(sugg);
      if (result.ok) {
        card.classList.add("tm-card-removing");
        setTimeout(() => card.remove(), 200);
        if (result.openPath) {
          await this.app.workspace.openLinkText(result.openPath, "", false);
        }
        await this.refreshAll();
      } else {
        confirmBtn.disabled = false;
        confirmBtn.empty();
        confirmBtn.textContent = t("suggestions_confirm");
      }
    });

    const dismissBtn = actions.createEl("button", {
      text: t("suggestions_dismiss"),
      cls: "tm-btn-dismiss",
    });
    dismissBtn.setAttribute("aria-label", t("suggestions_dismiss"));
    dismissBtn.addEventListener("click", () => {
      this.plugin.kernelService.dropSuggestion(sugg.id);
      card.classList.add("tm-card-removing");
      setTimeout(() => card.remove(), 200);
    });
  }

  // ── Actions ────────────────────────────────────────────────────────────

  private submitInput(): void {
    const text = this.inputEl.value.trim();
    if (!text) return;

    const isUrl = isLoneUrlCapture(text);
    const target = isUrl ? "inbox" : "stream";
    if (isUrl) {
      new Notice(t("notice_url_to_inbox"));
    }

    const tags = this.plugin.settings.autoTag ? extractTags(text) : [];
    this.inputEl.disabled = true;
    this.submitBtn.disabled = true;
    this.submitBtn.empty();
    this.submitBtn.createSpan({ cls: "tm-btn-spinner" });
    const result = this.plugin.kernelService.capture(text, { target, tags });

    if (result.ok) {
      this.inputEl.value = "";
      this.inputEl.style.height = "auto";
      this.refreshStream();
      // Scroll to top (newest entry in desc order)
      this.streamContainer.scrollTop = 0;
      new Notice(t("notice_written"));
    } else {
      new Notice(t("notice_write_failed"));
    }
    this.inputEl.disabled = false;
    this.submitBtn.disabled = false;
    this.submitBtn.empty();
    this.submitBtn.textContent = t("quick_capture_log_it");
    this.inputEl.focus();
  }

  private async organizePeriod(): Promise<void> {
    if (this.organizing) return;
    const periodPath = this.periodSelect.value;
    if (!periodPath) return;

    this.organizing = true;
    this.organizeBtn.disabled = true;
    this.organizeBtn.empty();
    this.organizeBtn.createSpan({ cls: "tm-btn-spinner tm-btn-spinner-dark" });
    new Notice(t("notice_organizing"));

    try {
      this.plugin.kernelService.reconcilePeriod(periodPath);

      if (this.plugin.settings.autoMaintainTodos) {
        await this.plugin.kernelService.runOperation("todo_maintain");
      }

      await this.refreshSuggestions();
      await this.refreshStream();
      new Notice(t("notice_organize_done"));
    } catch (err) {
      console.error("[topmind] organizePeriod failed:", err);
      new Notice(`${t("notice_execute_failed")}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.organizing = false;
      this.organizeBtn.disabled = false;
      this.organizeBtn.empty();
      setIcon(this.organizeBtn, "list-tree");
      this.organizeBtn.createSpan({ text: t("stream_organize") });
    }
  }
}
