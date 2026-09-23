/**
 * Client-side notes index helpers used by Home / sidebar views.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveRecentTopicsFromNotes,
  countTopicsFromNotes,
} from "../src/lib/workspace-data-cache.ts";

test("deriveRecentTopicsFromNotes groups by category/topic and sorts by mtime", () => {
  const notes = [
    {
      path: "10-日常/2026-A/a.md",
      name: "a.md",
      category: "10-日常",
      topic: "2026-A",
      mtime: "2026-01-02T00:00:00.000Z",
      size: 1,
      title: null,
      tags: [],
      status: null,
      priority: null,
      source_type: null,
    },
    {
      path: "10-日常/2026-A/b.md",
      name: "b.md",
      category: "10-日常",
      topic: "2026-A",
      mtime: "2026-01-03T00:00:00.000Z",
      size: 1,
      title: null,
      tags: [],
      status: null,
      priority: null,
      source_type: null,
    },
    {
      path: "20-研究/2025-B/c.md",
      name: "c.md",
      category: "20-研究",
      topic: "2025-B",
      mtime: "2026-02-01T00:00:00.000Z",
      size: 1,
      title: null,
      tags: [],
      status: null,
      priority: null,
      source_type: null,
    },
    {
      path: "00-收件箱/x.md",
      name: "x.md",
      category: "00-收件箱",
      topic: null,
      mtime: "2026-03-01T00:00:00.000Z",
      size: 1,
      title: null,
      tags: [],
      status: null,
      priority: null,
      source_type: null,
    },
  ];
  const topics = deriveRecentTopicsFromNotes(notes, 6);
  assert.equal(topics.length, 2);
  assert.equal(topics[0].id, "20-研究/2025-B");
  assert.equal(topics[1].id, "10-日常/2026-A");
  assert.equal(topics[1].fileCount, 2);
  assert.equal(topics[1].updatedAt, "2026-01-03T00:00:00.000Z");
  assert.equal(countTopicsFromNotes(notes), 2);
});

test("deriveRecentTopicsFromNotes skips system categories", () => {
  const notes = [
    {
      path: "88-输出/out.md",
      name: "out.md",
      category: "88-输出",
      topic: "2026-x",
      mtime: "2026-01-01T00:00:00.000Z",
      size: 1,
      title: null,
      tags: [],
      status: null,
      priority: null,
      source_type: null,
    },
  ];
  assert.deepEqual(deriveRecentTopicsFromNotes(notes), []);
  assert.equal(countTopicsFromNotes(notes), 0);
});
