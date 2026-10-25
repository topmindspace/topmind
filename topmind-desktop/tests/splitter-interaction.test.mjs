import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createElement, act, useState } from "react";

const { window } = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { Splitter } = await import("../src/components/ui/Splitter.tsx");

async function dispatch(node, name, props = {}) {
  const event = new window.Event(name, { bubbles: true, cancelable: true });
  Object.assign(event, props);
  await act(async () => node.dispatchEvent(event));
  return event;
}
async function mount(t, side) {
  const values = [];
  function Harness() {
    const [value, setValue] = useState(240);
    return createElement(Splitter, { side, value, min: 180, max: 480, onChange: (v) => { values.push(v); setValue(v); } });
  }
  const root = createRoot(document.getElementById("root"));
  await act(async () => root.render(createElement(Harness)));
  t.after(async () => { await act(async () => root.unmount()); });
  const node = document.querySelector("[role='separator']");
  node.parentElement.getBoundingClientRect = () => assert.fail("dragging must not read parent layout on every move");
  return { node, values };
}

test("left drag measures delta rather than the ActivityBar's parent offset", async (t) => {
  const { node, values } = await mount(t, "left");
  await dispatch(node, "pointerdown", { button: 0, pointerId: 1, clientX: 288 });
  await dispatch(node, "pointermove", { pointerId: 1, clientX: 298 });
  assert.equal(values.at(-1), 250);
  await dispatch(node, "pointermove", { pointerId: 1, clientX: 300 });
  assert.equal(values.at(-1), 252);
  await dispatch(node, "pointerup", { pointerId: 1 });
  await dispatch(node, "pointermove", { pointerId: 1, clientX: 330 });
  assert.equal(values.at(-1), 252);
  assert.equal(document.body.style.userSelect, "");
});

test("right drag, bounds and keyboard resizing use the same controlled value", async (t) => {
  const { node, values } = await mount(t, "right");
  await dispatch(node, "pointerdown", { button: 0, pointerId: 1, clientX: 900 });
  await dispatch(node, "pointermove", { pointerId: 1, clientX: 880 });
  assert.equal(values.at(-1), 260);
  await dispatch(node, "pointerup", { pointerId: 1 });
  const event = await dispatch(node, "keydown", { key: "ArrowLeft", shiftKey: true });
  assert.equal(values.at(-1), 308);
  assert.equal(event.defaultPrevented, true);
  await dispatch(node, "pointerdown", { button: 0, pointerId: 2, clientX: 900 });
  await dispatch(node, "pointermove", { pointerId: 2, clientX: -900 });
  assert.equal(values.at(-1), 480);
  await dispatch(window, "blur");
  assert.equal(document.body.style.cursor, "");
});
