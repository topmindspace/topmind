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
  // plan/meta logic: MAKE_LATEST true only when tag is v* and not skills-/desktop-/extension-v*
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
  // Surface desktop tags must resolve make_latest false via the exclusion
  const meta = src.slice(src.indexOf("MAKE_LATEST="));
  assert.match(
    meta,
    /desktop-v\*/u,
    "desktop-v* must be excluded from MAKE_LATEST=true",
  );
});
