/**
 * Icon system — RemixIcon only (no hand-drawn SVGs / no second icon pack).
 *
 * Strategy:
 * 1. Source: `@remixicon/react` only. Never invent path icons for UI chrome.
 *    Missing glyph: search remixicon.com first — do not drop inline <svg>.
 * 2. Size: always `ICON.*` — never raw numbers at call sites.
 * 3. Variant: default `*Line` (outline) for chrome; `*Fill` (solid) is reserved
 *    for binary "on" states and emphasis (e.g. Zap=flashlight fill, pinned pin).
 * 4. Panel toggles: `PanelToggleIcon` — open = RiLayoutLeft/RightFill (filled
 *    side rail); closed = RiLayoutLeft/RightLine. See components/ui/PanelToggleIcon.tsx.
 * 5. Color: parent owns `text-*` / pressed bg; icons inherit currentColor via fill.
 * 6. RemixIcon glyphs are fill-based and read slightly larger than stroke icons
 *    at equal px — the scale below is tuned for that optical weight.
 *
 * Scale semantics (enforced by audit, not just convention):
 * - nano: ONLY expand/collapse chevrons, status dots, kbd glyphs (Enter ↵).
 * - micro: dense meta (chips, tags, remove-X on chips), inline status markers.
 * - xs: compact lists, tree rows, auxiliary actions inside rows.
 * - sm: interactive buttons, toolbars, primary nav (header / sidebar / menus).
 */

export const ICON = {
  /** 10 — chevrons, status dots, kbd glyphs only (never functional icons) */
  nano: 10,
  /** 12 — dense meta chips, tag close buttons, status bar */
  micro: 12,
  /** 14 — tree rows, compact lists, row-level aux actions */
  xs: 14,
  /** 17 — buttons, toolbars, primary nav (header / sidebar / main nav) */
  sm: 17,
  /** 20 — empty states, headers */
  md: 20,
  /** 24 — landing / splash */
  lg: 24,
  /** 30 — brand mark */
  xl: 30,
} as const;

export type IconSizeKey = keyof typeof ICON;

/** Icon component type from @remixicon/react — re-exported for icon-map typing. */
export type { RemixiconComponentType as IconComponent } from "@remixicon/react";
