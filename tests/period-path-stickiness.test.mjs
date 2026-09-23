/**
 * Period-path stickiness (2026-08-23 round 3): pre-yearDir workspaces must
 * not fork a period across flat + year-dir twin files after upgrade.
 * Covers resolveStreamTarget / resolvePeriodMemoryPath / archiveStreamYear.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import {
  resolveStreamTarget,
  archiveStreamYear,
} from "../lib/workspace-model.mjs";
import { resolvePeriodMemoryPath } from "../lib/memory-engine.mjs";
import { writeContract } from "../lib/contract-engine.mjs";

const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function mkWs(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Seed a minimal stream workspace: contract (no year_dir key = legacy) + dirs. */
function seedLegacyStreamWs(ws, { withFlatCurrent = true } = {}) {
  writeContract(ws, {
    contract_version: 4,
    // Deliberately NO stream.year_dir — a pre-D1 (2026-08-09) workspace
    // upgrade path fills it with the default true.
    stream: { packing: "weekly", append_heading: "day" },
  });
  fs.mkdirSync(path.join(ws, "10-动态"), { recursive: true });
  fs.mkdirSync(path.join(ws, "99-归档"), { recursive: true });
  if (withFlatCurrent) {
    // Current week's flat file — what the user has been appending to
    const now = new Date();
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const isoYear = d.getUTCFullYear();
    const week = Math.ceil(((d - new Date(Date.UTC(isoYear, 0, 1))) / 86400000 + 1) / 7);
    const stem = `${isoYear}-W${String(week).padStart(2, "0")}`;
    fs.writeFileSync(path.join(ws, "10-动态", `${stem}.md`), "# flat current\n");
    return stem;
  }
  return null;
}

describe("resolveStreamTarget period-path stickiness", () => {
  let ws;
  let stem;
  before(() => {
    ws = mkWs("tm-sticky-stream-");
    stem = seedLegacyStreamWs(ws);
  });
  after(() => fs.rmSync(ws, { recursive: true, force: true }));

  it("keeps appending to the existing flat file for the current period (no year twin)", () => {
    const target = resolveStreamTarget({ workspaceRoot: ws, engineRoot });
    assert.equal(target.yearDir, true, "legacy contract upgrades to yearDir default true");
    assert.equal(
      target.periodRelPath,
      `10-动态/${stem}.md`,
      "flat file for current period must win over the year-dir path",
    );
    assert.equal(fs.existsSync(path.join(ws, "10-动态", "2026")), false, "no year twin created implicitly");
  });

  it("targets the year dir for a fresh period (no flat file)", () => {
    // Remove the flat current file → new period layout applies
    fs.unlinkSync(path.join(ws, "10-动态", `${stem}.md`));
    const target = resolveStreamTarget({ workspaceRoot: ws, engineRoot });
    assert.match(target.periodRelPath, /^10-动态\/\d{4}\/\d{4}-W\d{2}\.md$/u);
  });

  it("prefers the year twin once both exist (never jumps back)", () => {
    const target1 = resolveStreamTarget({ workspaceRoot: ws, engineRoot });
    fs.mkdirSync(path.dirname(path.join(ws, target1.periodRelPath)), { recursive: true });
    fs.writeFileSync(path.join(ws, target1.periodRelPath), "# year twin\n");
    fs.writeFileSync(path.join(ws, "10-动态", `${target1.periodStem}.md`), "# flat twin\n");
    const target2 = resolveStreamTarget({ workspaceRoot: ws, engineRoot });
    assert.match(target2.periodRelPath, /\/\d{4}\/\d{4}-W\d{2}\.md$/u, "year twin wins when both exist");
  });

  it("keeps appending to the year-dir file after year_dir is toggled off", () => {
    // Mirror of the legacy-flat case: a workspace born with yearDir=true holds
    // the current period under {year}/; toggling the setting off must not fork
    // a flat twin for the SAME period (new periods do go flat).
    const wsOff = mkWs("tm-sticky-off-");
    try {
      writeContract(wsOff, {
        contract_version: 4,
        stream: { packing: "weekly", append_heading: "day", year_dir: true },
      });
      fs.mkdirSync(path.join(wsOff, "10-动态"), { recursive: true });
      fs.mkdirSync(path.join(wsOff, "99-归档"), { recursive: true });
      const born = resolveStreamTarget({ workspaceRoot: wsOff, engineRoot });
      fs.mkdirSync(path.dirname(path.join(wsOff, born.periodRelPath)), { recursive: true });
      fs.writeFileSync(path.join(wsOff, born.periodRelPath), "# born in year dir\n");

      writeContract(wsOff, {
        contract_version: 4,
        stream: { packing: "weekly", append_heading: "day", year_dir: false },
      });
      const after = resolveStreamTarget({ workspaceRoot: wsOff, engineRoot });
      assert.equal(after.yearDir, false);
      assert.equal(
        after.periodRelPath,
        born.periodRelPath,
        "current period stays in the year-dir file after toggling off",
      );
      assert.equal(
        fs.existsSync(path.join(wsOff, "10-动态", `${born.periodStem}.md`)),
        false,
        "no flat twin created for the same period",
      );
    } finally {
      fs.rmSync(wsOff, { recursive: true, force: true });
    }
  });
});

