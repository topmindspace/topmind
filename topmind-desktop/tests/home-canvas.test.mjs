/**
 * Drives the shipped canvas-default helpers and the pure home summary
 * that WorkspaceHomeView renders. Does not reimplement either.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultCanvasSelection,
  normalizeSelection,
  selectionAfterFileTabsClose,
} from "../src/types.ts";
import {
  HOME_ACTION_IDS,
  summarizeWorkspaceHome,
} from "../src/plugins/topmind-workspace/home-summary.ts";
import {
  destinationSwitchKind,
  destinationSwitchLabel,
  DESTINATION_SWITCH_KINDS,
  primaryViewSwitchKind,
} from "../src/lib/titlebar-identity.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("null, unknown, and last-tab-closed selections land on the home", () => {
  assert.deepEqual(defaultCanvasSelection(), { kind: "home" });
  assert.deepEqual(normalizeSelection(null), { kind: "home" });
  assert.deepEqual(normalizeSelection(undefined), { kind: "home" });
  assert.deepEqual(normalizeSelection({ kind: "not-a-surface" }), { kind: "home" });
  assert.deepEqual(normalizeSelection({ kind: "dashboard" }), { kind: "home" });
  assert.deepEqual(selectionAfterFileTabsClose([]), { kind: "home" });
  assert.deepEqual(selectionAfterFileTabsClose(["", "  "]), { kind: "home" });
});

test("explicit stream, inbox, outputs, file, and memory stay themselves", () => {
  assert.deepEqual(normalizeSelection({ kind: "stream" }), { kind: "stream" });
  assert.deepEqual(normalizeSelection({ kind: "inbox" }), { kind: "inbox" });
  assert.deepEqual(normalizeSelection({ kind: "outputs" }), { kind: "outputs" });
  assert.deepEqual(normalizeSelection({ kind: "memory" }), { kind: "memory" });
  const file = normalizeSelection({ kind: "file", path: "20-专题/note.md" });
  assert.equal(file.kind, "file");
  assert.equal(file.kind === "file" ? file.path : "", "20-专题/note.md");
  const kept = selectionAfterFileTabsClose(["10-动态/2026/week.md", "other.md"]);
  assert.equal(kept.kind, "file");
  assert.equal(kept.kind === "file" ? kept.path : "", "10-动态/2026/week.md");
  assert.equal(kept.kind === "file" ? kept.topicId : "", "10-动态/2026");
  assert.equal(primaryViewSwitchKind("home"), null);
  assert.equal(primaryViewSwitchKind("stream"), "stream");
});

test("sidebar destination switcher includes home and does not label it as stream", () => {
  const labels = { home: "Workspace", stream: "Stream", inbox: "Inbox", outputs: "Delivery" };
  assert.deepEqual([...DESTINATION_SWITCH_KINDS], ["home", "stream", "inbox", "outputs"]);
  assert.equal(destinationSwitchKind("home"), "home");
  assert.equal(destinationSwitchKind("stream"), "stream");
  assert.equal(destinationSwitchKind("inbox"), "inbox");
  assert.equal(destinationSwitchKind("outputs"), "outputs");
  assert.equal(destinationSwitchKind("file"), "home");
  assert.equal(destinationSwitchLabel("home", labels), labels.home);
  assert.notEqual(destinationSwitchLabel("home", labels), labels.stream);
  assert.equal(destinationSwitchLabel("stream", labels), labels.stream);
  assert.equal(destinationSwitchLabel(null, labels), labels.home);

  const nav = fs.readFileSync(path.join(root, "src/components/shell/PrimaryNav.tsx"), "utf8");
  const homeAt = nav.indexOf('kind: "home"');
  assert.ok(homeAt >= 0, "destination switcher lists home");
  const homeSlice = nav.slice(homeAt, nav.indexOf('kind: "stream"', homeAt));
  assert.match(homeSlice, /RiHome4Line/);
  assert.doesNotMatch(homeSlice, /RiNewspaperLine/);
  assert.match(nav, /destinationSwitchKind/);
});

test("a populated snapshot echoes identity, six actions, and live info", () => {
  const summary = summarizeWorkspaceHome({
    name: "Field notes",
    root: "/Users/me/Field notes",
    streamContext: {
      periodRelPath: "10-动态/2026/2026-W12.md",
      periodTitle: "2026-W12",
      periodFileName: "2026-W12.md",
    },
    periods: [
      {
        relPath: "10-动态/2026/2026-W02.md",
        fileName: "2026-W02.md",
        title: "2026-W02",
        mtime: "2026-09-01T00:00:00.000Z",
      },
      {
        relPath: "10-动态/2026/2026-W12.md",
        fileName: "2026-W12.md",
        title: "2026-W12",
        mtime: "2026-01-01T00:00:00.000Z",
      },
    ],
    inbox: {
      count: 2,
      items: [{ name: "clip.md", relativePath: "00-Inbox/clip.md", mtime: "2026-03-21T00:00:00.000Z" }],
    },
    outputs: {
      count: 1,
      items: [{ name: "essay.md", relativePath: "88-交付/essay.md" }],
    },
    categories: [
      { name: "Inbox", role: "buffer" },
      { name: "动态", role: "loose-stream" },
      { name: "专题", role: "deep-work" },
      { name: "交付", role: "delivery" },
      { name: "归档", role: "system" },
      { name: "隐藏", role: "deep-work", hidden: true },
    ],
  });

  assert.equal(summary.identity.name, "Field notes");
  assert.equal(summary.identity.root, "/Users/me/Field notes");
  assert.deepEqual(summary.actions.map((action) => action.id), [...HOME_ACTION_IDS]);
  assert.equal(summary.actions.find((action) => action.id === "capture").target, undefined);
  assert.deepEqual(summary.actions.find((action) => action.id === "stream").target, { kind: "stream" });
  assert.deepEqual(summary.actions.find((action) => action.id === "inbox").target, { kind: "inbox" });
  assert.deepEqual(summary.actions.find((action) => action.id === "outputs").target, { kind: "outputs" });
  assert.deepEqual(summary.actions.find((action) => action.id === "memory").target, { kind: "memory" });
  assert.deepEqual(summary.actions.find((action) => action.id === "topics").target, {
    kind: "category",
    category: "专题",
  });
  assert.equal(summary.period.present, true);
  assert.equal(summary.period.source, "current");
  assert.equal(summary.period.title, "2026-W12");
  assert.equal(summary.period.relPath, "10-动态/2026/2026-W12.md");
  assert.equal(summary.inbox.count, 2);
  assert.equal(summary.inbox.items[0].relativePath, "00-Inbox/clip.md");
  assert.equal(summary.outputs.count, 1);
  assert.equal(summary.outputs.items[0].name, "essay.md");
  assert.deepEqual(summary.topics.map((topic) => topic.name), ["专题"]);
  assert.equal(summary.empty, false);
});

test("an empty snapshot keeps the same structure and says it is empty", () => {
  const summary = summarizeWorkspaceHome({
    name: "",
    root: "/tmp/empty-ws",
    streamContext: null,
    periods: [],
    inbox: { count: 0, items: [] },
    outputs: { count: 0, items: [] },
    categories: [],
  });

  assert.equal(summary.identity.name, "empty-ws");
  assert.equal(summary.identity.root, "/tmp/empty-ws");
  assert.deepEqual(summary.actions.map((action) => action.id), [...HOME_ACTION_IDS]);
  assert.equal(summary.period.present, false);
  assert.equal(summary.period.source, "none");
  assert.equal(summary.period.relPath, null);
  assert.equal(summary.inbox.count, 0);
  assert.deepEqual(summary.inbox.items, []);
  assert.equal(summary.outputs.count, 0);
  assert.deepEqual(summary.outputs.items, []);
  assert.deepEqual(summary.topics, []);
  assert.equal(summary.actions.find((action) => action.id === "topics").target, undefined);
  assert.equal(summary.empty, true);
});

test("a computed period path missing from the period list is not present", () => {
  const summary = summarizeWorkspaceHome({
    name: "",
    root: "/tmp/empty-ws",
    streamContext: {
      periodRelPath: "10-动态/2026/2026-W38.md",
      periodTitle: "2026-W38",
      periodFileName: "2026-W38.md",
    },
    periods: [],
    inbox: { count: 0, items: [] },
    outputs: { count: 0, items: [] },
    categories: [],
  });

  assert.equal(summary.period.present, false);
  assert.equal(summary.period.source, "none");
  assert.equal(summary.period.relPath, null);
  assert.equal(summary.period.title, null);
  assert.equal(summary.inbox.count, 0);
  assert.equal(summary.outputs.count, 0);
  assert.deepEqual(summary.topics, []);
  assert.equal(summary.empty, true);
});

test("without a listed current file, filename-newest beats a later mtime", () => {
  const summary = summarizeWorkspaceHome({
    name: "Field notes",
    root: "/Users/me/Field notes",
    streamContext: {
      periodRelPath: "10-动态/2026/2026-W38.md",
      periodTitle: "2026-W38",
      periodFileName: "2026-W38.md",
    },
    periods: [
      {
        relPath: "10-动态/2026/2026-W02.md",
        fileName: "2026-W02.md",
        title: "2026-W02",
        mtime: "2026-09-01T00:00:00.000Z",
      },
      {
        relPath: "10-动态/2026/2026-W12.md",
        fileName: "2026-W12.md",
        title: "2026-W12",
        mtime: "2026-01-01T00:00:00.000Z",
      },
    ],
    inbox: { count: 0, items: [] },
    outputs: { count: 0, items: [] },
    categories: [],
  });

  assert.equal(summary.period.present, true);
  assert.equal(summary.period.source, "latest");
  assert.equal(summary.period.relPath, "10-动态/2026/2026-W12.md");
  assert.equal(summary.period.title, "2026-W12");
  assert.equal(summary.period.fileName, "2026-W12.md");
  assert.notEqual(summary.period.relPath, "10-动态/2026/2026-W38.md");
  assert.notEqual(summary.period.relPath, "10-动态/2026/2026-W02.md");
  assert.equal(summary.empty, false);
});

test("the canvas imports this summary instead of a parallel copy", () => {
  const view = fs.readFileSync(
    path.join(root, "src/plugins/topmind-workspace/views/WorkspaceHomeView.tsx"),
    "utf8",
  );
  assert.match(view, /from ["']\.\.\/home-summary["']/);
  assert.match(view, /summarizeWorkspaceHome\(/);
  assert.match(view, /periods:\s*\(periods \|\| \[\]\)/);
  assert.doesNotMatch(view, /pickLatestPeriod/);
  assert.doesNotMatch(view, /currentPeriod:\s*ctx/);
  const store = fs.readFileSync(path.join(root, "src/stores/view-store.ts"), "utf8");
  assert.match(store, /selectionAfterFileTabsClose\(/);
  assert.match(store, /defaultCanvasSelection\(/);
});
