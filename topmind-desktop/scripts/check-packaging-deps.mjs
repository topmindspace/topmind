#!/usr/bin/env node
/**
 * Packaging dependency gate — catch peer deps that electron-builder will omit.
 *
 * AI SDK (`ai`, `@ai-sdk/*`) declares `zod` as a peerDependency only.
 * electron-builder walks package.json production dependencies; undeclared peers
 * install fine in dev (npm auto-peer) but are missing from the asar on Windows/mac,
 * producing runtime errors like "Cannot find module 'zod'".
 *
 * Fail if any required packaging peer is missing from package.json#dependencies
 * or from node_modules.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const require = createRequire(path.join(desktopRoot, "package.json"));

/** Peers that must be direct production deps for asar packaging. */
const REQUIRED_PACKAGING_PEERS = [
  {
    name: "zod",
    requiredBy: ["ai", "@ai-sdk/openai", "@ai-sdk/anthropic", "@ai-sdk/google", "@ai-sdk/openai-compatible"],
    reason: "AI SDK peer — missing in packaged asar breaks Windows/mac AI runtime",
  },
  {
    name: "yaml",
    requiredBy: ["lib/workspace-model.mjs", "lib/contract-engine.mjs"],
    reason:
      "Engine lib runtime — resolved via lib/yaml-bridge.mjs (createRequire fallback to asar). " +
      "Must be in package.json#dependencies so electron-builder includes it in asar node_modules/. " +
      "electron-builder strips node_modules/ from extraResources, so the bridge resolves from asar at runtime.",
  },
];

async function readJson(rel) {
  return JSON.parse(await fs.readFile(path.join(desktopRoot, rel), "utf8"));
}

function resolveInstalled(name) {
  try {
    const pkgPath = require.resolve(`${name}/package.json`);
    return JSON.parse(require("node:fs").readFileSync(pkgPath, "utf8")).version;
  } catch {
    return null;
  }
}

const pkg = await readJson("package.json");
const deps = pkg.dependencies || {};
const errors = [];
const report = [];

for (const entry of REQUIRED_PACKAGING_PEERS) {
  const declared = deps[entry.name];
  const installed = resolveInstalled(entry.name);
  const ok = Boolean(declared) && Boolean(installed);
  report.push({
    name: entry.name,
    declared: declared ?? null,
    installed: installed ?? null,
    requiredBy: entry.requiredBy,
    reason: entry.reason,
    ok,
  });
  if (!declared) {
    errors.push(
      `missing production dependency "${entry.name}" (required by ${entry.requiredBy.join(", ")}): ${entry.reason}`,
    );
  } else if (!installed) {
    errors.push(`"${entry.name}" is declared but not installed — run npm ci in topmind-desktop`);
  }
}

// Also verify AI packages themselves are production deps (not only dev)
const aiPackages = [
  "ai",
  "@ai-sdk/openai",
  "@ai-sdk/anthropic",
  "@ai-sdk/google",
  "@ai-sdk/openai-compatible",
];
for (const name of aiPackages) {
  if (!deps[name]) {
    errors.push(`AI package "${name}" must be a production dependency (electron main process)`);
  }
}

process.stdout.write(
  `${JSON.stringify({ ok: errors.length === 0, packagingPeers: report, errors }, null, 2)}\n`,
);

if (errors.length > 0) {
  process.stderr.write(
    `[check-packaging-deps] FAIL (${errors.length}):\n${errors.map((e) => `  - ${e}`).join("\n")}\n`,
  );
  process.exit(1);
}

process.stdout.write("[check-packaging-deps] OK — packaging peer deps declared and installed\n");
