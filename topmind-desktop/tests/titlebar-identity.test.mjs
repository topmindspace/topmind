/**
 * Drive the shipped TitleBar identity helper (the function TitleBar imports).
 * Labels are injected — no hardcoded product copy / i18n golden strings.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ancestorSelection,
  displayPathSegment,
  resolveTitleBarIdentity,
} from "../src/lib/titlebar-identity.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const labels = {
  stream: "StreamView",
  inbox: "InboxView",
  outputs: "OutputsView",
  memory: "MemoryView",
  archive: "ArchiveView",
};

test("TitleBar.tsx imports and uses resolveTitleBarIdentity", () => {
  const src = readFileSync(path.join(root, "src/components/shell/TitleBar.tsx"), "utf8");
  assert.match(src, /from ["']\.\.\/\.\.\/lib\/titlebar-identity["']/);
  assert.match(src, /resolveTitleBarIdentity\(/);
  assert.match(src, /data-view-switcher/);
  assert.match(src, /data-breadcrumb-title/);
  assert.match(src, /data-titlebar-actions-slot/);
  assert.match(src, /onClick=\{\(\) => setViewMenuOpen\(\(open\) => !open\)\}/);
  assert.match(src, /max-w-36 shrink-0/);
});

test("empty / root selection does not invent crumbs", () => {
  assert.deepEqual(resolveTitleBarIdentity(null, labels).crumbs, []);
  assert.equal(resolveTitleBarIdentity(null, labels).title, "");
  assert.deepEqual(resolveTitleBarIdentity(undefined, labels).crumbs, []);
  assert.deepEqual(resolveTitleBarIdentity({ kind: "stream" }, labels).crumbs, []);
  assert.equal(resolveTitleBarIdentity({ kind: "stream" }, labels).title, labels.stream);
  assert.deepEqual(resolveTitleBarIdentity({ kind: "file", path: "solo.md" }, labels).crumbs, []);
  assert.equal(resolveTitleBarIdentity({ kind: "file", path: "solo.md" }, labels).title, displayPathSegment("solo.md"));
  assert.deepEqual(resolveTitleBarIdentity({ kind: "file", path: "" }, labels).crumbs, []);
});

test("multi-level file path yields clickable ancestors and a last-segment title", () => {
  const id = resolveTitleBarIdentity(
    { kind: "file", path: "20-专题/2026-foo/note.md" },
    labels,
  );
  assert.equal(id.title, displayPathSegment("note.md"));
  assert.equal(id.crumbs.length, 2);
  assert.equal(id.crumbs[0].label, "20-专题");
  assert.deepEqual(id.crumbs[0].target, { kind: "category", category: "20-专题" });
  assert.equal(id.crumbs[1].label, "2026-foo");
  assert.equal(id.crumbs[1].target?.kind, "topic");
  assert.equal(id.crumbs[1].target && "topicId" in id.crumbs[1].target ? id.crumbs[1].target.topicId : "", "20-专题/2026-foo");
});

test("topic-folder ancestor selects that topic, not a fake category", () => {
  const topicFolder = ancestorSelection("20-专题/2026-foo");
  assert.equal(topicFolder?.kind, "topic");
  assert.equal(topicFolder && "topicId" in topicFolder ? topicFolder.topicId : "", "20-专题/2026-foo");
  assert.notEqual(topicFolder?.kind, "category");

  const id = resolveTitleBarIdentity(
    { kind: "file", path: "20-专题/2026-foo/sub/deep.md" },
    labels,
  );
  const topicCrumb = id.crumbs.find((c) => c.label === "2026-foo");
  assert.ok(topicCrumb);
  assert.equal(topicCrumb.target?.kind, "topic");
  assert.notEqual(topicCrumb.target?.kind, "category");
});

test("directory pages expose a name plus live stats", () => {
  const stream = resolveTitleBarIdentity({ kind: "stream" }, labels, { stats: "12 entries" });
  assert.equal(stream.title, labels.stream);
  assert.equal(stream.stats, "12 entries");
  assert.deepEqual(stream.crumbs, []);

  const inbox = resolveTitleBarIdentity({ kind: "inbox" }, labels, { stats: "3 queued" });
  assert.equal(inbox.title, labels.inbox);
  assert.equal(inbox.stats, "3 queued");

  const outputs = resolveTitleBarIdentity({ kind: "outputs" }, labels, { stats: "5 shipped" });
  assert.equal(outputs.title, labels.outputs);
  assert.equal(outputs.stats, "5 shipped");

  const category = resolveTitleBarIdentity(
    { kind: "category", category: "20-专题" },
    labels,
    { stats: "4 topics" },
  );
  assert.equal(category.title, "20-专题");
  assert.equal(category.stats, "4 topics");
  assert.deepEqual(category.crumbs, []);

  const topic = resolveTitleBarIdentity(
    { kind: "topic", topicId: "20-专题/2026-foo" },
    labels,
    { title: "Foo", stats: "8 notes" },
  );
  assert.equal(topic.title, "Foo");
  assert.equal(topic.stats, "8 notes");
  assert.equal(topic.crumbs.length, 1);
  assert.equal(topic.crumbs[0].target?.kind, "category");
});

test("role-root file ancestors jump to inbox / stream / outputs, not a fake topic", () => {
  const inbox = resolveTitleBarIdentity({ kind: "file", path: "00-收件箱/clip.md" }, labels);
  assert.equal(inbox.crumbs[0]?.target?.kind, "inbox");
  const stream = resolveTitleBarIdentity({ kind: "file", path: "10-动态/2026/2026-W30.md" }, labels);
  assert.ok(stream.crumbs.every((c) => c.target?.kind === "stream"));
  const out = resolveTitleBarIdentity({ kind: "file", path: "88-输出/essay.md" }, labels);
  assert.equal(out.crumbs[0]?.target?.kind, "outputs");
});
