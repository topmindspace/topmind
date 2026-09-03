import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSystemPrompt } from "../electron/ai-prompts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toolsSrc = readFileSync(path.join(root, "electron/ai-tools.mjs"), "utf8");

test("ai-tools: wrapWrite generates self-healing hint for edit_file failures", () => {
  // edit_file no-match provides read_file retry hint
  assert.match(toolsSrc, /Edit failed: oldText was not found/);
  assert.match(toolsSrc, /编辑失败：未在文件中匹配到 oldText/);
  assert.match(toolsSrc, /read_file\(\{ relativePath/);

  // edit_file ambiguous match provides disambiguation hint
  assert.match(toolsSrc, /Edit failed: oldText matched multiple times/);
  assert.match(toolsSrc, /编辑失败：oldText 在文件中命中多处/);
  assert.match(toolsSrc, /startLine\/endLine/);
});

test("system prompt: enforces active open document grounding & editing protocol", () => {
  const promptZh = buildSystemPrompt({
    workspaceContext: { userWorkspaceRoot: "/tmp/ws" },
    focusPath: "20-研究/2026-AI/topic.md",
    toolNames: ["edit_file", "read_file", "save_file"],
  });

  // Focus grounding
  assert.match(promptZh, /当前打开的活跃文档:\s*20-研究\/2026-AI\/topic\.md/);
  assert.match(promptZh, /默认操作目标即为此文档/);

  // Writing & Editing Protocol
  assert.match(promptZh, /文件编辑与写操作心智协议/);
  assert.match(promptZh, /感知先于行动/);
  assert.match(promptZh, /必须使用 edit_file/);
  assert.match(promptZh, /严禁为了修改一两句话使用 save_file 全篇覆盖/);
  assert.match(promptZh, /自愈循环/);

  // English prompt parity
  const promptEn = buildSystemPrompt({
    workspaceContext: { userWorkspaceRoot: "/tmp/ws" },
    focusPath: "20-Research/2026-AI/topic.md",
    toolNames: ["edit_file", "read_file", "save_file"],
    locale: "en-US",
  });
  assert.match(promptEn, /Active open document:\s*20-Research\/2026-AI\/topic\.md/);
  assert.match(promptEn, /Writing & Editing Protocol/);
  assert.match(promptEn, /Read Before Write/);
  assert.match(promptEn, /MUST use edit_file/);
});
