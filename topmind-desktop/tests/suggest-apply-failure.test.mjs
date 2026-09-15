/**
 * Suggestion apply — bulk efficiency + failure semantics (shipped paths).
 *
 * Two contracts the user sees directly:
 *
 *   1. "Accept all" is ONE IPC round-trip. Per-item calls paid the settings +
 *      AI-provider load N times for N cards.
 *   2. A card that can never apply (source file gone, payload malformed, target
 *      conflict) fails as ITSELF: the batch keeps going, the card is not
 *      reported as accepted, and — because retrying produces the identical skip
 *      — the failure IS the cancellation. Retryable failures keep the card.
 *
 * The classification is pinned against the reason codes `lib/suggest-engine.mjs`
 * actually emits, so a new skip cannot silently fall through to either
 * "retryable" (a dead card that fails forever) or "success" (a lie).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isTerminalApplyFailure } from "../src/lib/suggest-apply-label.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "..");
const read = (p) => readFileSync(p, "utf8");

const engineSrc = read(path.join(repoRoot, "lib/suggest-engine.mjs"));
const zh = JSON.parse(read(path.join(root, "src/locales/zh-CN/editor.json")));
const en = JSON.parse(read(path.join(root, "src/locales/en-US/editor.json")));

/**
 * Every reason code the engine can return from an apply. Two spellings exist:
 * a literal (`reason: "x"`) and an analysis-derived fallback
 * (`reason: analysisUsable.reason || "x"`).
 */
function engineReasonCodes() {
  const codes = new Set();
  for (const m of engineSrc.matchAll(/reason:\s*"([a-z0-9-]+)"/gu)) codes.add(m[1]);
  for (const m of engineSrc.matchAll(/reason\s*\|\|\s*"([a-z0-9-]+)"/gu)) codes.add(m[1]);
  return codes;
}

/**
 * How the UI must treat each engine code.
 * - cancel: terminal → the failure equals cancelling the suggestion
 * - keep: retryable / unknown → the card stays for another attempt
 * - pending: not a failure at all — the confirm gate, handled before the
 *   failure branch (see electron/lib/suggestion-gate.mjs)
 */
const EXPECTED = {
  "source-not-found": "cancel",
  "missing-target": "cancel",
  "invalid-placement": "cancel",
  "target-exists": "cancel",
  "invalid-period": "cancel",
  "no-usable-digest": "cancel",
  "no-usable-analysis": "cancel",
  "placeholder-or-polluted": "cancel",
  "read-failed": "cancel",
  "outside-workspace": "cancel",
  "write-failed": "keep",
  "write-pending": "pending",
};

test("every engine apply reason code is classified", () => {
  const codes = engineReasonCodes();
  const unclassified = [...codes].filter((c) => !(c in EXPECTED));
  assert.deepEqual(
    unclassified,
    [],
    `lib/suggest-engine.mjs emits unclassified reason(s) ${JSON.stringify(unclassified)} — `
      + "add them to TERMINAL_APPLY_FAILURES (dead card) or leave retryable (keep the card), "
      + "then register them in this test's EXPECTED map.",
  );
});

test("terminal classification matches the intended semantics", () => {
  for (const [code, expected] of Object.entries(EXPECTED)) {
    assert.equal(
      isTerminalApplyFailure(code),
      expected === "cancel",
      `${code} must be ${expected === "cancel" ? "terminal (auto-cancel)" : "retryable"}`,
    );
  }
});

test("no phantom terminal codes — every one is emitted by the engine", () => {
  const codes = engineReasonCodes();
  const phantom = Object.entries(EXPECTED)
    .filter(([, v]) => v === "cancel")
    .map(([k]) => k)
    .filter((k) => !codes.has(k));
  assert.deepEqual(phantom, [], `terminal set holds codes the engine never emits: ${phantom.join(", ")}`);
});

