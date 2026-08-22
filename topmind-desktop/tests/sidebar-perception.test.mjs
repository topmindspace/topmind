/**
 * Sidebar / inbox file perception — drive shipped classify + reveal helpers
 * and source contracts (no copied re-implementation).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyTreeFileChange,
  parseFileChangedPayload,
  shouldExpandInboxSection,
  inboxChildCount,
} from "../src/lib/tree-listing-change.ts";
import { expandIdsForSelection } from "../src/lib/tree-reveal.ts";
import { fileChangedPayloadForCompletedIngestJob } from "../electron/lib/ingest/queue.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

test("inbox relativePath after empty inbox is a listing rebuild, not skip", () => {
  const decision = classifyTreeFileChange({
    relativePath: "00-收件箱/clip-note.md",
    event: "add",
  });
  assert.equal(decision.kind, "listing");
  assert.equal(decision.section, "inbox");
  // The old bug: any relativePath skipped rebuild. Classifier must not do that.
  assert.notEqual(decision.kind, "content");
});

test("English / Inbox buffer roots are listing changes", () => {
  assert.equal(classifyTreeFileChange({ relativePath: "00-Inbox/a.md" }).kind, "listing");
  assert.equal(classifyTreeFileChange({ relativePath: "00 Inbox/b.md" }).kind, "listing");
  assert.equal(classifyTreeFileChange({ path: "Inbox/c.md" }).kind, "listing");
});

test("topic-internal content save stays targeted", () => {
  const decision = classifyTreeFileChange({
    relativePath: "20-专题/2026-foo/note.md",
  });
  assert.equal(decision.kind, "content");
  assert.equal(decision.section, "topic");
  assert.equal(decision.topicId, "20-专题/2026-foo");
});

test("stream year-dir period save stays targeted", () => {
  const decision = classifyTreeFileChange({
    relativePath: "10-动态/2026/2026-W30.md",
    event: "change",
  });
  assert.equal(decision.kind, "content");
});

test("outputs / archive / category-root / missing path are listing", () => {
  assert.equal(classifyTreeFileChange({ relativePath: "88-输出/essay.md" }).kind, "listing");
  assert.equal(classifyTreeFileChange({ relativePath: "99-归档/backups/x.md", event: "add" }).kind, "listing");
  assert.equal(classifyTreeFileChange({ relativePath: "20-专题/loose.md" }).kind, "listing");
  assert.equal(classifyTreeFileChange({}).kind, "listing");
  assert.equal(classifyTreeFileChange(undefined).kind, "listing");
  assert.equal(classifyTreeFileChange({ event: "unlink", relativePath: "20-专题/2026-foo/gone.md" }).kind, "listing");
});

test("empty→non-empty inbox and inbox file selection expand inbox section", () => {
  assert.equal(
    shouldExpandInboxSection({ prevInboxCount: 0, nextInboxCount: 1, selection: { kind: "stream" } }),
    true,
  );
  assert.equal(
    shouldExpandInboxSection({ prevInboxCount: 1, nextInboxCount: 2, selection: { kind: "stream" } }),
    false,
  );
  assert.equal(
    shouldExpandInboxSection({
      prevInboxCount: 1,
      nextInboxCount: 1,
      selection: { kind: "file", path: "00-收件箱/a.md" },
    }),
    true,
  );
  assert.equal(
    shouldExpandInboxSection({ prevInboxCount: 0, nextInboxCount: 0, selection: { kind: "inbox" } }),
    false,
  );
  assert.deepEqual(expandIdsForSelection({ kind: "file", path: "00-收件箱/a.md" }), ["section/inbox"]);
  assert.deepEqual(expandIdsForSelection({ kind: "inbox" }), ["section/inbox"]);
});

test("inboxChildCount reads section/inbox children", () => {
  assert.equal(inboxChildCount([]), 0);
  assert.equal(
    inboxChildCount([
      { id: "section/inbox", children: [{ id: "a" }, { id: "b" }] },
      { id: "cat/10", children: [] },
    ]),
    2,
  );
});

test("ingest job-done payload is a listing refresh (not enqueue-only)", () => {
  assert.equal(fileChangedPayloadForCompletedIngestJob({ status: "queued" }), null);
  assert.equal(fileChangedPayloadForCompletedIngestJob({ status: "running" }), null);
  assert.equal(fileChangedPayloadForCompletedIngestJob({ status: "failed", result: { targetPath: "00-收件箱/x.md" } }), null);

  const payload = fileChangedPayloadForCompletedIngestJob({
    status: "done",
    result: { targetPath: "00-收件箱/converted.md" },
  });
  assert.ok(payload);
  assert.equal(payload.listing, true);
  assert.equal(payload.source, "ingest");
  assert.equal(payload.event, "add");
  assert.equal(payload.relativePath, "00-收件箱/converted.md");
  assert.equal(classifyTreeFileChange(payload).kind, "listing");
  assert.equal(classifyTreeFileChange(payload).section, "inbox");
});

test("clip path payload (legacy) classifies as inbox listing", () => {
  const parsed = parseFileChangedPayload({ path: "00-收件箱/clip.md" });
  assert.equal(parsed.relativePath, "00-收件箱/clip.md");
  assert.equal(classifyTreeFileChange({ path: "00-收件箱/clip.md", source: "clip" }).kind, "listing");
});

test("shipped tree uses classifier + inbox expand; refresh sits in tree toolbar", () => {
  const sidebar = read("src/components/shell/Sidebar.tsx");
  const toolbar = read("src/components/sidebar/tree-toolbar.tsx");
  const inbox = read("src/plugins/topmind-workspace/views/InboxView.tsx");
  const queue = read("electron/lib/ingest/queue.mjs");
  const zh = JSON.parse(read("src/locales/zh-CN/shell.json"));
  const en = JSON.parse(read("src/locales/en-US/shell.json"));

  assert.match(sidebar, /classifyTreeFileChange/);
  assert.match(sidebar, /shouldExpandInboxSection/);
  assert.match(sidebar, /inboxChildCount/);
  assert.match(sidebar, /onRefresh=\{\(\) => void hardRefresh\(\)\}/);
  assert.equal((toolbar.match(/data-sidebar-refresh/g) || []).length, 1);
  assert.doesNotMatch(sidebar, /data-sidebar-refresh/);
  assert.match(sidebar, /data-sidebar-header/);
  assert.match(sidebar, /<ViewSwitcher/);
  assert.match(sidebar, /<ProfileButton/);
  const headerIdx = sidebar.indexOf("data-sidebar-header");
  const pinsIdx = sidebar.indexOf("data-sidebar-pins");
  const profileIdx = sidebar.indexOf("function ProfileButton");
  assert.ok(headerIdx >= 0 && pinsIdx > headerIdx, "header band before period pins");
  assert.ok(profileIdx > 0);
  assert.match(sidebar, /viewMode !== "category" && viewMode !== "stream"/);

  assert.match(inbox, /workspace:file-changed/);
  assert.match(inbox, /loadFiles\(\{\s*silent:\s*true\s*\}/);
  assert.match(inbox, /if \(!silent\) setLoading\(true\)/);

  assert.match(queue, /fileChangedPayloadForCompletedIngestJob/);
  assert.match(queue, /emit\("workspace:file-changed", listing\)/);

  assert.equal(typeof zh.sidebar.refreshTooltip, "string");
  assert.equal(typeof en.sidebar.refreshTooltip, "string");
  assert.ok(zh.sidebar.refreshTooltip.length > 0);
  assert.ok(en.sidebar.refreshTooltip.length > 0);
});
