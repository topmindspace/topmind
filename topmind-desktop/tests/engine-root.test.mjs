/**
 * Engine root resolution — monorepo vs portable packaged layout.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isClassicEngineRoot,
  isPortableEngineRoot,
  isValidEngineRoot,
  defaultEngineCandidate,
} from "../electron/lib/engine-root.mjs";
import { resolvetopmindRoot } from "../electron/lib/path-model.mjs";
import { loadTemplateJson, setEngineRoot, getEngineRoot } from "../electron/lib/workspace-home.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("monorepo root is a classic engine", () => {
  assert.equal(isClassicEngineRoot(repoRoot), true);
  assert.equal(isValidEngineRoot(repoRoot), true);
});

test("defaultEngineCandidate points at monorepo root in non-packaged env", () => {
  const cand = defaultEngineCandidate();
  assert.equal(path.resolve(cand), path.resolve(repoRoot));
});

test("resolvetopmindRoot accepts monorepo layout", async () => {
  const root = await resolvetopmindRoot(repoRoot);
  assert.equal(root, path.resolve(repoRoot));
});

test("resolvetopmindRoot accepts portable templates-only layout", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-portable-"));
  try {
    await fs.mkdir(path.join(base, "templates"));
    await fs.writeFile(
      path.join(base, "templates", "balanced.json"),
      JSON.stringify({
        templateId: "balanced",
        name: "Test",
        categories: [],
      }),
      "utf8",
    );
    assert.equal(isPortableEngineRoot(base), true);
    const root = await resolvetopmindRoot(base);
    assert.equal(root, path.resolve(base));
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("loadTemplateJson reads from setEngineRoot", () => {
  const prev = getEngineRoot();
  try {
    setEngineRoot(repoRoot);
    const t = loadTemplateJson("balanced");
    assert.ok(t);
    assert.equal(t.templateId, "balanced");
    assert.ok(t.categories);
  } finally {
    setEngineRoot(prev);
  }
});
