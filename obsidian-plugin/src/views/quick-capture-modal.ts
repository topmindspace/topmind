// ── Quick Capture Modal: zero-friction capture ─────────────────────────────
//
// Design: open → focus → type → Enter → done.
// Esc closes without saving. Tab works naturally (textarea → tag input → target).
// Auto-resize textarea. Visual feedback on submit.
// Enhanced: better visual polish, keyboard hints, URL detection indicator.

import { Modal, Notice, setIcon } from "obsidian";
import type TopmindPlugin from "../main";
import { t } from "../i18n";
import type { CaptureTarget } from "../types";
import { extractTags, isLoneUrlCapture } from "../utils";

export class QuickCaptureModal extends Modal {
  plugin: TopmindPlugin;
  textarea!: HTMLTextAreaElement;
  targetSelect!: HTMLSelectElement;
  tagInput!: HTMLInputElement;
  submitBtn!: HTMLButtonElement;
  urlHintEl: HTMLElement | null = null;
  charCountEl: HTMLElement | null = null;

  constructor(app: import("obsidian").App, plugin: TopmindPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("tm-quick-capture-modal");
    contentEl.empty();
    contentEl.addClass("tm-quick-capture-content");

    // Title with icon
    const titleDiv = contentEl.createDiv({ cls: "tm-modal-title" });
    const titleIcon = titleDiv.createSpan({ cls: "tm-modal-icon" });
    setIcon(titleIcon, "zap");
    titleDiv.createSpan({ text: t("quick_capture_title") });

    // Textarea with wrapper for char count
    const textareaWrap = contentEl.createDiv({ cls: "tm-quick-capture-textarea-wrap" });
    this.textarea = textareaWrap.createEl("textarea", {
      cls: "tm-quick-capture-textarea",
      attr: { placeholder: t("quick_capture_placeholder"), rows: "3", autofocus: "true" },
    });

    // Character count + URL hint
    const metaBar = textareaWrap.createDiv({ cls: "tm-quick-capture-meta" });
    this.urlHintEl = metaBar.createSpan({ cls: "tm-url-hint tm-url-hint-hidden" });
    const urlIcon = this.urlHintEl.createSpan({ cls: "tm-url-hint-icon" });
    setIcon(urlIcon, "link");
    this.urlHintEl.createSpan({ text: t("notice_url_to_inbox") });

    this.charCountEl = metaBar.createSpan({ cls: "tm-char-count" });
    this.charCountEl.textContent = "0";

    // Footer
    const footer = contentEl.createDiv({ cls: "tm-quick-capture-footer" });

    // Left: target + tags
    const leftDiv = footer.createDiv({ cls: "tm-footer-left" });

    const targetDiv = leftDiv.createDiv({ cls: "tm-quick-capture-target" });
    targetDiv.createSpan({ text: t("quick_capture_target"), cls: "tm-footer-label" });
    this.targetSelect = targetDiv.createEl("select");
    this.targetSelect.createEl("option", { value: "stream", text: t("quick_capture_target_stream") });
    this.targetSelect.createEl("option", { value: "inbox", text: t("quick_capture_target_inbox") });

    const tagDiv = leftDiv.createDiv({ cls: "tm-quick-capture-tags" });
    tagDiv.createSpan({ text: t("quick_capture_tags"), cls: "tm-footer-label" });
    this.tagInput = tagDiv.createEl("input", {
      cls: "tm-tag-input",
      attr: { type: "text", placeholder: t("quick_capture_tags_placeholder") },
    });

    // Right: hints + submit
    const rightDiv = footer.createDiv({ cls: "tm-footer-right" });
    rightDiv.createSpan({
      text: `${t("quick_capture_hint_enter_note")}  ${t("quick_capture_hint_shift_enter")}`,
      cls: "tm-hint",
    });

    this.submitBtn = footer.createEl("button", {
      text: t("quick_capture_note_it"),
      cls: "tm-submit-btn",
    });
    this.submitBtn.setAttribute("aria-label", t("quick_capture_note_it"));

    // Focus input
    setTimeout(() => this.textarea.focus(), 50);

    // Auto-grow textarea + char count + URL detection
    this.textarea.addEventListener("input", () => {
      this.textarea.style.height = "auto";
      this.textarea.style.height = Math.min(this.textarea.scrollHeight, 300) + "px";
      this.updateCharCount();
      this.updateUrlHint();
    });

    // Enter submits, Shift+Enter newline
    this.textarea.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.submit();
      }
      // Esc closes without saving
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });

    // Submit button
    this.submitBtn.addEventListener("click", () => this.submit());

    // Target change — manual override removes URL hint
    this.targetSelect.addEventListener("change", () => {
      if (this.urlHintEl && this.targetSelect.value !== "inbox") {
        this.urlHintEl.addClass("tm-url-hint-hidden");
      }
    });
  }

  private updateCharCount(): void {
    if (this.charCountEl) {
      this.charCountEl.textContent = String(this.textarea.value.length);
    }
  }

  private updateUrlHint(): void {
    if (!this.urlHintEl) return;
    const text = this.textarea.value.trim();
    const isUrl = isLoneUrlCapture(text);
    if (isUrl) {
      this.targetSelect.value = "inbox";
      this.urlHintEl.removeClass("tm-url-hint-hidden");
    } else if (this.targetSelect.value === "inbox") {
      // Only hide if target is inbox but text is not URL and was auto-set
      this.urlHintEl.addClass("tm-url-hint-hidden");
    }
  }

  private submit(): void {
    if (this.submitBtn.disabled) return;
    const text = this.textarea.value.trim();
    if (!text) {
      this.close();
      return;
    }

    const target = this.targetSelect.value as CaptureTarget;

    // Merge auto-extracted tags with manually entered tags
    let tags = this.plugin.settings.autoTag ? extractTags(text) : [];
    const manualTags = extractTags(this.tagInput.value);
    const existing = new Set(tags.map((t) => t.toLowerCase()));
    for (const mt of manualTags) {
      if (!existing.has(mt.toLowerCase())) {
        tags.push(mt);
        existing.add(mt.toLowerCase());
      }
    }

    // Disable during write
    this.textarea.disabled = true;
    this.tagInput.disabled = true;
    this.submitBtn.disabled = true;
    this.submitBtn.empty();
    this.submitBtn.createSpan({ cls: "tm-btn-spinner" });

    const result = this.plugin.kernelService.capture(text, { target, tags });

    if (result.ok) {
      this.modalEl.addClass("tm-modal-submitted");
      new Notice(t("quick_capture_success"), 2000);
      setTimeout(() => this.close(), 120);
    } else {
      this.textarea.disabled = false;
      this.tagInput.disabled = false;
      this.submitBtn.disabled = false;
      this.submitBtn.empty();
      this.submitBtn.textContent = t("quick_capture_note_it");
      this.textarea.focus();
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
