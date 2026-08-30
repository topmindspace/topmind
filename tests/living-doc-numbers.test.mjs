/**
 * Living-doc numbers must match shipped Kernel constants.
 * Drives EXTRACT_CORPUS_MAX / MAINTAIN_CORPUS_MAX / SUGGEST_CORPUS_MAX_CHARS
 * / activity-window defaults — no hardcoded expected blobs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXTRACT_CORPUS_MAX,
  MAINTAIN_CORPUS_MAX,
} from "../lib/todo-engine.mjs";
import {
  DEFAULT_WINDOW_DAYS,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_PERIODS,
  SUGGEST_CORPUS_MAX_CHARS,
} from "../lib/activity-window.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(path.join(repo, rel), "utf8");
}

const extractK = EXTRACT_CORPUS_MAX / 1000;
const maintainK = MAINTAIN_CORPUS_MAX / 1000;
const suggestK = SUGGEST_CORPUS_MAX_CHARS / 1000;

test("activity-window and todo-engine expose the shipped corpus/window constants", () => {
  assert.equal(typeof DEFAULT_WINDOW_DAYS, "number");
  assert.equal(typeof DEFAULT_MAX_FILES, "number");
  assert.equal(typeof DEFAULT_MAX_PERIODS, "number");
  assert.equal(typeof SUGGEST_CORPUS_MAX_CHARS, "number");
  assert.equal(typeof EXTRACT_CORPUS_MAX, "number");
  assert.equal(typeof MAINTAIN_CORPUS_MAX, "number");
  assert.ok(EXTRACT_CORPUS_MAX >= MAINTAIN_CORPUS_MAX);
  assert.equal(EXTRACT_CORPUS_MAX, SUGGEST_CORPUS_MAX_CHARS);
});

test("AGENTS.md activity-window numbers match shipped constants", () => {
  const src = read("AGENTS.md");
  assert.match(src, new RegExp(`${DEFAULT_WINDOW_DAYS} 天`));
  assert.match(src, new RegExp(`${DEFAULT_MAX_FILES} 文件`));
  assert.match(src, new RegExp(`${DEFAULT_MAX_PERIODS} 周期`));
  assert.match(src, new RegExp(`suggest ${suggestK}K`));
  assert.match(src, new RegExp(`todo extract ${extractK}K`));
  assert.match(src, new RegExp(`maintain ${maintainK}K`));
});

test("Desktop DESIGN corpus budget matches todo-engine", () => {
  const src = read("topmind-desktop/DESIGN.md");
  assert.match(
    src,
    new RegExp(`extract ${extractK}K / maintain ${maintainK}K`),
  );
  assert.doesNotMatch(src, /extract 12K \/ maintain 8K/);
  assert.match(
    src,
    new RegExp(`${DEFAULT_WINDOW_DAYS} 天 / ${DEFAULT_MAX_FILES} 文件 / ${DEFAULT_MAX_PERIODS} 周期`),
  );
});

test("stream-first scheme states the same window and corpus budgets", () => {
  const src = read("docs/stream-first-optimization-scheme.md");
  assert.match(
    src,
    new RegExp(`${DEFAULT_WINDOW_DAYS} 天 / ${DEFAULT_MAX_FILES} 文件 / ${DEFAULT_MAX_PERIODS} 周期`),
  );
  assert.match(src, new RegExp(`suggest ${suggestK}K`));
  assert.match(src, new RegExp(`todo extract ${extractK}K`));
  assert.match(src, new RegExp(`maintain ${maintainK}K`));
});

test("suggest / todo / ops call activity-window defaults, not magic 21/30/16000", () => {
  for (const rel of ["lib/suggest-engine.mjs", "lib/ai-operation-engine.mjs"]) {
    const src = read(rel);
    assert.match(src, /SUGGEST_CORPUS_MAX_CHARS/, `${rel} must use SUGGEST_CORPUS_MAX_CHARS`);
    assert.doesNotMatch(src, /windowDays:\s*21/, `${rel} must not hardcode windowDays: 21`);
    assert.doesNotMatch(src, /maxFiles:\s*30/, `${rel} must not hardcode maxFiles: 30`);
    assert.doesNotMatch(src, /maxChars:\s*16000/, `${rel} must not hardcode maxChars: 16000`);
  }
  const todo = read("lib/todo-engine.mjs");
  assert.match(todo, /DEFAULT_WINDOW_DAYS/);
  assert.match(todo, /DEFAULT_MAX_FILES/);
  assert.doesNotMatch(todo, /windowDays:\s*21/);
  assert.doesNotMatch(todo, /maxFiles:\s*30/);
});

test("living docs describe 我的情况 as memory-plane browse, not a sixth concept", () => {
  const design = read("DESIGN.md");
  const reset = read("docs/ARCHITECTURE-RESET.md");
  const desktopDesign = read("topmind-desktop/DESIGN.md");
  const obsidianDesign = read("obsidian-plugin/DESIGN.md");
  assert.match(design, /记忆浏览/);
  assert.match(desktopDesign, /记忆浏览/);
  assert.match(obsidianDesign, /记忆浏览/);
  assert.match(reset, /记忆浏览/);
  assert.doesNotMatch(design, /(?<!不)是第六个用户概念/u);
});

test("optional 记账 is memory-plane satellite, not a sixth concept or ninth engine", () => {
  const design = read("DESIGN.md");
  const boundaries = read("PRODUCT-BOUNDARIES.md");
  const model = read("PROJECT-MODEL.md");
  const agents = read("AGENTS.md");
  const reset = read("docs/ARCHITECTURE-RESET.md");
  const tools = read("TOOLS.md");
  const desktopDesign = read("topmind-desktop/DESIGN.md");
  for (const [rel, src] of [
    ["DESIGN.md", design],
    ["PRODUCT-BOUNDARIES.md", boundaries],
    ["PROJECT-MODEL.md", model],
    ["AGENTS.md", agents],
    ["docs/ARCHITECTURE-RESET.md", reset],
    ["TOOLS.md", tools],
    ["topmind-desktop/DESIGN.md", desktopDesign],
  ]) {
    assert.match(src, /ledgers\//, `${rel} must name memory/ledgers`);
    assert.match(src, /ledger-engine|可选记账/, `${rel} must name optional 记账 / ledger-engine`);
  }
  const conceptTable = design.match(/## 1\. 用户概念硬上限[\s\S]*?(?=\n## 2\.)/);
  assert.ok(conceptTable, "DESIGN.md concept table");
  assert.doesNotMatch(conceptTable[0], /^\| \*\*记账\*\*/m);
  assert.match(design, /不是第六个用户概念/);
  assert.match(agents, /ledger-engine/);
  assert.match(agents, /不是第九引擎/);
  assert.match(agents, /contract · workspace-model · stream · memory · lifecycle · \*\*writeback/);
  assert.match(tools, /8 个 UTR 命令域/);
  assert.match(desktopDesign, /不是\*\* PrimaryNav|不是\*\*PrimaryNav|\*\*不是\*\* PrimaryNav/);
});

