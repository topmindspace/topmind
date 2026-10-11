import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadContractRegistry } from "../../core/contract-registry.mjs";

// Anti-drift anchors: utr/core/contract-registry.mjs (contracts/*.json command
// surface) and lib/kernel-api.mjs (kernel function surface) are two separate
// sources of truth. These tests pin the two directions tools depend on:
//   a. every kernel-api symbol imported by utr/tools/*.mjs must actually be
//      exported by lib/kernel-api.mjs;
//   b. every command registered in the contract registry must have a dispatch
//      site in the tool script its contract points to (and vice versa).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UTR_ROOT = path.resolve(__dirname, "..", "..");
const ENGINE_ROOT = path.resolve(UTR_ROOT, "..");
const TOOLS_DIR = path.join(UTR_ROOT, "tools");
const KERNEL_API_PATH = path.join(ENGINE_ROOT, "lib", "kernel-api.mjs");

const KERNEL_IMPORT_RE = /import\s*\{([^;]*?)\}\s*from\s*["']\.\.\/\.\.\/lib\/kernel-api\.mjs["']/gu;
const DISPATCH_CASE_RE = /case\s+["']([^"']+)["']\s*:/gu;
const DISPATCH_IF_RE = /args\.command\s*={2,3}\s*["']([^"']+)["']/gu;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function listToolFiles() {
  const entries = await fs.readdir(TOOLS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
    .map((entry) => entry.name)
    .sort();
}

/** Extract exported symbol names imported from ../../lib/kernel-api.mjs. */
function extractKernelApiImports(source) {
  const symbols = [];
  for (const match of source.matchAll(KERNEL_IMPORT_RE)) {
    for (const part of match[1].split(",")) {
      const name = part.trim();
      if (!name) continue;
      // `X as Y` imports bind the exported name X
      symbols.push(name.split(/\s+as\s+/u)[0].trim());
    }
  }
  return symbols;
}

/** Extract command names dispatched via switch cases or if-chains. */
function extractDispatchedCommands(source) {
  const commands = new Set();
  for (const match of source.matchAll(DISPATCH_CASE_RE)) commands.add(match[1]);
  for (const match of source.matchAll(DISPATCH_IF_RE)) commands.add(match[1]);
  return commands;
}

test("utr/tools kernel-api imports all exist in lib/kernel-api.mjs exports", async () => {
  const kernelApi = await import(pathToFileURL(KERNEL_API_PATH).href);
  const exportedKeys = new Set(Object.keys(kernelApi));
  assert.ok(exportedKeys.size > 0, "lib/kernel-api.mjs should export symbols");

  const toolFiles = await listToolFiles();
  assert.ok(toolFiles.length > 0, "utr/tools should contain tool scripts");

  const drift = [];
  let importCount = 0;
  for (const file of toolFiles) {
    const source = await fs.readFile(path.join(TOOLS_DIR, file), "utf8");
    const symbols = extractKernelApiImports(source);
    importCount += symbols.length;
    for (const symbol of symbols) {
      if (!exportedKeys.has(symbol)) {
        drift.push(`${file}: imports missing export "${symbol}"`);
      }
    }
  }

  assert.ok(importCount > 0, "expected kernel-api imports across utr/tools (regex extraction sanity check)");
  assert.deepEqual(drift, [], `kernel-api drift detected:\n${drift.join("\n")}`);
});

test("registry commands are dispatched by the tool script each contract points to", async () => {
  const registry = await loadContractRegistry();
  assert.ok(registry.commandCount > 0, "registry should register commands");

  for (const [kind, contract] of registry.byKind) {
    const script = contract.execution?.script;
    assert.ok(script, `${kind}: contract missing execution.script`);
    const scriptPath = path.join(ENGINE_ROOT, script);
    const source = await fs.readFile(scriptPath, "utf8");

    const dispatched = extractDispatchedCommands(source);
    for (const commandName of Object.keys(contract.commands || {})) {
      assert.ok(
        dispatched.has(commandName),
        `${kind}.${commandName}: registered but not dispatched in ${script}`,
      );
    }
  }
});

test("tool dispatcher cases are all registered registry commands (no orphan handlers)", async () => {
  const registry = await loadContractRegistry();

  const registeredByScript = new Map();
  for (const [kind, contract] of registry.byKind) {
    const script = contract.execution?.script;
    assert.ok(script, `${kind}: contract missing execution.script`);
    registeredByScript.set(script, new Set(Object.keys(contract.commands || {})));
  }

  for (const [script, registered] of registeredByScript) {
    const scriptPath = path.join(ENGINE_ROOT, script);
    const source = await fs.readFile(scriptPath, "utf8");
    const dispatched = extractDispatchedCommands(source);
    for (const commandName of dispatched) {
      assert.ok(
        registered.has(commandName),
        `${script}: dispatches "${commandName}" but no contract registers it`,
      );
    }
  }
});

test("registry execution scripts cover exactly the utr/tools/*.mjs files", async () => {
  const registry = await loadContractRegistry();
  const toolFiles = await listToolFiles();

  const scriptFiles = new Set(
    [...registry.byKind.values()].map((contract) => path.basename(contract.execution.script)),
  );

  assert.deepEqual(
    toolFiles,
    [...scriptFiles].sort(),
    "utr/tools/*.mjs and contract execution.script basenames drifted",
  );
});
