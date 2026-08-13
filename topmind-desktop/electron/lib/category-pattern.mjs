/**
 * Desktop-local category dir name pattern (sync, no engine import).
 *
 * MUST stay identical to monorepo `lib/workspace-model.mjs` CATEGORY_PATTERN.
 * Why duplicated: electron must not static-import monorepo `../../lib` (asar crash).
 * Canonical product definition: engine `lib/workspace-model.mjs`.
 */
export const CATEGORY_PATTERN = /^\d{2}[ -].+/u;

export const VALID_ROLES = Object.freeze([
  "buffer",
  "loose-stream",
  "deep-work",
  "fallback",
  "reference",
  "delivery",
  "system",
]);

/** Slot → role when template names are Chinese but on-disk dirs are English / renamed. */
export const SLOT_ROLE_HEURISTICS = Object.freeze({
  "00": "buffer",
  "10": "loose-stream",
  "88": "delivery",
  "99": "system",
});

/** Known localized aliases; prefer an existing on-disk name over inventing 00-收件箱. */
export const ROLE_DIR_ALIASES = Object.freeze({
  buffer: ["00-收件箱", "00 收件箱", "00-Inbox", "00 Inbox"],
  delivery: ["88-输出", "88 输出", "88-Outputs", "88 Outputs"],
  system: ["99-归档", "99 归档", "99-Archive", "99 Archive"],
});
