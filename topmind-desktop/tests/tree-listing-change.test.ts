/**
 * tree-listing-change.test.ts — classifyTreeFileChange decisions.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { classifyTreeFileChange } from "../src/lib/tree-listing-change";

test("classifyTreeFileChange: pure content save never triggers listing", () => {
  // Inbox note save
  const inboxSave = classifyTreeFileChange({
    relativePath: "00-收件箱/quick-note.md",
    event: "change",
    source: "editor",
  });
  assert.equal(inboxSave.kind, "content");
  assert.equal(inboxSave.relativePath, "00-收件箱/quick-note.md");

  // Stream periodic note save
  const streamSave = classifyTreeFileChange({
    relativePath: "10-动态/2026/2026-W36.md",
    event: "change",
    source: "editor",
  });
  assert.equal(streamSave.kind, "content");

  // Flat category note save
  const flatNoteSave = classifyTreeFileChange({
    relativePath: "20-专题/standalone.md",
    event: "change",
    source: "editor",
  });
  assert.equal(flatNoteSave.kind, "content");

  // Topic nested note save
  const topicSave = classifyTreeFileChange({
    relativePath: "20-专题/2026-工作/meeting.md",
    event: "change",
    source: "editor",
  });
  assert.equal(topicSave.kind, "content");
  assert.equal(topicSave.topicId, "20-专题/2026-工作");
});

test("classifyTreeFileChange: structural changes trigger listing", () => {
  // Ingest source
  const ingest = classifyTreeFileChange({
    relativePath: "00-收件箱/imported.md",
    source: "ingest",
  });
  assert.equal(ingest.kind, "listing");

  // Add / unlink event
  const add = classifyTreeFileChange({
    relativePath: "20-专题/2026-工作/new-file.md",
    event: "add",
  });
  assert.equal(add.kind, "listing");

  // Empty relativePath (structural rebuild hint)
  const empty = classifyTreeFileChange({});
  assert.equal(empty.kind, "listing");
});
