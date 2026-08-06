/**
 * writebackMode resolution — auto|confirm only; batch rejected.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveWritebackModeInput,
  WRITEBACK_MODES,
} from "../../core/writeback-mode.mjs";

test("WRITEBACK_MODES is exactly auto and confirm", () => {
  assert.deepEqual([...WRITEBACK_MODES], ["auto", "confirm"]);
});

test("omitted mode defaults to auto", () => {
  const r = resolveWritebackModeInput({});
  assert.equal(r.ok, true);
  assert.equal(r.mode, "auto");
});

test("payload confirm is accepted", () => {
  const r = resolveWritebackModeInput({
    payloadHasMode: true,
    payloadMode: "confirm",
  });
  assert.equal(r.ok, true);
  assert.equal(r.mode, "confirm");
});

test("payload auto is accepted", () => {
  const r = resolveWritebackModeInput({
    payloadHasMode: true,
    payloadMode: "auto",
  });
  assert.equal(r.ok, true);
  assert.equal(r.mode, "auto");
});

test("legacy batch is rejected (not silently mapped to auto)", () => {
  const r = resolveWritebackModeInput({
    payloadHasMode: true,
    payloadMode: "batch",
  });
  assert.equal(r.ok, false);
  assert.equal(r.mode, null);
  assert.match(r.error, /batch/i);
  assert.match(r.error, /auto\|confirm/);
});

test("option batch is rejected", () => {
  const r = resolveWritebackModeInput({ optionMode: "batch" });
  assert.equal(r.ok, false);
  assert.match(r.error, /batch/i);
});

test("env batch is rejected", () => {
  const r = resolveWritebackModeInput({ envMode: "batch" });
  assert.equal(r.ok, false);
  assert.match(r.error, /batch/i);
});

test("unknown mode is rejected", () => {
  const r = resolveWritebackModeInput({
    payloadHasMode: true,
    payloadMode: "preview",
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /preview/);
});

test("empty payload mode falls through to option then env", () => {
  const viaOption = resolveWritebackModeInput({
    payloadHasMode: true,
    payloadMode: "  ",
    optionMode: "confirm",
  });
  assert.equal(viaOption.ok, true);
  assert.equal(viaOption.mode, "confirm");

  const viaEnv = resolveWritebackModeInput({
    envMode: "confirm",
  });
  assert.equal(viaEnv.ok, true);
  assert.equal(viaEnv.mode, "confirm");
});

test("payload takes precedence over option and env", () => {
  const r = resolveWritebackModeInput({
    payloadHasMode: true,
    payloadMode: "auto",
    optionMode: "confirm",
    envMode: "confirm",
  });
  assert.equal(r.ok, true);
  assert.equal(r.mode, "auto");
});
