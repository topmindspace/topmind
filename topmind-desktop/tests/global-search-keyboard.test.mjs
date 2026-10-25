import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createElement, act } from "react";

const { window } = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
Object.assign(globalThis, {
  window, document: window.document, HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement, Node: window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
  localStorage: { getItem: () => '["alpha","beta"]', setItem() {}, removeItem() {} },
});
window.HTMLElement.prototype.scrollIntoView = function () {};
window.topmind = { subscribe: () => () => {}, invoke: async () => ({ results: [
  { relativePath: "88-outputs/result.md", preview: "delivery", nameMatch: false },
  { relativePath: "memory/profile.md", preview: "profile", nameMatch: false },
], count: 2 }) };

const { createRoot } = await import("react-dom/client");
const { GlobalSearch } = await import("../src/components/overlays/GlobalSearch.tsx");
const { useViewStore } = await import("../src/stores/view-store.ts");

async function mount(t) {
  const root = createRoot(document.getElementById("root"));
  await act(async () => root.render(createElement(GlobalSearch)));
  t.after(async () => { await act(async () => root.unmount()); });
  return document.querySelector("[role='combobox']");
}
async function press(input, key, props = {}) {
  const event = new window.Event("keydown", { bubbles: true, cancelable: true });
  Object.assign(event, { key, keyCode: 0, ...props });
  await act(async () => input.dispatchEvent(event));
  return event;
}

test("combobox navigation is handled once and cannot reach the workbench", async (t) => {
  const input = await mount(t);
  const escaped = [];
  const onKey = (event) => escaped.push(event.key);
  document.addEventListener("keydown", onKey);
  t.after(() => document.removeEventListener("keydown", onKey));
  const down = await press(input, "ArrowDown");
  assert.equal(input.getAttribute("aria-activedescendant"), "global-search-opt-1");
  assert.equal(down.defaultPrevented, true);
  await press(input, "ArrowUp");
  assert.equal(input.getAttribute("aria-activedescendant"), "global-search-opt-0");
  await press(input, "Enter");
  assert.deepEqual(escaped, []);
});

test("IME commit stays inside the input while native editing keys remain available", async (t) => {
  const input = await mount(t);
  const escaped = [];
  const onKey = (event) => escaped.push(event.key);
  document.addEventListener("keydown", onKey);
  t.after(() => document.removeEventListener("keydown", onKey));
  const composition = await press(input, "Enter", { isComposing: true });
  assert.equal(composition.defaultPrevented, false, "native composition must still commit");
  assert.equal(input.value, "");
  assert.deepEqual(escaped, []);
  const home = await press(input, "Home");
  const end = await press(input, "End");
  assert.equal(home.defaultPrevented, false);
  assert.equal(end.defaultPrevented, false);
});

test("Enter opens the first visibly grouped result, rather than the API's first hit", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const input = await mount(t);
  // Enter a recent search using the real component, then finish its debounce.
  await press(input, "Enter");
  await act(async () => {
    t.mock.timers.tick(180);
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.match(document.querySelector("[role='option']").textContent, /memory\/profile.md/u);
  await press(input, "Enter");
  assert.equal(useViewStore.getState().selection.path, "memory/profile.md");
});
