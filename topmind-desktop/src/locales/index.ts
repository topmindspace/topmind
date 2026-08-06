/**
 * i18n configuration — i18next + react-i18next.
 *
 * Locale resources are JSON files under `src/locales/{locale}/{namespace}.json`,
 * fully separated from component code. Adding a new locale = add a new directory.
 *
 * Supported locales: zh-CN (default), en-US.
 * The active locale is driven by `settings.ui.locale` (or `auto` = OS locale).
 *
 * Namespaces map to feature areas:
 *   common · shell · settings · editor · ai · workspace · ingest · weread · x · overlays
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// ── Locale resolution (pure logic, no i18next dependency) ───────────────────
// Re-export everything from locale-resolver so consumers can import from a
// single entry point. Tests import locale-resolver directly to avoid
// initialising the full i18n stack.
export {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  resolveLocale,
  matchLocale,
} from "./locale-resolver";
export type { SupportedLocale } from "./locale-resolver";

import { resolveLocale, SUPPORTED_LOCALES, DEFAULT_LOCALE, FALLBACK_LOCALE } from "./locale-resolver";
import type { SupportedLocale } from "./locale-resolver";

// ── Locale resources (bundled synchronously — no async loading) ─────────────
import zhCNCommon from "./zh-CN/common.json";
import zhCNShell from "./zh-CN/shell.json";
import zhCNSettings from "./zh-CN/settings.json";
import zhCNEditor from "./zh-CN/editor.json";
import zhCNAi from "./zh-CN/ai.json";
import zhCNWorkspace from "./zh-CN/workspace.json";
import zhCNIngest from "./zh-CN/ingest.json";
import zhCNWeread from "./zh-CN/weread.json";
import zhCNX from "./zh-CN/x.json";
import zhCNOverlays from "./zh-CN/overlays.json";

import enUSCommon from "./en-US/common.json";
import enUSShell from "./en-US/shell.json";
import enUSSettings from "./en-US/settings.json";
import enUSEditor from "./en-US/editor.json";
import enUSAi from "./en-US/ai.json";
import enUSWorkspace from "./en-US/workspace.json";
import enUSIngest from "./en-US/ingest.json";
import enUSWeread from "./en-US/weread.json";
import enUSX from "./en-US/x.json";
import enUSOverlays from "./en-US/overlays.json";

/** All i18n resource namespaces. */
export const NAMESPACES = [
  "common",
  "shell",
  "settings",
  "editor",
  "ai",
  "workspace",
  "ingest",
  "weread",
  "x",
  "overlays",
] as const;
export type Namespace = (typeof NAMESPACES)[number];

/** Default namespace used when no namespace is specified in t() calls. */
export const DEFAULT_NAMESPACE: Namespace = "common";

/** All locale resources keyed by [locale][namespace]. */
const resources = {
  "zh-CN": {
    common: zhCNCommon,
    shell: zhCNShell,
    settings: zhCNSettings,
    editor: zhCNEditor,
    ai: zhCNAi,
    workspace: zhCNWorkspace,
    ingest: zhCNIngest,
    weread: zhCNWeread,
    x: zhCNX,
    overlays: zhCNOverlays,
  },
  "en-US": {
    common: enUSCommon,
    shell: enUSShell,
    settings: enUSSettings,
    editor: enUSEditor,
    ai: enUSAi,
    workspace: enUSWorkspace,
    ingest: enUSIngest,
    weread: enUSWeread,
    x: enUSX,
    overlays: enUSOverlays,
  },
} as const;

// ── i18next initialisation ─────────────────────────────────────────────────
// Called once at app boot (main.tsx).
// `lng` is set later by `applyLocale()` after settings load.
void i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LOCALE,
  fallbackLng: FALLBACK_LOCALE,
  defaultNS: DEFAULT_NAMESPACE,
  ns: NAMESPACES,
  interpolation: {
    // React already escapes values, so we don't need i18next's escaping.
    escapeValue: false,
  },
  react: {
    // Re-render on language change.
    bindI18n: "languageChanged loaded",
    // Do not suspend — we bundle all resources synchronously.
    useSuspense: false,
  },
  returnEmptyString: false,
});

/**
 * Apply a locale at runtime. Called when settings load or user switches language.
 * No-op if the locale is not supported.
 */
export function applyLocale(locale: SupportedLocale | string): void {
  const resolved = SUPPORTED_LOCALES.includes(locale as SupportedLocale)
    ? (locale as SupportedLocale)
    : resolveLocale(locale);
  if (i18n.language !== resolved) {
    // Defer language change to next event loop tick to avoid synchronous layout/IPC lockup on Windows
    setTimeout(() => {
      void i18n.changeLanguage(resolved);
    }, 0);
  }
}

/**
 * Get the current resolved locale (e.g. `zh-CN`), never `auto`.
 * Useful for Intl / toLocaleString calls.
 */
export function currentLocale(): SupportedLocale {
  const lng = i18n.language || DEFAULT_LOCALE;
  return SUPPORTED_LOCALES.includes(lng as SupportedLocale)
    ? (lng as SupportedLocale)
    : DEFAULT_LOCALE;
}

/**
 * Intl locale tag for date/number formatting.
 * Maps our locale IDs to standard BCP-47 tags.
 */
export function intlLocale(): string {
  return currentLocale();
}

export default i18n;
