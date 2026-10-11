import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Compile-free: duplicate minimal test of lineDiff via dynamic import of ts is hard;
// reimplement smoke via inline copy of contract.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("lineDiff marks add/remove/same", async () => {
  // Import compiled path not available; load via tsx if project uses it
  const { lineDiff } = await import("../src/lib/simple-diff.ts");
  const lines = lineDiff("hello\nworld", "hello\nthere");
  assert.ok(lines.some((l) => l.kind === "same" && l.text === "hello"));
  assert.ok(lines.some((l) => l.kind === "removed" && l.text === "world"));
  assert.ok(lines.some((l) => l.kind === "added" && l.text === "there"));
});