test("ADR index pairs list 2026-08-27 desktop log rotation", () => {
  const en = read("docs/README.md");
  const zh = read("docs/README.zh-CN.md");
  assert.match(en, /2026-08-27-desktop-log-rotation\.md/);
  assert.match(zh, /2026-08-27-desktop-log-rotation\.md/);
});

test("living DESIGN files do not copy surface version digits into headings", () => {
  for (const rel of [
    "DESIGN.md",
    "topmind-desktop/DESIGN.md",
    "obsidian-plugin/DESIGN.md",
    "README.md",
    "README.zh-CN.md",
    "AGENTS.md",
    "CLAUDE.md",
  ]) {
    const src = read(rel);
    assert.doesNotMatch(
      src,
      /### Desktop \d+\.\d+\.\d+/u,
      `${rel} must not stamp Desktop x.y.z in a heading`,
    );
    assert.doesNotMatch(
      src,
      /Status Bar Item · \d+\.\d+\.\d+/u,
      `${rel} must not stamp a surface version on the status-bar entry`,
    );
  }
});

test("living DESIGN/ARCHITECTURE do not present canvas SuggestEntryStrip as current chrome", () => {
  const design = read("topmind-desktop/DESIGN.md");
  const arch = read("topmind-desktop/ARCHITECTURE.md");
  const streamFirst = read("docs/stream-first-optimization-scheme.md");
  assert.match(design, /状态栏(?:建议)?计数 chip/);
  assert.doesNotMatch(design, /有 `items` 时画布顶 `SuggestEntryStrip`/);
  assert.doesNotMatch(design, /建议计数\*\*恰好两处\*\*：标题栏 💡 badge \+ 画布顶/);
  assert.doesNotMatch(arch, /EditorArea（SuggestEntryStrip/);
  assert.doesNotMatch(streamFirst, /画布顶 strip（空则隐藏）/);
  assert.doesNotMatch(streamFirst, /用户在 feed 附近一眼看见建议/);
  assert.match(arch, /PrimaryNav 文案与默认 selection 为 \*\*动态 · 收件箱 · 写出来 · 搜索\*\*/);
  assert.doesNotMatch(design, /AI 轨 `ActionBar` 仅为计数跳转/);
  assert.match(design, /AI 轨 `ActionBar` \*\*仅专注模式\*\*/);
});

test("living Desktop DESIGN UIX-403 matches Design System 3.0 tokens (not 2.1 leftover)", () => {
  const design = read("topmind-desktop/DESIGN.md");
  const tokens = read("topmind-desktop/src/styles/tokens.css");
  const dark = tokens.split(/\.dark\s*\{/)[1] || "";
  const sidebar = dark.match(/--color-sidebar:\s*([^;]+);/)?.[1]?.trim();
  const canvas = dark.match(/--color-background:\s*([^;]+);/)?.[1]?.trim();
  assert.ok(sidebar && canvas, "dark sidebar/canvas tokens");
  assert.match(design, new RegExp(sidebar.replace("#", "\\#")));
  assert.match(design, new RegExp(canvas.replace("#", "\\#")));
  assert.doesNotMatch(design, /#171715|#1e1e1c|#262624|#2e2e2b/);
  assert.doesNotMatch(design, /Typography\*\*：Inter/);
  assert.match(design, /--font-family-ui/);
  assert.doesNotMatch(design, /\| ⌘N \|[^\n]*快速捕获/);
  assert.doesNotMatch(design, /\| ⌘⇧N \|[^\n]*快速捕获/);
  const obsidian = read("obsidian-plugin/DESIGN.md");
  assert.doesNotMatch(obsidian, /橙=todo_extract/);
  assert.doesNotMatch(obsidian, /蓝=create_topic\/inbox_review\/topic_classify/);
  assert.match(obsidian, /inbox_organize/);
});
