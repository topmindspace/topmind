/**
 * Appearance preferences (theme + language) — the shared writer for the two
 * surfaces that flip them without a settings round-trip: the sidebar workspace
 * menu and the native application menu (视图 → 外观 / 语言).
 *
 * Theme flows through the view store on purpose: App.tsx owns `applyTheme` off
 * `useViewStore.theme`, so pushing the preference into the store keeps a single
 * applier and lets the menu's radio state and the sidebar swatches agree.
 *
 * Not used by the Settings dialog, deliberately. `useSettingsController.update()`
 * is a strict superset — it patches the whole cached settings object optimistically
 * (so the panel and the shell resize both stay truthful), keeps its own dialog
 * state, and flushes through a debounced `api.sys.update`. Routing it through
 * these helpers would drop the optimistic object and the debounce and start
 * writing on every keystroke-level change. Settings reaches the same main-process
 * effect through that flush (`system.updateSettings` → `setAppSettings`).
 */
import { api } from "../services/api";
import { useViewStore } from "../stores/view-store";
import { patchCachedSettings } from "./settings-cache";
import { applyLocale } from "../locales";
import { applyThemeSeed, type Theme, type ThemeSeed } from "./theme";

export type LocalePreference = "auto" | "zh-CN" | "en-US";

/** Apply + persist a theme preference. Never throws — persistence is best-effort. */
export function setThemePreference(theme: Theme): void {
  useViewStore.getState().setTheme(theme);
  patchCachedSettings({ theme });
  void api.sys.update({ theme }).catch(() => {});
}

/** Apply + persist a pre-generated color seed (accent axis). */
export function setThemeSeedPreference(seed: ThemeSeed): void {
  applyThemeSeed(seed);
  patchCachedSettings({ themeSeed: seed });
  void api.sys.update({ themeSeed: seed }).catch(() => {});
}

/** Apply + persist a UI language preference. i18n hot-swaps; no reload needed. */
export function setLocalePreference(locale: LocalePreference): void {
  patchCachedSettings({ ui: { locale } });
  applyLocale(locale);
  void api.sys.update({ ui: { locale } }).catch(() => {});
}
