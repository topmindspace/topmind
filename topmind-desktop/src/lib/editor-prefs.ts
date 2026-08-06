/**
 * Editor reading preferences — shared by FileEditorView, quick Aa panel, Settings.
 * Persisted under settings.editor; mirrored to view-store for instant UI.
 */
import i18n from "../locales";
import { api } from "../services/api";
import { useViewStore } from "../stores/view-store";
import type { EditorContentWidth } from "./editor-markdown";
import { normalizeContentWidth } from "./editor-markdown";

export type EditorFontFamily = "sans" | "serif" | "mono";
export type EditorPagePadding = "compact" | "comfortable" | "spacious";
/** Canvas paper tone for edit + preview (not global app theme). */
export type EditorPaper = "default" | "soft" | "paper" | "sepia";

export interface EditorReadingPrefs {
  fontSize: number;
  lineHeight: number;
  fontFamily: EditorFontFamily;
  autoSaveMs: number;
  wordWrap: boolean;
  tabMode: "multi" | "single";
  contentWidth: EditorContentWidth;
  pagePadding: EditorPagePadding;
  paper: EditorPaper;
}

export const DEFAULT_EDITOR_PREFS: EditorReadingPrefs = {
  fontSize: 16,
  lineHeight: 1.7,
  fontFamily: "sans",
  autoSaveMs: 1500,
  wordWrap: true,
  tabMode: "multi",
  contentWidth: "reading",
  pagePadding: "comfortable",
  paper: "default",
};

export const FONT_SIZE_PRESETS = [14, 15, 16, 17, 18, 20] as const;
export const LINE_HEIGHT_PRESETS = [1.5, 1.6, 1.7, 1.8, 1.9, 2.0] as const;

export function getPagePaddingOptions(): {
  value: EditorPagePadding;
  label: string;
  hint: string;
}[] {
  return [
    { value: "compact", label: i18n.t("editor:readingMenu.paddingCompact"), hint: i18n.t("editor:readingMenu.paddingCompactHint") },
    { value: "comfortable", label: i18n.t("editor:readingMenu.paddingComfortable"), hint: i18n.t("editor:readingMenu.paddingComfortableHint") },
    { value: "spacious", label: i18n.t("editor:readingMenu.paddingSpacious"), hint: i18n.t("editor:readingMenu.paddingSpaciousHint") },
  ];
}

export function getPaperOptions(): {
  value: EditorPaper;
  label: string;
  hint: string;
}[] {
  return [
    { value: "default", label: i18n.t("editor:readingMenu.paperDefault"), hint: i18n.t("editor:readingMenu.paperDefaultHint") },
    { value: "soft", label: i18n.t("editor:readingMenu.paperSoft"), hint: i18n.t("editor:readingMenu.paperSoftHint") },
    { value: "paper", label: i18n.t("editor:readingMenu.paperPaper"), hint: i18n.t("editor:readingMenu.paperPaperHint") },
    { value: "sepia", label: i18n.t("editor:readingMenu.paperSepia"), hint: i18n.t("editor:readingMenu.paperSepiaHint") },
  ];
}

export function normalizeFontFamily(v: unknown): EditorFontFamily {
  if (v === "serif" || v === "mono" || v === "sans") return v;
  return "sans";
}

export function normalizePagePadding(v: unknown): EditorPagePadding {
  if (v === "compact" || v === "comfortable" || v === "spacious") return v;
  return "comfortable";
}

export function normalizePaper(v: unknown): EditorPaper {
  if (v === "default" || v === "soft" || v === "paper" || v === "sepia") return v;
  return "default";
}

export function clampFontSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_EDITOR_PREFS.fontSize;
  return Math.max(12, Math.min(24, Math.round(n)));
}

export function clampLineHeight(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_EDITOR_PREFS.lineHeight;
  return Math.max(1.2, Math.min(2.5, Math.round(n * 10) / 10));
}

/** Merge partial prefs with store + defaults. */
export function mergeEditorPrefs(
  partial?: Partial<EditorReadingPrefs> | null,
  base?: Partial<EditorReadingPrefs> | null,
): EditorReadingPrefs {
  const b = { ...DEFAULT_EDITOR_PREFS, ...(base || {}) };
  const p = partial || {};
  return {
    fontSize: clampFontSize(p.fontSize ?? b.fontSize),
    lineHeight: clampLineHeight(p.lineHeight ?? b.lineHeight),
    fontFamily: normalizeFontFamily(p.fontFamily ?? b.fontFamily),
    autoSaveMs: p.autoSaveMs ?? b.autoSaveMs,
    wordWrap: p.wordWrap !== undefined ? p.wordWrap !== false : b.wordWrap !== false,
    tabMode: p.tabMode === "single" || p.tabMode === "multi" ? p.tabMode : b.tabMode,
    contentWidth: normalizeContentWidth(p.contentWidth ?? b.contentWidth),
    pagePadding: normalizePagePadding(p.pagePadding ?? b.pagePadding),
    paper: normalizePaper(p.paper ?? b.paper),
  };
}

/**
 * Apply reading prefs: update view-store immediately, persist to settings.editor.
 */
export async function applyEditorPrefs(
  patch: Partial<EditorReadingPrefs>,
): Promise<EditorReadingPrefs> {
  const prev = useViewStore.getState().editorSettings as Partial<EditorReadingPrefs>;
  const next = mergeEditorPrefs(patch, prev);
  useViewStore.getState().setEditorSettings(next);
  if (next.tabMode === "single" || next.tabMode === "multi") {
    useViewStore.getState().setEditorTabMode(next.tabMode);
  }
  try {
    await api.sys.update({ editor: next });
  } catch {
    /* offline / test */
  }
  return next;
}

export function fontFamilyCss(family: EditorFontFamily): string {
  if (family === "serif") return "var(--font-family-editor-serif)";
  if (family === "mono") return "var(--font-family-mono)";
  return "var(--font-family-editor-sans)";
}
