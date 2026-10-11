/**
 * Companion download / update-check surface → repo mapping after the three-repo split.
 * Locks the channel contract: skills/obsidian assets come from sister repos.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SURFACE_REPOS as DL_REPOS, downloadCompanionAsset } from "../electron/lib/companion-download.mjs";
import {
  SURFACE_REPOS as UC_REPOS,
  skillsVersionFromTag,
  obsidianVersionFromTag,
} from "../electron/lib/update-check.mjs";

test("companion-download maps surfaces to sister repos", () => {
  assert.equal(DL_REPOS.skills, "topmindspace/topmind-skills");
  assert.equal(DL_REPOS.obsidian, "topmindspace/topmind-obsidian");
  assert.equal(DL_REPOS.extension, "topmindspace/topmind");
  assert.equal(DL_REPOS.desktop, "topmindspace/topmind");
});

test("update-check shares the same surface repos", () => {
  assert.deepEqual(UC_REPOS.skills, DL_REPOS.skills);
  assert.deepEqual(UC_REPOS.obsidian, DL_REPOS.obsidian);
});

test("skills/obsidian version-from-tag accepts sister-repo plain v* tags", () => {
  assert.equal(skillsVersionFromTag("skills-v4.9.0"), "4.9.0");
  assert.equal(skillsVersionFromTag("v4.9.0"), "4.9.0");
  assert.equal(obsidianVersionFromTag("obsidian-v4.7.0"), "4.7.0");
  assert.equal(obsidianVersionFromTag("v4.7.0"), "4.7.0");
});

test("obsidian version-from-tag accepts community bare tags (no v prefix)", () => {
  // Community plugin HARD RULE: tag == manifest.version exactly (4.16.0).
  // Missing this made Desktop "check for updates" ignore every community release.
  assert.equal(obsidianVersionFromTag("4.16.0"), "4.16.0");
  assert.equal(obsidianVersionFromTag("4.15.0"), "4.15.0");
  assert.equal(obsidianVersionFromTag("not-a-version"), null);
  assert.equal(obsidianVersionFromTag(""), null);
});

test("downloadCompanionAsset builds URLs against the surface repo", async () => {
  /** @type {string[]} */
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    // Return empty zip + no sums so verify is skipped
    const bytes = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);
    return {
      ok: true,
      status: 200,
      body: {
        getReader() {
          let done = false;
          return {
            async read() {
              if (done) return { done: true };
              done = true;
              return { done: false, value: Buffer.from(bytes) };
            },
          };
        },
      },
    };
  };
  const result = await downloadCompanionAsset({
    surface: "skills",
    version: "4.9.0",
    tag: "v4.9.0",
    fetchImpl,
    tempDir: undefined,
  });
  assert.ok(result.ok, result.error);
  assert.ok(
    urls.some((u) => u.includes("topmindspace/topmind-skills/releases/download/v4.9.0/topmind-skills-4.9.0.zip")),
    `expected skills repo URL, got: ${urls.join(", ")}`,
  );
  assert.ok(
    !urls.some((u) => u.includes("topmindspace/topmind/releases") && u.includes("topmind-skills-")),
    "skills assets must not download from the main topmind repo",
  );
});
