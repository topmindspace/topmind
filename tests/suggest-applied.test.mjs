/**
 * Durable apply ledger — "user already accepted this card" survives restarts.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  markSuggestionApplied,
  isSuggestionApplied,
  filterAppliedSuggestions,
  loadAppliedSuggestions,
  recentAppliedSummary,
  clearAppliedSuggestions,
} from "../lib/suggest-applied.mjs";

/** @type {string} */
let ws;

before(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "tm-applied-"));
});

after(() => {
  try {
    fs.rmSync(ws, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("suggest-applied ledger", () => {
  it("marks and filters applied ids across reloads", () => {
    clearAppliedSuggestions(ws);
    assert.equal(isSuggestionApplied(ws, "digest-2026-W20"), false);
    markSuggestionApplied(ws, {
      id: "digest-2026-W20",
      kind: "stream_digest",
      targetPath: "memory/periodic/2026/2026-W20.md",
    });
    assert.equal(isSuggestionApplied(ws, "digest-2026-W20"), true);
    // Reload from disk (new process simulation)
    const state = loadAppliedSuggestions(ws);
    assert.ok(state.ids["digest-2026-W20"]);
    const kept = filterAppliedSuggestions(ws, [
      { id: "digest-2026-W20" },
      { id: "digest-2026-W21" },
    ]);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].id, "digest-2026-W21");
  });

  it("force option still returns applied cards (rewrite path)", () => {
    markSuggestionApplied(ws, { id: "digest-2026-W30", kind: "stream_digest" });
    const forced = filterAppliedSuggestions(
      ws,
      [{ id: "digest-2026-W30" }],
      { force: true },
    );
    assert.equal(forced.length, 1);
  });

  it("recentAppliedSummary lists recent entries for AI prompts", () => {
    clearAppliedSuggestions(ws);
    markSuggestionApplied(ws, { id: "digest-2026-W28", kind: "stream_digest", targetPath: "memory/periodic/2026/2026-W28.md" });
    const summary = recentAppliedSummary(ws, { limit: 5 });
    assert.match(summary, /digest-2026-W28/);
    assert.match(summary, /stream_digest/);
  });

  it("is durable on disk under .topmind/", () => {
    clearAppliedSuggestions(ws);
    markSuggestionApplied(ws, { id: "inbox-a.md", kind: "inbox_organize" });
    const abs = path.join(ws, ".topmind/suggest-applied.json");
    assert.ok(fs.existsSync(abs));
    const raw = JSON.parse(fs.readFileSync(abs, "utf8"));
    assert.ok(raw.ids["inbox-a.md"]);
  });
});
