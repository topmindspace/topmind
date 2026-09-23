/**
 * Scrim-dismiss policy: what a background click may close.
 *
 * Pickers and reports close (nothing to lose); overlays that hold unsaved user
 * input — 记一下 capture, plugin mini-apps — stay open. Same rule for the
 * Dialog primitives: they never dismiss on a scrim click.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scrimDismissesOverlay } from "../src/lib/overlay-dismiss.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

test("scrim dismisses pickers and reports", () => {
  for (const kind of ["settings", "command-palette", "search", "about", "loop-report"]) {
    assert.equal(scrimDismissesOverlay(kind), true, `${kind} should dismiss on scrim`);
  }
});

test("scrim never dismisses overlays holding unsaved input", () => {
  assert.equal(scrimDismissesOverlay("quick-capture"), false);
  assert.equal(scrimDismissesOverlay("plugin-app"), false);
  // Unknown / third-party overlays default to the safe side.
  assert.equal(scrimDismissesOverlay("some-plugin-surface"), false);
  assert.equal(scrimDismissesOverlay(""), false);
});

test("OverlayHost routes the scrim click through the policy", () => {
  const src = read("src/components/shell/OverlayHost.tsx");
  assert.match(src, /import \{ scrimDismissesOverlay \} from "\.\.\/\.\.\/lib\/overlay-dismiss"/);
  assert.match(src, /if \(scrimDismissesOverlay\(overlay\)\) void requestCloseOverlay\(\)/);
  assert.doesNotMatch(src, /onClick=\{\(\) => void requestCloseOverlay\(\)\}/);
});

test("Dialog primitive never wires the scrim to onClose", () => {
  const src = read("src/components/ui/Dialog.tsx");
  const start = src.indexOf('data-dialog-scrim');
  assert.ok(start > 0, "dialog scrim marker missing");
  const scrimTag = src.slice(start - 200, start + 400);
  assert.doesNotMatch(scrimTag, /onClick=\{onClose\}/);
  assert.doesNotMatch(src, /closeOnScrim/);
});
