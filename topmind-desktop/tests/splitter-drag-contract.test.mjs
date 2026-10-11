/**
 * Splitter sticky-drag contract — a missed pointerup must not leave width
 * tracking the cursor. Guards: ref-based drag flag + window-level stoppers.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../src/", import.meta.url);
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, root)), "utf8");

test("Splitter drag flag is a ref, not only React state", () => {
  const src = read("components/ui/Splitter.tsx");
  assert.match(src, /const draggingRef = useRef\(false\)/);
  assert.match(src, /if \(!draggingRef\.current\) return/);
});

test("Splitter hard-stops drag on window pointerup / pointercancel / blur", () => {
  const src = read("components/ui/Splitter.tsx");
  assert.match(src, /window\.addEventListener\("pointerup"/);
  assert.match(src, /window\.addEventListener\("pointercancel"/);
  assert.match(src, /window\.addEventListener\("blur"/);
  assert.match(src, /onLostPointerCapture/);
  assert.match(src, /userSelect/);
  // Unmount mid-drag must restore body styles (effect cleanup calls endDrag).
  assert.match(src, /window\.removeEventListener\("blur", stop\);\s*endDrag\(\);/);
});

test("Splitter aria-label is localized, not hardcoded English", () => {
  const src = read("components/ui/Splitter.tsx");
  assert.match(src, /aria-label=\{t\("splitter\.resizePanel"\)\}/);
  assert.doesNotMatch(src, /aria-label="Resize panel"/);
});

test("editor split divider uses the same hard-stop pattern", () => {
  const src = read("components/shell/EditorArea.tsx");
  assert.match(src, /window\.addEventListener\("pointerup"/);
  assert.match(src, /onLostPointerCapture/);
  assert.match(src, /document\.body\.style\.userSelect/);
});

test("only primary button starts a resize", () => {
  assert.match(read("components/ui/Splitter.tsx"), /if \(e\.button !== 0\) return/);
  assert.match(read("components/shell/EditorArea.tsx"), /if \(e\.button !== 0\) return/);
});
