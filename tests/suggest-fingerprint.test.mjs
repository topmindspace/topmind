/**
 * Durable suggest fingerprints — cold start must not re-AI when activity unchanged.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadSuggestFingerprints,
  saveSuggestFingerprints,
  shouldSkipAiForFingerprint,
  markAiFingerprint,
  clearSuggestFingerprints,
  SUGGEST_FINGERPRINT_REL,
} from "../lib/suggest-fingerprint.mjs";

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tm-suggest-fp-"));
});

afterEach(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("suggest-fingerprint", () => {
  it("loads empty when missing", () => {
    const s = loadSuggestFingerprints(tmp);
    assert.deepEqual(s.hashes, {});
  });

  it("persists and skips matching fingerprint across loads", () => {
    markAiFingerprint(tmp, "activity#summary", "abc123");
    const abs = path.join(tmp, SUGGEST_FINGERPRINT_REL);
    assert.ok(fs.existsSync(abs));
    const mem = new Map();
    assert.equal(shouldSkipAiForFingerprint(tmp, "activity#summary", "abc123", mem), true);
    assert.equal(shouldSkipAiForFingerprint(tmp, "activity#summary", "other", mem), false);
    // cold process: no memory cache
    assert.equal(shouldSkipAiForFingerprint(tmp, "activity#summary", "abc123"), true);
  });

  it("clear removes durable file", () => {
    markAiFingerprint(tmp, "activity#promote", "x");
    clearSuggestFingerprints(tmp);
    assert.equal(shouldSkipAiForFingerprint(tmp, "activity#promote", "x"), false);
  });

  it("save/load roundtrip", () => {
    saveSuggestFingerprints(tmp, { hashes: { "activity#promote": "p1" } });
    const s = loadSuggestFingerprints(tmp);
    assert.equal(s.hashes["activity#promote"], "p1");
  });
});
