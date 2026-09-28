/**
 * Kernel engine files are vendored for packaging and community snapshots:
 *   lib/<file>                                   — single source of truth
 *   topmind-desktop/resources/topmind-engine/lib/ — packaged Desktop engine
 *   topmind-obsidian/lib/                        — community clean-build snapshot
 * Desktop electron/lib only static-imports agent-goal-protocol (covered in
 * agent-goal-protocol-parity.test.mjs); the other engines resolve through
 * engine-root at runtime and must still stay byte-identical across the copies
 * that exist.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ENGINE_FILES = [
  "agent-goal-protocol.mjs",
  "agent-goal-protocol.d.mts",
  "github-md.mjs",
  "github-md.d.mts",
  "memory-engine.mjs",
  "writeback-engine.mjs",
  "ai-operation-engine.mjs",
  "suggest-engine.mjs",
];

/** Copy roots that may hold a vendored engine snapshot. */
const obsidianEnv = process.env.TOPMIND_OBSIDIAN_SRC;
const COPY_ROOTS = [
  ["Desktop electron/lib", path.join(root, "topmind-desktop", "electron", "lib")],
  ["Desktop resources/topmind-engine/lib", path.join(root, "topmind-desktop", "resources", "topmind-engine", "lib")],
  // Sibling checkout (dev machine).
  ["topmind-obsidian/lib", path.resolve(root, "..", "topmind-obsidian", "lib")],
  // In-repo checkout (CI `path: topmind-obsidian`) and explicit env override.
  ["topmind-obsidian/lib (in-repo)", path.join(root, "topmind-obsidian", "lib")],
  ...(obsidianEnv ? [["TOPMIND_OBSIDIAN_SRC/lib", path.join(obsidianEnv, "lib")]] : []),
];

for (const rel of ENGINE_FILES) {
  test(`${rel} copies match lib/`, (t) => {
    const kernelPath = path.join(root, "lib", rel);
    if (!existsSync(kernelPath)) {
      t.skip(`lib/${rel} not present`);
      return;
    }
    const expected = readFileSync(kernelPath, "utf8");
    let compared = 0;
    for (const [label, dir] of COPY_ROOTS) {
      const copy = path.join(dir, rel);
      if (!existsSync(copy)) continue;
      assert.equal(readFileSync(copy, "utf8"), expected, `${label}/${rel} drifted from lib/`);
      compared += 1;
    }
    // memory/writeback/ai-op/suggest are never static-imported from electron/lib;
    // they must at least exist in the packaged engine snapshot and Obsidian lib.
    // electron/lib only vendors agent-goal-protocol + github-md — its directory
    // existing is not enough. Require a real snapshot root before asserting
    // presence; bare CI without sister checkout or pack:prepare skips instead.
    const snapshotRoots = COPY_ROOTS.filter(([label]) => label !== "Desktop electron/lib");
    const hasSnapshot = snapshotRoots.some(([, dir]) => existsSync(dir));
    if (!hasSnapshot) {
      if (rel !== "agent-goal-protocol.mjs" && rel !== "agent-goal-protocol.d.mts") {
        t.skip(`no engine snapshot root (obsidian lib / resources) for ${rel}`);
        return;
      }
    } else if (rel !== "agent-goal-protocol.mjs" && rel !== "agent-goal-protocol.d.mts") {
      assert.ok(compared >= 1, `no vendored copy of ${rel} found outside lib/`);
    }
  });
}

test("packaged engine snapshot carries the full Kernel engine set", () => {
  const packaged = path.join(root, "topmind-desktop", "resources", "topmind-engine", "lib");
  if (!existsSync(packaged)) {
    // pack:prepare not run in this tree — the per-copy tests above still guard lib vs obsidian.
    return;
  }
  for (const rel of ["memory-engine.mjs", "writeback-engine.mjs", "ai-operation-engine.mjs", "suggest-engine.mjs"]) {
    assert.ok(existsSync(path.join(packaged, rel)), `resources/topmind-engine/lib/${rel} missing`);
    assert.equal(
      readFileSync(path.join(packaged, rel), "utf8"),
      readFileSync(path.join(root, "lib", rel), "utf8"),
      `resources/topmind-engine/lib/${rel} drifted from lib/`,
    );
  }
});
