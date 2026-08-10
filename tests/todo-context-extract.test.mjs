/**
 * Todo extract/maintain: prompt corpus + skip/hash must include activity-window
 * extras, not only period-file raw body. Force re-run must see latest material.
 * Drives shipped extractTodosFromStream / maintainTodos with a recording fake AI.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import {
  extractTodosFromStream,
  maintainTodos,
  ensureTodoFile,
  writeTodoList,
  readTodoList,
  notePromptCorpus,
  noteCorpusHash,
  budgetTodoPromptCorpus,
  splitPeriodAndExtras,
  ACTIVITY_EXTRAS_HEADING,
} from "../lib/todo-engine.mjs";

const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DAY = 24 * 60 * 60 * 1000;

function seedWs(prefix) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const d of ["00-收件箱", "10-动态", "20-专题", "88-输出", "99-归档", "memory"]) {
    fs.mkdirSync(path.join(ws, d), { recursive: true });
  }
  fs.writeFileSync(
    path.join(ws, "topmind.yaml"),
    "contract_version: 4\nworkspace:\n  template: stream\nstream:\n  packing: weekly\n",
    "utf8",
  );
  return ws;
}

function writePeriod(ws, name, body) {
  const p = path.join(ws, "10-动态", name);
  fs.writeFileSync(p, body, "utf8");
  return p;
}

function recordingProvider(lines = ["- 写周报"]) {
  /** @type {string[]} */
  const prompts = [];
  return {
    prompts,
    generate: async (prompt) => {
      prompts.push(String(prompt || ""));
      return lines.join("\n");
    },
  };
}

describe("notePromptCorpus / noteCorpusHash", () => {
  it("includes extras in corpus and hash", () => {
    const note = {
      rawContent: "# week\n\nbase only\n",
      content: "# week\n\nbase only\n",
      extrasCorpus: "### 10-动态/inbox.md\n\n- 最新任务：整理活动材料\n",
    };
    const corpus = notePromptCorpus(note);
    assert.match(corpus, /base only/);
    assert.match(corpus, /整理活动材料/);
    assert.notEqual(noteCorpusHash(note), noteCorpusHash({ ...note, extrasCorpus: "" }));
  });

  it("budgetTodoPromptCorpus keeps extras when period body alone exceeds budget", () => {
    const marker = "UNIQUE_EXTRAS_MARKER_ZX9_发布产品文档";
    // Use ASCII filler so length is predictable across encodings
    const longBase = `# long period\n\n${"old-stream-line-padding-xxxxxxxx\n".repeat(250)}`;
    const extras = `${ACTIVITY_EXTRAS_HEADING}\n\n### 00-收件箱/latest.md\n\n- ${marker}\n`;
    const full = `${longBase}\n\n${extras}`;
    assert.ok(longBase.length > 6000, `base alone must exceed budget (got ${longBase.length})`);
    assert.ok(full.length > 6000, "fixture must exceed extract budget");
    // Naive head-slice would drop extras entirely (extras sit after the long base)
    assert.doesNotMatch(full.slice(0, 6000), new RegExp(marker));
    const extractBudget = budgetTodoPromptCorpus(full, 6000, { locale: "zh" });
    assert.match(extractBudget, new RegExp(marker), "extract budget must keep extras marker");
    assert.match(extractBudget, new RegExp(ACTIVITY_EXTRAS_HEADING));
    const maintainBudget = budgetTodoPromptCorpus(full, 3500, {
      locale: "zh",
    });
    assert.match(maintainBudget, new RegExp(marker), "maintain budget must keep extras marker");
    const parts = splitPeriodAndExtras(full);
    assert.ok(parts.base.length > 3500);
    assert.match(parts.extras, new RegExp(marker));
  });
});

