#!/usr/bin/env node
/**
 * Generate Desktop `electron/lib/category-pattern.mjs` from Kernel model-core.
 *
 * Why: electron must not static-import monorepo `../../lib` (asar crash).
 * This script is the single write path for that snapshot. Run with --check
 * in CI to fail when Kernel constants drift without regenerating Desktop.
 *
 *   node scripts/sync-category-pattern.mjs          # write
 *   node scripts/sync-category-pattern.mjs --check  # exit 1 if stale
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATEGORY_PATTERN,
  VALID_ROLES,
  REQUIRED_ROLES,
  SLOT_ROLE_HEURISTICS,
  ROLE_DIR_ALIASES,
  DELIVERY_SLOT_RE,
} from "../lib/model-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "topmind-desktop", "electron", "lib", "category-pattern.mjs");

function jre(re) {
  // Serialize a RegExp as source + flags for stable generated output
  return `new RegExp(${JSON.stringify(re.source)}, ${JSON.stringify(re.flags)})`;
}

function jfreezeArray(arr) {
  return `Object.freeze([${arr.map((v) => JSON.stringify(v)).join(", ")}])`;
}

function jfreezeRoleAliases(obj) {
  const lines = Object.entries(obj).map(([role, names]) => {
    return `  ${JSON.stringify(role)}: ${jfreezeArray([...names])},`;
  });
  return `Object.freeze({\n${lines.join("\n")}\n})`;
}

function jfreezeHeuristics(obj) {
  // Stable key order: 00, 10, 88, 99 (matches Kernel source layout)
  const preferred = ["00", "10", "88", "99"];
  const keys = [
    ...preferred.filter((k) => k in obj),
    ...Object.keys(obj).filter((k) => !preferred.includes(k)).sort(),
  ];
  const lines = keys.map((slot) => {
    return `  ${JSON.stringify(slot)}: ${JSON.stringify(obj[slot])},`;
  });
  return `Object.freeze({\n${lines.join("\n")}\n})`;
}

export function renderCategoryPatternModule() {
  return `/**
 * Desktop-local category role constants (GENERATED — do not edit by hand).
 *
 * Source of truth: monorepo \`lib/model-core.mjs\`.
 * Why a snapshot: electron must not static-import monorepo \`../../lib\` (asar crash).
 * Regenerate: \`npm run sync:category-pattern\` at repo root.
 * CI gate: \`npm run check:category-pattern\` (fails when Kernel drifts).
 */

/** Match first-level category directories: \`00-Inbox\` or \`00 Inbox\`. */
export const CATEGORY_PATTERN = ${jre(CATEGORY_PATTERN)};

export const VALID_ROLES = ${jfreezeArray([...VALID_ROLES])};

export const REQUIRED_ROLES = ${jfreezeArray([...REQUIRED_ROLES])};

/** Slot → role when template names are Chinese but on-disk dirs are English / renamed. */
export const SLOT_ROLE_HEURISTICS = ${jfreezeHeuristics(SLOT_ROLE_HEURISTICS)};

/** Known localized aliases; prefer an existing on-disk name over inventing 00-Inbox. */
export const ROLE_DIR_ALIASES = ${jfreezeRoleAliases(ROLE_DIR_ALIASES)};

/** Delivery slot marker (localized names share the 88- prefix). */
export const DELIVERY_SLOT_RE = ${jre(DELIVERY_SLOT_RE)};
`;
}

async function main() {
  const next = renderCategoryPatternModule();
  const check = process.argv.includes("--check");
  let current = null;
  try {
    current = await fs.readFile(OUT, "utf8");
  } catch {
    current = null;
  }
  if (check) {
    if (current !== next) {
      console.error(
        `category-pattern out of sync with Kernel model-core.\nRun: npm run sync:category-pattern\nExpected: ${OUT}`,
      );
      process.exit(1);
    }
    console.log("category-pattern: in sync with Kernel model-core");
    return;
  }
  if (current === next) {
    console.log("category-pattern: already up to date");
    return;
  }
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, next, "utf8");
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("sync-category-pattern.mjs")) {
  await main();
}
