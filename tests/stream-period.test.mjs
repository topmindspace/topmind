/**
 * Stream packing + period note helpers
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  periodParts,
  periodFileStem,
  appendToPeriodBody,
  seedPeriodNoteBody,
  normalizeStreamConfig,
  normalizeMemoryConfig,
  packingLabel,
  reconcilePeriodBody,
  detectCompletionSubject,
  isoWeekKeyFromDate,
} from "../lib/stream-period.mjs";
import {
  resolveWorkspaceModel,
  resolveStreamTarget,
  resolveMemoryPaths,
  ensureCoreProfile,
  shouldAppendToPeriodNote,
} from "../lib/workspace-model.mjs";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("stream-period helpers", () => {
  it("normalizes packing defaults to weekly", () => {
    assert.equal(normalizeStreamConfig({}).packing, "weekly");
    assert.equal(normalizeStreamConfig({ packing: "atom" }).packing, "atom");
    assert.equal(normalizeStreamConfig({ packing: "nope" }).packing, "weekly");
    assert.equal(packingLabel("weekly"), "每周一本");
  });

  it("builds ISO week stem", () => {
    const d = new Date(2026, 6, 22); // 2026-07-22 local
    const stem = periodFileStem("weekly", d);
    assert.match(stem, /^2026-W\d{2}$/u);
    assert.equal(periodFileStem("daily", d), "2026-07-22");
    assert.equal(periodFileStem("monthly", d), "2026-07");
    assert.equal(periodFileStem("atom", d), null);
  });

  it("appends under day heading in weekly body", () => {
    const d = new Date(2026, 6, 22);
    const seed = seedPeriodNoteBody("weekly", d);
    const once = appendToPeriodBody(seed, {
      content: "要做方案评审",
      title: "待办",
      packing: "weekly",
      appendHeading: "day",
      date: d,
    });
    assert.match(once, /要做方案评审/u);
    const twice = appendToPeriodBody(once, {
      content: "方案评审完成",
      packing: "weekly",
      appendHeading: "day",
      date: d,
    });
    assert.match(twice, /方案评审完成/u);
    // single day heading
    const headingCount = (twice.match(/## 07-22/gu) || []).length;
    assert.equal(headingCount, 1);
  });

  it("normalizes memory config", () => {
    assert.equal(normalizeMemoryConfig({}).profileFile, "profile.md");
    assert.equal(normalizeMemoryConfig({ dir: "10-动态" }).dir, "10-动态");
    assert.equal(normalizeMemoryConfig({ dir: "../etc" }).dir, null);
    assert.deepEqual(
      normalizeMemoryConfig({ files: ["团队.md", "profile.md", "bad/path.md"] }).files,
      ["团队.md"],
    );
  });

  it("detects completion subjects", () => {
    assert.equal(detectCompletionSubject("方案评审完成了"), "方案评审");
    assert.equal(detectCompletionSubject("完成了 原型"), "原型");
    assert.equal(detectCompletionSubject("随便记一句"), null);
  });

  it("reconciles period body: marks todos and dedups", () => {
    const body = `# 2026-W30 动态

## 进行中

- [ ] 方案评审
- [ ] 方案评审

## 07-21 周一

- 09:00 要做方案评审

## 07-22 周二

- 10:00 方案评审完成了
- 10:00 方案评审完成了
`;
    const r = reconcilePeriodBody(body, { packing: "weekly" });
    assert.equal(r.changed, true);
    assert.match(r.body, /\[x\].*方案评审/u);
    assert.ok(r.changes.length >= 1);
  });

  it("isoWeekKeyFromDate", () => {
    assert.match(isoWeekKeyFromDate(new Date(2026, 6, 22)), /^2026-W\d{2}$/u);
  });
});

describe("workspace stream + memory resolution", () => {
  it("resolves weekly period under stream category for simple template", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-stream-"));
    try {
      for (const d of ["00-收件箱", "10-动态", "20-专题", "88-输出", "99-归档"]) {
        await fs.mkdir(path.join(tmp, d));
      }
      await fs.writeFile(
        path.join(tmp, "topmind.yaml"),
        [
          "contract_version: 4",
          "workspace:",
          "  template: stream",
          "stream:",
          "  packing: weekly",
          "  append_heading: day",
          "memory:",
          "  dir: memory",
          "  layers:",
          "    global:",
          "      file: profile.md",
        ].join("\n") + "\n",
        "utf8",
      );
      const model = resolveWorkspaceModel({ workspaceRoot: tmp, engineRoot });
      assert.equal(model.templateId, "stream");
      assert.equal(model.stream.packing, "weekly");

      const target = resolveStreamTarget({ workspaceRoot: tmp, engineRoot });
      assert.ok(target.streamCategory);
      assert.equal(target.streamCategory.directory, "10-动态");
      assert.ok(target.periodAbsPath?.endsWith(".md"));
      assert.ok(target.periodRelPath?.startsWith("10-动态/"));
      assert.equal(shouldAppendToPeriodNote(target.streamCategory, "weekly"), true);
      assert.equal(shouldAppendToPeriodNote(target.streamCategory, "atom"), false);

      const mem = resolveMemoryPaths({ workspaceRoot: tmp, engineRoot });
      assert.equal(mem.profileFile, "profile.md");
      assert.ok(mem.profileRelPath?.includes("profile.md"));

      const ensured = ensureCoreProfile(tmp, { engineRoot });
      assert.equal(ensured.ok, true);
      assert.equal(ensured.created, true);
      const body = await fs.readFile(ensured.profileAbsPath, "utf8");
      assert.match(body, /profile/u);
      assert.match(body, /## 偏好/u);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("periodParts is stable for known date", () => {
    const p = periodParts(new Date(2026, 0, 5)); // Mon
    assert.equal(p.ymd, "2026-01-05");
    assert.ok(p.isoWeek.startsWith("2026-W"));
  });
});
