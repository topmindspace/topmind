import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(skillsRoot, "..");
const contractsRoot = path.join(repoRoot, "utr", "contracts");

async function readJson(relPath) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, relPath), "utf8"));
}

/** Load actual UTR command surface: { domain: { command: exposure } } */
async function loadActualSurface() {
  const surface = {};
  const domains = (await fs.readdir(contractsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const domain of domains) {
    const contractPath = path.join(contractsRoot, domain, `${domain}.json`);
    const contract = JSON.parse(await fs.readFile(contractPath, "utf8"));
    surface[domain] = Object.fromEntries(
      Object.entries(contract.commands || {}).map(([name, cmd]) => [name, cmd.exposure || "advanced"]),
    );
  }
  return surface;
}

async function walkMarkdown(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      out.push(...await walkMarkdown(abs));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(abs);
    }
  }
  return out;
}

test("pack.json utr.command_vocabulary matches utr/contracts actual commands", async () => {
  const manifest = await readJson("skills/topmind-pack.json");
  const actual = await loadActualSurface();
  const vocab = manifest.utr.command_vocabulary;

  // Every domain in vocabulary exists in contracts
  for (const [domain, commands] of Object.entries(vocab)) {
    assert.ok(actual[domain], `domain ${domain} should exist in utr/contracts`);
    for (const command of commands) {
      assert.ok(
        actual[domain][command],
        `${domain}.${command} declared in pack.json should exist in utr/contracts/${domain}/${domain}.json`,
      );
    }
  }

  // No undeclared commands: every contract command appears in vocabulary
  for (const [domain, commands] of Object.entries(actual)) {
    assert.ok(Array.isArray(vocab[domain]), `domain ${domain} should be declared in pack.json command_vocabulary`);
    for (const command of Object.keys(commands)) {
      assert.ok(
        vocab[domain].includes(command),
        `${domain}.${command} exists in contracts but missing from pack.json command_vocabulary`,
      );
    }
  }
});

test("pack.json command_count / mcp_default_count match contracts reality", async () => {
  const manifest = await readJson("skills/topmind-pack.json");
  const actual = await loadActualSurface();
  const all = Object.values(actual).flatMap((commands) => Object.values(commands));
  const total = all.length;
  const mcpDefault = all.filter((exposure) => exposure === "primary" || exposure === "danger").length;

  assert.equal(manifest.utr.command_count, total, "command_count should equal actual contract command total");
  assert.equal(
    manifest.utr.mcp_default_count,
    mcpDefault,
    "mcp_default_count should equal primary+danger exposure count",
  );
  assert.equal(Object.keys(actual).length, 8, "should be 8 command domains");
});

test("pack.json command_exposure lists match contract exposure levels", async () => {
  const manifest = await readJson("skills/topmind-pack.json");
  const actual = await loadActualSurface();
  const exposure = manifest.utr.command_exposure;

  for (const [level, ids] of Object.entries(exposure)) {
    for (const id of ids) {
      const [domain, command] = id.split(".");
      assert.ok(
        actual[domain]?.[command],
        `command_exposure.${level} references unknown command ${id}`,
      );
      assert.equal(
        actual[domain][command],
        level,
        `${id} exposure in contracts (${actual[domain][command]}) should match pack.json (${level})`,
      );
    }
  }
});

test("lib/*.mjs paths referenced in skills docs exist on disk", async () => {
  const markdownFiles = await walkMarkdown(skillsRoot);
  const libRefPattern = /lib\/[\w.-]+\.mjs/gu;
  const missing = [];
  for (const file of markdownFiles) {
    const content = await fs.readFile(file, "utf8");
    const refs = new Set(content.match(libRefPattern) || []);
    for (const ref of refs) {
      const abs = path.join(repoRoot, ref);
      try {
        await fs.access(abs);
      } catch {
        missing.push(`${path.relative(repoRoot, file)} -> ${ref}`);
      }
    }
  }
  assert.deepEqual(missing, [], `missing lib files referenced from skills docs: ${missing.join(", ")}`);
});
