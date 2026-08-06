/**
 * AI durable write quality — sanitize, no-placeholder-on-failure,
 * period/profile merge/dedupe, todo maintain idempotency.
 * Drives shipped kernel entry points with mock AI providers.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  sanitizeAiContent,
  isPlaceholderOrPolluted,
  usableAiBody,
  extractCleanLines,
  profileSectionHasFact,
} from "../lib/ai-content-sanitize.mjs";
import {
  appendProfileEntry,
  writePeriodDigest,
  ensureMemoryPlane,
  readGlobalMemory,
  readMemoryLayer,
} from "../lib/memory-engine.mjs";
import { applySuggestion, generateSuggestions } from "../lib/suggest-engine.mjs";
import {
  ensureTodoFile,
  readTodoList,
  writeTodoList,
  maintainTodos,
} from "../lib/todo-engine.mjs";

/** @type {string} */
let ws;

function seedWorkspace() {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "topmind-ai-write-"));
  fs.writeFileSync(
    path.join(ws, "topmind.yaml"),
    `version: 4\ncategories:\n  - directory: 10-动态\n    role: loose-stream\n  - directory: 20-专题\n    role: deep-work\n  - directory: 00-收件箱\n    role: buffer\n  - directory: 88-输出\n    role: delivery\n  - directory: 99-归档\n    role: system\n`,
    "utf8",
  );
  for (const d of ["10-动态", "20-专题", "00-收件箱", "88-输出", "99-归档"]) {
    fs.mkdirSync(path.join(ws, d), { recursive: true });
  }
  ensureMemoryPlane(ws);
  // Period note with real content for activity window
  fs.writeFileSync(
    path.join(ws, "10-动态", "2026-W30.md"),
    `---\ntitle: 2026-W30\n---\n\n# 2026-W30\n\n## 记录\n\n- 推进 topmind AI 写回质量\n- 偏好：确认后写入，不要自动改 memory\n- 目标：本周交付建议管线卫生\n`,
    "utf8",
  );
}

beforeEach(() => {
  seedWorkspace();
});

