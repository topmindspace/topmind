/**
 * Scrim-dismiss policy for overlay surfaces (OverlayHost).
 *
 * Two kinds of overlay live in the same host:
 *
 * - **Pickers / reports** — ⌘K palette, full-text search, settings (auto-saved),
 *   about, loop report. A click on the dimmed background closing them is the
 *   convention users expect, and nothing is lost.
 * - **Forms** — 记一下 capture, plugin mini-apps. They hold unsaved input, so a
 *   stray click on the scrim would silently discard what the user just typed.
 *   They stay open and dismiss via Esc or their own close affordance.
 *
 * The list is a **allow-list on purpose**: an unknown / third-party overlay
 * defaults to "do not discard input". Losing a half-written note is far worse
 * than an extra Escape press.
 */

/** Overlays where a scrim click is a safe, expected dismissal. */
const SCRIM_DISMISSES: ReadonlySet<string> = new Set([
  "settings",
  "command-palette",
  "search",
  "about",
  "loop-report",
  "tools-logs",
  "help",
]);

/** True when clicking the dimmed background may close this overlay. */
export function scrimDismissesOverlay(kind: string): boolean {
  return SCRIM_DISMISSES.has(kind);
}
