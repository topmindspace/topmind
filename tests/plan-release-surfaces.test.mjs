/**
 * Drive shipped plan-release-surfaces.mjs — pack vs reuse vs asset classify.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  planReleaseSurfaces,
  classifyReleaseAsset,
  readPreviousLatest,
  currentSurfaceVersions,
  RELEASE_SURFACES,
} from "../scripts/plan-release-surfaces.mjs";

test("no previous Latest → pack every surface", () => {
  const current = { skills: "3.4.0", desktop: "3.4.0", extension: "3.4.0", obsidian: "3.4.0" };
  const plan = planReleaseSurfaces(current, null);
  for (const id of RELEASE_SURFACES) assert.equal(plan[id], "pack", id);
});

test("same versions as previous Latest → reuse every surface", () => {
  const current = { skills: "3.4.0", desktop: "3.4.0", extension: "3.4.0", obsidian: "3.4.0" };
  const plan = planReleaseSurfaces(current, current);
  for (const id of RELEASE_SURFACES) assert.equal(plan[id], "reuse", id);
});

test("only changed surfaces pack; unchanged reuse previous assets", () => {
  const current = { skills: "3.4.0", desktop: "3.4.1", extension: "3.4.0", obsidian: "3.4.2" };
  const previous = { skills: "3.4.0", desktop: "3.4.0", extension: "3.4.0", obsidian: "3.4.0" };
  const plan = planReleaseSurfaces(current, previous);
  assert.equal(plan.skills, "reuse");
  assert.equal(plan.desktop, "pack");
  assert.equal(plan.extension, "reuse");
  assert.equal(plan.obsidian, "pack");
});

test("missing previous surface key → pack that surface", () => {
  const plan = planReleaseSurfaces(
    { skills: "3.4.0", desktop: "3.4.0", extension: "3.4.0", obsidian: "3.4.0" },
    { skills: "3.4.0", desktop: "3.4.0" },
  );
  assert.equal(plan.skills, "reuse");
  assert.equal(plan.desktop, "reuse");
  assert.equal(plan.extension, "pack");
  assert.equal(plan.obsidian, "pack");
});

test("classifyReleaseAsset maps prefixes and skips latest.json", () => {
  assert.equal(classifyReleaseAsset("topmind-skills-3.4.0.zip"), "skills");
  assert.equal(classifyReleaseAsset("topmind-clip-extension-3.4.0.zip"), "extension");
  assert.equal(classifyReleaseAsset("topmind-obsidian-3.4.0.zip"), "obsidian");
  assert.equal(classifyReleaseAsset("topmind-3.4.0-mac-arm64.dmg"), "desktop");
  assert.equal(classifyReleaseAsset("topmind-SHA256SUMS-desktop-macos.txt"), "desktop");
  assert.equal(classifyReleaseAsset("latest.json"), null);
  assert.equal(classifyReleaseAsset(""), null);
});

test("readPreviousLatest reads finalize-release stamp; currentSurfaceVersions matches truth", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tm-latest-"));
  try {
    const fp = path.join(dir, "latest.json");
    writeFileSync(
      fp,
      JSON.stringify({
        productTag: "v3.4.0",
        desktop: "3.4.0",
        skills: "3.4.0",
        extension: "3.4.0",
        obsidian: "3.4.0",
      }),
    );
    const prev = readPreviousLatest(fp);
    assert.deepEqual(prev, {
      desktop: "3.4.0",
      skills: "3.4.0",
      extension: "3.4.0",
      obsidian: "3.4.0",
    });
    assert.equal(readPreviousLatest(path.join(dir, "missing.json")), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const cur = currentSurfaceVersions();
  for (const id of RELEASE_SURFACES) {
    assert.match(cur[id], /^\d+\.\d+\.\d+$/u, id);
  }
  assert.equal(cur.utr, undefined);
});

test("release.yml ships the planner for v* and a reuse-previous job", () => {
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows", "release.yml"),
    "utf8",
  );
  assert.match(src, /plan-release-surfaces\.mjs/u);
  assert.match(src, /reuse-previous:/u);
  assert.match(src, /classifyReleaseAsset|reuse_skills/u);
});
