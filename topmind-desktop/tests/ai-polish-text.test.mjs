/**
 * Real shipped polishComposerText helper (stream composer + QuickCapture).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcTs = path.join(root, "src/lib/ai-polish-text.ts");

// Vite/TS source is compiled via esbuild in tests? Desktop uses tsx --test.
// Import via dynamic path that tsx can load:
const mod = await import(pathToFileURL(path.join(root, "src/lib/ai-polish-text.ts")).href);

test("polishComposerText calls complete with action polish and returns text", async () => {
  const calls = [];
  const complete = async (args) => {
    calls.push(args);
    return { text: "  polished body  " };
  };
  const out = await mod.polishComposerText(complete, "  raw note  ", "stream-polish");
  assert.equal(out, "polished body");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, "polish");
  assert.equal(calls[0].mode, "rewrite");
  assert.equal(calls[0].text, "raw note");
  assert.match(calls[0].requestId, /^stream-polish-/u);
});

test("polishComposerText forwards documentText for whole-file format context", async () => {
  const calls = [];
  const doc = "# Title\n\n- a\n- b\n";
  await mod.polishComposerText(
    async (args) => {
      calls.push(args);
      return { text: "polished" };
    },
    "snippet",
    "stream-polish",
    { documentText: doc },
  );
  assert.equal(calls[0].documentText, doc.trim());
  assert.equal(calls[0].action, "polish");
});

test("polishComposerText returns null for empty input without calling complete", async () => {
  let called = false;
  const out = await mod.polishComposerText(async () => {
    called = true;
    return { text: "x" };
  }, "   ");
  assert.equal(out, null);
  assert.equal(called, false);
});

test("polishComposerText returns null when complete yields empty text", async () => {
  const out = await mod.polishComposerText(async () => ({ text: "  " }), "hello");
  assert.equal(out, null);
});

test("StreamDetailView and QuickCapture wire polishComposerText / action polish", () => {
  const stream = readFileSync(path.join(root, "src/plugins/topmind-workspace/views/StreamDetailView.tsx"), "utf8");
  const capture = readFileSync(path.join(root, "src/components/overlays/CaptureForm.tsx"), "utf8");
  assert.match(stream, /polishComposerText/u);
  assert.match(stream, /action:\s*["']polish["']|polishComposerText\(/u);
  assert.match(stream, /composeAiPolish|aiPolish/u);
  assert.match(capture, /polishComposerText/u);
  // Capture still uses real complete path via helper
  assert.match(capture, /api\.ai\.complete/u);
});

test("stream detail: polish + save primary; full capture demoted; no header 记一下", () => {
  const stream = readFileSync(path.join(root, "src/plugins/topmind-workspace/views/StreamDetailView.tsx"), "utf8");
  // Maintain todos + polish + save
  assert.match(stream, /id:\s*["']ai-todos["']/u);
  assert.match(stream, /useTodoStore\.getState\(\)\.maintain/u);
  assert.match(stream, /handleComposePolish|polishComposerText/u);
  assert.match(stream, /handleInlineCompose/u);
  // Full capture only as tertiary link (not header primary)
  assert.match(stream, /composeFullCapture/u);
  assert.doesNotMatch(stream, /id:\s*["']capture["']/u);
  assert.doesNotMatch(stream, /primary:\s*true/u);
  // Stream polish passes period body as documentText
  assert.match(stream, /documentText/u);
  assert.match(stream, /data-stream-inline-composer/u);
  assert.match(stream, /data-stream-feed|data-stream-day-group/u);
});