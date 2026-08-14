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

test("release.yml packs Obsidian on full v* and supports obsidian-v* surface tags", () => {
  const src = loadReleaseWorkflow();
  assert.match(src, /-\s*"obsidian-v\*"/u, "on.push.tags must include obsidian-v*");
  assert.match(src, /OBSIDIAN=true/u, "plan must set OBSIDIAN=true for matching tags");
  assert.match(
    src,
    /elif \[\[ "\$\{TAG\}" == obsidian-v\* \]\]; then/u,
    "plan must handle obsidian-v* surface tag",
  );
  const fullProductAt = src.indexOf('elif [[ "${TAG}" == v* ]]; then');
  assert.ok(fullProductAt >= 0, "plan must handle product v* tag");
  assert.match(src, /plan-release-surfaces\.mjs/u, "v* ship uses pack-vs-reuse planner");
  assert.match(src, /pack-obsidian:/u, "must define pack-obsidian job");
  assert.match(src, /needs\.plan\.outputs\.obsidian == 'true'/u);
  assert.match(
    src,
    /needs:\s*\[[^\]]*pack-obsidian[^\]]*\]/u,
    "finalize-release must wait on pack-obsidian",
  );
  assert.match(src, /reuse-previous:/u, "must define reuse-previous job");
  assert.match(src, /pack_obsidian:/u, "workflow_dispatch must expose pack_obsidian");
});

/** Extract the pack-obsidian job shell (upload step) for basename/path asserts. */
function packObsidianJobBody(src) {
  const marker = "pack-obsidian:";
  const start = src.indexOf(marker);
  assert.ok(start >= 0, "pack-obsidian job must exist");
  const after = src.slice(start);
  const nextJob = after.search(/\n  [a-z][a-z0-9_-]*:\n/u);
  return nextJob >= 0 ? after.slice(0, nextJob) : after;
}

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
  assert.match(
    packaging,
    /\|\s*`obsidian`\s*\|/u,
    "plan job outputs table must include obsidian",
  );
  assert.match(packaging, /gh release upload/u);
  assert.doesNotMatch(
    packaging,
    /merge-multiple[^\n]*release 汇聚下载/u,
    "must not claim merge-multiple aggregates Release assets",
  );
  assert.match(
    packaging,
    /skills\/extension\/obsidian smoke packs/u,
    "CI row must list Obsidian smoke pack",
  );
});

test("pack-obsidian uploads unique dist-only versioned artifacts (no dual-path / stale zips)", () => {
  const job = packObsidianJobBody(loadReleaseWorkflow());
  // Must resolve version from shipped manifest (not wildcards over stale release/)
  assert.match(
    job,
    /require\(['"]\.\/obsidian-plugin\/manifest\.json['"]\)\.version/u,
    "upload must pin artifacts to obsidian-plugin/manifest.json version",
  );
  // Explicit monorepo dist/ paths with ${VER}
  assert.match(
    job,
    /dist\/topmind-obsidian-\$\{VER\}\.zip/u,
    "zip must come from monorepo dist/ with version pin",
  );
  assert.match(
    job,
    /dist\/topmind-obsidian-\$\{VER\}\.SHA256SUMS/u,
    "SHA256SUMS must come from monorepo dist/ with version pin",
  );
  // Forbidden: dual-root find that picks mirror + stale zips → duplicate basenames
  assert.doesNotMatch(
    job,
    /find\s+dist\s+obsidian-plugin\/release/u,
    "must not find across dist + obsidian-plugin/release (duplicate basenames break gh upload)",
  );
  assert.doesNotMatch(
    job,
    /gh release upload[^\n]*obsidian-plugin\/release/u,
    "gh release upload must not take paths under obsidian-plugin/release/",
  );
  // No unversioned wildcard upload that can scoop multiple version zips
  assert.doesNotMatch(
    job,
    /gh release upload[^\n]*topmind-obsidian-\*\.zip/u,
    "must not upload topmind-obsidian-*.zip wildcards (stale versions)",
  );
  // Fail hard if zip missing
  assert.match(job, /missing \$\{ZIP\}|! -f "\$\{ZIP\}"/u);
});
