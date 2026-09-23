/**
 * Structural checks against the shipped release.yml create-release path.
 * Catches the desktop-v* failure mode: invalid --not-latest + masked create stderr
 * → false "already exists" → gh release edit 404 → pack jobs skipped.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { resolveSkillsRoot, resolveObsidianRoot, SKIP_SKILLS, SKIP_OBSIDIAN, repoRoot: _sisterRepoRoot } = await import("./helpers/sister-repos.mjs");
const skillsRoot = resolveSkillsRoot() || path.join(_sisterRepoRoot, "skills");
const obsidianRoot = resolveObsidianRoot() || path.join(_sisterRepoRoot, "obsidian-plugin");
function absJoin(root, rel) {
  return path.isAbsolute(rel) ? rel : path.join(root, rel);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseYml = path.join(repoRoot, ".github", "workflows", "release.yml");

function loadReleaseWorkflow() {
  assert.ok(fs.existsSync(releaseYml), `missing shipped workflow: ${releaseYml}`);
  return fs.readFileSync(releaseYml, "utf8");
}

/** Extract the Create GitHub Release step body (run: | …) for focused asserts. */
function createReleaseStepBody(src) {
  const marker = "name: Create GitHub Release";
  const start = src.indexOf(marker);
  assert.ok(start >= 0, "Create GitHub Release step must exist");
  const after = src.slice(start);
  // Next top-level job is typically "pack-skills:" at indent 2
  const nextJob = after.search(/\n  [a-z][a-z0-9_-]*:\n/u);
  const stepBlock = nextJob >= 0 ? after.slice(0, nextJob) : after;
  return stepBlock;
}

test("release.yml forbids invalid gh flag --not-latest (use --latest=false)", () => {
  const src = loadReleaseWorkflow();
  // Strip YAML/shell comments so docs can mention the forbidden flag by name.
  const codeOnly = src
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return t && !t.startsWith("#");
    })
    .join("\n");
  assert.doesNotMatch(
    codeOnly,
    /--not-latest\b/u,
    "gh release create/edit only support --latest=false (invalid --not-latest must not appear as a flag)",
  );
  const body = createReleaseStepBody(src);
  assert.match(
    body,
    /ARGS\+=\(--latest=false\)/u,
    "surface-tag / MAKE_LATEST=false path must pass --latest=false on create",
  );
  assert.match(
    body,
    /EDIT_ARGS\+=\(--latest=false\)/u,
    "edit path must also keep surface releases non-latest",
  );
});

test("release.yml does not mask gh release create stderr as already-exists", () => {
  const body = createReleaseStepBody(loadReleaseWorkflow());
  assert.doesNotMatch(
    body,
    /gh release create[^\n]*2>\s*\/dev\/null/u,
    "must not swallow create errors (false already-exists → edit 404)",
  );
});

test("release.yml probes release existence before edit", () => {
  const body = createReleaseStepBody(loadReleaseWorkflow());
  assert.match(
    body,
    /gh release view\s+"\$\{TAG\}"/u,
    "must gh release view TAG before edit path",
  );
  assert.match(body, /gh release create\s+"\$\{TAG\}"/u);
  assert.match(body, /gh release edit\s+"\$\{TAG\}"/u);
});

test("MAKE_LATEST is true only for full product v* tags (not surface tags)", () => {
  const src = loadReleaseWorkflow();
  // plan/meta logic: MAKE_LATEST true only when tag is v* and not skills-/desktop-/extension-/obsidian-v*
  assert.match(
    src,
    /MAKE_LATEST="true"/u,
  );
  assert.match(
    src,
    /TAG"\s*!=\s*skills-v\*|TAG\}"\s*!=\s*skills-v\*|skills-v\*/u,
  );
  assert.match(src, /desktop-v\*/u);
  assert.match(src, /extension-v\*/u);
  assert.match(src, /obsidian-v\*/u);
  // Surface desktop tags must resolve make_latest false via the exclusion
  const meta = src.slice(src.indexOf("MAKE_LATEST="));
  assert.match(
    meta,
    /desktop-v\*/u,
    "desktop-v* must be excluded from MAKE_LATEST=true",
  );
  assert.match(
    meta,
    /obsidian-v\*/u,
    "obsidian-v* must be excluded from MAKE_LATEST=true",
  );
});

