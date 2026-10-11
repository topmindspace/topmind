/**
 * Windows caption-button geometry — measured, never guessed.
 *
 * The OS paints minimize / maximize / close *over* the full-width OS chrome
 * strip (`OsChromeStrip` / `data-os-chrome`) — never over a product column
 * header. `navigator.windowControlsOverlay.getTitlebarAreaRect()` reports the
 * part of that strip the OS left to us, in CSS pixels, and `geometrychange`
 * fires whenever it moves (maximize, DPI / scale change, RTL). Both insets are
 * republished as CSS variables so the reservation rule can stay a one-liner:
 *
 *   --wc-inset-left   px of the strip the OS took on the left  (0 on Windows)
 *   --wc-inset-right  px of the strip the OS took on the right (the caption buttons)
 *
 * Why this is the whole mechanism: the first version of the feature reserved a
 * hardcoded 138px, and because `.v4-column-chrome { padding: 0 8px }` sat later in
 * the stylesheet, the shorthand reset it at equal specificity — the reservation
 * was dead code and the AI workspace's 4th tab plus the AI panel toggle were
 * painted under the buttons. Both halves of that accident are now structurally
 * impossible: the number comes from the OS, and the rule that consumes it is a
 * compound selector targeting only the OS strip (see `html[data-wc-inset]` in
 * `src/styles/v4.css`).
 */

interface TitlebarAreaRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WindowControlsOverlayLike {
  visible?: boolean;
  getTitlebarAreaRect?: () => TitlebarAreaRect;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

function controlsOverlay(): WindowControlsOverlayLike | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlayLike };
  return nav.windowControlsOverlay ?? null;
}

function setInset(root: HTMLElement, side: "left" | "right", px: number): void {
  root.style.setProperty(`--wc-inset-${side}`, `${px}px`);
}

/**
 * Read the current overlay rect and publish both insets.
 *
 * Safe on every platform: without the API (macOS, Linux, older runtimes) nothing
 * is overlaid on the row, so both insets are zero and every reservation collapses
 * to the normal 8px header padding.
 */
export function syncWindowControlsInset(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const overlay = controlsOverlay();
  if (!overlay || typeof overlay.getTitlebarAreaRect !== "function") {
    setInset(root, "left", 0);
    setInset(root, "right", 0);
    return;
  }
  let rect: TitlebarAreaRect;
  try {
    rect = overlay.getTitlebarAreaRect();
  } catch {
    // Throws while the overlay is detached (window not shown yet).
    setInset(root, "left", 0);
    setInset(root, "right", 0);
    return;
  }
  const total = window.innerWidth || 0;
  const left = Math.max(0, Math.round(rect.x));
  const right = Math.max(0, Math.round(total - rect.x - rect.width));
  setInset(root, "left", left);
  setInset(root, "right", right);
}

/**
 * Track the overlay for the lifetime of the shell. Returns a teardown function.
 * Mount once, next to the menu strip that depends on it.
 */
export function installWindowControlsTracking(): () => void {
  const overlay = controlsOverlay();
  const onChange = () => syncWindowControlsInset();
  syncWindowControlsInset();
  window.addEventListener("resize", onChange);
  overlay?.addEventListener?.("geometrychange", onChange);
  return () => {
    window.removeEventListener("resize", onChange);
    overlay?.removeEventListener?.("geometrychange", onChange);
  };
}
