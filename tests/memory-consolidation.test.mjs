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
    assert.ok(!body.includes("学习 Rust 异步运行时"));
    assert.match(body, /^- （\d{4}-\d{2}-\d{2}）已转向学习 Rust 嵌入式开发$/mu);
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
    assert.match(body, /归档）wrap up the memory design/u);
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
