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
  assert.doesNotMatch(design, /第六用户概念/);
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
  assert.match(arch, /PrimaryNav 文案与默认 selection 为 \*\*动态 · 收件箱 · 写出来 · 搜索\*\*/);
  assert.doesNotMatch(design, /AI 轨 `ActionBar` 仅为计数跳转/);
  assert.match(design, /AI 轨 `ActionBar` \*\*仅专注模式\*\*/);
});
