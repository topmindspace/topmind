/**
 * Memory-plane contract paths (2026-08-24 round 4): memory-engine must honor
 * contract memory.dir + layers.global.file (a v3 migration can produce a
 * custom profileFile). Hardcoded memory/profile.md paths used to fork a twin
 * profile that Desktop (resolveMemoryPaths) could never see.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import {
  resolveMemoryDir,
  resolveMemoryLayerPath,
  resolvePeriodMemoryPath,
  periodMemoryRelPath,
  appendProfileEntry,
  ensureMemoryPlane,
  globalProfileRelPath,
} from "../lib/memory-engine.mjs";
import { generateSuggestions } from "../lib/suggest-engine.mjs";
import { writeContract } from "../lib/contract-engine.mjs";
import { resolveTodoRelPath, resolveTodoPath, ensureTodoFile } from "../lib/todo-engine.mjs";
import { classifyActivityPath } from "../lib/activity-window.mjs";
import { isRecoverableLifecycle } from "../lib/writeback-engine.mjs";
import { isMemoryPlaneRelPath } from "../lib/stream-period.mjs";

const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function mkWs(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("memory-engine honors contract memory.dir + layers.global.file", () => {
  let ws;
  before(() => {
    ws = mkWs("tm-memcfg-");
    // v3-migrated shape: custom dir + custom profile filename
    writeContract(ws, {
      contract_version: 4,
      memory: {
        dir: "70-记忆",
        layers: { global: { file: "me.md" } },
      },
    });
    fs.mkdirSync(path.join(ws, "10-动态"), { recursive: true });
  });
  after(() => fs.rmSync(ws, { recursive: true, force: true }));

  it("resolveMemoryDir / resolveMemoryLayerPath use the configured locations", () => {
    assert.equal(resolveMemoryDir(ws), path.join(ws, "70-记忆"));
    assert.equal(resolveMemoryLayerPath(ws, "global"), path.join(ws, "70-记忆", "me.md"));
  });

  it("ensureMemoryPlane creates the configured tree, not a memory/ twin", () => {
    ensureMemoryPlane(ws);
    assert.ok(fs.existsSync(path.join(ws, "70-记忆", "periodic")));
    assert.ok(fs.existsSync(path.join(ws, "70-记忆", "topics")));
    assert.equal(fs.existsSync(path.join(ws, "memory")), false, "no hardcoded memory/ twin");
  });

  it("appendProfileEntry writes the configured profile file", () => {
    appendProfileEntry({
      workspaceRoot: ws,
      entry: { section: "进行中的事", content: "在契约路径上写入画像事实" },
    });
    const custom = path.join(ws, "70-记忆", "me.md");
    assert.ok(fs.existsSync(custom), "profile written to configured file");
    assert.ok(
      fs.readFileSync(custom, "utf8").includes("在契约路径上写入画像事实"),
      "fact landed in the configured profile",
    );
    assert.equal(
      fs.existsSync(path.join(ws, "memory", "profile.md")),
      false,
      "no hardcoded twin created",
    );
  });

  it("periodic paths honor the configured dir and stick to a legacy flat file", () => {
    const flat = path.join(ws, "70-记忆", "periodic", "2025-W03.md");
    fs.mkdirSync(path.dirname(flat), { recursive: true });
    fs.writeFileSync(flat, "# flat reflection\n");
    assert.equal(
      resolvePeriodMemoryPath(ws, "2025-W03"),
      flat,
      "write side sticks to flat file in configured dir",
    );
    assert.equal(
      periodMemoryRelPath("2025-W03", { workspaceRoot: ws }),
      "70-记忆/periodic/2025-W03.md",
      "payload rel path is sticky too (no year-twin lie)",
    );
    assert.equal(
      periodMemoryRelPath("2026-W01", { workspaceRoot: ws }),
      "70-记忆/periodic/2026/2026-W01.md",
      "fresh periods use year dir under the configured dir",
    );
  });

  it("skip evidence uses the configured relative path, not memory/profile.md", () => {
    const r = appendProfileEntry({
      workspaceRoot: ws,
      entry: { section: "进行中的事", content: "在契约路径上写入画像事实" },
    });
    assert.equal(r.operation, "skip");
    assert.equal(r.reason, "duplicate-fact");
    assert.equal(r.targetPath, "70-记忆/me.md");
    assert.equal(globalProfileRelPath(ws), "70-记忆/me.md");
  });

  it("todo file lives under the configured memory dir (no memory/todo.md twin)", () => {
    ensureTodoFile(ws);
    assert.equal(resolveTodoRelPath(ws), "70-记忆/todo.md");
    assert.equal(resolveTodoPath(ws), path.join(ws, "70-记忆", "todo.md"));
    assert.ok(fs.existsSync(path.join(ws, "70-记忆", "todo.md")));
    assert.equal(fs.existsSync(path.join(ws, "memory", "todo.md")), false);
  });

  it("activity / recoverability treat the custom dir as the memory plane", () => {
    assert.equal(isMemoryPlaneRelPath("70-记忆/me.md", "70-记忆"), true);
    assert.equal(classifyActivityPath("70-记忆/me.md", "70-记忆"), "memory");
    assert.equal(
      isRecoverableLifecycle({
        protection: "open",
        relativePath: "70-记忆/me.md",
        workspaceRoot: ws,
      }),
      true,
    );
    assert.equal(
      isRecoverableLifecycle({
        protection: "open",
        relativePath: "00-收件箱/scratch.md",
        workspaceRoot: ws,
      }),
      false,
    );
  });

  it("open-profile suggestion targets the configured profile", async () => {
    const fresh = mkWs("tm-memcfg-suggest-");
    try {
      writeContract(fresh, {
        contract_version: 4,
        memory: { dir: "70-记忆", layers: { global: { file: "me.md" } } },
      });
      fs.mkdirSync(path.join(fresh, "10-动态"), { recursive: true });
      const suggestions = await generateSuggestions({ workspaceRoot: fresh, engineRoot });
      const open = suggestions.find((s) => s.kind === "open_profile");
      assert.ok(open, "open_profile suggestion present on empty profile");
      assert.equal(open.targetPath, "70-记忆/me.md");
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true });
    }
  });
});

describe("default workspaces keep memory/profile.md behavior", () => {
  it("plain contract resolves the canonical locations", () => {
    const ws = mkWs("tm-memdef-");
    try {
      writeContract(ws, { contract_version: 4 });
      assert.equal(resolveMemoryDir(ws), path.join(ws, "memory"));
      assert.equal(resolveMemoryLayerPath(ws, "global"), path.join(ws, "memory", "profile.md"));
      assert.equal(periodMemoryRelPath("2026-W01", { workspaceRoot: ws }), "memory/periodic/2026/2026-W01.md");
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
