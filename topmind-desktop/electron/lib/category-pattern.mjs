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
