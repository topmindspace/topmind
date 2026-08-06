/**
 * seed-testws-fixtures.mjs — real seed path (temp dir), not hardcoded TestWS.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveActivityWindow } from "../lib/activity-window.mjs";
import { listStreamPeriods } from "../lib/workspace-model.mjs";

const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(engineRoot, "scripts", "seed-testws-fixtures.mjs");

describe("seed-testws-fixtures", () => {
  /** @type {string} */
  let ws;

  after(() => {
    if (ws && fs.existsSync(ws)) fs.rmSync(ws, { recursive: true, force: true });
  });

  it("seeds a usable stream-first workspace (periods + topic + profile)", async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "tm-seed-ws-"));
    const r = spawnSync(process.execPath, [script, ws], {
      encoding: "utf8",
      cwd: engineRoot,
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, true);
    assert.ok(fs.existsSync(path.join(ws, "topmind.yaml")));
    assert.ok(fs.existsSync(path.join(ws, "memory", "profile.md")));
    assert.ok(fs.existsSync(path.join(ws, "20-专题", "2026-知识管理演示", "topic.md")));
    assert.ok(fs.existsSync(path.join(ws, "00-收件箱")));
    assert.ok(fs.existsSync(path.join(ws, "88-输出")));

    const yaml = fs.readFileSync(path.join(ws, "topmind.yaml"), "utf8");
    assert.match(yaml, /contract_version:\s*4/u);
    assert.match(yaml, /packing:\s*weekly/u);

    const list = await listStreamPeriods({ workspaceRoot: ws, engineRoot, limit: 10 });
    assert.ok(list.length >= 1, "expected ≥1 stream period after seed");

    const win = resolveActivityWindow({
      workspaceRoot: ws,
      engineRoot,
      options: { windowDays: 30, maxFiles: 24 },
    });
    assert.ok(win.items.length >= 1, "activity window must see seeded content");
    assert.ok(
      win.items.some((i) => i.kind === "period" || /动态\//u.test(i.relPath)),
      "should include stream period path",
    );
    assert.ok(!ws.startsWith(engineRoot + path.sep));
  });

  it("refuses to seed inside engine root", () => {
    const r = spawnSync(process.execPath, [script, engineRoot], {
      encoding: "utf8",
      cwd: engineRoot,
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr || r.stdout, /Refusing|engine root/i);
  });
});