describe("extractTodosFromStream corpus hash vs extras", () => {
  /** @type {string} */
  let ws;
  before(() => {
    ws = seedWs("topmind-todo-ctx-");
  });
  after(() => fs.rmSync(ws, { recursive: true, force: true }));

  it("skips when corpus unchanged; re-runs when extras change; force clears skip", async () => {
    const periodBody =
      "---\ntitle: 本周\ntype: stream-period\n---\n\n# 2026-W32\n\n- 已有旧事项：续订域名\n";
    writePeriod(ws, "2026-W32.md", periodBody);

    // Seed a non-period activity file that activity-window can fold (recent mtime)
    const extraPath = path.join(ws, "00-收件箱", "latest-task.md");
    fs.writeFileSync(
      extraPath,
      "---\ntitle: latest\n---\n\n# latest\n\n- 最新待办：提交季度总结\n",
      "utf8",
    );
    // Ensure mtime is "now" so window includes it
    const now = new Date();
    fs.utimesSync(extraPath, now, now);

    ensureTodoFile(ws);

    const ai1 = recordingProvider(["- 提交季度总结"]);
    const r1 = await extractTodosFromStream({
      workspaceRoot: ws,
      engineRoot,
      aiProvider: ai1,
      options: {},
    });
    assert.equal(r1.ok, true, JSON.stringify(r1));
    assert.notEqual(r1.reason, "already-processed");
    assert.ok(ai1.prompts.length === 1, "first extract calls AI");
    assert.match(ai1.prompts[0], /提交季度总结|latest-task|相关活动材料|续订域名/u);

    // Mark as processed with current corpus hash by second call → should skip
    const ai2 = recordingProvider(["- 不应出现"]);
    const r2 = await extractTodosFromStream({
      workspaceRoot: ws,
      engineRoot,
      aiProvider: ai2,
      options: {},
    });
    assert.equal(r2.reason, "already-processed");
    assert.equal(ai2.prompts.length, 0, "unchanged corpus must not call AI");

    // Change ONLY the folded activity material (period file hash unchanged)
    fs.writeFileSync(
      extraPath,
      "---\ntitle: latest\n---\n\n# latest\n\n- 超级新任务：发布产品文档\n",
      "utf8",
    );
    fs.utimesSync(extraPath, new Date(), new Date());

    const ai3 = recordingProvider(["- 发布产品文档"]);
    const r3 = await extractTodosFromStream({
      workspaceRoot: ws,
      engineRoot,
      aiProvider: ai3,
      options: {},
    });
    assert.notEqual(r3.reason, "already-processed", "extras change must invalidate skip");
    assert.equal(ai3.prompts.length, 1, "extras change must call AI");
    assert.match(ai3.prompts[0], /发布产品文档/u);

    // Force re-run even if unchanged
    const ai4 = recordingProvider(["- 再次抽取"]);
    const r4 = await extractTodosFromStream({
      workspaceRoot: ws,
      engineRoot,
      aiProvider: ai4,
      options: { force: true },
    });
    assert.notEqual(r4.reason, "already-processed");
    assert.equal(ai4.prompts.length, 1);
    assert.match(ai4.prompts[0], /发布产品文档|相关活动材料|续订域名/u);
  });
});

