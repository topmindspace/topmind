// ── Stream Workbench View: main workbench in Obsidian center area ──────────

import { ItemView, WorkspaceLeaf, Notice, MarkdownRenderer } from "obsidian";
import type TopmindPlugin from "../main";
import { t } from "../i18n";
import { VIEW_TYPE_STREAM_WORKBENCH } from "../constants";
import type { StreamPeriod, StreamEntry, SuggestionCard, SuggestionKind } from "../types";
import { extractTags, isStreamOrTodoPath } from "../utils";

export class StreamWorkbenchView extends ItemView {
  plugin: TopmindPlugin;
  private inputEl!: HTMLTextAreaElement;
  private streamContainer!: HTMLElement;
  private suggestionContainer!: HTMLElement;
  private periodSelect!: HTMLSelectElement;
  private currentPeriods: StreamPeriod[] = [];
  private currentEntries: StreamEntry[] = [];
  private currentSuggestions: SuggestionCard[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private suggestionRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private suggestionInFlight = false;

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

    // ── Quick Input Bar ──
    const inputDiv = contentEl.createDiv({ cls: "tm-quick-input" });
    this.inputEl = inputDiv.createEl("textarea", {
      attr: { placeholder: "⚡ " + t("quick_capture_placeholder"), rows: "1" },
    });

    const submitBtn = inputDiv.createEl("button", { text: t("quick_capture_submit") });
    submitBtn.setAttribute("aria-label", t("quick_capture_submit"));
    submitBtn.addEventListener("click", () => this.submitInput());

    this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.submitInput();
      }
    });

    // Auto-grow textarea
    this.inputEl.addEventListener("input", () => {
      this.inputEl.style.height = "auto";
      this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 120) + "px";
    });

    // ── Stream Section ──
    const streamHeader = contentEl.createDiv({ cls: "tm-section-header" });
    streamHeader.createSpan({ text: "🌊 " + t("stream_this_week") });

    this.periodSelect = streamHeader.createEl("select");
    this.periodSelect.addEventListener("change", () => this.refreshStream());

    const organizeBtn = streamHeader.createEl("button", {
      text: t("stream_organize"),
      cls: "tm-card-actions",
    });
    organizeBtn.setAttribute("aria-label", t("stream_organize"));
    organizeBtn.addEventListener("click", () => this.organizePeriod());

    this.streamContainer = contentEl.createDiv({ cls: "tm-stream-container" });

    // ── Suggestions Section ──
    const suggHeader = contentEl.createDiv({ cls: "tm-section-header" });
    suggHeader.createSpan({ text: "✨ " + t("suggestions_title") });

    const refreshSuggBtn = suggHeader.createEl("button", {
      text: "↻",
      cls: "tm-card-actions",
    });
    refreshSuggBtn.setAttribute("aria-label", t("cmd_refresh_suggestions"));
    refreshSuggBtn.addEventListener("click", () => this.refreshSuggestions());

    this.suggestionContainer = contentEl.createDiv({ cls: "tm-suggestion-container" });

    // Initial load — both stream and suggestions
    await this.refreshAll();

    // Listen for vault changes (filtered to stream/todo paths)
    // Stream refresh is fast (file read + DOM render) → 450ms debounce
    // Suggestion refresh is expensive (AI calls) → only on explicit user action
    // Also listen for topmind.yaml changes → invalidate cache + refresh
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
    if (this.suggestionRefreshTimer) clearTimeout(this.suggestionRefreshTimer);
  }

  // ── Refresh ────────────────────────────────────────────────────────────

  /**
   * Schedule a stream-only refresh (fast, no AI calls).
   * Used by vault event listeners for reactive UI updates.
   */
  private scheduleRefresh(delay: number): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refreshStream(), delay);
  }

  /**
   * Full refresh — stream + suggestions.
   * Used on initial load and explicit user actions (organize, apply suggestion).
   * NOT used for vault event-driven refresh (would trigger expensive AI calls).
   */
  async refreshAll(): Promise<void> {
    await this.refreshStream();
    await this.refreshSuggestions();
  }

  async refreshStream(): Promise<void> {
    const { streamContainer } = this;
    streamContainer.empty();

    if (!this.plugin.kernelService.isWorkspaceReady()) {
      streamContainer.createDiv({
        cls: "tm-empty-state",
        text: t("init_workspace"),
      });
      return;
    }

    // Get stream context
    const ctx = this.plugin.kernelService.getStreamContext();
    this.currentPeriods = ctx.periods;

    // Update period selector (use DOM API, not innerHTML)
    while (this.periodSelect.firstChild) {
      this.periodSelect.removeChild(this.periodSelect.firstChild);
    }
    for (const p of ctx.periods) {
      this.periodSelect.createEl("option", {
        value: p.relPath,
        text: p.title,
      });
    }

    const selectedPath = this.periodSelect.value || ctx.current?.relPath;
    if (!selectedPath) {
      streamContainer.createDiv({
        cls: "tm-empty-state",
        text: t("stream_empty"),
      });
      return;
    }

    // Read period note
    const { entries } = this.plugin.kernelService.readPeriodNote(selectedPath);
    this.currentEntries = this.plugin.settings.timelineOrder === "desc"
      ? [...entries].reverse()
      : entries;

    if (this.currentEntries.length === 0) {
      streamContainer.createDiv({
        cls: "tm-empty-state",
        text: t("stream_empty"),
      });
      return;
    }

    // Render cards
    for (const entry of this.currentEntries) {
      void this.renderStreamCard(streamContainer, entry);
    }
  }

  private async renderStreamCard(container: HTMLElement, entry: StreamEntry): Promise<void> {
    const card = container.createDiv({ cls: "tm-card" });

    const header = card.createDiv({ cls: "tm-card-header" });
    header.createSpan({ cls: "tm-card-time", text: entry.time });

    const body = card.createDiv({ cls: "tm-card-body tm-collapsed" });
    // Render entry text as markdown instead of plain text for better readability
    if (entry.text) {
      try {
        await MarkdownRenderer.renderMarkdown(entry.text, body, "", this);
      } catch {
        // Fallback: plain text if markdown rendering fails
        body.textContent = entry.text;
      }
    } else {
      body.textContent = entry.text;
    }

    // Toggle collapse on click
    body.addEventListener("click", () => {
      body.classList.toggle("tm-collapsed");
    });
    body.setAttribute("role", "button");
    body.setAttribute("tabindex", "0");
    body.setAttribute("aria-label", t("stream_expand_entry"));

    // Footer with tags and actions
    if (entry.tags.length > 0) {
      const footer = card.createDiv({ cls: "tm-card-footer" });
      for (const tag of entry.tags) {
        footer.createSpan({ cls: "tm-card-tag", text: `#${tag}` });
      }
    }
  }

  async refreshSuggestions(): Promise<void> {
    // Guard against concurrent calls — if a refresh is already in flight,
    // skip the new call rather than racing and potentially overwriting results.
    if (this.suggestionInFlight) return;
    this.suggestionInFlight = true;

    const { suggestionContainer } = this;
    suggestionContainer.empty();

    if (!this.plugin.settings.autoSuggest || !this.plugin.kernelService.isWorkspaceReady()) {
      this.suggestionInFlight = false;
      return;
    }

    // Show loading indicator while AI is working
    suggestionContainer.createDiv({
      cls: "tm-loading",
      text: t("loading"),
    });

    try {
      const suggestions = await this.plugin.kernelService.generateSuggestions();
      this.currentSuggestions = suggestions;

      // Clear loading indicator
      suggestionContainer.empty();

      if (suggestions.length === 0) {
        suggestionContainer.createDiv({
          cls: "tm-empty-state",
          text: t("suggestions_empty"),
        });
        return;
      }

      for (const sugg of suggestions) {
        this.renderSuggestionCard(suggestionContainer, sugg);
      }
    } finally {
      this.suggestionInFlight = false;
    }
  }

  private renderSuggestionCard(container: HTMLElement, sugg: SuggestionCard): void {
    const card = container.createDiv({
      cls: `tm-suggestion-card tm-suggestion-${sugg.kind.replace(/_/g, "-")}`,
    });

    // Icon and label by suggestion kind — covers all Kernel suggest-engine
    // and ai-operation-engine suggestion types.
    const kindMeta: Record<SuggestionKind, { icon: string; border: string }> = {
      create_topic: { icon: "📂", border: "blue" },
      todo_extract: { icon: "📝", border: "orange" },
      promote_memory: { icon: "🧠", border: "green" },
      ai_summary: { icon: "📊", border: "purple" },
      inbox_review: { icon: "📥", border: "blue" },
      stale_topic: { icon: "📦", border: "orange" },
      catch_all: { icon: "🧹", border: "orange" },
      stream_digest: { icon: "📜", border: "purple" },
      open_profile: { icon: "👤", border: "green" },
    };
    const meta = kindMeta[sugg.kind] || kindMeta.promote_memory;

    const header = card.createDiv({ cls: "tm-suggestion-header" });
    header.createSpan({ text: `${meta.icon} ${sugg.title}` });

    card.createDiv({ cls: "tm-suggestion-body", text: sugg.summary });

    const actions = card.createDiv({ cls: "tm-suggestion-actions" });
    const confirmBtn = actions.createEl("button", {
      text: t("suggestions_confirm"),
      cls: "tm-btn-confirm",
    });
    confirmBtn.setAttribute("aria-label", t("suggestions_confirm"));
    confirmBtn.addEventListener("click", async () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "...";
      const result = await this.plugin.kernelService.applySuggestion(sugg);
      if (result.ok) {
        card.remove();
        await this.refreshAll();
      } else {
        confirmBtn.disabled = false;
        confirmBtn.textContent = t("suggestions_confirm");
      }
    });

    const dismissBtn = actions.createEl("button", {
      text: t("suggestions_dismiss"),
      cls: "tm-btn-dismiss",
    });
    dismissBtn.setAttribute("aria-label", t("suggestions_dismiss"));
    dismissBtn.addEventListener("click", () => {
      card.remove();
    });
  }

  // ── Actions ────────────────────────────────────────────────────────────

  private submitInput(): void {
    const text = this.inputEl.value.trim();
    if (!text) return;

    // URL detection: route links to inbox (knowledge capture, not stream clutter)
    const isUrl = /^https?:\/\/\S+$/iu.test(text);
    const target = isUrl ? "inbox" : "stream";
    if (isUrl) {
      new Notice(t("notice_url_to_inbox"));
    }

    const tags = this.plugin.settings.autoTag ? extractTags(text) : [];
    // Disable input during write to prevent double-submit
    this.inputEl.disabled = true;
    const result = this.plugin.kernelService.capture(text, { target, tags });

    if (result.ok) {
      this.inputEl.value = "";
      this.inputEl.style.height = "auto";
      this.refreshStream();
    }
    this.inputEl.disabled = false;
    this.inputEl.focus();
  }

  private async organizePeriod(): Promise<void> {
    const periodPath = this.periodSelect.value;
    if (!periodPath) return;

    new Notice(t("notice_organizing"));

    // Reconcile the period note via Kernel
    this.plugin.kernelService.reconcilePeriod(periodPath);

    // Try AI maintain todos if enabled
    if (this.plugin.settings.autoMaintainTodos) {
      await this.plugin.kernelService.runOperation("todo_maintain");
    }

    // Generate fresh suggestions
    await this.refreshSuggestions();
    await this.refreshStream();
    new Notice(t("notice_organize_done"));
  }
}
