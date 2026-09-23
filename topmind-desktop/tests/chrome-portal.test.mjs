/**
 * ChromePortal rebinds when the host remounts (TitleBar focus mode used to
 * drop data-titlebar-actions-slot, leaving children on a detached node).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { parseHTML } from "linkedom";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ChromePortal,
  notifyChromeSlots,
  queryChromeSlot,
  watchChromeSlot,
} from "../src/lib/chrome-portal.tsx";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function installDom() {
  const { window, document } = parseHTML("<!doctype html><html><body></body></html>");
  globalThis.window = window;
  globalThis.document = document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.MutationObserver = window.MutationObserver;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  if (!globalThis.navigator) {
    globalThis.navigator = { userAgent: "node-test" };
  }
  return { window, document };
}

test("TitleBar keeps data-titlebar-actions-slot mounted in the focus-mode tree", () => {
  const src = readFileSync(path.join(root, "src/components/shell/TitleBar.tsx"), "utf8");
  assert.match(src, /data-titlebar-actions-slot/);
  assert.match(src, /notifyChromeSlots/);
  // Slot is not inside the focusMode-only early return; one header always hosts it.
  assert.doesNotMatch(
    src,
    /if \(focusMode\) \{[\s\S]*return \([\s\S]*<\/header>\s*\);\s*\}/,
  );
  const slotIdx = src.indexOf("data-titlebar-actions-slot");
  const focusIdx = src.indexOf("{focusMode ? (");
  assert.ok(slotIdx > 0 && focusIdx > 0);
});

test("watchChromeSlot rebinds after the host remounts", () => {
  const { document } = installDom();
  const seen = [];
  const stop = watchChromeSlot("[data-titlebar-actions-slot]", (el) => {
    seen.push(el);
  });
  assert.equal(seen.at(-1), null);

  const a = document.createElement("div");
  a.setAttribute("data-titlebar-actions-slot", "");
  document.body.append(a);
  notifyChromeSlots();
  assert.equal(queryChromeSlot("[data-titlebar-actions-slot]"), a);
  assert.equal(seen.at(-1), a);

  a.remove();
  notifyChromeSlots();
  assert.equal(queryChromeSlot("[data-titlebar-actions-slot]"), null);
  assert.equal(seen.at(-1), null);

  const b = document.createElement("div");
  b.setAttribute("data-titlebar-actions-slot", "");
  document.body.append(b);
  notifyChromeSlots();
  assert.equal(queryChromeSlot("[data-titlebar-actions-slot]"), b);
  assert.equal(seen.at(-1), b);
  assert.notEqual(a, b);
  stop();
});

test("ChromePortal children follow a remounted host", async () => {
  const { document } = installDom();
  const hostA = document.createElement("div");
  hostA.setAttribute("data-titlebar-actions-slot", "");
  document.body.append(hostA);

  const mount = document.createElement("div");
  document.body.append(mount);
  const rootNode = createRoot(mount);

  await act(async () => {
    rootNode.render(
      createElement(
        ChromePortal,
        { selector: "[data-titlebar-actions-slot]" },
        createElement("button", { "data-test-action": "1" }, "Go"),
      ),
    );
  });

  assert.ok(hostA.querySelector("[data-test-action]"), "children land in the first host");

  hostA.remove();
  const hostB = document.createElement("div");
  hostB.setAttribute("data-titlebar-actions-slot", "");
  document.body.append(hostB);
  await act(async () => {
    notifyChromeSlots();
  });

  assert.equal(hostA.querySelector("[data-test-action]"), null);
  assert.ok(hostB.querySelector("[data-test-action]"), "children reappear on the remounted host");

  await act(async () => {
    rootNode.unmount();
  });
});
