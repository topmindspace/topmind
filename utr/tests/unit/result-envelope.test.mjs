import test from "node:test";
import assert from "node:assert/strict";

import {
  buildResultEnvelope,
  parseToolOutput,
  unwrapToolData,
} from "../../core/result-envelope.mjs";

test("parseToolOutput reads fenced topmind-result JSON", () => {
  const output = [
    "noise before",
    "```topmind-result",
    JSON.stringify({ data: { ok: true, path: "20-研究/2026-demo/topic.md" } }, null, 2),
    "```",
  ].join("\n");

  const parsed = parseToolOutput(output);

  assert.deepEqual(parsed.parsed, { data: { ok: true, path: "20-研究/2026-demo/topic.md" } });
  assert.equal(parsed.format, "topmind-result");
  assert.equal(unwrapToolData(parsed.parsed).path, "20-研究/2026-demo/topic.md");
});

test("parseToolOutput reads raw JSON and preserves raw text on invalid output", () => {
  const parsed = parseToolOutput('{"data":{"answer":42}}');
  assert.deepEqual(parsed.parsed, { data: { answer: 42 } });
  assert.equal(parsed.format, "json");

  const invalid = parseToolOutput("plain output");
  assert.equal(invalid.parsed, null);
  assert.equal(invalid.raw, "plain output");
  assert.equal(invalid.format, "text");
});

test("buildResultEnvelope creates a portable success envelope", () => {
  const envelope = buildResultEnvelope({
    ok: true,
    kind: "workspace-write",
    command: "workspace-write.capture-note",
    data: { path: "20-研究/2026-demo/a.md" },
    receipt: { target: "20-研究/2026-demo/a.md", affectedFiles: [] },
  });

  assert.equal(envelope.ok, true);
  assert.equal(envelope.kind, "workspace-write");
  assert.equal(envelope.command, "workspace-write.capture-note");
  assert.deepEqual(envelope.data, { path: "20-研究/2026-demo/a.md" });
  assert.equal(envelope.receipt.target, "20-研究/2026-demo/a.md");
  assert.match(envelope.generatedAt, /^\d{4}-\d{2}-\d{2}T/u);
});
