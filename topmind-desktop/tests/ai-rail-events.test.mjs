/**
 * AI rail event helpers — pending invalidation + event names.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shouldInvalidatePendingWrites,
  SUGGESTIONS_REFRESH_EVENT,
  PENDING_WRITES_CHANGED_EVENT,
} from "../src/lib/ai-rail-events.ts";

test("event names are stable for strip subscribers", () => {
  assert.equal(SUGGESTIONS_REFRESH_EVENT, "suggestions:refresh");
  assert.equal(PENDING_WRITES_CHANGED_EVENT, "pending-writes:changed");
});

test("shouldInvalidatePendingWrites detects confirm / pending / wrote", () => {
  assert.equal(shouldInvalidatePendingWrites(null), false);
  assert.equal(shouldInvalidatePendingWrites({ needsConfirm: true }), true);
  assert.equal(shouldInvalidatePendingWrites({ pending: true }), true);
  assert.equal(shouldInvalidatePendingWrites({ ok: true, wroteFiles: true, targetPath: "a.md" }), true);
  assert.equal(shouldInvalidatePendingWrites({ ok: true, targetPath: "a.md" }), true);
  assert.equal(shouldInvalidatePendingWrites({ batchEvidence: { writeCount: 2 } }), true);
  assert.equal(
    shouldInvalidatePendingWrites({ evidence: { needsConfirm: true } }),
    true,
  );
  assert.equal(shouldInvalidatePendingWrites({ ok: false, error: "x" }), false);
});