describe("long period: extras reach generate() prompt", () => {
  /** @type {string} */
  let ws;
  before(() => {
    ws = seedWs("topmind-todo-long-");
  });
  after(() => fs.rmSync(ws, { recursive: true, force: true }));

  it("extractTodosFromStream: UNIQUE extras marker is in AI prompt when period is huge", async () => {
    const marker = "UNIQUE_LONG_EXTRACT_MARKER_Q7_提交季度总结";
    // Period body alone >> 6000 chars and has no marker
    const longBody = [
      "---",
      "title: long-week",
      "type: stream-period",
      "---",
      "",
      "# 2026-W40",
      "",
      ...Array.from({ length: 900 }, (_, i) => `- 旧流水条目 ${i}：回顾会议纪要与无关笔记。`),
      "",
    ].join("\n");
    assert.ok(longBody.length > 6000);
    writePeriod(ws, "2026-W40.md", longBody);

    const extraPath = path.join(ws, "00-收件箱", "long-latest.md");
    fs.writeFileSync(
      extraPath,
      `---\ntitle: long-latest\n---\n\n# long-latest\n\n- ${marker}\n`,
      "utf8",
    );
    fs.utimesSync(extraPath, new Date(), new Date());
    ensureTodoFile(ws);

    const ai = recordingProvider(["- 提交季度总结"]);
    const r = await extractTodosFromStream({
      workspaceRoot: ws,
      engineRoot,
      aiProvider: ai,
      options: { force: true },
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(ai.prompts.length, 1);
    assert.match(
      ai.prompts[0],
      new RegExp(marker),
      "long period must not truncate away folded extras from extract prompt",
    );
  });

  it("maintainTodos: UNIQUE extras marker is in AI prompt when period is huge", async () => {
    const marker = "UNIQUE_LONG_MAINTAIN_MARKER_R3_上线checklist";
    const longBody = [
      "---",
      "title: long-week-m",
      "type: stream-period",
      "---",
      "",
      "# 2026-W41",
      "",
      // Long period body to test smart budgeting (not keyword filtering)
      ...Array.from({ length: 400 }, (_, i) => `- 待办 ${i}：完成任务${i}、处理邮件、跟进会议。`),
      "",
    ].join("\n");
    assert.ok(longBody.length > 3500);
    writePeriod(ws, "2026-W41.md", longBody);

    const extraPath = path.join(ws, "20-专题", "2026-long", "topic.md");
    fs.mkdirSync(path.dirname(extraPath), { recursive: true });
    fs.writeFileSync(
      extraPath,
      `---\ntitle: long-topic\n---\n\n# long-topic\n\n- ${marker}\n`,
      "utf8",
    );
    fs.utimesSync(extraPath, new Date(), new Date());

    const maintainAi = {
      prompts: /** @type {string[]} */ ([]),
      generate: async (prompt) => {
        maintainAi.prompts.push(String(prompt || ""));
        return JSON.stringify({ add: ["上线 checklist"], complete: [], update: [] });
      },
    };
    const r = await maintainTodos({
      workspaceRoot: ws,
      engineRoot,
      aiProvider: maintainAi,
      options: { force: true },
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(maintainAi.prompts.length >= 1);
    assert.match(
      maintainAi.prompts[maintainAi.prompts.length - 1],
      new RegExp(marker),
      "long keyword-heavy period must not crowd out folded extras in maintain prompt",
    );
  });
});

describe("maintainTodos corpus hash + force", () => {
  /** @type {string} */
  let ws;
  before(() => {
    ws = seedWs("topmind-todo-maint-");
  });
  after(() => fs.rmSync(ws, { recursive: true, force: true }));

  it("all-periods-processed when stable; force re-runs with latest extras in prompt", async () => {
    writePeriod(
      ws,
      "2026-W33.md",
      "---\ntitle: w33\n---\n\n# 2026-W33\n\n- 周记：完成设计评审\n",
    );
    const extra = path.join(ws, "20-专题", "2026-demo", "topic.md");
    fs.mkdirSync(path.dirname(extra), { recursive: true });
    fs.writeFileSync(extra, "---\ntitle: demo\n---\n\n# demo\n\n- 专题动作：整理里程碑\n", "utf8");
    fs.utimesSync(extra, new Date(), new Date());

    const ai = recordingProvider(["- 整理里程碑"]);
    // JSON maintain response format
    const maintainAi = {
      prompts: /** @type {string[]} */ ([]),
      generate: async (prompt) => {
        maintainAi.prompts.push(String(prompt || ""));
        return JSON.stringify({ add: ["整理里程碑"], complete: [], update: [] });
      },
    };

    const r1 = await maintainTodos({
      workspaceRoot: ws,
      engineRoot,
      aiProvider: maintainAi,
      options: {},
    });
    assert.equal(r1.ok, true, JSON.stringify(r1));
    assert.ok(maintainAi.prompts.length >= 1);
    assert.match(maintainAi.prompts[0], /整理里程碑|相关活动材料|设计评审/u);

    const r2 = await maintainTodos({
      workspaceRoot: ws,
      engineRoot,
      aiProvider: maintainAi,
      options: {},
    });
    assert.equal(r2.reason, "all-periods-processed");

    // New extras only
    fs.writeFileSync(extra, "---\ntitle: demo\n---\n\n# demo\n\n- 专题动作：上线 checklist\n", "utf8");
    fs.utimesSync(extra, new Date(), new Date());
    const before = maintainAi.prompts.length;
    const r3 = await maintainTodos({
      workspaceRoot: ws,
      engineRoot,
      aiProvider: maintainAi,
      options: {},
    });
    assert.notEqual(r3.reason, "all-periods-processed", "extras change must re-process");
    assert.ok(maintainAi.prompts.length > before);
    assert.match(maintainAi.prompts[maintainAi.prompts.length - 1], /上线 checklist/u);

    // Force after stable
    const r4 = await maintainTodos({
      workspaceRoot: ws,
      engineRoot,
      aiProvider: maintainAi,
      options: { force: true },
    });
    assert.notEqual(r4.reason, "all-periods-processed");
    assert.match(maintainAi.prompts[maintainAi.prompts.length - 1], /上线 checklist|相关活动材料/u);
  });
});
