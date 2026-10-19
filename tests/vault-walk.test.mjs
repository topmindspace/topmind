import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isOpaquePackageName,
  isHeavyDirName,
  shouldSkipVaultDirName,
  shouldDescendDirent,
  compileUserIgnoreFilters,
  pathMatchesUserIgnore,
  loadVaultIgnoreSync,
  isEscapingSymlinkSync,
  resolvesOutsideVaultSync,
} from "../lib/vault-walk.mjs";

test("package and heavy names match the vault fence", () => {
  assert.equal(isOpaquePackageName("Blender.app"), true);
  assert.equal(isOpaquePackageName("EquationKit.framework"), true);
  assert.equal(isOpaquePackageName("Keynote.APP"), true);
  assert.equal(isOpaquePackageName("note.md"), false);
  assert.equal(isOpaquePackageName("My.app.notes"), false);
  assert.equal(isOpaquePackageName(".app"), false);
  assert.equal(isHeavyDirName("node_modules"), true);
  assert.equal(isHeavyDirName("dist"), true);
  assert.equal(isHeavyDirName("__pycache__"), true);
  assert.equal(isHeavyDirName("__MACOSX"), true);
  assert.equal(isHeavyDirName("venv"), true);
  assert.equal(isHeavyDirName("images"), false);
  assert.equal(shouldSkipVaultDirName("images"), false);
  assert.equal(shouldSkipVaultDirName(".obsidian"), true);
  assert.equal(shouldSkipVaultDirName(""), true);
  assert.equal(shouldSkipVaultDirName("Blender.app"), true);
});

test("shouldDescendDirent refuses symlinks and packages", () => {
  const dir = { name: "notes", isDirectory: () => true, isSymbolicLink: () => false };
  const link = { name: "link", isDirectory: () => false, isSymbolicLink: () => true };
  const app = { name: "Fake.app", isDirectory: () => true, isSymbolicLink: () => false };
  const file = { name: "note.md", isDirectory: () => false, isSymbolicLink: () => false };
  assert.equal(shouldDescendDirent(dir), true);
  assert.equal(shouldDescendDirent(link), false);
  assert.equal(shouldDescendDirent(app), false);
  assert.equal(shouldDescendDirent(file), false);
});

test("userIgnoreFilters compile like Obsidian and skip a broken line", () => {
  const filters = compileUserIgnoreFilters(["skipme\\.md$", "  ", 12, "("]);
  assert.equal(filters.length, 1);
  assert.equal(pathMatchesUserIgnore("40-创作/topic/skipme.md", filters), true);
  assert.equal(pathMatchesUserIgnore("40-创作/topic/note.md", filters), false);
  assert.equal(pathMatchesUserIgnore("../outside.md", filters), false);
});

test("loadVaultIgnoreSync reads app.json and treats a missing file as no filters", () => {
  const root = mkdtempSync(path.join(tmpdir(), "vault-ignore-"));
  try {
    assert.deepEqual(loadVaultIgnoreSync(root), []);
    mkdirSync(path.join(root, ".obsidian"), { recursive: true });
    writeFileSync(
      path.join(root, ".obsidian", "app.json"),
      JSON.stringify({ userIgnoreFilters: ["^secret/"] }),
      "utf8",
    );
    const filters = loadVaultIgnoreSync(root);
    assert.equal(pathMatchesUserIgnore("secret/a.md", filters), true);
    assert.equal(pathMatchesUserIgnore("notes/a.md", filters), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("escaping symlink leaves the vault; an internal link and the vault root do not", () => {
  const root = mkdtempSync(path.join(tmpdir(), "vault-link-"));
  const outside = mkdtempSync(path.join(tmpdir(), "vault-out-"));
  try {
    const internal = path.join(root, "inside");
    mkdirSync(internal);
    const internalLink = path.join(root, "internal");
    const escapeLink = path.join(root, "escape");
    const dangling = path.join(root, "dangling");
    try {
      symlinkSync(internal, internalLink);
      symlinkSync(outside, escapeLink);
      symlinkSync(path.join(outside, "missing"), dangling);
    } catch (err) {
      throw new Error(`symlink required for the vault fence: ${err instanceof Error ? err.message : String(err)}`);
    }
    writeFileSync(path.join(outside, "marker.md"), "out\n", "utf8");
    assert.equal(isEscapingSymlinkSync(root, internalLink), false);
    assert.equal(isEscapingSymlinkSync(root, escapeLink), true);
    assert.equal(isEscapingSymlinkSync(root, dangling), true);
    assert.equal(isEscapingSymlinkSync(root, internal), false);
    assert.equal(resolvesOutsideVaultSync(root, escapeLink), true);
    assert.equal(resolvesOutsideVaultSync(root, path.join(escapeLink, "marker.md")), true);
    assert.equal(resolvesOutsideVaultSync(root, internal), false);
    assert.equal(resolvesOutsideVaultSync(root, path.join(root, "missing.md")), false);
    const rootLink = path.join(root, "root-link");
    symlinkSync(root, rootLink);
    assert.equal(isEscapingSymlinkSync(root, rootLink), false);
    assert.equal(resolvesOutsideVaultSync(root, rootLink), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
