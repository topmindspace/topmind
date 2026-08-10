/**
 * Icon system — Lucide only (no hand-drawn SVGs / no second icon pack).
 *
 * Strategy:
 * 1. Source: `lucide-react` only. Never invent path icons for UI chrome.
 * 2. Size: always `ICON.*` — never raw numbers at call sites.
 * 3. Stroke: shell chrome uses `ICON_STROKE.chrome` (1.75); content uses default (2).
 * 4. Panel toggles: `PanelToggleIcon` — open = LayoutPanelLeft half-filled rail;
 *    closed = Panel*Inactive dashed rail. See components/ui/PanelToggleIcon.tsx.
 * 5. Binary state: prefer Lucide solid/inactive or filled-rail pairs, not chevron Open/Close.
 * 6. Color: parent owns `text-*` / pressed bg; icons inherit currentColor.
 * 7. Missing glyph: search lucide.dev first — do not drop inline <svg>.
 */

export const ICON = {
  /** 9 — kbd-adjacent, decorative chevrons */
  nano: 9,
  /** 11 — status bar, dense meta */
  micro: 11,
  /** 12 — tree rows, compact lists */
  xs: 12,
  /** 15 — buttons, toolbars, section labels, menus */
  sm: 15,
  /** 18 — empty states, headers */
  md: 18,
  /** 22 — landing / splash */
  lg: 22,
  /** 28 — brand mark */
  xl: 28,
} as const;

export type IconSizeKey = keyof typeof ICON;

/** Stroke weights for Lucide `strokeWidth` — keep chrome + content linear weight unified. */
export const ICON_STROKE = {
  /** Title bar / shell chrome / status / tree — thin linear */
  chrome: 1.75,
  /** Default content / buttons — same visual weight as chrome for consistency */
  default: 1.75,
  /** Emphasis only (empty-state heroes, rare brand marks) */
  emphasis: 2,
} as const;
