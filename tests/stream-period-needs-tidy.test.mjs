/**
 * Stream 未整理 / needs-tidy is the shipped list flag `reconciled`.
 * Drive listStreamPeriods + reconcilePeriodBody — not a reimplementation.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { writeContract } from "../lib/contract-engine.mjs";
import { listStreamPeriods } from "../lib/workspace-model.mjs";
import {
  periodFileStem,
  periodYearDir,
  periodNoteNeedsTidy,
  reconcilePeriodBody,
  stripPeriodFrontmatter,
} from "../lib/stream-period.mjs";

const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function tidyMarkdown(title) {
  return [
    "---",
    `title: ${title}`,
    "type: stream-period",
    "---",
    `# ${title}`,
    "",
    "## 进行中",
    "",
    "## 记录",
    "",
    "## 07-21 周一",
    "",
    "- 09:00 只记了一件不同的事",
    "",
  ].join("\n");
}

function messyMarkdown(title, extraFm = []) {
  return [
    "---",
    `title: ${title}`,
    "type: stream-period",
    ...extraFm,
    "---",
    `# ${title}`,
    "",
    "## 进行中",
    "",
    "- [ ] 方案评审",
    "- [ ] 方案评审",
    "",
    "## 07-21 周一",
    "",
    "- 09:00 要做方案评审",
    "- 10:00 方案评审完成了",
    "- 10:00 方案评审完成了",
    "",
  ].join("\n");
}

function mkWs() {
  const ws = fsSync.mkdtempSync(path.join(os.tmpdir(), "tm-period-tidy-"));
  writeContract(ws, {
    contract_version: 4,
    stream: { packing: "weekly", append_heading: "day", year_dir: true },
  });
  fsSync.mkdirSync(path.join(ws, "10-动态"), { recursive: true });
  return ws;
}

function seed(ws, rel, body) {
  const abs = path.join(ws, rel);
  fsSync.mkdirSync(path.dirname(abs), { recursive: true });
  fsSync.writeFileSync(abs, body, "utf8");
}

describe("periodNoteNeedsTidy (shipped reconcile meaning)", () => {
  it("tidy body without stamp does not need tidy", () => {
    const md = tidyMarkdown("2024-W10");
    assert.equal(periodNoteNeedsTidy(md, { packing: "weekly" }), false);
    const body = stripPeriodFrontmatter(md);
    assert.equal(reconcilePeriodBody(body, { packing: "weekly" }).changed, false);
  });

  it("duplicate / completable body needs tidy even with reconciled_at stamp", () => {
    const md = messyMarkdown("2024-W11", ["reconciled_at: 2024-03-01T00:00:00.000Z"]);
    assert.equal(periodNoteNeedsTidy(md, { packing: "weekly" }), true);
    const body = stripPeriodFrontmatter(md);
    assert.equal(reconcilePeriodBody(body, { packing: "weekly" }).changed, true);
  });
});

describe("listStreamPeriods reconciled flag (UI 未整理)", () => {
  it("past tidy without stamp is reconciled; messy is not; current can still need tidy", async () => {
    const ws = mkWs();
    try {
      const now = new Date();
      const currentStem = periodFileStem("weekly", now);
      const currentYear = periodYearDir("weekly", true, now);
      assert.ok(currentStem);
      assert.ok(currentYear);

      seed(ws, "10-动态/2024/2024-W10.md", tidyMarkdown("2024-W10"));
      seed(ws, "10-动态/2024/2024-W11.md", messyMarkdown("2024-W11"));
      seed(
        ws,
        `10-动态/${currentYear}/${currentStem}.md`,
        messyMarkdown(currentStem),
      );

      const list = await listStreamPeriods({
        workspaceRoot: ws,
        engineRoot,
        limit: 50,
      });
      const byName = Object.fromEntries(list.map((p) => [p.fileName, p]));

      const pastTidy = byName["2024-W10.md"];
      const pastMessy = byName["2024-W11.md"];
      const current = byName[`${currentStem}.md`];

      assert.ok(pastTidy, "past tidy period listed");
      assert.ok(pastMessy, "past messy period listed");
      assert.ok(current, "current period listed");

      // Flag the UI uses (`p.reconciled`), not a hardcoded title string.
      assert.equal(pastTidy.reconciled, true, "past tidy without stamp is not 未整理");
      assert.equal(pastMessy.reconciled, false, "body that would still change is need-tidy");
      assert.equal(current.reconciled, false, "current period can still be need-tidy");
    } finally {
      fsSync.rmSync(ws, { recursive: true, force: true });
    }
  });
});
