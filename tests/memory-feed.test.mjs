/**
 * Memory browse grouping — shipped Kernel `lib/memory-feed.mjs`.
 * Hosts must not fork a twin algorithm (Desktop TS copy is parity-tested;
 * Obsidian re-exports this module).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assembleMemoryFeed,
  filterMemoryFeedByLayer,
  isMemoryFeedLayer,
} from "../lib/memory-feed.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("assembleMemoryFeed: empty plane yields empty array without throwing", () => {
  assert.deepEqual(assembleMemoryFeed(null), []);
  assert.deepEqual(assembleMemoryFeed(undefined), []);
  assert.deepEqual(
    assembleMemoryFeed({ profile: null, periodic: [], topics: [] }),
    [],
  );
  assert.deepEqual(
    assembleMemoryFeed({
      profile: { path: "memory/profile.md", markdown: "" },
      periodic: [],
      topics: [],
    }),
    [],
  );
});

test("assembleMemoryFeed: profile fact + periodic + topic are separate rows with real paths", () => {
  const items = assembleMemoryFeed({
    profile: {
      path: "memory/profile.md",
      markdown: `---
title: 我的情况
---

# 我的情况

## 偏好

- 喜欢简洁的信息流
- 夜间工作

## 当前目标

完成卡片式动态浏览
`,
    },
    periodic: [
      {
        path: "memory/periodic/2026/2026-W32.md",
        markdown: `---
title: 2026-W32
---

# 周期反思

本周确认了信息流分块必须按段落而非按换行。
`,
      },
    ],
    topics: [
      {
        path: "memory/topics/2026-ui.md",
        markdown: `---
title: UI 专题记忆
---

# UI

卡片对齐是单列，不是瀑布流。
`,
      },
    ],
  });

  const kinds = items.map((i) => i.kind);
  assert.ok(kinds.includes("profile"), `kinds=${kinds.join(",")}`);
  assert.ok(kinds.includes("periodic"));
  assert.ok(kinds.includes("topic"));

  const profile = items.filter((i) => i.kind === "profile");
  assert.ok(profile.length >= 1);
  assert.ok(profile.some((i) => /简洁/.test(i.body + i.preview + i.title)));
  for (const p of profile) {
    assert.equal(p.path, "memory/profile.md");
  }

  const periodic = items.find((i) => i.kind === "periodic");
  assert.ok(periodic);
  assert.equal(periodic.path, "memory/periodic/2026/2026-W32.md");
  assert.match(periodic.body + periodic.preview, /信息流分块/);

  const topic = items.find((i) => i.kind === "topic");
  assert.ok(topic);
  assert.equal(topic.path, "memory/topics/2026-ui.md");
  assert.match(topic.body + topic.preview, /单列/);
});

test("filterMemoryFeedByLayer keeps one kind; isMemoryFeedLayer guards chips", () => {
  const items = assembleMemoryFeed({
    profile: {
      path: "memory/profile.md",
      markdown: "# 我的情况\n\n## 偏好\n\n- 喜欢简洁\n",
    },
    periodic: [
      { path: "memory/periodic/2026-W32.md", markdown: "---\ntitle: W32\n---\n\n反思。\n" },
    ],
    topics: [{ path: "memory/topics/ui.md", markdown: "# UI\n\n单列。\n" }],
  });
  const profile = filterMemoryFeedByLayer(items, "profile");
  assert.ok(profile.length >= 1);
  assert.ok(profile.every((i) => i.kind === "profile"));
  const periodic = filterMemoryFeedByLayer(items, "periodic");
  assert.equal(periodic.length, 1);
  assert.equal(periodic[0].path, "memory/periodic/2026-W32.md");
  assert.equal(filterMemoryFeedByLayer(items, "all").length, items.length);
  assert.deepEqual(filterMemoryFeedByLayer(null, "topic"), []);
  assert.equal(isMemoryFeedLayer("all"), true);
  assert.equal(isMemoryFeedLayer("profile"), true);
  assert.equal(isMemoryFeedLayer("masonry"), false);
});

test("empty profile sections are skipped", () => {
  const items = assembleMemoryFeed({
    profile: {
      path: "memory/profile.md",
      markdown: "# 我的情况\n\n## 偏好\n\n## 当前目标\n\n",
    },
    periodic: [],
    topics: [],
  });
  assert.equal(items.length, 0);
});

test("kernel-api re-exports memory-feed; Obsidian utils re-exports Kernel (no twin)", () => {
  const api = readFileSync(path.join(repo, "lib/kernel-api.mjs"), "utf8");
  assert.match(api, /assembleMemoryFeed/);
  assert.match(api, /from "\.\/memory-feed\.mjs"/);
  const utils = readFileSync(path.join(repo, "obsidian-plugin/src/utils.ts"), "utf8");
  assert.match(utils, /from ["']\.\.\/\.\.\/lib\/memory-feed\.mjs["']/);
  assert.doesNotMatch(utils, /export function assembleMemoryFeed/);
  assert.doesNotMatch(utils, /function memoryItemsFromBlock/);
  assert.equal(existsSync(path.join(repo, "lib/memory-feed.d.mts")), true);
  const tsconfig = JSON.parse(readFileSync(path.join(repo, "obsidian-plugin/tsconfig.json"), "utf8"));
  assert.ok(
    (tsconfig.include || []).some((x) => String(x).includes("memory-feed.d.mts")),
    "obsidian tsconfig must include memory-feed.d.mts",
  );
});
