/**
 * Period stem + yearDir digest path — scanLifecycle → generateSuggestions → applySuggestion.
 * Drives shipped kernel entry points (no reimplementation of the unit under test).
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { scanLifecycle } from "../lib/lifecycle-engine.mjs";
import { generateSuggestions, applySuggestion } from "../lib/suggest-engine.mjs";
import { writePeriodDigest, periodMemoryRelPath, ensureMemoryPlane } from "../lib/memory-engine.mjs";
import { loadContract } from "../lib/contract-engine.mjs";

const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @type {string} */
let ws;

function seedYearDirWorkspace() {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "topmind-suggest-period-"));
  fs.writeFileSync(
    path.join(ws, "topmind.yaml"),
    `contract_version: 4
workspace:
  template: stream
categories:
  - directory: 00-收件箱
    role: buffer
  - directory: 10-动态
    role: loose-stream
  - directory: 20-专题
    role: deep-work
  - directory: 88-输出
    role: delivery
  - directory: 99-归档
    role: system
stream:
  packing: weekly
  yearDir: true
lifecycle:
  stream:
    digest_after_periods: 4
`,
    "utf8",
  );
  for (const d of ["00-收件箱", "10-动态", "20-专题", "88-输出", "99-归档"]) {
    fs.mkdirSync(path.join(ws, d), { recursive: true });
  }
  ensureMemoryPlane(ws);
  const yearDir = path.join(ws, "10-动态", "2026");
  fs.mkdirSync(yearDir, { recursive: true });
  for (let w = 20; w <= 30; w++) {
    const stem = `2026-W${String(w).padStart(2, "0")}`;
    fs.writeFileSync(
      path.join(yearDir, `${stem}.md`),
      `---\ntitle: ${stem}\n---\n\n# ${stem}\n\n## 记录\n\n- 周期本 ${stem} 有真实正文，用于建议打开与周期反思。\n- 推进写回卫生与记忆路径一致性。\n`,
      "utf8",
    );
  }
}

beforeEach(() => {
  seedYearDirWorkspace();
});

