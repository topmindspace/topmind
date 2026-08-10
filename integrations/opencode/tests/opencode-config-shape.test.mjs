import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const integrationRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(integrationRoot, "..", "..");

test("OpenCode example config keeps a thin adapter shape", async () => {
  const raw = await fs.readFile(path.join(integrationRoot, "opencode.example.json"), "utf8");
  const config = JSON.parse(raw);

  assert.ok(Array.isArray(config.skills.paths));
  assert.ok(config.skills.paths.includes("${topmind_ENGINE_ROOT}/skills"));
  assert.equal(config.mcp.topmind.type, "local");
  assert.deepEqual(config.mcp.topmind.command, [
    "node",
    "${topmind_ENGINE_ROOT}/utr/server/topmind-mcp.mjs",
  ]);
  assert.deepEqual(config.plugin, [
    "${topmind_ENGINE_ROOT}/integrations/opencode/plugins/topmind-plugin.ts",
  ]);
  assert.doesNotMatch(raw, /\/Users\/|\/home\/|~\//u);
});

test("OpenCode command templates exist for capture and doctor", async () => {
  const capture = await fs.readFile(path.join(integrationRoot, "commands", "topmind-capture.md"), "utf8");
  const doctor = await fs.readFile(path.join(integrationRoot, "commands", "topmind-doctor.md"), "utf8");

  assert.match(capture, /capture -> auto route/u);
  assert.match(capture, /workspace-write\.capture-note/u);
  assert.match(doctor, /topmind-cli\.mjs doctor --json --mcp/u);
});

test("OpenCode plugin skeleton exports a topmind plugin", async () => {
  const source = await fs.readFile(path.join(repoRoot, "integrations", "opencode", "plugins", "topmind-plugin.ts"), "utf8");

  assert.match(source, /export default async function topmindPlugin/u);
  assert.match(source, /name: "topmind"/u);
});

test("OpenCode adapter follows the portable skill-pack contract", async () => {
  const [pack, target, readme, pluginSource] = await Promise.all([
    fs.readFile(path.join(repoRoot, "skills", "topmind-pack.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(repoRoot, "skills", "install-targets", "opencode.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(integrationRoot, "README.md"), "utf8"),
    fs.readFile(path.join(repoRoot, "integrations", "opencode", "plugins", "topmind-plugin.ts"), "utf8"),
  ]);

  assert.equal(pack.portable_contract.requires_desktop, false);
  assert.equal(target.content_truth, pack.portable_contract.content_truth);
  assert.ok(target.capabilities.includes("skills"));
  assert.ok(target.capabilities.includes("mcp"));
  assert.ok(target.capabilities.includes("plugin"));
  assert.match(readme, /content truth/u);
  assert.match(readme, /Expose only `topmind`|only daily.*`topmind`/iu);

  assert.match(pluginSource, /contentTruth:\s*"topmind-workspace\/categories-and-topics"/u);
  assert.match(pluginSource, /writesContent:\s*false/u);
  assert.doesNotMatch(readme + "\n" + pluginSource, /should fork OpenCode|write topmind content directly:\s*true|writesContent:\s*true/u);
});
