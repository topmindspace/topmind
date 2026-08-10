/**
 * Theme application — toggles the `dark` class on <html>.
 *
 * Shared by App.tsx (boot + system-change listener) and SettingsDialog
 * (live apply when the user changes the theme dropdown), so switching theme
 * takes effect immediately without an app restart.
 *
 * Also stamps data-platform for chrome CSS (mac/win/linux titlebar pads).
 */
export type Theme = "auto" | "light" | "dark";

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
