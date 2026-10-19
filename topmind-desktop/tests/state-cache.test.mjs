import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pruneRegenerableCaches } from "../electron/lib/fs-utils.mjs";

test("pruneRegenerableCaches drops an over-cap cache and leaves state alone", () => {
  const home = mkdtempSync(path.join(tmpdir(), "desk-cache-"));
  try {
    mkdirSync(path.join(home, "Cache", "sub"), { recursive: true });
    writeFileSync(path.join(home, "Cache", "sub", "a.bin"), Buffer.alloc(100));
    mkdirSync(path.join(home, "state"), { recursive: true });
    writeFileSync(path.join(home, "state", "keep.txt"), "keep");
    const pruned = pruneRegenerableCaches(home, { Cache: 10, "Code Cache": 10 });
    assert.deepEqual(pruned.map((item) => item.name), ["Cache"]);
    assert.equal(existsSync(path.join(home, "Cache")), false);
    assert.equal(existsSync(path.join(home, "state", "keep.txt")), true);
    assert.equal(existsSync(path.join(home, "Code Cache")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
