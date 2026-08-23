/**
 * Activity window — shared AI organize scope (stream-first Wave S1).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  resolveActivityWindow,
  buildActivityCorpus,
  parseAppendMarkers,
  appendToStreamEntry,
  formatAppendBlock,
  isPeriodNoteFileName,
  isSafePeriodStem,
  periodStemFromFileName,
  periodStemFromCandidate,
  classifyActivityPath,
  periodItemsFromWindow,
  SUGGEST_CORPUS_MAX_CHARS,
  DEFAULT_WINDOW_DAYS,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_PERIODS,
} from "../lib/activity-window.mjs";

import { fileURLToPath } from "node:url";

const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function mkWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tm-activity-"));
  fs.mkdirSync(path.join(root, "10-动态"), { recursive: true });
  fs.mkdirSync(path.join(root, "20-专题"), { recursive: true });
  fs.mkdirSync(path.join(root, "memory"), { recursive: true });
  fs.mkdirSync(path.join(root, "00-收件箱"), { recursive: true });
  fs.mkdirSync(path.join(root, "88-输出"), { recursive: true });
  fs.mkdirSync(path.join(root, "99-归档"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "topmind.yaml"),
    `schema_version: 4
workspace:
  locale: zh-CN
categories:
  - directory: 00-收件箱
    role: buffer
  - directory: 10-动态
    role: loose-stream
    specialBehavior: flat-default
  - directory: 20-专题
    role: deep-work
  - directory: 88-输出
    role: delivery
  - directory: 99-归档
    role: system
stream:
  packing: weekly
  append_heading: day
`,
    "utf8",
  );
  return root;
}

describe("activity-window helpers", () => {
  it("classifies period / memory / topic paths", () => {
    assert.equal(isPeriodNoteFileName("2026-W31.md"), true);
    assert.equal(isPeriodNoteFileName("2026-08-03.md"), true);
    assert.equal(isPeriodNoteFileName("notes.md"), false);
    assert.equal(classifyActivityPath("10-动态/2026-W31.md"), "period");
    assert.equal(classifyActivityPath("memory/profile.md"), "memory");
    assert.equal(classifyActivityPath("70-记忆/me.md", "70-记忆"), "memory");
    assert.equal(classifyActivityPath("00-收件箱/x.md", "70-记忆"), "note");
    assert.equal(classifyActivityPath("20-专题/2026-foo/topic.md"), "topic");
    assert.equal(classifyActivityPath("20-专题/2026-foo/note.md"), "note");
  });

  it("resolves a period stem from filename/path/candidate and rejects fallbacks", () => {
    assert.equal(isSafePeriodStem("2026-W26"), true);
    assert.equal(isSafePeriodStem("2026-08-03"), true);
    assert.equal(isSafePeriodStem("undefined"), false);
    assert.equal(isSafePeriodStem("period"), false);
    assert.equal(isSafePeriodStem("近期活动"), false);
    assert.equal(isSafePeriodStem("Recent Activity"), false);
    assert.equal(isSafePeriodStem("10-动态/2026/2026-W26.md"), false);
    assert.equal(periodStemFromFileName("10-动态/2026/2026-W26.md"), "2026-W26");
    assert.equal(periodStemFromFileName("2026-W26.md"), "2026-W26");
    assert.equal(periodStemFromCandidate({ path: "/ws/10-动态/2026/2026-W20.md", periodsOld: 5 }), "2026-W20");
    assert.equal(periodStemFromCandidate({ period: "2026-W30" }), "2026-W30");
    assert.equal(periodStemFromCandidate({ path: "/tmp/notes.md", periodsOld: 4 }), null);
    assert.equal(periodStemFromCandidate("undefined"), null);
    assert.equal(periodStemFromCandidate("近期活动"), null);
  });

  it("parses append markers including parent path", () => {
    const md = `
## 记录
- hello
<!-- topmind:append parent="20-专题/2026-old/note.md" heading="背景" at="2026-08-03T01:00:00.000Z" -->
#### 续 · 2026-08-03
more
<!-- topmind:append heading="仅同文件" at="2026-08-03T02:00:00.000Z" -->
`;
    const markers = parseAppendMarkers(md);
    assert.equal(markers.length, 2);
    assert.equal(markers[0].parentRel, "20-专题/2026-old/note.md");
    assert.equal(markers[0].heading, "背景");
    assert.equal(markers[1].parentRel, undefined);
    assert.equal(markers[1].heading, "仅同文件");
  });

  it("appendToStreamEntry inserts after matching heading section", () => {
    const body = `# 2026-W31 动态

## 进行中

## 记录

## 07-22 周二
- 10:00 原始条目 A

## 07-23 周三
- 11:00 另一天
`;
    const next = appendToStreamEntry(body, {
      heading: "07-22 周二",
      content: "补充进度：方案已评审",
      date: new Date("2026-08-03T08:30:00"),
    });
    assert.match(next, /topmind:append/u);
    assert.match(next, /补充进度：方案已评审/u);
    // append sits before next day section
    const iAppend = next.indexOf("补充进度");
    const iNextDay = next.indexOf("## 07-23");
    assert.ok(iAppend > 0 && iNextDay > iAppend, "append should be before next heading");
    assert.match(formatAppendBlock({ content: "x", heading: "h" }), /topmind:append/u);
  });
});

describe("resolveActivityWindow", () => {
  /** @type {string} */
  let root;

  before(() => {
    root = mkWorkspace();
    const period = path.join(root, "10-动态", "2026-W31.md");
    fs.writeFileSync(
      period,
      `---\ntitle: 2026-W31\n---\n\n# 2026-W31\n\n## 记录\n\n- 本周写了活动窗口\n`,
      "utf8",
    );
    // Older period still listed as recent_period when among maxPeriods
    fs.writeFileSync(
      path.join(root, "10-动态", "2026-W30.md"),
      `# 2026-W30\n\n- 上周内容够长够长够长够长\n`,
      "utf8",
    );

    // Old topic note, then touch mtime into window
    const topicDir = path.join(root, "20-专题", "2026-长期主题");
    fs.mkdirSync(topicDir, { recursive: true });
    const oldNote = path.join(topicDir, "deep-note.md");
    fs.writeFileSync(oldNote, `# Deep\n\n## 背景\n\n很久以前的文章正文，足够长。\n`, "utf8");
    const recent = Date.now() - 3600_000;
    fs.utimesSync(oldNote, new Date(recent), new Date(recent));

    // Period note with append pointing at parent → parent must enter window even if old mtime
    const ancient = path.join(topicDir, "ancient.md");
    fs.writeFileSync(ancient, `# Ancient\n\n原始知识全文，需要整包进入整理范围。\n`, "utf8");
    fs.utimesSync(ancient, new Date("2020-01-01"), new Date("2020-01-01"));

    const withAnchor = path.join(root, "10-动态", "2026-W29.md");
    fs.writeFileSync(
      withAnchor,
      `# W29\n\n- note\n<!-- topmind:append parent="20-专题/2026-长期主题/ancient.md" heading="原始" at="2026-08-01T00:00:00.000Z" -->\n#### 续\n\n评论增补\n`,
      "utf8",
    );
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("includes recent period notes and mtime-touched notes", () => {
    const win = resolveActivityWindow({
      workspaceRoot: root,
      engineRoot,
      options: { windowDays: 14, maxFiles: 20, maxPeriods: 4, minContentLength: 10 },
    });
    const rels = win.items.map((i) => i.relPath);
    assert.ok(rels.some((r) => r.includes("2026-W31")), `periods missing: ${rels.join(",")}`);
    assert.ok(
      rels.some((r) => r.includes("deep-note.md")),
      `mtime note missing: ${rels.join(",")}`,
    );
    assert.ok(periodItemsFromWindow(win).length >= 1);
  });

  it("pulls reply_parent from append markers even when parent mtime is ancient", () => {
    const win = resolveActivityWindow({
      workspaceRoot: root,
      engineRoot,
      options: { windowDays: 14, maxFiles: 30, maxPeriods: 4 },
    });
    const parent = win.items.find((i) => i.relPath.includes("ancient.md"));
    assert.ok(parent, `parent not in window: ${win.items.map((i) => i.relPath).join(", ")}`);
    assert.equal(parent.reason, "reply_parent");
    assert.match(parent.content || "", /原始知识全文/u);
  });

  it("buildActivityCorpus concatenates paths for LLM", () => {
    const win = resolveActivityWindow({
      workspaceRoot: root,
      engineRoot,
      options: { maxChars: 8000 },
    });
    const corpus = buildActivityCorpus(win, { maxChars: 4000 });
    assert.ok(corpus.length > 20);
    assert.match(corpus, /### /u);
  });

  it("resolveActivityWindow and buildActivityCorpus default to shipped caps", () => {
    const win = resolveActivityWindow({
      workspaceRoot: root,
      engineRoot,
    });
    assert.equal(win.meta.windowDays, DEFAULT_WINDOW_DAYS);
    assert.equal(win.meta.maxFiles, DEFAULT_MAX_FILES);
    assert.ok(win.items.length <= DEFAULT_MAX_FILES);
    assert.ok(periodItemsFromWindow(win).length <= DEFAULT_MAX_PERIODS);
    const corpus = buildActivityCorpus(win);
    assert.ok(corpus.length <= SUGGEST_CORPUS_MAX_CHARS);
  });

  it("does not treat 99-归档 as activity source", () => {
    fs.mkdirSync(path.join(root, "99-归档", "backups"), { recursive: true });
    fs.writeFileSync(path.join(root, "99-归档", "backups", "noise.md"), "# noise\n".repeat(20), "utf8");
    const win = resolveActivityWindow({
      workspaceRoot: root,
      engineRoot,
      options: { windowDays: 14 },
    });
    assert.ok(!win.items.some((i) => i.relPath.includes("99-归档")));
  });
});

describe("create_topic apply + append (shipped path)", () => {
  it("applySuggestion create_topic writes topic.md under content category", async () => {
    const { applySuggestion } = await import("../lib/suggest-engine.mjs");
    const ws = mkWorkspace();
    try {
      const result = await applySuggestion({
        workspaceRoot: ws,
        engineRoot,
        suggestion: {
          id: "t1",
          kind: "create_topic",
          title: "建议专题",
          summary: "test",
          impact: "high",
          payload: {
            category: "20-专题",
            name: "2026-活动窗口",
            title: "活动窗口",
            reason: "从动态涌现",
          },
        },
      });
      assert.equal(result.ok, true);
      const topicFile = path.join(ws, "20-专题", "2026-活动窗口", "topic.md");
      assert.ok(fs.existsSync(topicFile), "topic.md should exist under category");
      assert.ok(topicFile.startsWith(path.resolve(ws) + path.sep));
      const body = fs.readFileSync(topicFile, "utf8");
      assert.match(body, /活动窗口/u);
      assert.ok(!body.includes("memory/topics"));
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("rejects create_topic category with path traversal (..)", async () => {
    const { applySuggestion } = await import("../lib/suggest-engine.mjs");
    const { sanitizeTopicPlacement } = await import("../lib/workspace-model.mjs");
    const ws = mkWorkspace();
    const outside = path.join(ws, "..", `escape-probe-${Date.now()}`);
    try {
      await assert.rejects(
        () =>
          applySuggestion({
            workspaceRoot: ws,
            engineRoot,
            suggestion: {
              id: "evil",
              kind: "create_topic",
              title: "evil",
              summary: "x",
              impact: "high",
              payload: {
                category: "20-专题/../../OUT",
                name: "2026-escape",
                title: "escape",
              },
            },
          }),
        /path traversal|single directory|invalid category|escapes workspace|missing/i,
      );
      await assert.rejects(
        () =>
          applySuggestion({
            workspaceRoot: ws,
            engineRoot,
            suggestion: {
              id: "evil2",
              kind: "create_topic",
              title: "evil",
              summary: "x",
              impact: "high",
              payload: { category: "..", name: "2026-escape", title: "escape" },
            },
          }),
        /path traversal|invalid category|missing|absolute/i,
      );
      assert.throws(
        () =>
          sanitizeTopicPlacement({
            workspaceRoot: ws,
            category: "20-专题/../../OUT",
            name: "2026-x",
          }),
        /path traversal|single directory/,
      );
      // No file created outside workspace from failed apply
      assert.ok(!fs.existsSync(path.join(outside, "2026-escape", "topic.md")));
      // No escaped dir under parent of workspace from this probe name
      const parentLeak = path.join(path.dirname(ws), "OUT", "2026-escape", "topic.md");
      assert.ok(!fs.existsSync(parentLeak), `must not write outside: ${parentLeak}`);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("rejects non-workspace / missing category directories", async () => {
    const { applySuggestion } = await import("../lib/suggest-engine.mjs");
    const ws = mkWorkspace();
    try {
      await assert.rejects(
        () =>
          applySuggestion({
            workspaceRoot: ws,
            engineRoot,
            suggestion: {
              id: "missing-cat",
              kind: "create_topic",
              title: "x",
              summary: "x",
              impact: "high",
              payload: {
                category: "77-不存在的类",
                name: "2026-ghost",
                title: "ghost",
              },
            },
          }),
        /missing|invalid category|not in workspace/i,
      );
      assert.ok(!fs.existsSync(path.join(ws, "77-不存在的类")));
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("rejects reserved planes (memory / .topmind) for create_topic", async () => {
    const { sanitizeTopicPlacement, isReservedTopicCategory } = await import(
      "../lib/workspace-model.mjs"
    );
    const { applySuggestion } = await import("../lib/suggest-engine.mjs");
    const ws = mkWorkspace();
    try {
      assert.equal(isReservedTopicCategory("memory"), true);
      assert.equal(isReservedTopicCategory(".topmind"), true);
      assert.equal(isReservedTopicCategory("20-专题"), false);
      assert.throws(
        () =>
          sanitizeTopicPlacement({
            workspaceRoot: ws,
            category: "memory",
            name: "2026-leak",
            requireCategoryOnDisk: false,
          }),
        /reserved plane|invalid category/i,
      );
      await assert.rejects(
        () =>
          applySuggestion({
            workspaceRoot: ws,
            engineRoot,
            suggestion: {
              id: "mem-topic",
              kind: "create_topic",
              title: "bad",
              summary: "x",
              impact: "high",
              payload: {
                category: "memory",
                name: "2026-topics-leak",
                title: "leak",
              },
            },
          }),
        /reserved plane|invalid category|missing/i,
      );
      assert.ok(!fs.existsSync(path.join(ws, "memory", "2026-topics-leak", "topic.md")));
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("rejects system/buffer/delivery/loose-stream categories for create_topic apply", async () => {
    const {
      sanitizeTopicPlacement,
      isDisallowedTopicCategoryRole,
      TOPIC_DISALLOWED_ROLES,
      resolveCategoryRoleForTopic,
    } = await import("../lib/workspace-model.mjs");
    const { applySuggestion } = await import("../lib/suggest-engine.mjs");
    const ws = mkWorkspace();
    try {
      assert.ok(TOPIC_DISALLOWED_ROLES.includes("system"));
      assert.ok(TOPIC_DISALLOWED_ROLES.includes("buffer"));
      assert.ok(TOPIC_DISALLOWED_ROLES.includes("delivery"));
      assert.ok(TOPIC_DISALLOWED_ROLES.includes("loose-stream"));
      assert.equal(isDisallowedTopicCategoryRole("system"), true);
      assert.equal(isDisallowedTopicCategoryRole("deep-work"), false);

      // Role resolution from contract-backed workspace
      assert.equal(resolveCategoryRoleForTopic(ws, "99-归档", { engineRoot }), "system");
      assert.equal(resolveCategoryRoleForTopic(ws, "00-收件箱", { engineRoot }), "buffer");
      assert.equal(resolveCategoryRoleForTopic(ws, "88-输出", { engineRoot }), "delivery");
      assert.equal(resolveCategoryRoleForTopic(ws, "10-动态", { engineRoot }), "loose-stream");
      assert.equal(resolveCategoryRoleForTopic(ws, "20-专题", { engineRoot }), "deep-work");

      const blocked = [
        { category: "99-归档", role: "system" },
        { category: "00-收件箱", role: "buffer" },
        { category: "88-输出", role: "delivery" },
        { category: "10-动态", role: "loose-stream" },
      ];
      for (const { category, role } of blocked) {
        assert.throws(
          () =>
            sanitizeTopicPlacement({
              workspaceRoot: ws,
              category,
              name: "2026-blocked-topic",
              engineRoot,
            }),
          /role|cannot host content topics|reserved plane/i,
          `sanitize should reject ${category} (${role})`,
        );
        await assert.rejects(
          () =>
            applySuggestion({
              workspaceRoot: ws,
              engineRoot,
              suggestion: {
                id: `block-${role}`,
                kind: "create_topic",
                title: "blocked",
                summary: "x",
                impact: "high",
                payload: {
                  category,
                  name: "2026-blocked-topic",
                  title: "blocked",
                },
              },
            }),
          /role|cannot host content topics|reserved plane/i,
          `apply should reject ${category} (${role})`,
        );
        assert.ok(
          !fs.existsSync(path.join(ws, category, "2026-blocked-topic", "topic.md")),
          `must not write under ${category}`,
        );
      }

      // deep-work still allowed
      const ok = await applySuggestion({
        workspaceRoot: ws,
        engineRoot,
        suggestion: {
          id: "ok-deep",
          kind: "create_topic",
          title: "ok",
          summary: "x",
          impact: "high",
          payload: {
            category: "20-专题",
            name: "2026-allowed-topic",
            title: "allowed",
          },
        },
      });
      assert.equal(ok.ok, true);
      assert.equal(ok.targetPath, "20-专题/2026-allowed-topic/topic.md");
      assert.ok(fs.existsSync(path.join(ws, "20-专题", "2026-allowed-topic", "topic.md")));
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("topic_classify strips path segments and never emits traversal categories", async () => {
    const { runOperation } = await import("../lib/ai-operation-engine.mjs");
    const ws = mkWorkspace();
    try {
      fs.writeFileSync(
        path.join(ws, "10-动态", "2026-W31.md"),
        `# W31\n\n- 研究知识管理长期专题需要建立专题夹。\n`.repeat(4),
        "utf8",
      );
      const year = new Date().getFullYear();
      const aiProvider = {
        async generate() {
          return JSON.stringify([
            {
              category: "20-专题/../../OUT",
              name: `${year}-泄漏`,
              title: "泄漏",
              reason: "bad",
            },
            {
              category: "20-专题",
              name: `${year}-安全主题`,
              title: "安全主题",
              reason: "ok",
            },
          ]);
        },
      };
      const result = await runOperation({
        id: "topic_classify",
        workspaceRoot: ws,
        engineRoot,
        aiProvider,
        options: { force: true },
      });
      assert.equal(result.ok, true);
      for (const s of result.suggestions || []) {
        const cat = String(s.payload?.category || "");
        assert.ok(!cat.includes(".."), `category must not contain ..: ${cat}`);
        assert.ok(!cat.includes("/"), `category must be single segment: ${cat}`);
        // Content topics land under deep-work-style categories, never stream/delivery/memory
        assert.ok(
          cat === "20-专题" || (/^\d{2}-/.test(cat) && !cat.startsWith("10-") && !cat.startsWith("88-")),
          `category should be content deep-work dir, not stream/delivery: ${cat}`,
        );
        assert.notEqual(cat, "memory");
        assert.ok(!String(s.targetPath || "").startsWith("memory/"));
        const rel = String(s.targetPath || `${cat}/${s.payload?.name}`);
        const abs = path.resolve(ws, rel);
        const root = path.resolve(ws);
        const r = path.relative(root, abs);
        assert.ok(!r.startsWith("..") && !path.isAbsolute(r), `target must stay under ws: ${abs}`);
      }
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
