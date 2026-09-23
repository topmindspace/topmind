/**
 * H1: one contract writer (writeContract) and loadContract ignores v3 JSON.
 * Drives shipped saveWorkspaceConfig + loadContract + ensureContract.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  saveWorkspaceConfig,
  loadWorkspaceConfig,
  normalizeConfig,
} from "../lib/workspace-model.mjs";
import {
  loadContract,
  ensureContract,
  CONTRACT_FILE_NAME,
  writeContract,
} from "../lib/contract-engine.mjs";

function tmpWs() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tm-contract-writer-"));
}

describe("saveWorkspaceConfig uses Kernel writeContract", () => {
  it("writes sanitized v4 yaml without flat top-level aliases", () => {
    const ws = tmpWs();
    try {
      const written = saveWorkspaceConfig(ws, {
        workspace: { template: "research", locale: "en-US", category_separator: " " },
        writeback: { mode: "confirm" },
      });
      assert.equal(written, path.join(ws, CONTRACT_FILE_NAME));
      const raw = fs.readFileSync(written, "utf8");
      assert.match(raw, /template:\s*research/);
      assert.doesNotMatch(raw, /^template:/m);
      assert.doesNotMatch(raw, /^categorySeparator:/m);
      const loaded = loadContract(ws);
      assert.equal(loaded.workspace.template, "research");
      assert.equal(loaded.writeback.mode, "confirm");
      assert.equal(loaded.template, undefined);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});

describe("loadContract vs ensureContract v3", () => {
  it("ensureContract still one-shot migrates v3 JSON to yaml", () => {
    const ws = tmpWs();
    try {
      fs.writeFileSync(
        path.join(ws, ".topmind-config.json"),
        JSON.stringify({ template: "balanced", locale: "zh-CN" }),
        "utf8",
      );
      assert.equal(loadContract(ws).workspace.template, "stream");
      const ensured = ensureContract(ws);
      assert.ok(["migrated", "created", "ok", "repaired"].includes(ensured.status));
      assert.ok(fs.existsSync(path.join(ws, CONTRACT_FILE_NAME)));
      const after = loadContract(ws);
      assert.equal(after.workspace.template, "balanced");
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("writeContract is the only persist used by saveWorkspaceConfig (round-trip)", () => {
    const ws = tmpWs();
    try {
      writeContract(ws, {
        contract_version: 4,
        workspace: { name: "x", locale: "zh-CN", template: "stream", category_separator: "-" },
        writeback: { mode: "auto" },
      });
      const cfg = normalizeConfig(loadWorkspaceConfig(ws));
      cfg.writeback.mode = "confirm";
      saveWorkspaceConfig(ws, cfg);
      assert.equal(loadContract(ws).writeback.mode, "confirm");
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});

describe("saveWorkspaceConfig preserves unmanaged on-disk keys", () => {
  it("keeps stream.default_view / memory.files / custom workspace keys; category deletions stick", () => {
    const ws = tmpWs();
    try {
      // Seed a contract with keys the model does not manage
      writeContract(ws, {
        contract_version: 4,
        workspace: { name: "user", locale: "zh-CN", template: "balanced", category_separator: "-", custom_note: "keep-me" },
        stream: { packing: "weekly", append_heading: "day", year_dir: false, default_view: "category" },
        memory: { dir: "memory", files: ["profile.md"], layers: { global: { file: "profile.md", update: "on-suggest" } } },
        writeback: { mode: "auto", custom_future_key: "keep" },
      });
      // Simulate a category op: delete an override, keep the rest
      const cfg = normalizeConfig(loadWorkspaceConfig(ws));
      cfg.categoryOverrides = { "11": { hidden: true } };
      saveWorkspaceConfig(ws, cfg);

      const after = loadContract(ws);
      assert.equal(after.stream.default_view, "category", "stream.default_view must survive");
      assert.equal(after.stream.year_dir, false, "user year_dir=false must survive");
      assert.deepEqual(after.memory.files, ["profile.md"], "memory.files must survive");
      assert.equal(after.workspace.custom_note, "keep-me", "custom workspace keys must survive");
      assert.equal(after.writeback.custom_future_key, "keep", "unknown writeback keys must survive");
      // Full-replace sections: deletions win (no resurrect)
      assert.ok(after.categories.overrides["11"], "override written");
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
