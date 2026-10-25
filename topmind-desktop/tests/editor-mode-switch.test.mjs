import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createElement, act } from "react";

const { window } = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, Node: window.Node, MutationObserver: window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { EditorModeSwitch, FileEditorTitleBarActions } = await import("../src/plugins/topmind-workspace/views/file-editor-format-bar.tsx");
const { TitleBarHistory } = await import("../src/components/shell/TitleBar.tsx");
const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");
const { default: i18n } = await import("../src/locales/index.ts");
await i18n.changeLanguage("en-US");

test("all icon modes have names; source can be selected while lossy visual editing is disabled", async () => {
  const root = createRoot(document.getElementById("root"));
  const changes = [];
  try {
    await act(async () => root.render(createElement(TooltipProvider, null, createElement(EditorModeSwitch, { viewMode: "source", visualDisabled: true, onChange: (mode) => changes.push(mode) }))));
    const buttons = [...document.querySelectorAll("button")];
    assert.deepEqual(buttons.map((button) => button.getAttribute("aria-label")), ["Edit", "Markdown source", "Preview"]);
    assert.equal(buttons[0].disabled, true);
    assert.equal(buttons[1].getAttribute("aria-pressed"), "true");
    assert.equal(buttons[2].getAttribute("aria-pressed"), "false");
    await act(async () => buttons[2].click());
    assert.deepEqual(changes, ["preview"]);
    await act(async () => buttons[0].click());
    assert.deepEqual(changes, ["preview"], "disabled visual mode cannot discard source syntax");
  } finally { await act(async () => root.unmount()); }
});

test("source/preview AI entry names the file conversation action and invokes it", async () => {
  const root = createRoot(document.getElementById("root"));
  let calls = 0;
  try {
    await act(async () => root.render(createElement(TooltipProvider, null, createElement(FileEditorTitleBarActions, {
      canPublish: false, busyAction: null, onPublish() {}, resolvedTopicId: null, onMemory() {}, readOnly: false,
      xPublishEnabled: false, onPostToX() {}, mounted: false, onToggleMount() {}, inlineAi: false, onRequestAiBar: () => { calls++; },
    }))));
    const button = document.querySelector('[aria-label="Ask AI about this note"]');
    assert.ok(button);
    await act(async () => button.click());
    assert.equal(calls, 1);
  } finally { await act(async () => root.unmount()); }
});

test("history controls expose disabled state and compact menu access", async () => {
  const root = createRoot(document.getElementById("root"));
  let backCalls = 0;
  let forwardCalls = 0;
  try {
    await act(async () => root.render(createElement(TooltipProvider, null, createElement(TitleBarHistory, {
      canGoBack: true, canGoForward: false,
      back() { backCalls++; }, forward() { forwardCalls++; },
    }))));
    const back = document.querySelector('[aria-label="Back"]');
    const forward = document.querySelector('[aria-label="Forward"]');
    const history = document.querySelector('[aria-label="Browsing history"]');
    assert.equal(back.disabled, false);
    assert.equal(forward.disabled, true);
    assert.equal(history.getAttribute("aria-haspopup"), "listbox");
    assert.equal(history.getAttribute("aria-expanded"), "false");
    await act(async () => { back.click(); forward.click(); });
    assert.equal(backCalls, 1);
    assert.equal(forwardCalls, 0);
  } finally { await act(async () => root.unmount()); }
});

test("file action rail collapses and restores actions when its allocated width changes", async () => {
  const previousObserver = globalThis.ResizeObserver;
  let resize;
  globalThis.ResizeObserver = class {
    constructor(callback) { resize = (width) => callback([{ contentRect: { width } }]); }
    observe() {}
    disconnect() {}
  };
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => root.render(createElement(TooltipProvider, null, createElement(FileEditorTitleBarActions, {
      canPublish: false, busyAction: null, onPublish() {}, resolvedTopicId: null, onMemory() {}, readOnly: false,
      xPublishEnabled: false, onPostToX() {}, mounted: true, onToggleMount() {}, inlineAi: false, onRequestAiBar() {},
    }))));
    await act(async () => resize(40));
    assert.equal(document.querySelector('[aria-label="Ask AI about this note"]'), null);
    assert.ok(document.querySelector('[aria-label="More"]'));
    await act(async () => resize(240));
    assert.equal(document.querySelectorAll('[aria-label="Ask AI about this note"]').length, 1);
    assert.equal(document.querySelector('[aria-label="Remove from AI context"]').getAttribute("aria-pressed"), "true");
    assert.equal(document.querySelector('[aria-label="More"]'), null);
    await act(async () => resize(40));
    assert.equal(document.querySelector('[aria-label="Ask AI about this note"]'), null);
  } finally {
    await act(async () => root.unmount());
    if (previousObserver) globalThis.ResizeObserver = previousObserver;
    else delete globalThis.ResizeObserver;
  }
});
