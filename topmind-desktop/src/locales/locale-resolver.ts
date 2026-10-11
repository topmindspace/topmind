/**
 * Pure locale resolution logic — no i18next dependency.
 * Extracted so tests can import without initializing the full i18n stack.
 */

/** All supported locale identifiers. */
export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Default locale when no preference is set. */
export const DEFAULT_LOCALE: SupportedLocale = "zh-CN";

/** Fallback locale for missing translation keys. */
export const FALLBACK_LOCALE: SupportedLocale = "en-US";

/**
 * Match a BCP-47 tag against supported locales.
 * Exact match first, then language-prefix match, then default.
 */
export function matchLocale(tag: string): SupportedLocale {
  if (!tag) return DEFAULT_LOCALE;
  const lower = tag.toLowerCase();
  // Exact match (case-insensitive)
  for (const loc of SUPPORTED_LOCALES) {
    if (lower === loc.toLowerCase()) return loc;
  }
  // Prefix match on language part (e.g. "zh-TW" → "zh-CN", "en-GB" → "en-US")
  const lang = lower.split("-")[0];
  for (const loc of SUPPORTED_LOCALES) {
    if (loc.toLowerCase().startsWith(lang + "-")) return loc;
  }
  return DEFAULT_LOCALE;
}

/**
 * Resolve a locale from a user preference string.
 * - `auto` or empty → detect from `navigator.language` / `app.getLocale()`.
 * - Exact match (e.g. `zh-CN`) → use as-is.
 * - Prefix match (e.g. `zh`, `zh-TW`) → first matching supported locale.
 * - No match → DEFAULT_LOCALE.
 */
export function resolveLocale(preference?: string | null): SupportedLocale {
  if (!preference || preference === "auto") {
    // Electron renderer: navigator.language is set by Chromium based on OS locale
    const navLocale = typeof navigator !== "undefined" ? navigator.language : "";
    return matchLocale(navLocale);
  }
  return matchLocale(preference);
}
