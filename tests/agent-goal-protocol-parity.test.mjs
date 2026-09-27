/**
 * agent-goal-protocol.mjs is vendored for packaging:
 *   lib/agent-goal-protocol.mjs                             — Kernel / Obsidian `#kernel`
 *   topmind-desktop/electron/lib/agent-goal-protocol.mjs     — Desktop static import (asar)
 *   topmind-desktop/resources/topmind-engine/lib/…           — packaged engine snapshot
 *   topmind-obsidian/lib/agent-goal-protocol.mjs            — community clean-build snapshot
 * All copies (and their .d.mts) must stay byte-identical to lib/.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siblingObsidian = path.resolve(root, "..", "topmind-obsidian", "lib");

const COPIES = [
  ["Desktop electron/lib", path.join(root, "topmind-desktop", "electron", "lib")],
  ["Desktop resources/topmind-engine/lib", path.join(root, "topmind-desktop", "resources", "topmind-engine", "lib")],
  ["topmind-obsidian/lib", siblingObsidian],
];

function kernel(rel) {
  return readFileSync(path.join(root, "lib", rel), "utf8");
}

for (const [label, dir] of COPIES) {
  test(`goal-protocol ${label} matches Kernel lib`, (t) => {
    if (!existsSync(dir)) {
      // Community clean-build / unbuilt Desktop may not have the tree — skip.
      t.skip(`${label} not present`);
      return;
    }
    const copy = path.join(dir, "agent-goal-protocol.mjs");
    if (!existsSync(copy)) {
      t.skip(`${label} has no agent-goal-protocol.mjs`);
      return;
    }
    assert.equal(
      readFileSync(copy, "utf8"),
      kernel("agent-goal-protocol.mjs"),
      `${label}/agent-goal-protocol.mjs drifted from lib/`,
    );
  });

  test(`goal-protocol .d.mts ${label} matches Kernel lib`, (t) => {
    const kernelDts = path.join(root, "lib", "agent-goal-protocol.d.mts");
    if (!existsSync(kernelDts)) {
      t.skip("lib/agent-goal-protocol.d.mts not present");
      return;
    }
    if (!existsSync(dir)) {
      t.skip(`${label} not present`);
      return;
    }
    const copy = path.join(dir, "agent-goal-protocol.d.mts");
    if (!existsSync(copy)) {
      // .d.mts is optional at a copy site (only agent-goal-protocol.mjs is load-bearing).
      t.skip(`${label} has no agent-goal-protocol.d.mts`);
      return;
    }
    assert.equal(
      readFileSync(copy, "utf8"),
      kernel("agent-goal-protocol.d.mts"),
      `${label}/agent-goal-protocol.d.mts drifted from lib/`,
    );
  });
}

test("Desktop electron/lib carries the static goal-protocol import", () => {
  const dir = path.join(root, "topmind-desktop", "electron", "lib");
  assert.ok(
    existsSync(path.join(dir, "agent-goal-protocol.mjs")),
    "Desktop electron/lib/agent-goal-protocol.mjs missing (static asar import)",
  );
  assert.equal(
    readFileSync(path.join(dir, "agent-goal-protocol.mjs"), "utf8"),
    kernel("agent-goal-protocol.mjs"),
  );
});
