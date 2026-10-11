/**
 * i18n helper for topmind Clip extension.
 *
 * Wraps chrome.i18n.getMessage() with a cleaner API.
 * Also provides applyI18n() to batch-translate elements with data-i18n attributes.
 *
 * Usage in HTML:
 *   <span data-i18n="hint_default"></span>
 *   <input data-i18n-placeholder="options_token_placeholder" />
 *   <button data-i18n="btn_clip"></button>
 *
 * Usage in JS:
 *   import { t } from "./lib/i18n.js";
 *   setMsg(t("msg_clipping"));
 */

/**
 * Translate a message key with optional substitutions.
 * @param {string} key — message key in _locales/<locale>/messages.json
 * @param {...string} [subs] — substitutions for $1, $2, …
 * @returns {string}
 */
export function t(key, ...subs) {
  if (!key) return "";
  const subsArg = subs.length ? subs : undefined;
  try {
    if (typeof chrome !== "undefined" && chrome?.i18n?.getMessage) {
      const msg = chrome.i18n.getMessage(key, subsArg);
      if (msg) return msg;
    }
  } catch {
    /* fallback */
  }
  return key;
}

/**
 * Apply translations to all elements with data-i18n attributes in the given root.
 * Handles:
 *   data-i18n             → textContent
 *   data-i18n-placeholder → placeholder
 *   data-i18n-title       → title
 *   data-i18n-aria-label  → aria-label
 *
 * @param {ParentNode} [root=document.body]
 */
export function applyI18n(root = document.body) {
  if (!root) return;
  // textContent
  for (const el of root.querySelectorAll("[data-i18n]")) {
    const key = el.getAttribute("data-i18n");
    if (key) {
      const translated = t(key);
      if (translated && translated !== key) {
        el.textContent = translated;
      }
    }
  }
  // placeholder
  for (const el of root.querySelectorAll("[data-i18n-placeholder]")) {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key) {
      const translated = t(key);
      if (translated && translated !== key) {
        el.placeholder = translated;
      }
    }
  }
  // title
  for (const el of root.querySelectorAll("[data-i18n-title]")) {
    const key = el.getAttribute("data-i18n-title");
    if (key) {
      const translated = t(key);
      if (translated && translated !== key) {
        el.title = translated;
      }
    }
  }
  // aria-label
  for (const el of root.querySelectorAll("[data-i18n-aria-label]")) {
    const key = el.getAttribute("data-i18n-aria-label");
    if (key) {
      const translated = t(key);
      if (translated && translated !== key) {
        el.setAttribute("aria-label", translated);
      }
    }
  }
}

/**
 * Get the current UI locale (e.g. "zh_CN" or "en_US").
 * @returns {string}
 */
export function getUiLocale() {
  return chrome.i18n.getUILanguage();
}
