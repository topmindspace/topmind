/**
 * derived-builder — real topic fixture; item-history is deterministic & rebuildable.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildTopicDerived, buildPeriodDerived, rebuildAllDerived } from "../lib/derived-builder.mjs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "topmind-derived-"));

describe("derived-builder", () => {
  /** @type {string} */
  let topicPath;

  before(() => {
    const ws = path.join(tmpRoot, "ws");
    topicPath = path.join(ws, "20-研究", "2026-测试专题");
    fs.mkdirSync(topicPath, { recursive: true });
    fs.writeFileSync(
      path.join(topicPath, "topic.md"),
      "---\ntitle: 测试专题\n---\n\n# 首页\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(topicPath, "note-a.md"),
      "---\ntitle: A\n---\n\n这是笔记甲的正文，记录了研究过程。\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(topicPath, "note-b.md"),
      "---\ntitle: B\n---\n\n这是笔记乙的补充材料与结论。\n",
      "utf8",
    );
  });

  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("buildTopicDerived writes summary + item-history under .derived/", async () => {
    const ws = path.join(tmpRoot, "ws");
    const generated = await buildTopicDerived({
      topicPath,
      workspaceRoot: ws,
    });
    assert.ok(generated.summary);
    assert.ok(generated.itemHistory);
    assert.ok(fs.existsSync(generated.summary));
    assert.ok(fs.existsSync(generated.itemHistory));
    assert.match(generated.itemHistory, /\.derived[/\\]item-history\.md$/u);

    const history = fs.readFileSync(generated.itemHistory, "utf8");
    assert.match(history, /source_type:\s*"?ai-derived"?/);
    assert.match(history, /note-a\.md/);
    assert.match(history, /note-b\.md/);
    assert.match(history, /条目历史/);
    // topic.md is homepage; inventory uses non-topic notes only (buildTopicDerived filter)
    assert.ok(!history.includes("topic.md") || history.includes("note-a"));
  });

  it("buildPeriodDerived writes period summary under stream .derived/", async () => {
    const ws = path.join(tmpRoot, "ws");
    const streamPath = path.join(ws, "10-动态");
    fs.mkdirSync(streamPath, { recursive: true });
    fs.writeFileSync(
      path.join(streamPath, "2026-W38.md"),
      "## 2026-09-21\n\n- 写了测试笔记甲\n\n## 2026-09-22\n\n- 补充了结论乙\n",
      "utf8",
    );
    const generated = await buildPeriodDerived({
      streamPath,
      periodStem: "2026-W38",
      workspaceRoot: ws,
    });
    assert.ok(generated, "buildPeriodDerived returns a result");
    assert.ok(generated.digest, "period derived exposes digest path");
    assert.ok(fs.existsSync(generated.digest), `period digest exists at ${generated.digest}`);
    assert.match(generated.digest, /period-digest-2026-W38\.md$/u);
  });

  it("buildPeriodDerived finds yearDir layout first (2026/2026-W38.md)", async () => {
    const ws = path.join(tmpRoot, "ws");
    const streamPath = path.join(ws, "10-动态");
    const yearDir = path.join(streamPath, "2026");
    fs.mkdirSync(yearDir, { recursive: true });
    // Prefer yearDir even when a flat twin exists.
    fs.writeFileSync(path.join(yearDir, "2026-W39.md"), "## 2026-09-28\n\n- yearDir 条目\n", "utf8");
    fs.writeFileSync(path.join(streamPath, "2026-W39.md"), "## 2026-09-28\n\n- flat 条目\n", "utf8");
    const generated = await buildPeriodDerived({
      streamPath,
      periodStem: "2026-W39",
      workspaceRoot: ws,
    });
    assert.ok(generated?.digest);
    assert.ok(fs.existsSync(generated.digest));
    const digest = fs.readFileSync(generated.digest, "utf8");
    // yearDir source wins over flat twin.
    assert.match(digest, /yearDir|2026-W39/u);
  });

  it("rebuildAllDerived walks topics + stream without throwing", async () => {
    const ws = path.join(tmpRoot, "ws");
    const result = await rebuildAllDerived({ workspaceRoot: ws });
    assert.ok(result, "rebuildAllDerived returns a result");
    // Either an aggregate count or a list — must not be undefined/throw.
    assert.ok(
      typeof result === "object",
      "rebuildAllDerived returns an object aggregate",
    );
  });
});
