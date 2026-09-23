/**
 * Desktop no longer projects v3 flat aliases. Sync loader is yaml-only.
 * Drives shipped loadWorkspaceConfigSync + loadWorkspaceConfig.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadWorkspaceConfig,
  loadWorkspaceConfigSync,
  setEngineRoot,
} from "../electron/lib/workspace-home.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
setEngineRoot(repoRoot);

test("projectConfigAliases is deleted from workspace-home", async () => {
  const src = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../electron/lib/workspace-home.mjs"),
    "utf8",
  );
  assert.doesNotMatch(src, /export function projectConfigAliases/);
  assert.doesNotMatch(src, /join\([^)]*["']\.topmind-config\.json["']\)/);
});

test("loadWorkspaceConfigSync reads nested v4 yaml and ignores v3 JSON", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "tm-cfg-sync-"));
  try {
    fs.writeFileSync(
      path.join(ws, "topmind.yaml"),
      "contract_version: 4\nworkspace:\n  template: research\n  category_separator: \" \"\n  locale: en-US\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(ws, ".topmind-config.json"),
      JSON.stringify({ template: "balanced", categorySeparator: "-" }),
      "utf8",
    );
    const cfg = loadWorkspaceConfigSync(ws);
    assert.equal(cfg.workspace.template, "research");
    assert.equal(cfg.workspace.category_separator, " ");
    assert.equal(cfg.template, undefined);
    assert.equal(cfg.categorySeparator, undefined);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("loadWorkspaceConfigSync with only v3 JSON returns empty (no silent migrate)", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "tm-cfg-v3-"));
  try {
    fs.writeFileSync(
      path.join(ws, ".topmind-config.json"),
      JSON.stringify({ template: "balanced" }),
      "utf8",
    );
    const cfg = loadWorkspaceConfigSync(ws);
    assert.deepEqual(cfg, {});
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("loadWorkspaceConfig async returns Kernel v4 nested contract", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "tm-cfg-async-"));
  try {
    fs.writeFileSync(
      path.join(ws, "topmind.yaml"),
      "contract_version: 4\nworkspace:\n  template: periodic\nwriteback:\n  mode: confirm\n",
      "utf8",
    );
    const cfg = await loadWorkspaceConfig(ws);
    assert.equal(cfg.workspace.template, "periodic");
    assert.equal(cfg.writeback.mode, "confirm");
    assert.equal(cfg.template, undefined);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
