/**
 * derived-builder — real topic fixture; item-history is deterministic & rebuildable.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildTopicDerived } from "../lib/derived-builder.mjs";

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
});
