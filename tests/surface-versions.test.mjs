/**
 * Unified product cuts (umbrella v* tags) require all four surface truth sources
 * to report the same semver. Prevents accidental partial bumps before ship.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, rel), "utf8"));
}

function readTrim(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8").trim();
}

test("all four surface version truth sources match (unified product stamp)", () => {
  const skills = readJson("skills/topmind-pack.json").version;
  const desktop = readJson("topmind-desktop/package.json").version;
  const extension = readJson("browser-extension/manifest.json").version;
  const utr = readTrim("utr/VERSION");

  assert.match(skills, /^\d+\.\d+\.\d+$/u);
  assert.equal(desktop, skills, `Desktop ${desktop} must equal Skills ${skills}`);
  assert.equal(extension, skills, `Extension ${extension} must equal Skills ${skills}`);
  assert.equal(utr, skills, `UTR ${utr} must equal Skills ${skills}`);
});

test("skill SKILL.md frontmatter versions follow pack truth source", () => {
  const packVersion = readJson("skills/topmind-pack.json").version;
  const skillsRoot = path.join(repoRoot, "skills");
  const dirs = fs.readdirSync(skillsRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
  let checked = 0;
  for (const d of dirs) {
    const skillMd = path.join(skillsRoot, d.name, "SKILL.md");
    if (!fs.existsSync(skillMd)) continue;
    const text = fs.readFileSync(skillMd, "utf8");
    const m = text.match(/^version:\s*(.+)$/mu);
    assert.ok(m, `${d.name}/SKILL.md missing version frontmatter`);
    assert.equal(
      m[1].trim(),
      packVersion,
      `${d.name}/SKILL.md version must equal pack ${packVersion}`,
    );
    checked += 1;
  }
  assert.ok(checked >= 9, `expected ≥9 skill modules with SKILL.md, got ${checked}`);
});
