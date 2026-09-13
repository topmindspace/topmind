/**
 * Stream period chips use the Kernel `reconciled` flag (未整理 = !reconciled).
 * Current period may still show need-tidy; badge is not hidden just because a chip is active.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

test("period chips bind 未整理 to p.reconciled and keep it on the active period", () => {
  const src = read("src/plugins/topmind-workspace/views/StreamDetailView.tsx");
  assert.match(src, /function StreamPeriodChip/);
  assert.match(src, /data-period-needs-tidy=\{p\.reconciled \? undefined : "true"\}/);
  assert.match(src, /\{!p\.reconciled \? \(/);
  assert.doesNotMatch(src, /!p\.reconciled && !isActive/);
  assert.match(src, /streamDetail\.unreconciledShort/);
  assert.match(src, /reconciled: p\.reconciled/);
});

test("capture / write skill dock icons match the labeled skill", () => {
  const src = read("src/components/ai/ChatInput.tsx");
  assert.match(src, /"topmind-capture": RiStickyNoteAddLine/);
  assert.match(src, /"topmind-write": RiQuillPenLine/);
  assert.doesNotMatch(src, /"topmind-capture": RiLightbulbLine/);
});

test("settings tools tab is not a terminal/shell glyph", () => {
  const src = read("src/components/overlays/SettingsDialog.tsx");
  assert.match(src, /id: "tools".*icon: RiToolsLine/);
  assert.doesNotMatch(src, /id: "tools".*icon: RiTerminalLine/);
});
