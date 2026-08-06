/**
 * Guard: AI SDK peer deps (zod) must be declared for electron-builder packaging.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));

function readPkg() {
  return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
}

test("zod is a direct production dependency (AI SDK peer for asar)", () => {
  const pkg = readPkg();
  assert.ok(pkg.dependencies?.zod, "zod must be in dependencies — peer-only installs omit it from asar");
  assert.match(String(pkg.dependencies.zod), /^[\^~]?[34]\./, "zod major should be 3 or 4 for AI SDK");
});

test("yaml is a direct production dependency (engine lib runtime for asar)", () => {
  const pkg = readPkg();
  assert.ok(pkg.dependencies?.yaml, "yaml must be in dependencies — engine lib/ imports it at runtime");
  assert.match(String(pkg.dependencies.yaml), /^[\^~]?2\./, "yaml major should be 2.x");
});

test("AI SDK packages are production deps (main-process runtime)", () => {
  const pkg = readPkg();
  for (const name of [
    "ai",
    "@ai-sdk/openai",
    "@ai-sdk/anthropic",
    "@ai-sdk/google",
    "@ai-sdk/openai-compatible",
  ]) {
    assert.ok(pkg.dependencies?.[name], `${name} must be a production dependency`);
  }
});

test("zod resolves from package root (same as electron main)", () => {
  const zodPkg = require.resolve("zod/package.json");
  assert.ok(existsSync(zodPkg), "zod/package.json must resolve");
  const version = JSON.parse(readFileSync(zodPkg, "utf8")).version;
  assert.ok(version, "zod version present");
});

test("yaml resolves from package root (asar dependency walk source)", () => {
  const yamlPkg = require.resolve("yaml/package.json");
  assert.ok(existsSync(yamlPkg), "yaml/package.json must resolve");
  const version = JSON.parse(readFileSync(yamlPkg, "utf8")).version;
  assert.ok(version, "yaml version present");
});

test("lib/yaml-bridge.mjs exists (enables asar fallback for bare imports)", () => {
  const bridge = path.join(path.resolve(root, ".."), "lib", "yaml-bridge.mjs");
  assert.ok(existsSync(bridge), "lib/yaml-bridge.mjs must exist — resolves yaml via createRequire(asar) in packaged mode");
});

test("electron-builder files include electron + dist (deps via dependency walk)", () => {
  const yml = readFileSync(path.join(root, "electron-builder.yml"), "utf8");
  assert.match(yml, /dist\/\*\*\/\*/);
  assert.match(yml, /electron\/\*\*\/\*/);
  // asar on so node_modules are packed via dependency graph
  assert.match(yml, /asar:\s*true/);
});