afterEach(() => {
  try {
    fs.rmSync(ws, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function mockAi() {
  /** @type {string[]} */
  const periodsSeen = [];
  const provider = {
    /** @param {string} prompt @param {object} [ctx] */
    generate: async (prompt, ctx) => {
      const period = ctx?.period;
      if (period != null) periodsSeen.push(String(period));
      assert.doesNotMatch(String(prompt), /undefined/u);
      if (period != null) {
        assert.notEqual(String(period), "undefined");
        assert.doesNotMatch(String(period), /[\\/]/u);
        assert.doesNotMatch(String(period), /近期活动|Recent Activity|^period$/u);
        assert.match(String(period), /^\d{4}-W\d{2}$/u);
      }
      if (ctx?.operation === "period_digest") {
        return `## ${period} 周期反思\n\n### 本周要点\n- mock 真实反思 A 足够长度\n- mock 真实反思 B 足够长度\n`;
      }
      if (ctx?.operation === "period_analysis") {
        return `## 近期要点\n- 分析点一足够长度用于建议卡\n- 分析点二足够长度用于建议卡\n`;
      }
      if (ctx?.operation === "memory_extract") {
        return "偏好：确认后写入记忆";
      }
      return "## 本周要点\n- generic mock content long enough to pass checks";
    },
  };
  return { provider, periodsSeen };
}

describe("scanLifecycle streamDigest yearDir stems", () => {
  it("exposes period stem and relPath, not only {path, periodsOld}", () => {
    const lifecycle = scanLifecycle({
      workspaceRoot: ws,
      contract: loadContract(ws),
      engineRoot,
    });
    assert.ok(lifecycle.streamDigest.length > 0);
    for (const item of lifecycle.streamDigest) {
      assert.equal(typeof item.period, "string");
      assert.match(item.period, /^\d{4}-W\d{2}$/u);
      assert.ok(item.relPath);
      assert.match(String(item.relPath).replace(/\\/g, "/"), /10-动态\/2026\/2026-W\d{2}\.md$/u);
      assert.equal(typeof item.periodsOld, "number");
      assert.ok(item.path);
    }
  });
});

describe("generateSuggestions → applySuggestion period path", () => {
  it("stream_digest uses a real stem, not undefined, and apply writes yearDir path", async () => {
    const { provider, periodsSeen } = mockAi();
    const list = await generateSuggestions({
      workspaceRoot: ws,
      engineRoot,
      aiProvider: provider,
    });
    const digests = list.filter((s) => s.kind === "stream_digest");
    assert.ok(digests.length > 0, "expected stream_digest cards");
    for (const card of digests) {
      const blob = JSON.stringify(card);
      assert.doesNotMatch(blob, /undefined/u);
      assert.doesNotMatch(blob, /近期活动|Recent Activity/u);
      assert.match(String(card.payload?.period), /^\d{4}-W\d{2}$/u);
      assert.match(card.summary, new RegExp(card.payload.period, "u"));
      assert.match(card.id, new RegExp(`digest-${card.payload.period}$`, "u"));
      assert.match(String(card.targetPath || "").replace(/\\/g, "/"), new RegExp(`${card.payload.period}\\.md$`, "u"));
      assert.equal(card.payload.digestPath, periodMemoryRelPath(card.payload.period));
      const sourceAbs = path.join(ws, card.targetPath);
      assert.ok(fs.existsSync(sourceAbs), "card targetPath is the existing 周期本");
      const sourceBody = fs.readFileSync(sourceAbs, "utf8");
      assert.ok(sourceBody.trim().length > 40, "周期本 already has content");
    }

    const card = digests[0];
    const result = await applySuggestion({
      workspaceRoot: ws,
      engineRoot,
      suggestion: card,
      aiProvider: provider,
    });
    assert.equal(result.ok, true);
    assert.equal(result.wroteFiles, true);
    const expected = `memory/periodic/2026/${card.payload.period}.md`;
    assert.equal(result.targetPath, expected);
    const writtenAbs = path.join(ws, result.targetPath);
    assert.ok(fs.existsSync(writtenAbs), "apply evidence path exists after write");
    const written = fs.readFileSync(writtenAbs, "utf8");
    assert.ok(written.trim().length > 40);
    assert.match(written, /mock 真实反思/);
    assert.doesNotMatch(written, /undefined/u);
    assert.equal(fs.existsSync(path.join(ws, "memory/periodic", `${card.payload.period}.md`)), false);
    assert.ok(periodsSeen.every((p) => /^\d{4}-W\d{2}$/u.test(p)));
  });

  it("ai_summary payload period is a stem, not a relPath or locale label", async () => {
    const { provider } = mockAi();
    const list = await generateSuggestions({
      workspaceRoot: ws,
      engineRoot,
      aiProvider: provider,
    });
    const summaries = list.filter((s) => s.kind === "ai_summary");
    assert.ok(summaries.length > 0, "expected ai_summary card when period notes exist");
    for (const card of summaries) {
      const blob = JSON.stringify(card);
      assert.doesNotMatch(blob, /undefined/u);
      assert.doesNotMatch(blob, /近期活动|Recent Activity/u);
      assert.match(String(card.payload?.period), /^\d{4}-W\d{2}$/u);
      assert.doesNotMatch(String(card.payload.period), /[\\/]/u);
      assert.match(String(card.targetPath || "").replace(/\\/g, "/"), /\.md$/u);
      const sourceAbs = path.join(ws, card.targetPath);
      assert.ok(fs.existsSync(sourceAbs), "ai_summary opens existing 周期本");
      assert.ok(fs.readFileSync(sourceAbs, "utf8").trim().length > 40);
    }
  });

  it("missing/unsafe period skips and creates neither undefined.md nor period.md", async () => {
    const { provider } = mockAi();
    const badPayloads = [
      {},
      { period: undefined },
      { period: "period" },
      { period: "undefined" },
      { period: "近期活动" },
      { period: "Recent Activity" },
      { period: "10-动态/2026/2026-W26.md" },
    ];
    for (const payload of badPayloads) {
      const result = await applySuggestion({
        workspaceRoot: ws,
        engineRoot,
        suggestion: {
          id: "digest-bad",
          kind: "stream_digest",
          title: "生成周期反思",
          summary: "x",
          impact: "high",
          payload,
        },
        aiProvider: provider,
      });
      assert.equal(result.ok, false, JSON.stringify(payload));
      assert.equal(result.wroteFiles, false, JSON.stringify(payload));
      assert.equal(result.reason, "invalid-period", JSON.stringify(payload));
    }
    assert.equal(fs.existsSync(path.join(ws, "memory/periodic/undefined.md")), false);
    assert.equal(fs.existsSync(path.join(ws, "memory/periodic/period.md")), false);
    assert.equal(fs.existsSync(path.join(ws, "memory/periodic/2026/undefined.md")), false);
    assert.equal(fs.existsSync(path.join(ws, "memory/periodic/2026/period.md")), false);
    assert.equal(fs.existsSync(path.join(ws, "memory/periodic/近期活动.md")), false);
  });
});

describe("suggest-engine source rejects leftover period fallbacks", () => {
  it("does not template a flat periodic path or locale-label stem", () => {
    const src = fs.readFileSync(
      path.join(engineRoot, "lib/suggest-engine.mjs"),
      "utf8",
    );
    assert.doesNotMatch(src, /period \|\| "period"/u);
    assert.doesNotMatch(src, /"Recent Activity"/u);
    assert.doesNotMatch(src, /targetPath:\s*`memory\/periodic\/\$\{period\}\.md`/u);
    assert.match(src, /periodMemoryRelPath/u);
    assert.match(src, /isSafePeriodStem/u);
  });
});

describe("writePeriodDigest fallback tokens", () => {
  it("refuses period/undefined stems without writing files", () => {
    const body = "## 周期反思\n\n### 本周要点\n- 足够长度的真实反思正文";
    for (const period of ["period", "undefined", "近期活动", ""]) {
      const r = writePeriodDigest({ workspaceRoot: ws, period, body });
      assert.equal(r.operation, "skip");
      assert.equal(r.wroteFiles, false);
      assert.equal(r.reason, "invalid-period");
    }
    assert.equal(fs.existsSync(path.join(ws, "memory/periodic/undefined.md")), false);
    assert.equal(fs.existsSync(path.join(ws, "memory/periodic/period.md")), false);
    assert.equal(periodMemoryRelPath("undefined"), "");
    assert.equal(periodMemoryRelPath("period"), "");
    assert.equal(periodMemoryRelPath("近期活动"), "");
    assert.equal(periodMemoryRelPath("2026-W26"), "memory/periodic/2026/2026-W26.md");
  });
});
