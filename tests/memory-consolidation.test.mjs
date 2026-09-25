/**
 * memory-consolidation — retire/update profile facts (confirm-gated lifecycle)
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const engineRoot = path.resolve(__dirname, "..");
const memoryEngine = await import(
  pathToFileURL(path.join(engineRoot, "lib", "memory-engine.mjs")).href
);
const { retireProfileEntry, updateProfileEntry, readProfileActiveBody, appendTopicEntry, writePeriodDigest, appendProfileEntry, resolveProfileSectionTitle } = memoryEngine;

const suggestEngine = await import(
  pathToFileURL(path.join(engineRoot, "lib", "suggest-engine.mjs")).href
);

const aiOps = await import(
  pathToFileURL(path.join(engineRoot, "lib", "ai-operation-engine.mjs")).href
);

let tmpDir;

const PROFILE = `---
title: 我的情况
source_type: user-original
memory_layer: global
---

# 我的情况

## 偏好

- 偏好简洁文案

## 进行中的事

- （2026-07-01）推进 topmind 记忆机制设计
- （2026-07-20）学习 Rust 异步运行时

## 当前目标

- 完成记忆整合方案
`;

function setupWorkspace() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topmind-memcons-test-"));
  fs.writeFileSync(
    path.join(tmpDir, "topmind.yaml"),
    `schema_version: 4\ncategories:\n  - directory: 10-动态\n    role: loose-stream\nstream:\n  packing: weekly\n`,
    "utf8",
  );
  fs.mkdirSync(path.join(tmpDir, "memory"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "memory", "profile.md"), PROFILE, "utf8");
  return tmpDir;
}

function cleanup() {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function readProfile() {
  return fs.readFileSync(path.join(tmpDir, "memory", "profile.md"), "utf8");
}

describe("retireProfileEntry", () => {
  beforeEach(setupWorkspace);
  afterEach(cleanup);

  it("moves a matched fact to the history section with a retirement date", () => {
    const result = retireProfileEntry({
      workspaceRoot: tmpDir,
      match: "推进 topmind 记忆机制设计",
    });
    assert.equal(result.operation, "update");
    assert.equal(result.wroteFiles, true);

    const body = readProfile();
    assert.ok(!body.includes("（2026-07-01）推进 topmind 记忆机制设计"), "fact removed from active section");
    assert.match(body, /^## 历史记录$/mu);
    assert.match(body, /^- （\d{4}-\d{2}-\d{2} 归档）推进 topmind 记忆机制设计$/mu);
    // Other facts untouched
    assert.ok(body.includes("学习 Rust 异步运行时"));
    assert.ok(body.includes("偏好简洁文案"));
    assert.ok(body.includes("完成记忆整合方案"));
  });

  it("is idempotent-ish: retiring an already-retired fact skips with already-retired", () => {
    retireProfileEntry({ workspaceRoot: tmpDir, match: "推进 topmind 记忆机制设计" });
    const second = retireProfileEntry({ workspaceRoot: tmpDir, match: "推进 topmind 记忆机制设计" });
    assert.equal(second.operation, "skip");
    assert.equal(second.reason, "already-retired");
    assert.equal(second.wroteFiles, false);
  });

  it("skips with no-matching-fact when the fact is absent", () => {
    const result = retireProfileEntry({ workspaceRoot: tmpDir, match: "不存在的条目内容" });
    assert.equal(result.operation, "skip");
    assert.equal(result.reason, "no-matching-fact");
  });

  it("skips with no-profile when profile.md is missing", () => {
    fs.rmSync(path.join(tmpDir, "memory", "profile.md"));
    const result = retireProfileEntry({ workspaceRoot: tmpDir, match: "任意" });
    assert.equal(result.operation, "skip");
    assert.equal(result.reason, "no-profile");
  });

  it("never touches frontmatter or other sections when section filter is set", () => {
    const result = retireProfileEntry({
      workspaceRoot: tmpDir,
      match: "偏好简洁文案",
      section: "偏好",
    });
    assert.equal(result.operation, "update");
    const body = readProfile();
    assert.match(body, /^memory_layer: global$/mu);
    assert.ok(!/## 偏好[\s\S]*?偏好简洁文案/.test(body.split("## 历史记录")[0]));
    assert.match(body, /归档）偏好简洁文案/u);
  });

  it("never matches a section heading line as a fact (structure stays intact)", () => {
    // Long heading text is a ≥6-char substring match candidate for itself —
    // retiring it must not splice the heading into the history section.
    const profile = readProfile()
      .replace("## 当前目标", "## 当前目标与阶段性交付计划");
    fs.writeFileSync(path.join(tmpDir, "memory", "profile.md"), profile, "utf8");
    const result = retireProfileEntry({
      workspaceRoot: tmpDir,
      match: "当前目标与阶段性交付计划",
    });
    assert.equal(result.operation, "skip");
    assert.equal(result.reason, "no-matching-fact");
    assert.ok(readProfile().includes("## 当前目标与阶段性交付计划"), "heading preserved");
  });

  it("rejects retiring directly from the history section", () => {
    retireProfileEntry({ workspaceRoot: tmpDir, match: "推进 topmind 记忆机制设计" });
    const again = retireProfileEntry({
      workspaceRoot: tmpDir,
      match: "推进 topmind 记忆机制设计",
      section: "历史记录",
    });
    assert.equal(again.operation, "skip");
    assert.equal(again.reason, "invalid-section");
    // No double date markers in history
    assert.doesNotMatch(readProfile(), /归档）\d{4}-\d{2}-\d{2} 归档/u);
  });

  it("normalizes CRLF profiles and keeps line endings consistent", () => {
    fs.writeFileSync(
      path.join(tmpDir, "memory", "profile.md"),
      PROFILE.replace(/\n/gu, "\r\n"),
      "utf8",
    );
    const result = retireProfileEntry({ workspaceRoot: tmpDir, match: "学习 Rust 异步运行时" });
    assert.equal(result.operation, "update");
    const body = readProfile();
    assert.doesNotMatch(body, /\r/u, "CRLF normalized to LF on write");
    assert.match(body, /归档）学习 Rust 异步运行时/u);
  });

  it("readProfileActiveBody collapses the history section for AI prompts", () => {
    retireProfileEntry({ workspaceRoot: tmpDir, match: "推进 topmind 记忆机制设计" });
    const active = readProfileActiveBody(tmpDir);
    assert.ok(!active.includes("推进 topmind 记忆机制设计"), "retired fact not in AI context");
    assert.match(active, /1 条已归档条目/u);
    assert.ok(active.includes("偏好简洁文案"), "active facts still present");
    // No history section → body unchanged
    fs.writeFileSync(path.join(tmpDir, "memory", "profile.md"), PROFILE, "utf8");
    assert.equal(readProfileActiveBody(tmpDir), PROFILE);
  });
});

describe("updateProfileEntry", () => {
  beforeEach(setupWorkspace);
  afterEach(cleanup);

  it("replaces the matched fact with dated corrected content", () => {
    const result = updateProfileEntry({
      workspaceRoot: tmpDir,
      match: "学习 Rust 异步运行时",
      content: "已转向学习 Rust 嵌入式开发",
    });
    assert.equal(result.operation, "update");
    const body = readProfile();
    // Active section holds the new fact; superseded wording is archived (not lost).
    const active = body.split(/##\s*历史记录/u)[0];
    assert.ok(!active.includes("学习 Rust 异步运行时"));
    assert.match(active, /^- （\d{4}-\d{2}-\d{2}）已转向学习 Rust 嵌入式开发/mu);
    assert.match(body, /归档）学习 Rust 异步运行时/u);
  });

  it("dedupes when the corrected fact already exists in the same section", () => {
    const result = updateProfileEntry({
      workspaceRoot: tmpDir,
      match: "学习 Rust 异步运行时",
      content: "推进 topmind 记忆机制设计",
    });
    assert.equal(result.operation, "skip");
    assert.equal(result.reason, "duplicate-fact");
  });

  it("rejects polluted replacement content", () => {
    const result = updateProfileEntry({
      workspaceRoot: tmpDir,
      match: "学习 Rust 异步运行时",
      content: "TODO: generate summary",
    });
    assert.equal(result.operation, "skip");
    assert.equal(result.reason, "placeholder-or-polluted");
  });

  it("skips with no-matching-fact when the fact is absent", () => {
    const result = updateProfileEntry({ workspaceRoot: tmpDir, match: "不存在的条目", content: "新事实" });
    assert.equal(result.operation, "skip");
    assert.equal(result.reason, "no-matching-fact");
  });

  it("never updates an already-archived fact in place (audit record preserved)", () => {
    retireProfileEntry({ workspaceRoot: tmpDir, match: "推进 topmind 记忆机制设计" });
    const result = updateProfileEntry({
      workspaceRoot: tmpDir,
      match: "推进 topmind 记忆机制设计",
      content: "记忆机制设计（改写）",
    });
    assert.equal(result.operation, "skip");
    assert.equal(result.reason, "no-matching-fact");
    assert.match(readProfile(), /归档）推进 topmind 记忆机制设计/u);
  });

  it("rejects section=历史记录 explicitly", () => {
    const result = updateProfileEntry({
      workspaceRoot: tmpDir,
      match: "推进 topmind 记忆机制设计",
      content: "改写内容",
      section: "历史记录",
    });
    assert.equal(result.operation, "skip");
    assert.equal(result.reason, "invalid-section");
  });
});

describe("appendProfileEntry live-section dedupe", () => {
  beforeEach(setupWorkspace);
  afterEach(cleanup);

  it("AI append in graded confirm mode lands immediately", () => {
    const result = appendProfileEntry({
      workspaceRoot: tmpDir,
      entry: { section: "进行中的事", content: "- （2026-09-13）分级确认下内容编辑直接落盘" },
      actor: "ai",
      confirmed: false,
      writebackModeOverride: "confirm",
    });
    assert.equal(result.pending || result.needsConfirm, false);
    assert.equal(result.wroteFiles, true);
    assert.match(readProfile(), /分级确认下内容编辑直接落盘/);
  });

  it("a second append of the same fact does not create a live duplicate in another section", () => {
    const first = appendProfileEntry({
      workspaceRoot: tmpDir,
      entry: { section: "进行中的事", content: "- 同一稳定事实只应出现一次" },
    });
    assert.equal(first.operation, "update");
    const second = appendProfileEntry({
      workspaceRoot: tmpDir,
      entry: { section: "当前目标", content: "- 同一稳定事实只应出现一次" },
    });
    assert.equal(second.operation, "skip");
    assert.equal(second.reason, "duplicate-fact");
    const hits = (readProfile().match(/同一稳定事实只应出现一次/g) || []).length;
    assert.equal(hits, 1);
  });

  it("re-append of a retired fact is allowed (re-activation, not a live duplicate)", () => {
    appendProfileEntry({
      workspaceRoot: tmpDir,
      entry: { section: "进行中的事", content: "- 可重新激活的事实" },
    });
    retireProfileEntry({ workspaceRoot: tmpDir, match: "可重新激活的事实" });
    const again = appendProfileEntry({
      workspaceRoot: tmpDir,
      entry: { section: "进行中的事", content: "- 可重新激活的事实" },
    });
    assert.equal(again.operation, "update");
    const live = readProfile().split("## 历史记录")[0];
    assert.ok(live.includes("可重新激活的事实"));
  });

  it("near-duplicate append fuses into the existing live fact (keeps newest wording)", () => {
    appendProfileEntry({
      workspaceRoot: tmpDir,
      entry: { section: "进行中的事", content: "- 推进 topmind 记忆机制设计" },
    });
    const fused = appendProfileEntry({
      workspaceRoot: tmpDir,
      entry: { section: "进行中的事", content: "- 推进 topmind 记忆机制设计联调" },
    });
    // Not a second live line — the near-dup became an in-place update.
    assert.notEqual(fused.reason, "duplicate-fact");
    const live = readProfile().split(/## 历史记录|## History/u)[0];
    const liveHits = (live.match(/推进 topmind 记忆机制设计/gu) || []).length;
    assert.equal(liveHits, 1, `expected one live line, got ${liveHits}:\n${live}`);
    assert.match(live, /推进 topmind 记忆机制设计联调/u);
  });
});

describe("update/retire fuzzy match diagnostics", () => {
  beforeEach(setupWorkspace);
  afterEach(cleanup);

  it("updateProfileEntry reports the fact it actually rewrote on a paraphrase match", async () => {
    appendProfileEntry({
      workspaceRoot: tmpDir,
      entry: { section: "进行中的事", content: "- 推进 topmind 记忆机制设计" },
    });
    const result = updateProfileEntry({
      workspaceRoot: tmpDir,
      // Paraphrase, not the exact bullet
      match: "topmind 记忆机制设计推进",
      content: "推进 topmind 记忆机制设计联调",
    });
    assert.equal(result.wroteFiles, true, JSON.stringify(result));
    assert.equal(result.matchExact, false);
    assert.match(String(result.matchedText || ""), /推进 topmind 记忆机制设计/u);
    assert.ok(typeof result.matchScore === "number" && result.matchScore >= 0.72, String(result.matchScore));
  });

  it("irregular Latin folds (preference/prefers) share a key", async () => {
    const { factSimilarity } = await import("../lib/memory-engine.mjs");
    assert.ok(factSimilarity("preference dark mode", "prefers dark mode") >= 0.72);
    assert.ok(factSimilarity("item 1 detail complete phrase", "item 2 detail complete phrase") < 0.72);
  });

  it("English inflection paraphrase still hits update (suffix fold)", async () => {
    appendProfileEntry({
      workspaceRoot: tmpDir,
      entry: { section: "In progress", content: "- learn Rust async runtime" },
    });
    const result = updateProfileEntry({
      workspaceRoot: tmpDir,
      match: "Rust async learning",
      content: "learn Rust async runtime and embedded",
    });
    assert.equal(result.wroteFiles, true, JSON.stringify(result));
    assert.equal(result.matchExact, false);
    assert.ok(Number(result.matchScore) >= 0.72, String(result.matchScore));
  });

  it("exact update is marked matchExact", async () => {
    appendProfileEntry({
      workspaceRoot: tmpDir,
      entry: { section: "进行中的事", content: "- 精确匹配条目" },
    });
    const result = updateProfileEntry({
      workspaceRoot: tmpDir,
      match: "精确匹配条目",
      content: "精确匹配条目（已更新）",
    });
    assert.equal(result.matchExact, true);
  });
});

describe("consolidation helpers (fuse / history compact / topic dedupe)", () => {
  beforeEach(setupWorkspace);
  afterEach(cleanup);

  it("findIntraProfileNearDups reports live near-dup pairs", async () => {
    const { findIntraProfileNearDups } = await import("../lib/memory-engine.mjs");
    // Seed two near-dup live lines directly (pre-fusion backlog the organizer
    // must still be able to find and fold).
    fs.mkdirSync(path.join(tmpDir, "memory"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "memory", "profile.md"),
      `---
title: 我的情况
memory_layer: global
---

# 我的情况

## 进行中的事

- （2026-08-01）学习 Rust 异步运行时
- （2026-08-12）学习 Rust 异步运行时进阶

## 偏好

- （2026-08-01）喜欢安静的工作环境
`,
      "utf8",
    );
    const pairs = findIntraProfileNearDups(tmpDir, { threshold: 0.72 });
    assert.equal(pairs.length, 1, `expected 1 pair, got ${JSON.stringify(pairs)}`);
    assert.match(pairs[0].keep.text, /进阶/u);
    assert.match(pairs[0].merge.text, /学习 Rust 异步运行时$/u);
  });

  it("compactProfileHistory drops older near-dup archive rows, keeps newest", async () => {
    const { compactProfileHistory } = await import("../lib/memory-engine.mjs");
    appendProfileEntry({ workspaceRoot: tmpDir, entry: { section: "进行中的事", content: "- 旧版本事实：记忆机制设计中" } });
    retireProfileEntry({ workspaceRoot: tmpDir, match: "旧版本事实：记忆机制设计中" });
    appendProfileEntry({ workspaceRoot: tmpDir, entry: { section: "进行中的事", content: "- 旧版本事实：记忆机制设计中（更早）" } });
    retireProfileEntry({ workspaceRoot: tmpDir, match: "旧版本事实：记忆机制设计中（更早）" });
    const before = (readProfile().match(/旧版本事实/gu) || []).length;
    assert.equal(before, 2);
    const result = compactProfileHistory({ workspaceRoot: tmpDir, confirmed: true });
    assert.equal(result.wroteFiles, true);
    const after = (readProfile().match(/旧版本事实/gu) || []).length;
    assert.equal(after, 1, `history should compact to 1, got ${after}:\n${readProfile()}`);
  });

  it("appendTopicEntry refuses to stack a near-duplicate topic fact", async () => {
    const first = appendTopicEntry({
      workspaceRoot: tmpDir,
      slug: "rust",
      entry: { content: "- 专题稳定记忆：Rust 所有权模型" },
    });
    assert.equal(first.wroteFiles, true);
    const second = appendTopicEntry({
      workspaceRoot: tmpDir,
      slug: "rust",
      entry: { content: "- 专题稳定记忆：Rust 所有权模型进阶" },
    });
    assert.equal(second.wroteFiles, false);
    assert.ok(
      second.reason === "duplicate-fact" || second.reason === "near-duplicate-fact",
      `unexpected reason ${second.reason}`,
    );
  });
});

describe("profile section locale honesty", () => {
  beforeEach(setupWorkspace);
  afterEach(cleanup);

  it("resolveProfileSectionTitle prefers an existing In progress heading", () => {
    const en = `# My situation\n\n## In progress\n\n- a fact\n`;
    assert.equal(resolveProfileSectionTitle(en, "inProgress", "zh"), "In progress");
    assert.equal(resolveProfileSectionTitle("", "inProgress", "en"), "In progress");
    assert.equal(resolveProfileSectionTitle("", "history", "en"), "History");
  });

  it("appendProfileEntry does not fork 进行中的事 onto an English profile", () => {
    fs.writeFileSync(
      path.join(tmpDir, "memory", "profile.md"),
      `---
title: My situation
memory_layer: global
---

# My situation

## In progress

- existing fact
`,
      "utf8",
    );
    const result = appendProfileEntry({
      workspaceRoot: tmpDir,
      entry: { content: "a newly confirmed fact" },
      contract: { workspace: { locale: "en-US" } },
    });
    assert.equal(result.operation, "update");
    const body = readProfile();
    assert.ok(body.includes("## In progress"));
    assert.ok(!body.includes("## 进行中的事"), "must not create a second Chinese section");
    assert.ok(body.includes("a newly confirmed fact"));
  });

  it("readProfileActiveBody collapses an English History heading in English", () => {
    fs.writeFileSync(
      path.join(tmpDir, "memory", "profile.md"),
      `---
title: My situation
---

# My situation

## In progress

- still active

## History

- (2026-08-01 archived) old fact
`,
      "utf8",
    );
    const active = readProfileActiveBody(tmpDir, { locale: "en" });
    assert.ok(!active.includes("old fact"), "archived fact not in AI context");
    assert.match(active, /^## History$/mu);
    assert.match(active, /archived fact/u);
    assert.ok(active.includes("still active"));
  });

  it("retireProfileEntry on an English profile creates ## History not ## 历史记录", () => {
    fs.writeFileSync(
      path.join(tmpDir, "memory", "profile.md"),
      `---
title: My situation
---

# My situation

## In progress

- wrap up the memory design
`,
      "utf8",
    );
    const result = retireProfileEntry({
      workspaceRoot: tmpDir,
      match: "wrap up the memory design",
      contract: { workspace: { locale: "en-US" } },
    });
    assert.equal(result.operation, "update");
    const body = readProfile();
    assert.match(body, /^## History$/mu);
    assert.ok(!body.includes("## 历史记录"));
    // English profiles use the English archive marker (2026-09-17e M5).
    assert.match(body, /\(2026-\d{2}-\d{2} archived\)\s*wrap up the memory design/u);
  });
});

describe("memory identifier traversal safety", () => {
  beforeEach(setupWorkspace);
  afterEach(cleanup);

  it("appendTopicEntry rejects traversal slugs with a structured skip", () => {
    for (const slug of ["../profile", "a/b", "..\\profile", "."]) {
      const result = appendTopicEntry({
        workspaceRoot: tmpDir,
        slug,
        entry: { content: "测试内容" },
      });
      assert.equal(result.operation, "skip", `slug ${slug}`);
      assert.equal(result.reason, "invalid-slug", `slug ${slug}`);
      assert.equal(result.wroteFiles, false);
    }
    assert.ok(!fs.existsSync(path.join(tmpDir, "memory", "profile.md.bak")));
  });

  it("writePeriodDigest rejects traversal period stems with a structured skip", () => {
    const result = writePeriodDigest({
      workspaceRoot: tmpDir,
      period: "foo/../../2026-fake",
      body: "足够长度的周期反思内容，用于测试。",
    });
    assert.equal(result.operation, "skip");
    assert.equal(result.reason, "invalid-period");
  });
});

describe("memory_organize retire candidates → applySuggestion", () => {
  beforeEach(setupWorkspace);
  afterEach(cleanup);

  it("converts AI retire quotes into confirm-gated retire_profile suggestions", async () => {
    fs.mkdirSync(path.join(tmpDir, "10-动态"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "10-动态", "2026-W32.md"),
      `# 2026-W32\n\n## 记录\n\n- 记忆机制设计已收尾并交付文档。\n- 本周开始整理旧画像条目。\n`,
      "utf8",
    );
    const aiProvider = {
      async generate() {
        return JSON.stringify({
          profile: [],
          periodic: "",
          retire: ["推进 topmind 记忆机制设计"],
        });
      },
    };
    const out = await aiOps.runOperation({
      id: "memory_organize",
      workspaceRoot: tmpDir,
      aiProvider,
      contract: null,
    });
    assert.ok(out.ok, `memory_organize should succeed: ${JSON.stringify(out)}`);
    const retireSuggestions = (out.suggestions || []).filter(
      (s) => s.payload?.action === "retire_profile",
    );
    assert.equal(retireSuggestions.length, 1);
    assert.equal(retireSuggestions[0].kind, "promote_memory");
    assert.equal(retireSuggestions[0].payload.match, "推进 topmind 记忆机制设计");
  });

  it("applySuggestion(retire_profile) moves the fact and returns promote evidence", async () => {
    const result = await suggestEngine.applySuggestion({
      workspaceRoot: tmpDir,
      suggestion: {
        id: "mem-retire-test",
        kind: "promote_memory",
        title: "归档「我的情况」旧条目",
        summary: "已完成/过期：推进 topmind 记忆机制设计",
        impact: "medium",
        payload: { action: "retire_profile", match: "推进 topmind 记忆机制设计" },
      },
    });
    assert.equal(result.operation, "promote");
    assert.equal(result.wroteFiles, true);
    const body = readProfile();
    assert.match(body, /^## 历史记录$/mu);
    assert.match(body, /归档）推进 topmind 记忆机制设计/u);
    assert.ok(!body.includes("（2026-07-01）推进 topmind 记忆机制设计"));
  });

  it("applySuggestion(retire_profile) skips cleanly when the fact is already retired", async () => {
    const suggestion = {
      id: "mem-retire-test-2",
      kind: "promote_memory",
      title: "归档「我的情况」旧条目",
      summary: "已完成/过期：推进 topmind 记忆机制设计",
      impact: "medium",
      payload: { action: "retire_profile", match: "推进 topmind 记忆机制设计" },
    };
    await suggestEngine.applySuggestion({ workspaceRoot: tmpDir, suggestion });
    const second = await suggestEngine.applySuggestion({ workspaceRoot: tmpDir, suggestion });
    assert.equal(second.operation, "skip");
    assert.equal(second.wroteFiles, false);
    assert.equal(second.ok, true);
    assert.equal(second.reason, "already-retired");
  });

  it("English UI locale emits English titles and writes to existing In progress", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "memory", "profile.md"),
      `---
title: My situation
memory_layer: global
---

# My situation

## Preferences

- prefers concise copy

## In progress

- learning Rust async runtime
`,
      "utf8",
    );
    fs.mkdirSync(path.join(tmpDir, "10-动态"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "10-动态", "2026-W32.md"),
      `# 2026-W32\n\n## Notes\n\n- Rust work wrapped up. New preference: dark mode.\n`,
      "utf8",
    );
    const aiProvider = {
      async generate() {
        return JSON.stringify({
          profile: ["prefers dark mode"],
          periodic: "",
          retire: ["learning Rust async runtime"],
        });
      },
    };
    const out = await aiOps.runOperation({
      id: "memory_organize",
      workspaceRoot: tmpDir,
      aiProvider,
      options: { localeOverride: "en-US" },
    });
    assert.ok(out.ok, `memory_organize should succeed: ${JSON.stringify(out)}`);
    const append = (out.suggestions || []).filter((s) => s.payload?.action === "append_profile");
    const retire = (out.suggestions || []).filter((s) => s.payload?.action === "retire_profile");
    assert.equal(append.length, 1);
    assert.equal(append[0].title, "Write to My profile");
    assert.equal(append[0].payload.section, "In progress");
    assert.equal(append[0].payload.entry.section, "In progress");
    assert.equal(retire.length, 1);
    assert.equal(retire[0].title, "Archive a stale My profile fact");
    assert.match(retire[0].summary, /^Finished or stale:/u);
    assert.match(out.summary, /memory suggestion/i);
  });

  it("converts AI update objects into confirm-gated update_profile suggestions", async () => {
    fs.mkdirSync(path.join(tmpDir, "10-动态"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "10-动态", "2026-W32.md"),
      `# 2026-W32\n\n## 记录\n\n- 学习 Rust 已转向嵌入式，不再做异步运行时。\n`,
      "utf8",
    );
    const aiProvider = {
      async generate() {
        return JSON.stringify({
          profile: [],
          periodic: "",
          retire: [],
          update: [{ match: "学习 Rust 异步运行时", content: "已转向学习 Rust 嵌入式开发" }],
        });
      },
    };
    const out = await aiOps.runOperation({
      id: "memory_organize",
      workspaceRoot: tmpDir,
      aiProvider,
      contract: null,
    });
    assert.ok(out.ok, `memory_organize should succeed: ${JSON.stringify(out)}`);
    const updateSuggestions = (out.suggestions || []).filter(
      (s) => s.payload?.action === "update_profile",
    );
    assert.equal(updateSuggestions.length, 1);
    assert.equal(updateSuggestions[0].kind, "promote_memory");
    assert.equal(updateSuggestions[0].payload.match, "学习 Rust 异步运行时");
    assert.equal(updateSuggestions[0].payload.content, "已转向学习 Rust 嵌入式开发");
  });

  it("near-duplicate profile candidates fuse into update, never a second live line", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "memory", "profile.md"),
      `---
title: 我的情况
memory_layer: global
---

# 我的情况

## 进行中的事

- （2026-08-01）推进 topmind 记忆机制设计
`,
      "utf8",
    );
    fs.mkdirSync(path.join(tmpDir, "10-动态"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "10-动态", "2026-W32.md"),
      `# 2026-W32\n\n## 记录\n\n- 记忆机制设计进入联调阶段。\n`,
      "utf8",
    );
    const aiProvider = {
      async generate() {
        return JSON.stringify({
          // Semantically close to the live fact — must become update/merge.
          profile: [{ text: "推进 topmind 记忆机制设计联调", section: "inProgress" }],
          periodic: "",
          retire: [],
          update: [],
        });
      },
    };
    const out = await aiOps.runOperation({
      id: "memory_organize",
      workspaceRoot: tmpDir,
      aiProvider,
      contract: null,
    });
    assert.ok(out.ok, `memory_organize should succeed: ${JSON.stringify(out)}`);
    const appends = (out.suggestions || []).filter((s) => s.payload?.action === "append_profile");
    const merges = (out.suggestions || []).filter((s) => s.payload?.action === "update_profile");
    assert.equal(appends.length, 0, `expected no append for near-dup, got ${JSON.stringify(appends)}`);
    assert.equal(merges.length, 1, `expected one merge/update, got ${JSON.stringify(merges)}`);
    assert.match(merges[0].payload.match, /推进 topmind 记忆机制设计/u);
    assert.match(merges[0].payload.content, /推进 topmind 记忆机制设计联调/u);
  });

  it("applySuggestion(update_profile) replaces the live line in place", async () => {
    const result = await suggestEngine.applySuggestion({
      workspaceRoot: tmpDir,
      suggestion: {
        id: "mem-update-test",
        kind: "promote_memory",
        title: "更新「我的情况」条目",
        summary: "已变更：已转向学习 Rust 嵌入式开发",
        impact: "high",
        payload: {
          action: "update_profile",
          match: "学习 Rust 异步运行时",
          content: "已转向学习 Rust 嵌入式开发",
        },
      },
    });
    assert.equal(result.operation, "promote");
    assert.equal(result.wroteFiles, true);
    const body = readProfile();
    const active = body.split(/##\s*历史记录/u)[0];
    assert.ok(!active.includes("学习 Rust 异步运行时"));
    assert.match(body, /已转向学习 Rust 嵌入式开发/u);
    // Superseded wording is archived, not deleted.
    assert.match(body, /归档）学习 Rust 异步运行时/u);
    const liveHits = (active.match(/已转向学习 Rust 嵌入式开发/g) || []).length;
    assert.equal(liveHits, 1);
  });

  it("applySuggestion(retire_profile) rejects polluted match text", async () => {
    const result = await suggestEngine.applySuggestion({
      workspaceRoot: tmpDir,
      suggestion: {
        id: "mem-retire-polluted",
        kind: "promote_memory",
        title: "归档「我的情况」旧条目",
        summary: "x",
        impact: "medium",
        payload: { action: "retire_profile", match: "TODO: generate summary" },
      },
    });
    assert.equal(result.operation, "skip");
    assert.equal(result.reason, "placeholder-or-polluted");
  });
});