test("unknown and missing reasons stay retryable", () => {
  // A raw protection rejection arrives with no reason — the user may still be
  // able to unlock and retry, so the card must not be discarded.
  assert.equal(isTerminalApplyFailure(undefined), false);
  assert.equal(isTerminalApplyFailure(null), false);
  assert.equal(isTerminalApplyFailure(""), false);
  assert.equal(isTerminalApplyFailure("error"), false);
  assert.equal(isTerminalApplyFailure("no-result"), false);
  assert.equal(isTerminalApplyFailure("brand-new-code"), false);
});

test("every reason code the UI can render has copy in both locales", () => {
  // The engine's `note` is written in the workspace locale; the reason key is
  // what the UI localises. A missing key would leak Chinese into the English UI
  // (or show a raw code).
  //
  // Only codes that reach the FAILURE branch need copy: a `pending` code
  // (write-pending) short-circuits on `needsConfirm` and shows the confirm
  // message instead — it never renders as an apply failure.
  const renderable = new Set([
    ...Object.entries(EXPECTED).filter(([, v]) => v !== "pending").map(([k]) => k),
    "error",
    "no-result",
  ]);
  for (const code of renderable) {
    assert.ok(zh.ai.applyFail?.[code], `zh-CN editor.json missing ai.applyFail.${code}`);
    assert.ok(en.ai.applyFail?.[code], `en-US editor.json missing ai.applyFail.${code}`);
  }
  // And the two locales cover exactly the same codes.
  assert.deepEqual(
    Object.keys(zh.ai.applyFail).sort(),
    Object.keys(en.ai.applyFail).sort(),
    "zh-CN / en-US applyFail code lists diverged",
  );
});

test("failure copy distinguishes auto-cancel from a retained card", () => {
  for (const [name, locale] of [["zh-CN", zh], ["en-US", en]]) {
    assert.ok(locale.ai.suggestFailed, `${name} missing ai.suggestFailed`);
    assert.ok(locale.ai.suggestFailedCancelled, `${name} missing ai.suggestFailedCancelled`);
    assert.ok(locale.ai.bulkAcceptCancelled, `${name} missing ai.bulkAcceptCancelled`);
    assert.notEqual(locale.ai.suggestFailed, locale.ai.suggestFailedCancelled);
  }
});

// ── Main process: one round-trip, per-item isolation ────────────────────────

/** Body of a service method, sliced to the next sibling method. */
function serviceBody(src, name) {
  const start = src.indexOf(`async ${name}(`);
  assert.notEqual(start, -1, `workspace-service.mjs has no async ${name}(`);
  const rest = src.slice(start);
  const end = rest.indexOf("\n  async ", 10);
  return end === -1 ? rest : rest.slice(0, end);
}

const serviceSrc = read(path.join(root, "electron/workspace-service.mjs"));

