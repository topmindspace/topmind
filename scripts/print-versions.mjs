#!/usr/bin/env node
/**
 * Print topmind surface versions from the **only** maintainable truth sources.
 * Docs must link to these paths — do not re-copy numbers into README / AGENTS / etc.
 *
 *   npm run versions
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(rel) {
  return JSON.parse(readFileSync(path.join(root, rel), "utf8"));
}

function readText(rel) {
  return readFileSync(path.join(root, rel), "utf8").trim();
}

/**
 * Canonical map — single place for *where* versions live (not the values).
 *
 * Version Policy (v2.1+):
 * ────────────────────────────────────────────────────────────
 * Each surface has an INDEPENDENT version number — they do not
 * need to be identical. The rules are:
 *
 * 1. MAJOR version alignment: all surfaces share the same major
 *    version (e.g., 3.x). A breaking change in any surface bumps
 *    the major for ALL surfaces.
 * 2. MINOR/PATCH independence: each surface bumps its own minor
 *    or patch when it has changes. Surfaces with no changes stay
 *    at their current version — they are NOT auto-bumped.
 * 3. UTR follows Desktop: UTR version tracks Desktop's version
 *    exactly (they ship together in the same installer).
 * 4. Future surfaces (e.g., Obsidian Plugin) will have their own
 *    truth source and version, following the same policy.
 * 5. Tag naming: `v*` = full release; `{surface}-v*` = surface-only.
 *    Only re-package surfaces whose version actually changed.
 *
 * Surface version truth sources:
 *   Skills Pack  → skills/topmind-pack.json        (independent)
 *   Desktop     → topmind-desktop/package.json    (independent)
 *   Clip Ext    → browser-extension/manifest.json  (independent)
 *   UTR         → utr/VERSION                      (follows Desktop)
 *   Obsidian    → obsidian-plugin/manifest.json    (independent)
 * ────────────────────────────────────────────────────────────
 */
export const VERSION_TRUTH = [
  {
    id: "skills",
    label: "Skills Pack",
    source: "skills/topmind-pack.json",
    read: () => readJson("skills/topmind-pack.json").version,
  },
  {
    id: "desktop",
    label: "Desktop",
    source: "topmind-desktop/package.json",
    read: () => readJson("topmind-desktop/package.json").version,
  },
  {
    id: "extension",
    label: "Clip Extension",
    source: "browser-extension/manifest.json",
    read: () => readJson("browser-extension/manifest.json").version,
  },
  {
    id: "utr",
    label: "UTR",
    source: "utr/VERSION",
    read: () => readText("utr/VERSION"),
  },
  {
    id: "obsidian",
    label: "Obsidian Plugin",
    source: "obsidian-plugin/manifest.json",
    read: () => readJson("obsidian-plugin/manifest.json").version,
  },
];

export function readAllVersions() {
  return VERSION_TRUTH.map((row) => ({
    id: row.id,
    label: row.label,
    source: row.source,
    version: row.read(),
  }));
}

function main() {
  const rows = readAllVersions();
  const asJson = process.argv.includes("--json");
  if (asJson) {
    const out = Object.fromEntries(rows.map((r) => [r.id, { version: r.version, source: r.source }]));
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return;
  }
  const wLabel = Math.max(...rows.map((r) => r.label.length));
  const wVer = Math.max(...rows.map((r) => r.version.length));
  process.stdout.write("topmind surface versions (truth sources only)\n\n");
  for (const r of rows) {
    process.stdout.write(
      `  ${r.label.padEnd(wLabel)}  ${r.version.padEnd(wVer)}  ← ${r.source}\n`,
    );
  }
  process.stdout.write("\nBump only the truth file for that surface; do not edit version tables in docs.\n");
  process.stdout.write("Skill SKILL.md frontmatter version must follow pack (skills:test).\n");
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) main();