test("main release.yml packs Desktop/Clip only (skills/obsidian live in sister repos)", () => {
  const src = loadReleaseWorkflow();
  assert.doesNotMatch(src, /-\s*"obsidian-v\*"/u, "obsidian-v* must not trigger main repo release");
  assert.doesNotMatch(src, /-\s*"skills-v\*"/u, "skills-v* must not trigger main repo release");
  assert.match(src, /-\s*"desktop-v\*"/u, "desktop-v* hotfix tag remains");
  assert.match(src, /-\s*"extension-v\*"/u, "extension-v* hotfix tag remains");
  assert.match(src, /pack-desktop:/u, "must define pack-desktop job");
  assert.match(src, /plan-release-surfaces\.mjs/u, "v* ship uses pack-vs-reuse planner");
});

test("sister repos own their release workflows (when checkouts present)", (t) => {
  if (!obsidianRoot || !fs.existsSync(path.join(obsidianRoot, ".github/workflows/release.yml"))) {
    t.skip(SKIP_OBSIDIAN || "topmind-obsidian checkout not found");
    return;
  }
  const src = fs.readFileSync(path.join(obsidianRoot, ".github/workflows/release.yml"), "utf8");
  assert.match(src, /manifest\.json/u, "obsidian release must pin to manifest.version");
  if (skillsRoot && fs.existsSync(path.join(skillsRoot, ".github/workflows/release.yml"))) {
    const s = fs.readFileSync(path.join(skillsRoot, ".github/workflows/release.yml"), "utf8");
    assert.match(s, /topmind-pack\.json/u, "skills release must pin to pack version");
  }
});

test("release.yml does not use Actions artifact storage for pack aggregation", () => {
  const src = loadReleaseWorkflow();
  const codeOnly = src
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return t && !t.startsWith("#");
    })
    .join("\n");
  assert.doesNotMatch(
    codeOnly,
    /download-artifact@/u,
    "Release pack jobs must not download-artifact (quota); they gh release upload",
  );
  assert.doesNotMatch(
    codeOnly,
    /merge-multiple\s*:/u,
    "Release must not merge-multiple Actions artifacts",
  );
  assert.match(
    src,
    /gh release upload/u,
    "Release pack path is gh release upload",
  );
});

test("PACKAGING.md matches release plan outputs and upload architecture", () => {
  const packaging = fs.readFileSync(
    path.join(repoRoot, "docs", "PACKAGING.md"),
    "utf8",
  );
  // After the three-repo split, this repo's plan only packs extension + desktop.
  assert.match(
    packaging,
    /\|\s*`extension`\s*\|/u,
    "plan job outputs table must include extension",
  );
  assert.match(
    packaging,
    /\|\s*`desktop`\s*\|/u,
    "plan job outputs table must include desktop",
  );
  // Sister surfaces are documented as living outside this plan.
  assert.match(
    packaging,
    /topmind-skills[\s\S]{0,400}topmind-obsidian|topmind-obsidian[\s\S]{0,400}topmind-skills/iu,
    "PACKAGING must name sister repos for skills/obsidian",
  );
  assert.match(packaging, /gh release upload/u);
  assert.doesNotMatch(
    packaging,
    /merge-multiple[^\n]*release 汇聚下载/u,
    "must not claim merge-multiple aggregates Release assets",
  );
  assert.match(
    packaging,
    /skills\/extension\/obsidian smoke packs|Skills\/Obsidian smoke|sister/iu,
    "CI row must mention Obsidian smoke pack or sister-repo packing",
  );
});

