/**
 * Resolve sister delivery repos after the three-repo split.
 * Contract cross-checks run when a checkout is present; otherwise skip.
 *
 * Layout (developer machine):
 *   <parent>/topmind            ← this repo
 *   <parent>/topmind-skills
 *   <parent>/topmind-obsidian
 *
 * Env overrides: TOPMIND_SKILLS_SRC, TOPMIND_OBSIDIAN_SRC
 * CI may also place checkouts under ./.topmind-skills or ./.topmind-obsidian.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const helperDir = path.dirname(fileURLToPath(import.meta.url)); // tests/helpers
export const repoRoot = path.resolve(helperDir, "..", ".."); // repo root

function firstExisting(candidates) {
  for (const dir of candidates) {
    if (dir && existsSync(dir)) return dir;
  }
  return null;
}

function firstWithMarker(candidates, marker) {
  for (const dir of candidates) {
    if (dir && existsSync(path.join(dir, marker))) return dir;
  }
  return null;
}

export function resolveSkillsRoot() {
  // Explicit env wins exclusively (CI can point at empty dir to skip).
  const env = process.env.TOPMIND_SKILLS_SRC;
  if (env) return firstWithMarker([env], "topmind-pack.json");
  return firstWithMarker([
    path.resolve(repoRoot, "..", "topmind-skills"),
    path.resolve(repoRoot, "topmind-skills"),
    path.resolve(repoRoot, ".topmind-skills"),
    existsSync(path.join(repoRoot, "skills", "topmind-pack.json"))
      ? path.join(repoRoot, "skills")
      : null,
  ], "topmind-pack.json");
}

export function resolveObsidianRoot() {
  const env = process.env.TOPMIND_OBSIDIAN_SRC;
  if (env) return firstWithMarker([env], "manifest.json");
  return firstWithMarker([
    path.resolve(repoRoot, "..", "topmind-obsidian"),
    path.resolve(repoRoot, "topmind-obsidian"),
    path.resolve(repoRoot, ".topmind-obsidian"),
    existsSync(path.join(repoRoot, "obsidian-plugin", "manifest.json"))
      ? path.join(repoRoot, "obsidian-plugin")
      : null,
  ], "manifest.json");
}

/** True when the tree is a real pack/plugin (not a migration stub). */
export function hasSkillsPack() {
  const root = resolveSkillsRoot();
  return Boolean(root && existsSync(path.join(root, "topmind-pack.json")));
}

export function hasObsidianPlugin() {
  const root = resolveObsidianRoot();
  return Boolean(root && existsSync(path.join(root, "manifest.json")));
}

export const SKIP_SKILLS = hasSkillsPack()
  ? null
  : "topmind-skills checkout not found (set TOPMIND_SKILLS_SRC or clone as sibling ../topmind-skills)";

const obsRoot = resolveObsidianRoot();
const obsReady =
  hasObsidianPlugin() &&
  // #kernel/* resolves to ./lib — ensure-engine must have linked/copyied Kernel
  existsSync(path.join(obsRoot || "", "lib", "kernel-api.mjs"));
export const SKIP_OBSIDIAN = obsReady
  ? null
  : "topmind-obsidian not ready (checkout + ensure-engine/lib link required; set TOPMIND_OBSIDIAN_SRC)";
