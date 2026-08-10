/**
 * Drives shipped decideSuggestRefresh (ActionStore cold/soft policy).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  decideSuggestRefresh,
  SUGGEST_SOFT_THROTTLE_MS,
} from "../src/lib/suggest-boot-policy.ts";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("autoPrepare off: kernel skip, pending still requested", () => {
  const d = decideSuggestRefresh({
    autoPrepare: false,
    force: false,
    lastRefreshAt: 0,
    now: 10_000,
    everLoaded: false,
    itemCount: 0,
  });
  assert.equal(d.runKernelSuggest, false);
  assert.equal(d.runPendingWrites, true);
  assert.equal(d.reason, "auto_prepare_off");
});

test("soft throttle: skip all when recently refreshed with items", () => {
  const now = 50_000;
  const d = decideSuggestRefresh({
    autoPrepare: true,
    force: false,
    lastRefreshAt: now - 1000,
    now,
    everLoaded: true,
    itemCount: 3,
    throttleMs: SUGGEST_SOFT_THROTTLE_MS,
  });
  assert.equal(d.runKernelSuggest, false);
  // Pending writes still load when throttled — user confirm path must stay responsive
  assert.equal(d.runPendingWrites, true);
  assert.equal(d.reason, "soft_throttled");
});

test("force always runs kernel when autoPrepare on", () => {
  const d = decideSuggestRefresh({
    autoPrepare: true,
    force: true,
    lastRefreshAt: Date.now(),
    everLoaded: true,
    itemCount: 5,
  });
  assert.equal(d.runKernelSuggest, true);
  assert.equal(d.soft, false);
  assert.equal(d.reason, "force_refresh");
});

test("cold start with autoPrepare: soft kernel refresh", () => {
  const d = decideSuggestRefresh({
    autoPrepare: true,
    force: false,
    lastRefreshAt: 0,
    now: 1,
    everLoaded: false,
    itemCount: 0,
  });
  assert.equal(d.runKernelSuggest, true);
  assert.equal(d.soft, true);
  assert.equal(d.reason, "cold_or_soft_refresh");
});

test("ActionStore refresh uses decideSuggestRefresh (shipped wire)", () => {
  const store = readFileSync(path.join(root, "src/stores/action-store.ts"), "utf8");
  assert.match(store, /decideSuggestRefresh|suggest-boot-policy/);
  assert.match(store, /mergeSuggestRefreshItems/);
  assert.match(store, /autoPrepare/);
  // Multi-AI: soft path yields to agent stream; kernel suggest on background lane
  assert.match(store, /agentStreaming/);
  assert.match(store, /enqueueBackgroundAi|ai-background-lane/);
});

test("soft agentStreaming skips kernel; force still runs", () => {
  const now = 100_000;
  // lastRefreshAt far enough that soft throttle does not fire first
  const soft = decideSuggestRefresh({
    autoPrepare: true,
    force: false,
    lastRefreshAt: now - 10_000,
    now,
    everLoaded: true,
    itemCount: 2,
    agentStreaming: true,
  });
  assert.equal(soft.runKernelSuggest, false);
  assert.equal(soft.reason, "agent_busy");
  assert.equal(soft.runPendingWrites, true);

  const force = decideSuggestRefresh({
    autoPrepare: true,
    force: true,
    lastRefreshAt: now,
    now,
    everLoaded: true,
    itemCount: 2,
    agentStreaming: true,
  });
  assert.equal(force.runKernelSuggest, true);
  assert.equal(force.reason, "force_refresh");
});

test("Shell healthy-workspace boot re-arms suggest with soft refresh (not force)", () => {
  const shell = readFileSync(path.join(root, "src/components/shell/useWorkspaceHealth.ts"), "utf8");
  // Boot arm useEffect (not the useRef declaration) — soft only so durable fingerprints survive restart
  const marker = "suggestBootArmed.current = true";
  const bootIdx = shell.indexOf(marker);
  assert.ok(bootIdx >= 0, "boot arm must set suggestBootArmed.current = true");
  const region = shell.slice(bootIdx, bootIdx + 500);
  assert.match(region, /st\.refresh\(\s*\)/);
  assert.doesNotMatch(region, /refresh\(\s*\{\s*force\s*:\s*true\s*\}\s*\)/);
  // Comment contract: soft path documented next to boot arm
  assert.match(shell, /Soft refresh only|durable activity fingerprints/i);
  // Force remains reserved for user-initiated surfaces (SuggestPopover / openSuggestSurface)
  const pop = readFileSync(path.join(root, "src/components/ai/SuggestPopover.tsx"), "utf8");
  assert.match(pop, /refresh\(\s*\{\s*force\s*:\s*true\s*\}\s*\)/);
  const surface = readFileSync(path.join(root, "src/lib/suggest-surface.ts"), "utf8");
  assert.match(surface, /force\s*:\s*true/);
});

test("generateSuggestions force flag wires from ActionStore force refresh", () => {
  const store = readFileSync(path.join(root, "src/stores/action-store.ts"), "utf8");
  // Soft decision → generateSuggestions without force; force path clears durable fingerprints
  assert.match(store, /generateSuggestions\(\s*\{\s*force:\s*!decision\.soft\s*\}\s*\)/);
  const eng = readFileSync(path.join(root, "../lib/suggest-engine.mjs"), "utf8");
  assert.match(eng, /clearSuggestFingerprints/);
  assert.match(eng, /force\s*===\s*true/);
});
