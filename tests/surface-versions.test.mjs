/**
 * Version policy tests (v2.1+):
 * - All surfaces share the same MAJOR version (breaking-change alignment)
 * - UTR version follows Desktop exactly (same installer)
 * - Skills / Extension have independent minor/patch (no cross-surface equality required)
 * - Skill SKILL.md frontmatter versions follow pack truth source
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

/** Extract major version number from semver string. */
function majorOf(v) {
  return parseInt(String(v).split(".")[0], 10);
}

test("all surface versions are valid semver", () => {
  const skills = readJson("skills/topmind-pack.json").version;
  const desktop = readJson("topmind-desktop/package.json").version;
  const extension = readJson("browser-extension/manifest.json").version;
  const obsidian = readJson("obsidian-plugin/manifest.json").version;
  const obsidianPkg = readJson("obsidian-plugin/package.json").version;
  const extPkg = readJson("browser-extension/package.json").version;
  const utr = readTrim("utr/VERSION");

  assert.match(skills, /^\d+\.\d+\.\d+$/u);
  assert.match(desktop, /^\d+\.\d+\.\d+$/u);
  assert.match(extension, /^\d+\.\d+\.\d+$/u);
  assert.match(obsidian, /^\d+\.\d+\.\d+$/u);
  assert.match(obsidianPkg, /^\d+\.\d+\.\d+$/u);
  assert.match(extPkg, /^\d+\.\d+\.\d+$/u);
  assert.match(utr, /^\d+\.\d+\.\d+$/u);
  assert.equal(obsidianPkg, obsidian, "obsidian package.json version must match manifest.json");
  assert.equal(extPkg, extension, "extension package.json version must match manifest.json");
});

test("all surfaces share the same MAJOR version (breaking-change alignment)", () => {
  const skills = readJson("skills/topmind-pack.json").version;
  const desktop = readJson("topmind-desktop/package.json").version;
  const extension = readJson("browser-extension/manifest.json").version;
  const obsidian = readJson("obsidian-plugin/manifest.json").version;
  const utr = readTrim("utr/VERSION");

  const skillsMajor = majorOf(skills);
  const desktopMajor = majorOf(desktop);
  const extensionMajor = majorOf(extension);
  const obsidianMajor = majorOf(obsidian);
  const utrMajor = majorOf(utr);

  assert.equal(desktopMajor, skillsMajor,
    `Desktop major ${desktopMajor} must equal Skills major ${skillsMajor}`);
  assert.equal(extensionMajor, skillsMajor,
    `Extension major ${extensionMajor} must equal Skills major ${skillsMajor}`);
  assert.equal(obsidianMajor, skillsMajor,
    `Obsidian major ${obsidianMajor} must equal Skills major ${skillsMajor}`);
  assert.equal(utrMajor, skillsMajor,
    `UTR major ${utrMajor} must equal Skills major ${skillsMajor}`);
});

test("Desktop and Obsidian lockfile package versions match package.json", () => {
  const desktop = readJson("topmind-desktop/package.json").version;
  const desktopLock = readJson("topmind-desktop/package-lock.json");
  assert.equal(desktopLock.version, desktop, "topmind-desktop/package-lock.json version");
  assert.equal(
    desktopLock.packages?.[""]?.version,
    desktop,
    "topmind-desktop/package-lock.json packages.\"\".version",
  );

  const obsidian = readJson("obsidian-plugin/package.json").version;
  const obsidianLock = readJson("obsidian-plugin/package-lock.json");
  assert.equal(obsidianLock.version, obsidian, "obsidian-plugin/package-lock.json version");
  assert.equal(
    obsidianLock.packages?.[""]?.version,
    obsidian,
    "obsidian-plugin/package-lock.json packages.\"\".version",
  );
});

test("UTR version follows Desktop exactly (same installer)", () => {
  const desktop = readJson("topmind-desktop/package.json").version;
  const utr = readTrim("utr/VERSION");
  assert.equal(utr, desktop, `UTR ${utr} must equal Desktop ${desktop}`);
});

test("UTR CLI --version reads utr/VERSION (no stale hardcoded constant)", () => {
  const src = fs.readFileSync(path.join(repoRoot, "utr/bin/topmind-cli.mjs"), "utf8");
  assert.match(src, /VERSION/);
  assert.doesNotMatch(src, /const CLI_VERSION = ["']\d+\.\d+\.\d+["']/);
  const utr = readTrim("utr/VERSION");
  assert.match(src, /fileURLToPath\(import\.meta\.url\)/);
  assert.equal(utr.length > 0, true);
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
