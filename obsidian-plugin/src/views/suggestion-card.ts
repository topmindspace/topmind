/**
 * Shared suggestion-card renderer — sidebar dock 与 stream workbench 共用
 * **同一张卡片表面**（2026-08-30 统一，此前两份拷贝已发生词汇漂移）。
 *
 * 动作词汇与 Desktop 对齐（跨表面规范）：
 * - write 类主按钮「确认执行」→ Kernel `applySuggestion`
 * - `open_profile` 主按钮「打开」（apply 本身即打开画像）
 * - write 类卡片可解析出目标文件时附「打开」次按钮（先查看再决定）
 *   + 目标路径面包屑（`… / 2026 / 2026-W30.md`）
 * - 「忽略」→ 移出会话
 */
import { setIcon } from "obsidian";
import { t } from "../i18n";
import type { SuggestionCard } from "../types";
import {
  friendlySuggestionPath,
  suggestionApplyIsWrite,
  suggestionOpenPath,
  SUGGESTION_KIND_META,
} from "../utils";

export interface SuggestionCardCallbacks {
  /** Kernel apply — resolves { ok, openPath } apply evidence. */
  apply(sugg: SuggestionCard): Promise<{ ok: boolean; openPath?: string | null }>;
  /** Remove the suggestion from the session (忽略). */
  dismiss(sugg: SuggestionCard): void;
  /** Refresh host views after a successful apply. */
  refresh(): void | Promise<void>;
  /** Open a vault-relative path in the workspace. */
  openVaultPath(p: string): Promise<void>;
}

export function renderSuggestionCard(
  container: HTMLElement,
  sugg: SuggestionCard,
  cb: SuggestionCardCallbacks,
): void {
  const card = container.createDiv({
    cls: `tm-suggestion-card tm-suggestion-${sugg.kind.replace(/_/g, "-")}`,
  });

  const meta = SUGGESTION_KIND_META[sugg.kind] || SUGGESTION_KIND_META.promote_memory;
  const isWrite = suggestionApplyIsWrite(sugg.kind);

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

  // Target breadcrumb (Desktop parity: friendly path under the summary)
  const openTarget = suggestionOpenPath(sugg);
  if (openTarget) {
    card.createDiv({
      cls: "tm-suggestion-path",
      text: friendlySuggestionPath(openTarget) || openTarget,
      attr: { title: openTarget },
    });
  }

  const actions = card.createDiv({ cls: "tm-suggestion-actions" });
  const primaryLabel = isWrite ? t("suggestions_confirm") : t("suggestions_open");
  const confirmBtn = actions.createEl("button", {
    text: primaryLabel,
    cls: "tm-btn-confirm",
  });
  confirmBtn.setAttribute("aria-label", primaryLabel);
  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    confirmBtn.empty();
    confirmBtn.createSpan({ cls: "tm-btn-spinner" });
    const result = await cb.apply(sugg);
    if (result.ok) {
      card.classList.add("tm-card-removing");
      setTimeout(() => card.remove(), 200);
      if (result.openPath) {
        await cb.openVaultPath(result.openPath);
      }
      await cb.refresh();
    } else {
      confirmBtn.disabled = false;
      confirmBtn.empty();
      confirmBtn.textContent = primaryLabel;
    }
  });

  // Secondary 打开 — inspect the target before deciding (Desktop parity).
  if (isWrite && openTarget) {
    const openBtn = actions.createEl("button", {
      text: t("suggestions_open"),
      cls: "tm-btn-open",
    });
    openBtn.setAttribute("aria-label", t("suggestions_open"));
    openBtn.addEventListener("click", () => {
      void cb.openVaultPath(openTarget);
    });
  }

  const dismissBtn = actions.createEl("button", {
    text: t("suggestions_dismiss"),
    cls: "tm-btn-dismiss",
  });
  dismissBtn.setAttribute("aria-label", t("suggestions_dismiss"));
  dismissBtn.addEventListener("click", () => {
    cb.dismiss(sugg);
    card.classList.add("tm-card-removing");
    setTimeout(() => card.remove(), 200);
  });
}
