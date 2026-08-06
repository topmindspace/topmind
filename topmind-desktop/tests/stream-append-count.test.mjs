/**
 * Stream append badge count — must match real shipped formatAppendBlock blocks.
 * One append emits both HTML marker and #### 续; badge must show 1 not 2.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { countStreamAppends } from "../src/lib/stream-period-parse.ts";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engineRoot = path.resolve(desktopRoot, "..");
// Dynamic import needs a file:// URL on Windows (absolute paths with drive letters fail ESM loader)
const activityWindowUrl = pathToFileURL(
  path.join(engineRoot, "lib/activity-window.mjs"),
).href;

test("countStreamAppends: one formatAppendBlock body ⇒ count 1 (not 2)", async () => {
  const { formatAppendBlock } = await import(activityWindowUrl);
  const block = formatAppendBlock({
    content: "follow-up note",
    heading: "原条目",
    date: new Date("2026-08-03T12:00:00.000Z"),
  });
  // Shipped block always has both marker families
  assert.match(block, /<!--\s*topmind:append\b/u);
  assert.match(block, /####\s*续/u);
  const body = `- original line\n${block}`;
  assert.equal(countStreamAppends(body), 1, "must not double-count marker + #### 续");
});

test("countStreamAppends: N formatAppendBlock appends ⇒ count N", async () => {
  const { formatAppendBlock } = await import(activityWindowUrl);
  let body = "## 记录\n\n- base entry\n";
  for (let i = 0; i < 3; i++) {
    body += formatAppendBlock({
      content: `续写 ${i + 1}`,
      heading: "记录",
      date: new Date(`2026-08-0${i + 1}T10:00:00.000Z`),
    });
  }
  assert.equal(countStreamAppends(body), 3);
});

test("countStreamAppends: legacy #### 续 only (no machine marker) still counts", () => {
  const legacy = "- note\n\n#### 续 · 2026-08-01\n\nmore\n\n#### 续 · 2026-08-02\n\nmore2\n";
  assert.equal(countStreamAppends(legacy), 2);
});

test("countStreamAppends: empty / no appends ⇒ 0", () => {
  assert.equal(countStreamAppends(""), 0);
  assert.equal(countStreamAppends("- just a line\n\nparagraph"), 0);
});

test("stream-entry-present uses countStreamAppends (not dual regex)", () => {
  // countStreamAppends lives in stream-period-parse and is consumed by stream-entry-present
  // (which StreamDetailView imports for expand decisions).
  const present = readFileSync(
    path.join(desktopRoot, "src/lib/stream-entry-present.ts"),
    "utf8",
  );
  assert.match(present, /countStreamAppends/);
  // View no longer inlines append regex — it delegates to presentation helpers
  const view = readFileSync(
    path.join(desktopRoot, "src/plugins/topmind-workspace/views/StreamDetailView.tsx"),
    "utf8",
  );
  assert.doesNotMatch(view, /topmind:append\|####\\s\*续/);
});
