/**
 * Suggestion ids must be content-addressed — a singleton id (old
 * `promote-stream-hint`) made one strip 忽略 suppress every sibling card.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engineSrc = fs.readFileSync(path.join(root, "lib/suggest-engine.mjs"), "utf8");

test("promote / inbox organize cards are content-addressed, not singletons", () => {
  assert.doesNotMatch(engineSrc, /id:\s*"promote-stream-hint"/);
  assert.match(engineSrc, /id:\s*`promote-app-\$\{contentHash/);
  assert.match(engineSrc, /id:\s*`promote-upd-\$\{contentHash/);
  assert.match(engineSrc, /id:\s*"promote-open-hint"/);
  // basename collision: two notes.md must not share a dismissal id
  assert.match(engineSrc, /id:\s*`inbox-organize-\$\{file\.rel\}`/);
  assert.doesNotMatch(engineSrc, /id:\s*`inbox-organize-\$\{file\.name\}`/);
  // batch hint keys off the current file set
  assert.match(engineSrc, /id:\s*`inbox-organize-batch-\$\{contentHash/);
});
