/**
 * Pure viewport placement for portaled menus / listboxes.
 * Keeps form selects flush under their control (no native Electron popup drift).
 */

export type DropdownAlign = "start" | "end";
export type DropdownPlacement = "bottom" | "top";

export interface RectLike {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface DropdownPositionInput {
  trigger: RectLike;
  /** Measured panel size after mount; omit for provisional placement */
  panel?: { width: number; height: number } | null;
  align?: DropdownAlign;
  minWidth?: number;
  maxWidth?: number;
  maxHeight?: number;
  /**
   * When true (default for form fields), panel width tracks trigger width.
   * When false, panel may grow for long option labels (model pickers).
   */
  matchTriggerWidth?: boolean;
  gap?: number;
  pad?: number;
  viewport?: { width: number; height: number };
}

export interface DropdownPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: DropdownPlacement;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(n, max));
}

/**
 * Compute fixed-position coords for a dropdown panel relative to a trigger.
 * Top flip uses measured height so the panel sits flush (no floating gap).
 */
export function computeDropdownPosition(input: DropdownPositionInput): DropdownPosition {
  const align = input.align ?? "start";
  const minWidth = input.minWidth ?? 0;
  const maxWidth = input.maxWidth ?? 480;
  const maxHeight = input.maxHeight ?? 320;
  const matchTriggerWidth = input.matchTriggerWidth !== false;
  const gap = input.gap ?? 4;
  const pad = input.pad ?? 8;
  const vw = input.viewport?.width ?? (typeof window !== "undefined" ? window.innerWidth : 1280);
  const vh = input.viewport?.height ?? (typeof window !== "undefined" ? window.innerHeight : 800);
  const t = input.trigger;

  const triggerW = Math.max(1, Math.ceil(t.width));
  const contentW = input.panel?.width ?? 0;
  const maxAllowed = Math.min(maxWidth, vw - pad * 2);

  let width: number;
  if (matchTriggerWidth) {
    // Form fields: stick to trigger width (native-feel). Avoid softGrow that
    // reflows left/width between provisional and measured frames (visible jump).
    width = clamp(Math.max(triggerW, minWidth), Math.min(triggerW, maxAllowed), maxAllowed);
    // Only expand if content is clearly wider (and we already measured panel)
    if (contentW > triggerW + 32) {
      width = clamp(Math.max(triggerW, contentW), pad, maxAllowed);
    }
  } else {
    // Prefer minWidth when panel not yet measured — stable first paint
    const base = contentW > 0 ? contentW : Math.max(minWidth || 160, triggerW);
    width = clamp(Math.max(minWidth || 160, base), pad, maxAllowed);
  }

  const spaceBelow = vh - t.bottom - gap - pad;
  const spaceAbove = t.top - gap - pad;
  const measuredH = input.panel?.height ?? 0;

  // Prefer opening below unless below is clearly worse.
  let placement: DropdownPlacement =
    spaceBelow >= 120 || spaceBelow >= spaceAbove ? "bottom" : "top";
  let avail = placement === "bottom" ? spaceBelow : spaceAbove;
  if (avail < 80 && (placement === "bottom" ? spaceAbove : spaceBelow) > avail + 16) {
    placement = placement === "bottom" ? "top" : "bottom";
    avail = placement === "bottom" ? spaceBelow : spaceAbove;
  }

  const maxH = clamp(Math.min(maxHeight, Math.max(80, avail)), 80, maxHeight);

  let top: number;
  if (placement === "bottom") {
    top = t.bottom + gap;
  } else {
    const h = measuredH > 0 ? Math.min(measuredH, maxH) : Math.min(maxH, 200);
    top = t.top - gap - h;
  }

  // Align panel edge to trigger edge (start = left edges match).
  let left = align === "end" ? t.right - width : t.left;
  left = clamp(left, pad, vw - width - pad);
  top = clamp(top, pad, Math.max(pad, vh - pad - 40));

  return {
    top: Math.round(top),
    left: Math.round(left),
    width: Math.round(width),
    maxHeight: Math.round(maxH),
    placement,
  };
}

/**
 * Anchor rect for the real control.
 * Prefer [data-menu-trigger] then button/select inside the wrapper.
 */
export function resolveTriggerRect(wrapper: HTMLElement | null): RectLike | null {
  if (!wrapper) return null;
  const marked = wrapper.querySelector<HTMLElement>("[data-menu-trigger]");
  const interactive =
    marked ||
    wrapper.querySelector<HTMLElement>(
      'button:not([disabled]), [role="combobox"], [role="button"], select',
    ) ||
    null;
  const el = interactive && wrapper.contains(interactive) ? interactive : wrapper;
  const r = el.getBoundingClientRect();
  const fallback = () => {
    const wr = wrapper.getBoundingClientRect();
    return {
      top: wr.top,
      left: wr.left,
      right: wr.right,
      bottom: wr.bottom,
      width: wr.width,
      height: wr.height,
    };
  };
  if (r.width < 2 && r.height < 2) return fallback();
  return {
    top: r.top,
    left: r.left,
    right: r.right,
    bottom: r.bottom,
    width: r.width,
    height: r.height,
  };
}
