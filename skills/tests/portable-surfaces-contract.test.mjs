import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const CONTENT_TRUTH = "topmind-workspace/categories-and-topics";

async function readText(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

function assertSurfaceContract(source, label, { desktopOptional = true, utrOptional = true } = {}) {
  assert.match(source, /topmind-workspace\/categories-and-topics/u, `${label} should name the v3.4 portable content truth`);
  assert.match(source, /only [`"]?topmind[`"]?|only daily|Expose only `topmind`|same daily entry \(`topmind`\)/iu, `${label} should expose a single daily entry`);
  assert.match(source, /not .*content truth|must not .*content truth|must not become topmind content truth|not .*topic state/iu, `${label} should reject host state as truth`);

  if (desktopOptional) {
    assert.match(source, /Desktop is not required|requires_desktop["\s:]*false|optional.*Desktop|Desktop, and MCP integrations must expose/u, `${label} should keep Desktop optional`);
  }
  if (utrOptional) {
    assert.match(source, /UTR is optional|requires_utr["\s:]*false|UTR.*optional|Use UTR.*when available|CLI\/MCP when available/iu, `${label} should keep UTR optional`);
  }

  assert.doesNotMatch(source, /\/Users\/|\/home\/|~\//u, `${label} should avoid host-specific absolute paths`);
  assert.doesNotMatch(source, /should fork OpenCode|writesContent:\s*true/iu, `${label} should not describe a forked or duplicated truth model`);
  // v3.4 architecture drift defenses
  assert.doesNotMatch(source, /topmind-workspace\/projects\//u, `${label} should not mention the v2.x projects/ root`);
  assert.doesNotMatch(source, /\bYYYY-类型-项目名\b/u, `${label} should not mention the v2.x project naming convention`);
  assert.doesNotMatch(source, /\bcreate-project\b|\binspect-project\b|\blist-projects\b|\bappend-project-memory\b|\bupdate-project\b|\bcheck-project\b|\bnormalize-project\b|\barchive-project\b|\brepair-project-index\b/u, `${label} should not reference v2.x UTR command names`);
}

test("portable surface docs mirror the v3.4 skill-pack content contract", async () => {
  const pack = await readJson("skills/topmind-pack.json");
  const contentTruth = pack.portable_contract.content_truth;

  assert.equal(contentTruth, CONTENT_TRUTH);
  assert.equal(pack.daily_entry, "topmind");
  assert.equal(pack.portable_contract.requires_desktop, false);
  assert.equal(pack.portable_contract.requires_utr, false);

  // v3.4: WORKSPACE-SPEC.md deleted (merged into PROJECT-MODEL/TOOLS/SKILL-ARCHITECTURE/DESIGN)
  // TUI surface removed; must not reappear in pack surfaces
  const surfaceDocs = {
    "skills README": await readText("skills/README.md"),
    "Codex integration": await readText("integrations/codex/README.md"),
    "Hermes integration": await readText("integrations/hermes/README.md"),
    "OpenCode integration": await readText("integrations/opencode/README.md"),
  };

  for (const [label, source] of Object.entries(surfaceDocs)) {
    assertSurfaceContract(source, label);
  }
});

test("install target manifests share the v3.4 portable host prohibitions", async () => {
  const pack = await readJson("skills/topmind-pack.json");

  for (const target of pack.install_targets) {
    const config = await readJson(target.path);

    assert.equal(config.daily_entry, pack.daily_entry);
    assert.equal(config.content_truth, pack.portable_contract.content_truth);
    assert.deepEqual(config.host_must_not, pack.portable_contract.host_must_not);
    assert.doesNotMatch(JSON.stringify(config), /\/Users\/|\/home\/|~\//u);
    // Packaged skills including topmind-loop + connectors + optional ledger
    assert.ok(config.skills.includes("topmind-loop"), `${target.id} should include topmind-loop`);
    assert.ok(config.skills.includes("topmind-ledger"), `${target.id} should include topmind-ledger`);
  }
});

test("core docs describe save settings instead of the old preview-confirm lifecycle", async () => {
  // v3.4: WORKSPACE-SPEC.md deleted; content merged into PROJECT-MODEL/TOOLS/SKILL-ARCHITECTURE/DESIGN
  const docs = {
    "README": await readText("README.md"),
    "Project model": await readText("PROJECT-MODEL.md"),
    "Skill architecture": await readText("SKILL-ARCHITECTURE.md"),
    "Design": await readText("DESIGN.md"),
    "Tools": await readText("TOOLS.md"),
    "UTR README": await readText("utr/README.md"),
    "UTR roadmap": await readText("utr/ROADMAP.md"),
  };

  const combined = Object.values(docs).join("\n");
  assert.match(combined, /writeback_mode:\s*auto\s*\|\s*confirm/u);
  assert.match(combined, /auto.*回执|auto.*receipt/iu);
  assert.match(combined, /confirm.*审阅|confirm.*review/iu);
  assert.match(combined, /保存设置/u);
  assert.match(combined, /自动保存/u);
  assert.match(combined, /审阅入口/u);

  for (const [label, source] of Object.entries(docs)) {
    assert.doesNotMatch(source, /Preview\/Confirm\/Evidence|confirm-preview-evidence/u, `${label} should not use the old lifecycle name`);
    for (const line of source.split(/\r?\n/u)) {
      assert.doesNotMatch(line, /confirm mode previews first|confirm 走预览\/审批|confirm[^\n。]*预览|confirm[^\n。]*preview/iu, `${label} should use review wording for confirm mode`);
      if (!line.includes("writeback_mode: auto | confirm")) {
        assert.doesNotMatch(line, /writeback mode|global writeback|auto mode|confirm mode|全局写回模式|当前写回模式|写回模式/u, `${label} should use save settings language outside protocol blocks`);
      }
    }
  }
});

test("write skill presents flexible entry points instead of workflow stages", async () => {
  const source = await readText("skills/topmind-write/SKILL.md");

  assert.match(source, /## Writing Entry Points/u);
  assert.doesNotMatch(source, /## Writing Stages|whichever stage|Stages are not rigid|skip stages|loop back|workflow stages/iu);
});

test("v3.4 docs are free of legacy project naming and project_type field", async () => {
  // v3.4: WORKSPACE-SPEC.md deleted
  const docs = {
    "README": await readText("README.md"),
    "Project model": await readText("PROJECT-MODEL.md"),
    "Skill architecture": await readText("SKILL-ARCHITECTURE.md"),
    "Design": await readText("DESIGN.md"),
    "Tools": await readText("TOOLS.md"),
    "UTR README": await readText("utr/README.md"),
  };

  const combined = Object.values(docs).join("\n");
  const deprecated = [
    { pattern: /topmind-workspace\/projects\//u, name: "old projects/ root" },
    { pattern: /\bYYYY-类型-项目名\b/u, name: "old project naming" },
    { pattern: /\bproject_type:\s/u, name: "old project_type field" },
    { pattern: /\bcreate-project\b|\binspect-project\b|\blist-projects\b|\bappend-project-memory\b|\bupdate-project\b|\bcheck-project\b|\bnormalize-project\b|\barchive-project\b|\brepair-project-index\b/u, name: "v2.x UTR command names" },
  ];

  for (const { pattern, name } of deprecated) {
    assert.doesNotMatch(combined, pattern, `v3.4 core docs should not contain ${name}`);
  }
});

test("v3.4 pack does not reference TUI surface (removed in v3.4)", async () => {
  const pack = await readJson("skills/topmind-pack.json");
  assert.ok(!pack.surfaces.includes("tui"), "v3.4 pack surfaces should not include tui");
  assert.ok(!pack.portable_contract.host_may_provide.includes("tui"), "v3.4 host_may_provide should not include tui");
});