afterEach(() => {
  try {
    fs.rmSync(ws, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// ── sanitize pure policy ──────────────────────────────────────────────────

describe("ai-content-sanitize", () => {
  it("strips thinking tags and fences", () => {
    const raw = `<think>secret chain</think>\n\n## 本周要点\n- 真内容\n\`\`\`thinking\nnoise\n\`\`\`\n`;
    const out = sanitizeAiContent(raw);
    assert.doesNotMatch(out, /secret chain|thinking/i);
    assert.match(out, /本周要点|真内容/);
  });

  it("detects placeholders and pollution", () => {
    assert.equal(isPlaceholderOrPolluted("（待 AI 生成：配置 AI provider 后自动填充）"), true);
    assert.equal(isPlaceholderOrPolluted("# 2026-W30\n\n（待摘要）\n"), true);
    assert.equal(isPlaceholderOrPolluted("- （2026-08-03）从动态整理：待填写"), true);
    assert.equal(isPlaceholderOrPolluted("<think>x</think>"), true);
    assert.equal(isPlaceholderOrPolluted("## 本周要点\n\n- 推进写回卫生\n"), false);
  });

  it("rejects multi-line JSON tool payloads (any size)", () => {
    const longJson = JSON.stringify(
      {
        profile: ["稳定事实1", "稳定事实2", "稳定事实3"],
        periodic:
          "这是一段超过四十字符的周期摘要候选文本，用于模拟 soft-parse 失败时把整段 JSON 当正文写入",
      },
      null,
      2,
    );
    assert.ok(longJson.length > 40);
    assert.equal(isPlaceholderOrPolluted(longJson), true);
    assert.equal(usableAiBody(longJson).ok, false);
    assert.equal(usableAiBody(longJson).reason, "json-dump");
    assert.equal(sanitizeAiContent(longJson), "");
  });

  it("rejects untagged 思考过程 / Reasoning dumps without MD result", () => {
    const zh =
      "思考过程：我先看材料，用户本周在推进写回卫生，偏好确认后写入，然后我再总结成摘要。";
    const en =
      "Reasoning: First I analyze the period notes, then I will draft a summary of key points carefully.";
    assert.equal(usableAiBody(zh).ok, false);
    assert.equal(usableAiBody(en).ok, false);
    assert.ok(
      usableAiBody(zh).reason === "thinking-dump" ||
        usableAiBody(zh).reason === "empty-or-short" ||
        usableAiBody(zh).reason === "placeholder-or-polluted",
    );
    // Thinking + real MD after: salvage the MD part
    const mixed =
      "思考过程：内部推理一大段话\n\n## 本周要点\n- 推进写回卫生\n- 确认后写入";
    const salvaged = usableAiBody(mixed);
    assert.equal(salvaged.ok, true);
    assert.match(salvaged.text, /本周要点|推进写回/);
    assert.doesNotMatch(salvaged.text, /思考过程|内部推理/);
  });

  it("usableAiBody rejects short/polluted", () => {
    assert.equal(usableAiBody("").ok, false);
    assert.equal(usableAiBody("（待 AI 生成）").ok, false);
    assert.equal(usableAiBody("## 要点\n- real item here").ok, true);
  });

  it("extractCleanLines drops polluted soft-parse lines", () => {
    const lines = extractCleanLines(
      `<think>plan</think>\n- 稳定事实：确认后写入\n- 待填写\n- 另一个真实偏好`,
    );
    assert.ok(lines.some((l) => /稳定事实/.test(l)));
    assert.ok(!lines.some((l) => /待填写/.test(l)));
  });

  it("profileSectionHasFact dedupes near-equal facts", () => {
    const section = "- （2026-08-01）偏好确认后写入\n- 其他事项";
    assert.equal(profileSectionHasFact(section, "- （2026-08-03）偏好确认后写入"), true);
    assert.equal(profileSectionHasFact(section, "- 全新事实 X"), false);
  });
});

// ── writePeriodDigest ─────────────────────────────────────────────────────

describe("writePeriodDigest", () => {
  it("refuses placeholder body (no write pollution)", () => {
    const r = writePeriodDigest({
      workspaceRoot: ws,
      period: "2026-W30",
      body: "（待 AI 生成：配置 AI provider 后自动填充）",
    });
    assert.equal(r.operation, "skip");
    assert.equal(r.wroteFiles, false);
    assert.equal(fs.existsSync(path.join(ws, "memory/periodic/2026-W30.md")), false);
  });

  it("writes real digest and updates in place without stacking", () => {
    const body1 = "## 2026-W30 周期摘要\n\n### 本周要点\n- 第一次摘要要点\n- 推进质量门";
    const r1 = writePeriodDigest({
      workspaceRoot: ws,
      period: "2026-W30",
      body: body1,
      derivedFrom: ["10-动态/2026-W30.md"],
    });
    assert.notEqual(r1.operation, "skip");
    const p = path.join(ws, "memory/periodic/2026-W30.md");
    assert.ok(fs.existsSync(p));
    const first = fs.readFileSync(p, "utf8");
    assert.match(first, /第一次摘要要点/);
    assert.doesNotMatch(first, /待 AI|待摘要/);

    const body2 = "## 2026-W30 周期摘要\n\n### 本周要点\n- 更新后的唯一摘要\n- 无冗余堆叠";
    const r2 = writePeriodDigest({
      workspaceRoot: ws,
      period: "2026-W30",
      body: body2,
      derivedFrom: ["10-动态/2026-W30.md"],
    });
    assert.equal(r2.operation, "update");
    const second = fs.readFileSync(p, "utf8");
    assert.match(second, /更新后的唯一摘要/);
    assert.doesNotMatch(second, /第一次摘要要点/);
    // only one periodic file for this period
    const files = fs.readdirSync(path.join(ws, "memory/periodic"));
    assert.equal(files.filter((f) => f.startsWith("2026-W30")).length, 1);
  });

  it("strips thinking tags before write", () => {
    const r = writePeriodDigest({
      workspaceRoot: ws,
      period: "2026-W31",
      body: `<think>internal</think>\n## 要点\n- 真实要点内容足够长`,
    });
    assert.notEqual(r.operation, "skip");
    const text = readMemoryLayer(ws, "periodic", "2026-W31");
    assert.doesNotMatch(text, /internal|<think/);
    assert.match(text, /真实要点/);
  });
});

// ── appendProfileEntry dedupe ─────────────────────────────────────────────

describe("appendProfileEntry", () => {
  it("dedupes same fact on re-append", () => {
    const e1 = appendProfileEntry({
      workspaceRoot: ws,
      entry: { section: "进行中的事", content: "- （2026-08-01）偏好：确认后写入" },
    });
    assert.notEqual(e1.operation, "skip");
    const e2 = appendProfileEntry({
      workspaceRoot: ws,
      entry: { section: "进行中的事", content: "- （2026-08-03）偏好：确认后写入" },
    });
    assert.equal(e2.reason, "duplicate-fact");
    assert.equal(e2.wroteFiles, false);
    const body = readGlobalMemory(ws);
    const hits = body.match(/偏好：确认后写入/g) || [];
    assert.equal(hits.length, 1);
  });

  it("skips placeholder entries", () => {
    const r = appendProfileEntry({
      workspaceRoot: ws,
      entry: { section: "进行中的事", content: "- （2026-08-03）从动态整理：待填写" },
    });
    assert.equal(r.operation, "skip");
    assert.equal(r.wroteFiles, false);
  });
});

// ── applySuggestion with mock AI ──────────────────────────────────────────

describe("applySuggestion stream_digest / ai_summary", () => {
  it("successful mock AI writes non-placeholder digest", async () => {
    const aiProvider = {
      generate: async () =>
        `## 2026-W30 周期摘要\n\n### 本周要点\n- mock 真实摘要 A\n- mock 真实摘要 B\n\n### 进行中的事\n- 写回卫生`,
    };
    const result = await applySuggestion({
      workspaceRoot: ws,
      suggestion: {
        id: "digest-2026-W30",
        kind: "stream_digest",
        title: "生成周期摘要",
        summary: "x",
        impact: "high",
        payload: { period: "2026-W30", body: "" },
      },
      aiProvider,
    });
    assert.equal(result.ok, true);
    assert.equal(result.wroteFiles, true);
    const text = fs.readFileSync(path.join(ws, "memory/periodic/2026-W30.md"), "utf8");
    assert.match(text, /mock 真实摘要 A/);
    assert.doesNotMatch(text, /待摘要|待 AI 生成/);
  });

  it("failed AI does not leave placeholder in periodic", async () => {
    const aiProvider = {
      generate: async () => {
        throw new Error("network down");
      },
    };
    const result = await applySuggestion({
      workspaceRoot: ws,
      suggestion: {
        id: "digest-fail",
        kind: "stream_digest",
        title: "生成周期摘要",
        summary: "x",
        impact: "high",
        payload: { period: "2026-W30", body: "（待摘要）" },
      },
      aiProvider,
    });
    assert.equal(result.ok, false);
    assert.equal(result.wroteFiles, false);
    assert.equal(fs.existsSync(path.join(ws, "memory/periodic/2026-W30.md")), false);
  });

  it("missing AI provider does not write placeholder", async () => {
    const result = await applySuggestion({
      workspaceRoot: ws,
      suggestion: {
        id: "digest-no-ai",
        kind: "stream_digest",
        title: "生成周期摘要",
        summary: "x",
        impact: "high",
        payload: { period: "2026-W30", body: `# 2026-W30\n\n（待摘要）\n` },
      },
    });
    assert.equal(result.wroteFiles, false);
    assert.equal(fs.existsSync(path.join(ws, "memory/periodic/2026-W30.md")), false);
  });

  it("ai_summary rejects thinking-tagged payload", async () => {
    const result = await applySuggestion({
      workspaceRoot: ws,
      suggestion: {
        id: "sum-think",
        kind: "ai_summary",
        title: "AI 分析",
        summary: "x",
        impact: "medium",
        payload: {
          period: "2026-W30",
          analysis: "<think>lots of reasoning dump only</think>",
          action: "write_digest",
        },
      },
    });
    assert.equal(result.wroteFiles, false);
    assert.equal(fs.existsSync(path.join(ws, "memory/periodic/2026-W30.md")), false);
  });

  it("stream_digest rejects multi-line JSON tool payload (no durable write)", async () => {
    const jsonDump = `{
  "profile": ["稳定事实A", "稳定事实B"],
  "periodic": "这段 JSON 被错误地当成周期摘要正文写入会污染 memory/periodic"
}`;
    const aiProvider = {
      generate: async () => jsonDump,
    };
    const result = await applySuggestion({
      workspaceRoot: ws,
      suggestion: {
        id: "digest-json",
        kind: "stream_digest",
        title: "生成周期摘要",
        summary: "x",
        impact: "high",
        payload: { period: "2026-W30", body: "" },
      },
      aiProvider,
    });
    assert.equal(result.wroteFiles, false);
    assert.equal(result.ok, false);
    assert.equal(fs.existsSync(path.join(ws, "memory/periodic/2026-W30.md")), false);
  });

  it("stream_digest rejects untagged 思考过程 dump (no durable write)", async () => {
    const aiProvider = {
      generate: async () =>
        "思考过程：我先分析活动窗口里的材料，用户在推进写回质量，然后输出摘要，但这里只有推理没有正文结构。",
    };
    const result = await applySuggestion({
      workspaceRoot: ws,
      suggestion: {
        id: "digest-cot-zh",
        kind: "stream_digest",
        title: "生成周期摘要",
        summary: "x",
        impact: "high",
        payload: { period: "2026-W30" },
      },
      aiProvider,
    });
    assert.equal(result.wroteFiles, false);
    assert.equal(fs.existsSync(path.join(ws, "memory/periodic/2026-W30.md")), false);
  });

  it("stream_digest rejects untagged Reasoning dump (no durable write)", async () => {
    const aiProvider = {
      generate: async () =>
        "Reasoning: I will carefully review the period notes and then produce a digest, but this output is only the chain of thought without markdown structure.",
    };
    const result = await applySuggestion({
      workspaceRoot: ws,
      suggestion: {
        id: "digest-cot-en",
        kind: "stream_digest",
        title: "生成周期摘要",
        summary: "x",
        impact: "high",
        payload: { period: "2026-W30" },
      },
      aiProvider,
    });
    assert.equal(result.wroteFiles, false);
    assert.equal(fs.existsSync(path.join(ws, "memory/periodic/2026-W30.md")), false);
  });

  it("writePeriodDigest refuses JSON and untagged thinking bodies", () => {
    const rJson = writePeriodDigest({
      workspaceRoot: ws,
      period: "2026-W32",
      body: JSON.stringify({ profile: ["a"], periodic: "long enough periodic text here" }, null, 2),
    });
    assert.equal(rJson.wroteFiles, false);
    assert.equal(fs.existsSync(path.join(ws, "memory/periodic/2026-W32.md")), false);

    const rThink = writePeriodDigest({
      workspaceRoot: ws,
      period: "2026-W33",
      body: "思考过程：只有推理没有标题列表结构的大段文字污染。",
    });
    assert.equal(rThink.wroteFiles, false);
    assert.equal(fs.existsSync(path.join(ws, "memory/periodic/2026-W33.md")), false);
  });

  it("ai_summary rejects JSON analysis payload", async () => {
    const result = await applySuggestion({
      workspaceRoot: ws,
      suggestion: {
        id: "sum-json",
        kind: "ai_summary",
        title: "AI 分析",
        summary: "x",
        impact: "medium",
        payload: {
          period: "2026-W30",
          analysis: '{\n  "profile": ["x"],\n  "periodic": "y should not land in periodic file"\n}',
          action: "write_digest",
        },
      },
    });
    assert.equal(result.wroteFiles, false);
    assert.equal(fs.existsSync(path.join(ws, "memory/periodic/2026-W30.md")), false);
  });

  it("promote_memory dedupes on re-apply same fact", async () => {
    const suggestion = {
      id: "promo",
      kind: "promote_memory",
      title: "写入",
      summary: "x",
      impact: "high",
      payload: {
        action: "append_profile",
        section: "进行中的事",
        entry: { section: "进行中的事", content: "- （2026-08-03）稳定事实：确认优先" },
      },
    };
    const r1 = await applySuggestion({ workspaceRoot: ws, suggestion });
    assert.equal(r1.wroteFiles, true);
    const r2 = await applySuggestion({ workspaceRoot: ws, suggestion });
    assert.equal(r2.wroteFiles, false);
    assert.ok(r2.reason === "duplicate-fact" || r2.ok === true);
    const hits = (readGlobalMemory(ws).match(/稳定事实：确认优先/g) || []).length;
    assert.equal(hits, 1);
  });

  it("re-apply stream_digest same period updates not stacks", async () => {
    let n = 0;
    const aiProvider = {
      generate: async () => {
        n += 1;
        return `## 摘要\n\n### 本周要点\n- 版本 ${n} 唯一正文足够长度`;
      },
    };
    const suggestion = {
      id: "d1",
      kind: "stream_digest",
      title: "digest",
      summary: "x",
      impact: "high",
      payload: { period: "2026-W30" },
    };
    await applySuggestion({ workspaceRoot: ws, suggestion, aiProvider });
    await applySuggestion({ workspaceRoot: ws, suggestion, aiProvider });
    const text = fs.readFileSync(path.join(ws, "memory/periodic/2026-W30.md"), "utf8");
    assert.match(text, /版本 2/);
    assert.doesNotMatch(text, /版本 1/);
  });
});

// ── generateSuggestions: no placeholder promote when AI fails ─────────────

describe("generateSuggestions hygiene", () => {
  it("does not seed 待填写 promote entry when AI returns empty", async () => {
    const aiProvider = {
      generate: async () => "",
    };
    const list = await generateSuggestions({ workspaceRoot: ws, aiProvider });
    const promote = list.filter((s) => s.kind === "promote_memory");
    for (const s of promote) {
      const c = s.payload?.entry?.content || s.payload?.entry || "";
      assert.doesNotMatch(String(c), /待填写|待 AI/);
    }
    const digests = list.filter((s) => s.kind === "stream_digest");
    for (const s of digests) {
      assert.doesNotMatch(String(s.payload?.body || ""), /待摘要/);
    }
  });
});

// ── todo maintain idempotency ─────────────────────────────────────────────

describe("maintainTodos idempotency", () => {
  it("second run without force skips already-processed period", async () => {
    ensureTodoFile(ws);
    let calls = 0;
    const aiProvider = {
      generate: async () => {
        calls += 1;
        return JSON.stringify({
          add: ["完成写回卫生测试"],
          complete: [],
          update: [],
        });
      },
    };
    const r1 = await maintainTodos({ workspaceRoot: ws, aiProvider });
    assert.equal(r1.ok, true);
    assert.ok((r1.added || []).length >= 1 || r1.reason === "no-changes");
    const after1 = readTodoList(ws);
    const count1 = after1?.items?.length || 0;

    const r2 = await maintainTodos({ workspaceRoot: ws, aiProvider });
    assert.equal(r2.ok, true);
    assert.equal(r2.reason, "all-periods-processed");
    assert.equal((r2.added || []).length, 0);
    const after2 = readTodoList(ws);
    assert.equal(after2?.items?.length || 0, count1);
    // second run should not call AI again for processed periods
    assert.equal(calls, 1);
  });

  it("does not add duplicate open items on force re-run with same extract", async () => {
    ensureTodoFile(ws);
    const aiProvider = {
      generate: async () =>
        JSON.stringify({
          add: ["同一待办事项幂等"],
          complete: [],
          update: [],
        }),
    };
    await maintainTodos({ workspaceRoot: ws, aiProvider, options: { force: true } });
    await maintainTodos({ workspaceRoot: ws, aiProvider, options: { force: true } });
    const list = readTodoList(ws);
    const matches = (list?.items || []).filter((i) => i.text.includes("同一待办事项幂等"));
    assert.equal(matches.length, 1);
  });
});
