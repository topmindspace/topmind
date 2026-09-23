/**
 * Scroll-dismiss policy: inside-panel scroll stays open; outside scroll closes.
 * Drives the shipped helper used by TodoPopover / DropdownMenu / context-menu.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  shouldCloseOnScroll,
  createScrollDismissHandler,
} from "../src/lib/scroll-dismiss.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

/** Minimal Event-like with target for pure helper tests */
function scrollEvent(target) {
  return { target, type: "scroll" };
}

test("shouldCloseOnScroll: scroll inside panel → stay open", () => {
  // Simulate Element.contains
  const body = { id: "body" };
  const panel = {
    contains: (n) => n === body || n === panel,
  };
  assert.equal(shouldCloseOnScroll(scrollEvent(body), panel), false);
  assert.equal(shouldCloseOnScroll(scrollEvent(panel), panel), false);
});

test("shouldCloseOnScroll: scroll outside panel → close", () => {
  const outside = { id: "page" };
  const panel = {
    contains: () => false,
  };
  assert.equal(shouldCloseOnScroll(scrollEvent(outside), panel), true);
  assert.equal(shouldCloseOnScroll(scrollEvent(outside), null), true);
});

test("shouldCloseOnScroll: nested data-menu-surface → stay open", () => {
  const nested = {
    closest: (sel) => (sel === "[data-menu-surface]" ? nested : null),
  };
  const panel = { contains: () => false };
  assert.equal(shouldCloseOnScroll(scrollEvent(nested), panel), false);
});

test("shouldCloseOnScroll: data-scroll-stable-panel host → stay open", () => {
  const host = {
    closest: (sel) => (sel === "[data-scroll-stable-panel]" ? host : null),
  };
  const panel = { contains: () => false };
  assert.equal(shouldCloseOnScroll(scrollEvent(host), panel), false);
});

test("createScrollDismissHandler only closes when policy says so", () => {
  let closed = 0;
  const body = { id: "in" };
  const panel = { contains: (n) => n === body };
  const handler = createScrollDismissHandler(
    () => panel,
    () => {
      closed += 1;
    },
  );
  handler(scrollEvent(body));
  assert.equal(closed, 0);
  handler(scrollEvent({ id: "out" }));
  assert.equal(closed, 1);
});

test("createScrollDismissHandler respects enabled=false (pinned)", () => {
  let closed = 0;
  const handler = createScrollDismissHandler(
    () => ({ contains: () => false }),
    () => {
      closed += 1;
    },
    () => false,
  );
  handler(scrollEvent({ id: "out" }));
  assert.equal(closed, 0);
});

test("TodoPopover uses shouldCloseOnScroll (not bare onOpenChange on every scroll)", () => {
  const src = read("src/components/todo/TodoPopover.tsx");
  assert.match(src, /shouldCloseOnScroll/);
  assert.match(src, /from ["'].*scroll-dismiss["']/);
  assert.match(src, /data-scroll-stable-panel/);
  // Must not be the old "close on any scroll" pattern alone
  assert.doesNotMatch(
    src,
    /const handle = \(\) => onOpenChange\(false\);\s*window\.addEventListener\(["']scroll["']/u,
  );
});

test("SuggestPopover uses shouldCloseOnScroll + outside-click dismiss (parity with TodoPopover)", () => {
  const src = read("src/components/ai/SuggestPopover.tsx");
  assert.match(src, /shouldCloseOnScroll/);
  assert.match(src, /from ["'].*scroll-dismiss["']/);
  assert.match(src, /data-scroll-stable-panel/);
  // Outside-click dismiss: mousedown listener that checks panelRef.contains
  assert.match(src, /mousedown/);
  assert.match(src, /panelRef\.current\?\.contains/);
  // Must NOT have the old "outside click does NOT close" comment
  assert.doesNotMatch(src, /Outside click does NOT close/);
});

/**
 * Layout contract: maxHeight alone is insufficient — flex body must shrink so
 * overflow-y-auto engages. Without overflow-hidden + min-h-0 flex-1, the list
 * grows past the panel and wheel scrolls the page → dismiss (OBJECTIVE #2).
 * Parity with SuggestPopover / TaskPanel.
 */
test("TodoPopover panel is a real internal scroll host (flex shrink + overflow)", () => {
  const src = read("src/components/todo/TodoPopover.tsx");
  // Outer shell: flex-col + overflow-hidden under maxHeight
  assert.match(src, /flex flex-col overflow-hidden/);
  assert.match(src, /maxHeight:\s*(?:Math\.min\(\s*)?PANEL_MAX_HEIGHT/);
  // Body scroll host classes (order-tolerant: min-h-0 and flex-1 both present with overflow-y-auto)
  assert.match(src, /min-h-0/);
  assert.match(src, /flex-1/);
  assert.match(src, /overflow-y-auto/);
  assert.match(src, /data-todo-scroll-body/);
  // Body must include all three class tokens together
  assert.match(
    src,
    /className=["'][^"']*min-h-0[^"']*flex-1[^"']*overflow-y-auto|className=["'][^"']*min-h-0 flex-1 overflow-y-auto/u,
  );
  // Header must not grow into body budget
  assert.match(src, /shrink-0/);
});

test("SuggestPopover and TaskPanel keep flex scroll-host parity", () => {
  const suggest = read("src/components/ai/SuggestPopover.tsx");
  const task = read("src/components/ai/TaskPanel.tsx");
  assert.match(suggest, /flex flex-col overflow-hidden/);
  assert.match(suggest, /min-h-0 flex-1 overflow-auto/);
  assert.match(task, /flex flex-col overflow-hidden/);
  assert.match(task, /min-h-0 flex-1 overflow-y-auto/);
});

test("DropdownMenu uses shared shouldCloseOnScroll", () => {
  const src = read("src/components/ui/DropdownMenu.tsx");
  assert.match(src, /shouldCloseOnScroll/);
  assert.match(src, /from ["'].*scroll-dismiss["']/);
});

test("context-menu uses shouldCloseOnScroll (not close on every scroll)", () => {
  const src = read("src/components/ui/context-menu.tsx");
  assert.match(src, /shouldCloseOnScroll/);
  assert.doesNotMatch(src, /const onScroll = \(\) => onClose\(\)/u);
});
