/**
 * Desktop category-pattern.mjs must match engine lib/model-core.mjs (workspace-model facade).
 * path-model must import CATEGORY_PATTERN for local use (re-export alone is not enough).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { CATEGORY_PATTERN, VALID_ROLES } from "../electron/lib/category-pattern.mjs";
import { detectUserWorkspaceRoot } from "../electron/lib/path-model.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// CATEGORY_PATTERN is defined in model-core.mjs and re-exported via the workspace-model facade.
const libSrc =
  readFileSync(path.join(root, "lib/model-core.mjs"), "utf8") +
  readFileSync(path.join(root, "lib/workspace-model.mjs"), "utf8");
const pathModelSrc = readFileSync(
  path.join(root, "topmind-desktop/electron/lib/path-model.mjs"),
  "utf8",
);

test("CATEGORY_PATTERN matches NN-Name and NN Name", () => {
assert.equal(CATEGORY_PATTERN.test("00-收件箱"), true);
assert.equal(CATEGORY_PATTERN.test("10 动态"), true);
assert.equal(CATEGORY_PATTERN.test("收件箱"), false);
  assert.equal(CATEGORY_PATTERN.test("projects"), false);
});

test("desktop category-pattern source equals lib export shape", () => {
  assert.match(libSrc, /export const CATEGORY_PATTERN = \/\^\\d\{2\}\[ -\]\.\+\/u;/u);
  // Runtime: same acceptance set as lib comments
  assert.deepEqual([...VALID_ROLES].sort(), [
    "buffer",
    "deep-work",
    "delivery",
    "fallback",
    "loose-stream",
    "reference",
    "system",
  ].sort());
});

test("path-model imports CATEGORY_PATTERN (local binding, not re-export-only)", () => {
  // Bare `export { X } from` does not bind X in the exporting module — regression of 1.0.14.
  assert.match(
    pathModelSrc,
    /import\s*\{[^}]*CATEGORY_PATTERN[^}]*\}\s*from\s*["']\.\/category-pattern\.mjs["']/u,
  );
  assert.doesNotMatch(
    pathModelSrc,
    /^export \{ CATEGORY_PATTERN \} from /mu,
  );
});

test("detectUserWorkspaceRoot finds dir with NN-Name categories", async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "mh-ws-shape-"));
  try {
mkdirSync(path.join(tmp, "00-收件箱"));
mkdirSync(path.join(tmp, "10-动态"));
    writeFileSync(path.join(tmp, ".topmind-config.json"), "{}\n");
    const found = await detectUserWorkspaceRoot(tmp);
    assert.equal(found, path.resolve(tmp));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("detectUserWorkspaceRoot rejects empty non-workspace dirs", async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "mh-ws-empty-"));
  try {
    mkdirSync(path.join(tmp, "notes"));
    await assert.rejects(
      () => detectUserWorkspaceRoot(tmp),
      /Could not locate topmind workspace/u,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
