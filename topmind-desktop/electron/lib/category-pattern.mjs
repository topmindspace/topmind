/**
 * Desktop-local category role constants (GENERATED — do not edit by hand).
 *
 * Source of truth: monorepo `lib/model-core.mjs`.
 * Why a snapshot: electron must not static-import monorepo `../../lib` (asar crash).
 * Regenerate: `npm run sync:category-pattern` at repo root.
 * CI gate: `npm run check:category-pattern` (fails when Kernel drifts).
 */

/** Match first-level category directories: `00-Inbox` or `00 Inbox`. */
export const CATEGORY_PATTERN = new RegExp("^\\d{2}[ -].+", "u");

export const VALID_ROLES = Object.freeze(["buffer", "loose-stream", "deep-work", "fallback", "reference", "delivery", "system"]);

export const REQUIRED_ROLES = Object.freeze(["buffer", "delivery", "system"]);

/** Slot → role when template names are Chinese but on-disk dirs are English / renamed. */
export const SLOT_ROLE_HEURISTICS = Object.freeze({
  "00": "buffer",
  "10": "loose-stream",
  "88": "delivery",
  "99": "system",
});

/** Known localized aliases; prefer an existing on-disk name over inventing 00-Inbox. */
export const ROLE_DIR_ALIASES = Object.freeze({
  "buffer": Object.freeze(["00-Inbox", "00 Inbox", "00-收件箱", "00 收件箱"]),
  "delivery": Object.freeze(["88-交付", "88 交付", "88-Delivery", "88 Delivery", "88-输出", "88 输出", "88-Outputs", "88 Outputs"]),
  "system": Object.freeze(["99-归档", "99 归档", "99-Archive", "99 Archive"]),
});

/** Delivery slot marker (localized names share the 88- prefix). */
export const DELIVERY_SLOT_RE = new RegExp("^88[- ]", "u");
