import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadContractRegistry, getCommand } from "../../core/contract-registry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const contractsRoot = path.join(repoRoot, "utr", "contracts");

async function contractFiles(dir = contractsRoot) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await contractFiles(fullPath));
    } else if (entry.name.endsWith(".json")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

test("real UTR contracts run on Node", async () => {
  const files = (await contractFiles()).filter((file) => !file.endsWith(`${path.sep}schema.json`));
  assert.ok(files.length > 0);

  for (const file of files) {
    const contract = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(contract.execution.runtime, "node", `${file} should use the production Node runtime`);
  }
});

test("runtime policy documents one Node runtime for UTR contracts", async () => {
  const files = [
    "README.md",
    "TOOLS.md",
    "PROJECT-MODEL.md",
    "SKILL-ARCHITECTURE.md",
    "DESIGN.md",
    "AGENTS.md",
    "utr/README.md",
    "utr/ROADMAP.md",
    "utr/core/doctor.mjs",
    "utr/core/tool-executor.mjs",
  ];
  const sources = Object.fromEntries(await Promise.all(files.map(async (file) => [
    file,
    await fs.readFile(path.join(repoRoot, file), "utf8"),
  ])));
  const combined = Object.entries(sources)
    .map(([file, source]) => `\n--- ${file} ---\n${source}`)
    .join("\n");
  const roadmap = sources["utr/ROADMAP.md"];
  const schema = JSON.parse(await fs.readFile(path.join(repoRoot, "utr/contracts/schema.json"), "utf8"));
  const retiredRuntime = ["py", "thon3"].join("");

  assert.equal(schema.properties.execution.properties.runtime.const, "node");
  assert.equal(schema.properties.execution.properties.runtime.enum, undefined);
  assert.match(roadmap, /TypeScript\/Node-only/u);
  assert.match(roadmap, /Contract runtime: `node`/u);
  assert.match(roadmap, /workspace-read`, `workspace-write`, `workspace-transform`, `workspace-maintain`, `contract`, `memory`, `lifecycle`, and `derived` on Node contracts/u);
  assert.match(roadmap, /workspace-write` runs on Node/u);
  assert.equal(combined.includes(retiredRuntime), false);
  assert.doesNotMatch(combined, /project-(?:read|write|check|transform|maintain)\.py/u);
  assert.doesNotMatch(combined, /workspace_audit\.py/u);
  assert.doesNotMatch(combined, /Python tools = migration-period detail/u);
  assert.doesNotMatch(combined, /migration may keep Python temporarily/u);
  assert.equal(combined.includes(`${retiredRuntime} tools now ->`), false);
  assert.doesNotMatch(combined, /production contracts should migrate by domain/u);
});

test("full topic replacement uses writeback mode and reversible safety instead of a second confirmation flag", async () => {
  const registry = await loadContractRegistry();
  // v3.4: workspace-write.update-topic (not update-project)
  const entry = getCommand(registry, "workspace-write", "update-topic");

  assert.equal(entry.command.review_policy, "preview_or_auto");
  assert.equal(entry.command.inputs.replaceReason.required, true);
  assert.equal(entry.command.inputs.confirmFullReplace, undefined);
  assert.ok(entry.command.inputs.writebackMode);
  assert.equal(entry.command.inputs.writebackMode.default, "auto");
  assert.ok(entry.command.workflow_note.includes("snapshot"));
});

test("archive topic uses writeback mode and reversible archive semantics instead of a special danger confirmation", async () => {
  const registry = await loadContractRegistry();
  // v3.4: workspace-maintain.archive-topic
  const entry = getCommand(registry, "workspace-maintain", "archive-topic");

  assert.equal(entry.command.risk_level, "high");
  assert.equal(entry.command.review_policy, "preview_or_auto");
  assert.equal(entry.command.inputs.reason.required, true);
  assert.ok(entry.command.inputs.writebackMode);
  assert.equal(entry.command.inputs.writebackMode.default, "auto");
  assert.equal(entry.command.review_overrides, undefined);
  assert.ok(entry.command.workflow_note.includes("without a second confirmation"));
});