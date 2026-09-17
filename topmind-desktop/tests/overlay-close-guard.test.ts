import { test } from "node:test";
import assert from "node:assert/strict";
import {
  setOverlayCloseGuard,
  runOverlayCloseGuard,
} from "../src/lib/overlay-close-guard.ts";

test("veto keeps the guard armed for a second Esc", async () => {
  let calls = 0;
  setOverlayCloseGuard(() => {
    calls += 1;
    return false;
  });

  assert.equal(await runOverlayCloseGuard(), false);
  assert.equal(calls, 1);
  // Second close attempt must still hit the same dirty guard.
  assert.equal(await runOverlayCloseGuard(), false);
  assert.equal(calls, 2);

  // User finally accepts discard — guard clears and further closes pass.
  setOverlayCloseGuard(() => true);
  assert.equal(await runOverlayCloseGuard(), true);
  assert.equal(await runOverlayCloseGuard(), true);
});

test("undefined/void result allows close and clears the guard", async () => {
  let calls = 0;
  setOverlayCloseGuard(() => {
    calls += 1;
  });
  assert.equal(await runOverlayCloseGuard(), true);
  assert.equal(calls, 1);
  assert.equal(await runOverlayCloseGuard(), true);
  assert.equal(calls, 1);
});

test("no guard means immediate allow", async () => {
  setOverlayCloseGuard(null);
  assert.equal(await runOverlayCloseGuard(), true);
});
