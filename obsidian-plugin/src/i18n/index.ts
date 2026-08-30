// ── i18n: lightweight bilingual support (zh-CN default, en-US fallback) ─────
//
// Same pattern as UTR's i18n-strings.mjs — no external i18n library needed.
// Locale resolved from Obsidian's app.locale or plugin settings.

import { zhCN } from "./locales/zh-CN";
import { enUS } from "./locales/en-US";

type LocaleStrings = typeof zhCN;
export type LocaleKey = keyof LocaleStrings;

const LOCALES: Record<string, LocaleStrings> = {
  "zh-CN": zhCN,
  "en-US": enUS,
};

let currentLocale: string = "zh-CN";

/** Set the active locale */
export function setLocale(locale: string): void {
  if (LOCALES[locale]) {
    currentLocale = locale;
  } else if (locale.startsWith("zh")) {
    currentLocale = "zh-CN";
  } else if (locale.startsWith("en")) {
    currentLocale = "en-US";
  }
}

/** Get the active locale */
export function getLocale(): string {
  return currentLocale;
}

/** Translate a key, with optional {{var}} interpolation. */
export function t(key: LocaleKey, vars?: Record<string, string | number>): string {
  const strings = LOCALES[currentLocale] || LOCALES["zh-CN"];
  let s = strings[key] || zhCN[key] || String(key);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{{${k}}}`, String(v));
    }
  }
  return s;
}
