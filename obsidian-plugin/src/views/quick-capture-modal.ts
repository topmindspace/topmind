// ── Quick Capture Modal: zero-friction capture ─────────────────────────────

import { Modal, Notice } from "obsidian";
import type TopmindPlugin from "../main";
import { t } from "../i18n";
import type { CaptureTarget } from "../types";
import { extractTags } from "../utils";

export class QuickCaptureModal extends Modal {
  plugin: TopmindPlugin;
  textarea!: HTMLTextAreaElement;
  targetSelect!: HTMLSelectElement;

  constructor(app: import("obsidian").App, plugin: TopmindPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("tm-quick-capture-modal");
    contentEl.empty();
    contentEl.addClass("tm-quick-capture-textarea-container");

    // Title
    contentEl.createEl("h2", { text: "⚡ " + t("quick_capture_title") });

    // Textarea
    this.textarea = contentEl.createEl("textarea", {
      cls: "tm-quick-capture-textarea",
      attr: { placeholder: t("quick_capture_placeholder"), rows: "3" },
    });

    // Footer
    const footer = contentEl.createDiv({ cls: "tm-quick-capture-footer" });

    // Target selector
    const targetDiv = footer.createDiv({ cls: "tm-quick-capture-target" });
    targetDiv.createSpan({ text: t("quick_capture_target") + ":" });
    this.targetSelect = targetDiv.createEl("select");
    this.targetSelect.createEl("option", {
      value: "stream",
      text: t("quick_capture_target_stream"),
    });
    this.targetSelect.createEl("option", {
      value: "inbox",
      text: t("quick_capture_target_inbox"),
    });

    // Hint
    footer.createSpan({
      text: `${t("quick_capture_hint_enter")}    ${t("quick_capture_hint_shift_enter")}`,
      cls: "tm-hint",
    });

    // Focus input
    setTimeout(() => this.textarea.focus(), 50);

    // Submit on Enter (Shift+Enter for newline)
    // Escape is handled natively by Obsidian's Modal.close()
    this.textarea.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.submit();
      }
    });
  }

  private submit(): void {
    const text = this.textarea.value.trim();
    if (!text) {
      this.close();
      return;
    }

    const target = this.targetSelect.value as CaptureTarget;
    const tags = this.plugin.settings.autoTag ? extractTags(text) : [];

    // Disable input during write to prevent double-submit
    this.textarea.disabled = true;

    const result = this.plugin.kernelService.capture(text, { target, tags });

    if (result.ok) {
      this.close();
    } else {
      // Re-enable input so user can fix and retry
      this.textarea.disabled = false;
      this.textarea.focus();
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