test("bulk apply loads settings once, not once per card", () => {
  const body = serviceBody(serviceSrc, "applySuggestions");
  const loads = body.match(/loadAppSettings\(/gu) ?? [];
  assert.equal(loads.length, 1, `applySuggestions must load settings once, found ${loads.length}`);
  const providers = body.match(/createKernelAiProvider\(/gu) ?? [];
  assert.equal(providers.length, 1, `applySuggestions must build the AI provider once, found ${providers.length}`);
  assert.match(body, /for \(/u, "applySuggestions must loop the items");
});

test("one failing card cannot abort the batch", () => {
  const body = serviceBody(serviceSrc, "applySuggestions");
  // The apply must sit inside a try inside the loop, and the catch must record a
  // result rather than rethrow.
  assert.match(body, /try\s*\{[\s\S]*kernelApplySuggestion[\s\S]*\}\s*catch/u, "apply is not isolated by try/catch");
  assert.match(body, /catch[\s\S]*?results\.push/u, "the catch must append a failure result");
  const rethrow = /catch[\s\S]{0,400}?throw /u.test(body);
  assert.equal(rethrow, false, "a per-item catch must not rethrow — that aborts the whole batch");
  // Progress is pushed for each item so the UI is not frozen on card 1.
  assert.match(body, /emit\([\s\S]{0,80}suggestion:bulk-progress/u, "no per-item progress event");
});

test("bulk apply still honours the unconfirmed high-impact gate", () => {
  const body = serviceBody(serviceSrc, "applySuggestions");
  assert.match(
    body,
    /blockUnconfirmedHighImpact\(/u,
    "the batch path bypasses the confirm gate — a high-impact write would apply unconfirmed",
  );
});

// ── Renderer store: batch call + auto-cancel on terminal failure ────────────

const storeSrc = read(path.join(root, "src/stores/action-store.ts"));

/**
 * Body of a zustand method. The store declares every method twice — once in the
 * `ActionState` interface, once in the implementation — so the marker must match
 * the implementation (`: async (`) and `lastIndexOf` must be used.
 */
function storeMethod(src, startMarker, endMarker) {
  const start = src.lastIndexOf(startMarker);
  assert.notEqual(start, -1, `action-store has no implementation of ${startMarker}`);
  const end = src.indexOf(endMarker, start);
  assert.notEqual(end, -1, `no ${endMarker} after ${startMarker}`);
  return src.slice(start, end);
}

test("acceptAll calls the batch endpoint, never per-item IPC", () => {
  const body = storeMethod(storeSrc, "acceptAll: async ()", "dismissAll: () => {");

  assert.match(body, /api\.ws\.applySuggestions\(/u, "acceptAll must use the batch endpoint");
  assert.equal(
    /api\.ws\.applySuggestion\(/u.test(body),
    false,
    "acceptAll still calls the per-item endpoint — that is the N-round-trip regression",
  );
  assert.match(body, /subscribeRpcEvent\(['"]suggestion:bulk-progress['"]/u, "acceptAll does not follow bulk progress");
});

test("terminal failure auto-cancels; retryable failure keeps the card", () => {
  const body = storeMethod(storeSrc, "acceptAll: async ()", "dismissAll: () => {");

  // The terminal branch must dismiss + drop the card, and must not be counted
  // as accepted.
  const terminalIdx = body.indexOf("isTerminalApplyFailure(");
  assert.notEqual(terminalIdx, -1, "acceptAll does not classify terminal failures");
  const branch = body.slice(terminalIdx, terminalIdx + 700);
  assert.match(branch, /cancelled\+\+/u, "terminal failure is not counted as cancelled");
  assert.match(branch, /dismissedIds\.add\(/u, "terminal failure is not remembered — a refresh would revive the dead card");
  assert.match(branch, /items\.filter\(/u, "terminal failure leaves the dead card in the list");
  assert.equal(/accepted\+\+/u.test(branch), false, "terminal failure counted as accepted (false success)");

  // The fallback branch keeps the card.
  const keepIdx = body.indexOf("} else {", terminalIdx);
  assert.notEqual(keepIdx, -1, "no retryable fallback branch");
  const keep = body.slice(keepIdx, keepIdx + 300);
  assert.match(keep, /failed\+\+/u, "retryable failure must be counted as failed");
  assert.equal(/items\.filter\(/u.test(keep), false, "retryable failure must NOT drop the card");
});

test("single-item accept shares the classification", () => {
  const body = storeMethod(storeSrc, "acceptItem: async (", "rejectItem: async (");
  const idx = body.indexOf("isTerminalApplyFailure(");
  assert.notEqual(idx, -1, "acceptItem does not classify terminal failures");
  const branch = body.slice(idx, idx + 500);
  assert.match(branch, /dismissedIds\.add\(/u);
  assert.match(branch, /items\.filter\(/u);
  // The honest path: only a real success removes the card as applied.
  assert.match(body, /if \(applied\) \{[\s\S]{0,120}items\.filter/u, "success path no longer removes the card");
});

test("dismissal memory survives a soft refresh", () => {
  // mergeSuggestions is the refresh funnel — a dismissed id must not re-enter.
  const start = storeSrc.lastIndexOf("mergeSuggestions:");
  assert.notEqual(start, -1, "action-store has no mergeSuggestions");
  const body = storeSrc.slice(start, start + 1200);
  assert.match(body, /dismissedIds\.has\(/u, "mergeSuggestions ignores dismissal memory");
  assert.match(body, /appliedIds\.has\(/u, "mergeSuggestions ignores applied memory");
});
