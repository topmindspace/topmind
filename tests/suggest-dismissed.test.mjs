/**
 * Durable suggestion dismissal — the "user said no" memory.
 *
 * Locks the contract that made this a separate file from suggest-fingerprints:
 *   · a rejection survives a process restart (durable, not session-only)
 *   · a rejection survives `force` / manual re-analysis
 *     (fingerprints do NOT — force is supposed to clear those)
 *   · it is bounded by a TTL so a "no" cannot become a permanent blind spot
 *   · it never stores suggestion content
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  markSuggestionsDismissed,
  isSuggestionDismissed,
  filterDismissedSuggestions,
  clearDismissedSuggestions,
  loadDismissedSuggestions,
  pruneDismissedIds,
  suggestDismissedPath,
  SUGGEST_DISMISSED_REL,
  DISMISS_TTL_DAYS,
} from "../lib/suggest-dismissed.mjs";
import {
  clearSuggestFingerprints,
  markAiFingerprint,
  shouldSkipAiForFingerprint,
} from "../lib/suggest-fingerprint.mjs";

let ws;
beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "tm-dismiss-"));
});
afterEach(() => {
  fs.rmSync(ws, { recursive: true, force: true });
});

const ok = (id) => ({ id, kind: "inbox_review", title: id });

describe("suggest dismissal is durable", () => {
  it("starts empty and writes to the system plane", () => {
    assert.deepEqual(loadDismissedSuggestions(ws).ids, {});
    markSuggestionsDismissed(ws, "inbox-00-收件箱/a.md");
    assert.equal(
      fs.existsSync(path.join(ws, SUGGEST_DISMISSED_REL)),
      true,
      "dismissal must live at .topmind/suggest-dismissed.json",
    );
    assert.equal(suggestDismissedPath(ws), path.join(ws, SUGGEST_DISMISSED_REL));
  });

  it("survives a fresh read — the card cannot come back after a restart", () => {
    markSuggestionsDismissed(ws, ["inbox-a.md", "stale-b"]);
    // A new process would re-read from disk; assert via the disk-backed reader
    // rather than the writer's return value.
    assert.equal(isSuggestionDismissed(ws, "inbox-a.md"), true);
    assert.equal(isSuggestionDismissed(ws, "stale-b"), true);
    assert.equal(isSuggestionDismissed(ws, "never-seen"), false);
  });

  it("accepts a single id or an array, and ignores empties", () => {
    assert.equal(markSuggestionsDismissed(ws, "only-one"), 1);
    assert.equal(markSuggestionsDismissed(ws, ["", "  ", "real-1", "real-2"]), 2);
    assert.equal(markSuggestionsDismissed(ws, []), 0);
    assert.deepEqual(Object.keys(loadDismissedSuggestions(ws).ids).sort(), [
      "only-one",
      "real-1",
      "real-2",
    ]);
  });

  it("re-dismissing refreshes the timestamp instead of duplicating", () => {
    markSuggestionsDismissed(ws, "x");
    const first = loadDismissedSuggestions(ws).ids.x;
    markSuggestionsDismissed(ws, "x");
    const second = loadDismissedSuggestions(ws).ids.x;
    assert.equal(Object.keys(loadDismissedSuggestions(ws).ids).length, 1);
    assert.ok(Date.parse(second) >= Date.parse(first));
  });
});

describe("dismissal is independent of the activity fingerprint", () => {
  it("force-style fingerprint clearing does NOT resurrect a dismissed card", () => {
    // This is the whole reason the two live in separate files: `force` (manual
    // refresh) clears analysis fingerprints without touching user rejections.
    markSuggestionsDismissed(ws, "inbox-a.md");
    markAiFingerprint(ws, "activity#summary", "fp-1");
    assert.equal(shouldSkipAiForFingerprint(ws, "activity#summary", "fp-1"), true);

    clearSuggestFingerprints(ws);

    assert.equal(
      shouldSkipAiForFingerprint(ws, "activity#summary", "fp-1"),
      false,
      "fingerprint must be cleared by force",
    );
    assert.equal(
      isSuggestionDismissed(ws, "inbox-a.md"),
      true,
      "dismissal must survive force — a refresh is not a change of mind",
    );
  });

  it("only the explicit reset clears dismissals", () => {
    markSuggestionsDismissed(ws, ["a", "b"]);
    clearDismissedSuggestions(ws);
    assert.deepEqual(loadDismissedSuggestions(ws).ids, {});
    assert.equal(fs.existsSync(suggestDismissedPath(ws)), false);
  });
});

describe("filtering", () => {
  it("drops dismissed cards and keeps the rest", () => {
    markSuggestionsDismissed(ws, "stale-b");
    const kept = filterDismissedSuggestions(ws, [ok("inbox-a.md"), ok("stale-b"), ok("digest-2026-W30")]);
    assert.deepEqual(
      kept.map((s) => s.id),
      ["inbox-a.md", "digest-2026-W30"],
    );
  });

  it("returns the same array instance when nothing is dismissed", () => {
    const list = [ok("a"), ok("b")];
    assert.equal(filterDismissedSuggestions(ws, list), list);
    assert.equal(filterDismissedSuggestions(ws, []).length, 0);
  });

  it("passes through entries without an id rather than swallowing them", () => {
    markSuggestionsDismissed(ws, "a");
    const kept = filterDismissedSuggestions(ws, [{ kind: "x" }, ok("a")]);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].kind, "x");
  });

  it("honours an optional hot cache", () => {
    const cache = new Map([["hot-id", "now"]]);
    assert.equal(isSuggestionDismissed(ws, "hot-id", cache), true);
    const kept = filterDismissedSuggestions(ws, [ok("hot-id"), ok("cold")], cache);
    assert.deepEqual(
      kept.map((s) => s.id),
      ["cold"],
    );
  });
});

describe("TTL keeps a rejection bounded", () => {
  it("prunes entries older than the TTL and keeps fresh ones", () => {
    const now = Date.now();
    const old = new Date(now - (DISMISS_TTL_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    const fresh = new Date(now - 60 * 1000).toISOString();
    const kept = pruneDismissedIds({ old, fresh }, now);
    assert.deepEqual(Object.keys(kept), ["fresh"]);
  });

  it("keeps unparseable timestamps rather than resurrecting the card", () => {
    const kept = pruneDismissedIds({ broken: "not-a-date" });
    assert.deepEqual(Object.keys(kept), ["broken"]);
  });

  it("prunes on read, so an expired 'no' releases the card by itself", () => {
    const stale = new Date(Date.now() - (DISMISS_TTL_DAYS + 2) * 24 * 60 * 60 * 1000).toISOString();
    fs.mkdirSync(path.join(ws, ".topmind"), { recursive: true });
    fs.writeFileSync(
      suggestDismissedPath(ws),
      `${JSON.stringify({ ids: { expired: stale } }, null, 2)}\n`,
      "utf8",
    );
    assert.equal(isSuggestionDismissed(ws, "expired"), false);
  });
});

describe("robustness", () => {
  it("a corrupt file reads as empty instead of throwing", () => {
    fs.mkdirSync(path.join(ws, ".topmind"), { recursive: true });
    fs.writeFileSync(suggestDismissedPath(ws), "{ not json", "utf8");
    assert.deepEqual(loadDismissedSuggestions(ws).ids, {});
    assert.equal(isSuggestionDismissed(ws, "anything"), false);
  });

  it("never persists suggestion content — ids and timestamps only", () => {
    markSuggestionsDismissed(ws, "inbox-10-动态/2026-W30.md");
    const raw = fs.readFileSync(suggestDismissedPath(ws), "utf8");
    const parsed = JSON.parse(raw);
    assert.deepEqual(Object.keys(parsed).sort(), ["ids", "updatedAt"]);
    for (const [id, iso] of Object.entries(parsed.ids)) {
      assert.equal(typeof id, "string");
      assert.equal(Number.isNaN(Date.parse(iso)), false, `${id} must carry an ISO timestamp`);
    }
    // No titles, summaries, or bodies anywhere in the payload.
    assert.equal(/title|summary|body|content/i.test(raw), false);
  });

  it("tolerates a missing workspace root without throwing", () => {
    assert.doesNotThrow(() => clearDismissedSuggestions(undefined));
    assert.deepEqual(loadDismissedSuggestions(path.join(ws, "does-not-exist")).ids, {});
  });
});
