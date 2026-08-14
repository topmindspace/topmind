#!/usr/bin/env node
/**
 * Decide which surfaces to pack vs reuse for a product `v*` ship.
 *
 * Surfaces stay independently versioned (truth files). A GitHub Release is a
 * snapshot: pack when this commit's version differs from the previous Latest
 * `latest.json`; otherwise copy the previous asset.
 *
 *   node scripts/plan-release-surfaces.mjs --json
 *   node scripts/plan-release-surfaces.mjs --prev path/to/latest.json --json
 *   node scripts/plan-release-surfaces.mjs --prev path/to/latest.json --github-output
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAllVersions } from "./print-versions.mjs";

export const RELEASE_SURFACES = ["skills", "desktop", "extension", "obsidian"];

/**
 * Classify a GitHub Release asset name into a pack surface, or null.
 * @param {string} name
 * @returns {"skills"|"desktop"|"extension"|"obsidian"|null}
 */
export function classifyReleaseAsset(name) {
  const n = String(name || "");
  if (!n || n === "latest.json") return null;
  if (n.startsWith("topmind-skills-")) return "skills";
  if (n.startsWith("topmind-clip-extension-")) return "extension";
  if (n.startsWith("topmind-obsidian-")) return "obsidian";
  if (n.startsWith("topmind-")) return "desktop";
  return null;
}

/**
 * @param {Record<string, string>} current  // { skills, desktop, extension, obsidian }
 * @param {Record<string, string> | null} previous
 * @returns {Record<string, "pack"|"reuse">}
 */
export function planReleaseSurfaces(current, previous) {
  const out = {};
  for (const id of RELEASE_SURFACES) {
    const cur = typeof current[id] === "string" ? current[id].trim() : "";
    const prev = previous && typeof previous[id] === "string" ? previous[id].trim() : "";
    out[id] = cur && prev && cur === prev ? "reuse" : "pack";
  }
  return out;
}

/**
 * Read previous Latest stamp (finalize-release `latest.json` shape).
 * @param {string} filePath
 * @returns {Record<string, string> | null}
 */
export function readPreviousLatest(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const out = {};
  for (const id of RELEASE_SURFACES) {
    const v = parsed[id];
    if (typeof v === "string" && v.trim()) out[id] = v.trim();
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function currentSurfaceVersions() {
  const rows = readAllVersions();
  const out = {};
  for (const r of rows) {
    if (r.id === "utr") continue;
    out[r.id] = r.version;
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const asGh = args.includes("--github-output");
  const prevIdx = args.indexOf("--prev");
  const prevPath = prevIdx >= 0 ? args[prevIdx + 1] : "";

  const current = currentSurfaceVersions();
  const previous = prevPath ? readPreviousLatest(path.resolve(prevPath)) : null;
  const plan = planReleaseSurfaces(current, previous);

  if (asGh) {
    for (const id of RELEASE_SURFACES) {
      process.stdout.write(`${id}=${plan[id] === "pack"}\n`);
      process.stdout.write(`reuse_${id}=${plan[id] === "reuse"}\n`);
    }
    return;
  }

  const payload = { current, previous, plan };
  if (asJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  for (const id of RELEASE_SURFACES) {
    process.stdout.write(`${id.padEnd(10)} ${plan[id].padEnd(6)}  now=${current[id] || "?"}  prev=${previous?.[id] || "(none)"}\n`);
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) main();
