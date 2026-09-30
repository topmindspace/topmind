/**
 * Session health circuit breaker.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSessionHealth,
  recordToolOutcome,
  shouldTrip,
  describeHealth,
} from "../electron/lib/session-health.mjs";

test("circuit stays closed on mixed outcomes", () => {
  let s = createSessionHealth();
  for (const ok of [true, false, true, true, false, true]) {
    s = recordToolOutcome(s, { name: "read_file", ok });
  }
  assert.equal(shouldTrip(s), false);
  assert.match(describeHealth(s), /circuit-closed/u);
});

test("high failure rate trips the circuit", () => {
  let s = createSessionHealth();
  for (let i = 0; i < 8; i++) s = recordToolOutcome(s, { name: "edit_file", ok: false });
  assert.equal(shouldTrip(s), true);
  assert.match(describeHealth(s), /circuit-open/u);
});

test("same-tool streak trips even if overall rate is moderate", () => {
  let s = createSessionHealth();
  s = recordToolOutcome(s, { name: "a", ok: true });
  s = recordToolOutcome(s, { name: "b", ok: true });
  s = recordToolOutcome(s, { name: "save_file", ok: false });
  s = recordToolOutcome(s, { name: "save_file", ok: false });
  s = recordToolOutcome(s, { name: "save_file", ok: false });
  assert.equal(shouldTrip(s), true);
  assert.match(s.tripReason, /save_file/u);
});
