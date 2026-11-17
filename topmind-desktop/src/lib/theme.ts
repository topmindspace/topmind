/**
 * Theme application — three orthogonal axes stamped on <html> / <body>.
 *
 *   mode  · Theme       → `.dark` class (auto follows prefers-color-scheme)
 *   tone  · ThemeTone   → `data-theme-tone` (surface ladder / text / paper)
 *   seed  · ThemeSeed   → `data-theme-seed` (accent / badge / info axis)
 *
 * Shared by App.tsx (boot + system-change listener) and settings/appearance
 * helpers, so switching any axis takes effect immediately without restart.
 * CSS in tokens.css owns every color stop — this file only stamps attributes.
 *
 * Also stamps data-platform for chrome CSS (mac/win/linux titlebar pads).
 */
export type Theme = "auto" | "light" | "dark";
/** Surface mood pack — neutral ladder only; ink CTA and accent stay put. */
export type ThemeTone = "warm" | "cool" | "neutral" | "slate";
/** Pre-generated brand seed — accent axis only; ink CTA stays monochrome. */
export const THEME_SEEDS = ["olive", "sky", "teal", "graphite"] as const;
export type ThemeSeed = (typeof THEME_SEEDS)[number];
export const DEFAULT_THEME_SEED: ThemeSeed = "olive";

export const THEME_TONES: ThemeTone[] = ["warm", "cool", "neutral", "slate"];

let platformStamped = false;

function stampPlatform(): void {
  if (platformStamped || typeof document === "undefined") return;
  platformStamped = true;
  const root = document.documentElement;
  const nav = typeof navigator !== "undefined" ? navigator : null;
  const plat = nav?.platform || "";
  const ua = nav?.userAgent || "";
  let id = "unknown";
  if (/Mac/i.test(plat)) id = "mac";
  else if (/Win/i.test(plat) || /Windows/i.test(ua)) id = "win";
  else if (/Linux/i.test(plat) || /Linux/i.test(ua)) id = "linux";
  root.setAttribute("data-platform", id);
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  stampPlatform();
  if (theme === "dark") root.classList.add("dark");
  else if (theme === "light") root.classList.remove("dark");
  else root.classList.toggle("dark", window.matchMedia("(prefers-color-scheme: dark)").matches);
}

/**
 * Stamp surface-tone attribute. `warm` is the default ladder and clears the
 * attribute so CSS uses its base surface palette.
 */
export function applyThemeTone(tone?: ThemeTone | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const next: ThemeTone = tone && THEME_TONES.includes(tone) ? tone : "warm";
  if (next === "warm") root.removeAttribute("data-theme-tone");
  else root.setAttribute("data-theme-tone", next);
}

/** Stamp seed attribute; CSS in tokens.css owns the actual color stops. */
export function applyThemeSeed(seed?: ThemeSeed | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const next = seed && THEME_SEEDS.includes(seed) ? seed : DEFAULT_THEME_SEED;
  if (next === DEFAULT_THEME_SEED) root.removeAttribute("data-theme-seed");
  else root.setAttribute("data-theme-seed", next);
}
