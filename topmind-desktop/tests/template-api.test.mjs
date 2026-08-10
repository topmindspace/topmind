/**
 * Desktop template-api — engine-root loading (packaged + monorepo).
 * Guards the fix for ERR_MODULE_NOT_FOUND on Windows/mac installers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listTemplateDescriptors,
  resolveConnectorCategory,
  listTemplateIds,
  loadTemplate,
} from "../electron/lib/template-api.mjs";
import { setEngineRoot, getEngineRoot } from "../electron/lib/workspace-home.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const electronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../electron");

test("electron/ never static-imports monorepo ../../lib", async () => {
  const ban = /from\s+["'](?:\.\.\/)+lib\//u;
  const { readdirSync } = await import("node:fs");
  function walk(dir, files = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, files);
      else if (/\.mjs$/u.test(e.name)) files.push(full);
    }
    return files;
  }
  for (const file of walk(electronDir)) {
    const text = readFileSync(file, "utf8");
    assert.equal(ban.test(text), false, `${file} must not import monorepo lib via relative path`);
  }
});

test("listTemplateDescriptors reads monorepo templates", () => {
  const prev = getEngineRoot();
  try {
    setEngineRoot(repoRoot);
    const list = listTemplateDescriptors(repoRoot);
    assert.ok(list.length >= 3);
    assert.ok(list.some((t) => t.id === "balanced"));
    assert.ok(list.every((t) => t.id && t.name));
  } finally {
    setEngineRoot(prev);
  }
});

test("resolveConnectorCategory matches monorepo template-loader semantics", () => {
  const prev = getEngineRoot();
  try {
    setEngineRoot(repoRoot);
    assert.equal(resolveConnectorCategory(repoRoot, "balanced", "weread", "-"), "20-专题");
    assert.equal(resolveConnectorCategory(repoRoot, "balanced", "weread", " "), "20 专题");
    assert.equal(resolveConnectorCategory(repoRoot, "balanced", "x", "-"), "20-专题");
  } finally {
    setEngineRoot(prev);
  }
});

test("listTemplateIds and loadTemplate work", () => {
  const prev = getEngineRoot();
  try {
    setEngineRoot(repoRoot);
    const ids = listTemplateIds(repoRoot);
    assert.ok(ids.includes("balanced"));
    const t = loadTemplate(repoRoot, "balanced");
    assert.equal(t.templateId, "balanced");
    assert.ok(t.categories);
  } finally {
    setEngineRoot(prev);
  }
});

test("system-service and connector-category use template-api", () => {
  const sys = readFileSync(path.join(electronDir, "system-service.mjs"), "utf8");
  const conn = readFileSync(path.join(electronDir, "lib/connector-category.mjs"), "utf8");
  assert.match(sys, /template-api\.mjs/);
  assert.match(conn, /template-api\.mjs/);
  assert.doesNotMatch(sys, /from\s+["']\.\.\/\.\.\/lib\//);
  assert.doesNotMatch(conn, /from\s+["']\.\.\/\.\.\/\.\.\/lib\//);
  assert.ok(existsSync(path.join(electronDir, "lib/template-api.mjs")));
});
