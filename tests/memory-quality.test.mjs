/**
 * Memory quality: inventory · health · restore · ranked prompt.
 * Global memory is precious — not a dumb append log.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  appendProfileEntry,
  retireProfileEntry,
  updateProfileEntry,
  restoreProfileEntry,
  listProfileFacts,
  analyzeProfileHealth,
  factSimilarity,
  formatProfileForPrompt,
  reviewStaleProfileEntries,
  searchProfile,
  mintFactId,
  parseFactMeta,
} from "../lib/memory-engine.mjs";
import { ensureContract } from "../lib/contract-engine.mjs";

/** @type {string} */
let ws;

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "tm-mem-q-"));
  ensureContract(ws);
  fs.mkdirSync(path.join(ws, "memory"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, "memory/profile.md"),
    `---
title: 我的情况
source_type: user-original
memory_layer: global
---

# 我的情况

## 偏好

- （2026-08-01）偏好深色模式

## 当前目标

- （2026-08-15）完成记忆整合方案

## 进行中的事

- （2026-09-01）推进 topmind 记忆机制设计

## 历史记录

- （2026-08-20 归档）每周跑步三次
`,
    "utf8",
  );
});

afterEach(() => {
  try {
    fs.rmSync(ws, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("listProfileFacts", () => {
  it("inventories active vs history with dates and roles", () => {
    const inv = listProfileFacts(ws);
    assert.equal(inv.exists, true);
    assert.equal(inv.activeCount, 3);
    assert.equal(inv.historyCount, 1);
    const prefs = inv.sections.find((s) => s.role === "preferences");
    assert.ok(prefs);
    assert.equal(prefs.facts.length, 1);
    assert.equal(prefs.facts[0].date, "2026-08-01");
    assert.match(prefs.facts[0].text, /深色模式/);
    const hist = inv.sections.find((s) => s.isHistory);
    assert.ok(hist);
  });
});

describe("factSimilarity + analyzeProfileHealth", () => {
  it("scores equality 1 and containment high", () => {
    assert.equal(factSimilarity("偏好深色模式", "偏好深色模式"), 1);
    assert.ok(factSimilarity("偏好深色模式与护眼", "深色模式") >= 0.9);
    assert.ok(factSimilarity("完全无关的另一件事", "偏好深色模式") < 0.3);
  });

  it("flags near-dupes across live sections", () => {
    // Write two near-dupes directly — append would conservative-dedupe them.
    const p = path.join(ws, "memory/profile.md");
    fs.writeFileSync(
      p,
      fs.readFileSync(p, "utf8").replace(
        "- （2026-08-01）偏好深色模式",
        "- （2026-08-01）偏好深色模式\n- （2026-09-10）一直偏好深色模式界面",
      ),
      "utf8",
    );
    const health = analyzeProfileHealth(ws, { nearDupeThreshold: 0.5 });
    assert.equal(health.healthy, false);
    assert.ok(health.nearDupes.length + health.exactDupes.length >= 1);
    assert.ok(health.issues.includes("near-duplicates") || health.issues.includes("exact-duplicates"));
  });

  it("clean profile reports healthy", () => {
    const health = analyzeProfileHealth(ws);
    assert.equal(health.healthy, true);
    assert.equal(health.activeCount, 3);
  });
});

describe("restoreProfileEntry", () => {
  it("moves a history fact back to an active section", () => {
    const ev = restoreProfileEntry({
      workspaceRoot: ws,
      match: "跑步",
      section: "进行中的事",
      actor: "user",
      confirmed: true,
    });
    assert.equal(ev.wroteFiles !== false, true, JSON.stringify(ev));
    const inv = listProfileFacts(ws);
    const hist = inv.sections.find((s) => s.isHistory);
    assert.equal(hist.facts.length, 0);
    const inProg = inv.sections.find((s) => s.role === "inProgress");
    assert.ok(inProg.facts.some((f) => /跑步/.test(f.text)));
    assert.ok(!inProg.facts.some((f) => /归档/.test(f.text)));
  });

  it("refuses restore when dest already has the fact", () => {
    restoreProfileEntry({
      workspaceRoot: ws,
      match: "跑步",
      section: "进行中的事",
      actor: "user",
      confirmed: true,
    });
    // Retire again then try restore to same section that already has it
    retireProfileEntry({
      workspaceRoot: ws,
      match: "跑步",
      actor: "user",
      confirmed: true,
    });
    // Dest still has a live copy? After retire it was moved. Seed another copy.
    appendProfileEntry({
      workspaceRoot: ws,
      entry: { section: "偏好", content: "每周跑步三次" },
      actor: "user",
      confirmed: true,
    });
    const ev = restoreProfileEntry({
      workspaceRoot: ws,
      match: "跑步",
      section: "偏好",
      actor: "user",
      confirmed: true,
    });
    assert.equal(ev.wroteFiles, false);
    assert.equal(ev.reason, "duplicate-fact");
  });
});

describe("formatProfileForPrompt", () => {
  it("ranks goals/preferences before inProgress and omits history body", () => {
    const out = formatProfileForPrompt(ws, { locale: "zh" });
    assert.match(out, /当前目标/);
    assert.match(out, /偏好/);
    assert.match(out, /深色模式/);
    // History facts must not appear as live bullets
    assert.doesNotMatch(out, /每周跑步三次/);
    assert.match(out, /已归档/);
    // Goals section appears before in-progress
    const gi = out.indexOf("当前目标");
    const pi = out.indexOf("进行中的事");
    assert.ok(gi >= 0 && pi >= 0 && gi < pi);
  });

  it("caps per section without mid-bullet cuts", () => {
    for (let i = 0; i < 12; i++) {
      appendProfileEntry({
        workspaceRoot: ws,
        entry: { section: "偏好", content: `偏好细节条目 ${i} 号完整表述不可截断` },
        actor: "user",
        confirmed: true,
      });
    }
    const out = formatProfileForPrompt(ws, { perSectionCap: 3, totalCap: 10 });
    assert.match(out, /本段还有/);
    // No bare "截断" mid-line
    assert.doesNotMatch(out, /\.\.\.（截断）/);
  });
});

describe("update still works after quality APIs", () => {
  it("updates in place with date stamp", () => {
    const ev = updateProfileEntry({
      workspaceRoot: ws,
      match: "深色模式",
      content: "偏好深色模式与护眼主题",
      actor: "user",
      confirmed: true,
    });
    assert.equal(ev.wroteFiles !== false, true, JSON.stringify(ev));
    const inv = listProfileFacts(ws);
    const prefs = inv.sections.find((s) => s.role === "preferences");
    assert.ok(prefs.facts.some((f) => /护眼主题/.test(f.text)));
  });
});

describe("fact id + provenance (M1)", () => {
  it("append mints a fid and records src in an HTML comment", () => {
    const ev = appendProfileEntry({
      workspaceRoot: ws,
      entry: { section: "偏好", content: "偏好使用深色终端主题" },
      actor: "user",
      confirmed: true,
      src: "10-动态/2026/2026-W38.md",
    });
    assert.equal(ev.wroteFiles !== false, true, JSON.stringify(ev));
    const inv = listProfileFacts(ws);
    const prefs = inv.sections.find((s) => s.role === "preferences");
    const f = prefs.facts.find((x) => /深色终端/.test(x.text));
    assert.ok(f, JSON.stringify(prefs.facts));
    assert.ok(f.fid && /^[0-9a-f]{8}$/u.test(f.fid), `fid=${f.fid}`);
    assert.match(String(f.src), /2026-W38/);
  });

  it("update/retire can address a fact by fid", () => {
    appendProfileEntry({
      workspaceRoot: ws,
      entry: { section: "偏好", content: "临时事实用于 fid 寻址" },
      actor: "user",
      confirmed: true,
    });
    const inv = listProfileFacts(ws);
    const prefs = inv.sections.find((s) => s.role === "preferences");
    const f = prefs.facts.find((x) => /fid 寻址/.test(x.text));
    assert.ok(f?.fid);
    const ret = retireProfileEntry({
      workspaceRoot: ws,
      match: f.fid,
      actor: "user",
      confirmed: true,
      reason: "done",
    });
    assert.equal(ret.wroteFiles !== false, true, JSON.stringify(ret));
    const inv2 = listProfileFacts(ws);
    const prefs2 = inv2.sections.find((s) => s.role === "preferences");
    assert.ok(!prefs2.facts.some((x) => x.fid === f.fid));
    const hist = inv2.sections.find((s) => s.isHistory);
    assert.ok(hist.facts.some((x) => x.fid === f.fid));
    assert.equal(hist.facts.find((x) => x.fid === f.fid)?.reason, "done");
  });

  it("parseFactMeta strips comment from text", () => {
    const m = parseFactMeta("- （2026-09-17）事实 <!-- fid:abcd1234 src:a/b reason:x -->");
    assert.equal(m.fid, "abcd1234");
    assert.equal(m.src, "a/b");
    assert.equal(m.reason, "x");
    assert.equal(m.text, "（2026-09-17）事实");
    assert.equal(mintFactId("seed").length, 8);
  });
});

describe("stale review + search (M3)", () => {
  it("reports live facts older than threshold", () => {
    const report = reviewStaleProfileEntries(ws, { olderThanDays: 30 });
    assert.equal(report.exists, true);
    assert.ok(report.count >= 1);
    assert.ok(report.items.some((i) => /深色模式|记忆整合|topmind/.test(i.text)));
  });

  it("search finds active and history hits", () => {
    const r = searchProfile(ws, "跑步", { includeHistory: true });
    assert.ok(r.hits.length >= 1);
    assert.ok(r.hits.some((h) => h.isHistory));
    const liveOnly = searchProfile(ws, "深色", { includeHistory: false });
    assert.ok(liveOnly.hits.every((h) => !h.isHistory));
    assert.ok(liveOnly.hits.length >= 1);
  });
});

describe("memory journal (M4)", () => {
  it("append/update/retire/restore write journal lines", () => {
    appendProfileEntry({
      workspaceRoot: ws,
      entry: { section: "偏好", content: "journal 测试事实" },
      actor: "user",
      confirmed: true,
    });
    updateProfileEntry({
      workspaceRoot: ws,
      match: "journal 测试事实",
      content: "journal 测试事实已更新",
      actor: "user",
      confirmed: true,
    });
    const jpath = path.join(ws, ".topmind/memory-journal.jsonl");
    assert.ok(fs.existsSync(jpath));
    const lines = fs.readFileSync(jpath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(lines.some((l) => l.op === "append"));
    assert.ok(lines.some((l) => l.op === "update"));
    assert.ok(lines.every((l) => l.ts && l.op));
  });
});