describe("resolvePeriodMemoryPath stickiness", () => {
  it("writes digest updates into the legacy flat reflection file", () => {
    const ws = mkWs("tm-sticky-mem-");
    try {
      const periodic = path.join(ws, "memory", "periodic");
      fs.mkdirSync(periodic, { recursive: true });
      fs.writeFileSync(path.join(periodic, "2025-W03.md"), "# old flat reflection\n");
      const p = resolvePeriodMemoryPath(ws, "2025-W03");
      assert.equal(p, path.join(periodic, "2025-W03.md"), "flat file sticky for existing period");
      const fresh = resolvePeriodMemoryPath(ws, "2026-W01");
      assert.equal(fresh, path.join(periodic, "2026", "2026-W01.md"), "new periods use year dir");
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});

describe("archiveStreamYear handles flat period files", () => {
  it("archives a flat-only year into 99-归档/stream-archive/{year}/", async () => {
    const ws = mkWs("tm-sticky-arch-");
    try {
      writeContract(ws, { contract_version: 4, stream: { packing: "weekly" } });
      fs.mkdirSync(path.join(ws, "10-动态"), { recursive: true });
      fs.mkdirSync(path.join(ws, "99-归档"), { recursive: true });
      fs.writeFileSync(path.join(ws, "10-动态", "2024-W05.md"), "# old\n");
      fs.writeFileSync(path.join(ws, "10-动态", "2024-W22.md"), "# old\n");
      fs.writeFileSync(path.join(ws, "10-动态", "2025-W01.md"), "# keep (other year)\n");

      const result = await archiveStreamYear({ workspaceRoot: ws, year: "2024", engineRoot });
      assert.equal(result.ok, true, `archive should succeed: ${result.reason || ""}`);
      assert.equal(result.movedCount, 2);
      const dest = path.join(ws, "99-归档", "stream-archive", "2024");
      assert.ok(fs.existsSync(path.join(dest, "2024-W05.md")));
      assert.ok(fs.existsSync(path.join(dest, "2024-W22.md")));
      assert.equal(fs.existsSync(path.join(ws, "10-动态", "2024-W05.md")), false);
      assert.ok(fs.existsSync(path.join(ws, "10-动态", "2025-W01.md")), "other year untouched");
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("still reports year-dir-not-found when nothing matches the year", async () => {
    const ws = mkWs("tm-sticky-arch2-");
    try {
      writeContract(ws, { contract_version: 4, stream: { packing: "weekly" } });
      fs.mkdirSync(path.join(ws, "10-动态"), { recursive: true });
      fs.mkdirSync(path.join(ws, "99-归档"), { recursive: true });
      const result = await archiveStreamYear({ workspaceRoot: ws, year: "2023", engineRoot });
      assert.equal(result.ok, false);
      assert.equal(result.reason, "year-dir-not-found");
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
