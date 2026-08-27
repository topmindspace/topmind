/**
 * Memory browse grouping — shipped assembleMemoryFeed (no parallel store).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assembleMemoryFeed, filterMemoryFeedByLayer } from "../src/lib/memory-feed.ts";
import {
  assembleMemoryFeed as kernelAssemble,
  filterMemoryFeedByLayer as kernelFilter,
} from "../../lib/memory-feed.mjs";

describe("assembleMemoryFeed", () => {
  it("empty plane yields empty array without throwing", () => {
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

  it("profile fact + periodic reflection + topic memory are separate rows with real paths", () => {
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
    assert.equal(profile[0].kind, "profile");
    assert.equal(periodic.kind, "periodic");
    assert.equal(topic.kind, "topic");
  });

  it("filterMemoryFeedByLayer keeps one kind", () => {
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
  });

  it("Desktop TS copy matches Kernel lib/memory-feed.mjs on the same fixture", () => {
    const source = {
      profile: {
        path: "memory/custom-profile.md",
        markdown: "# Title\n\n## 偏好\n\n- alpha\n- beta\n\n## 当前目标\n\nship the feed\n",
      },
      periodic: [
        { path: "memory/periodic/2026-W01.md", markdown: "---\ntitle: W01\n---\n\nweek one.\n" },
      ],
      topics: [{ path: "memory/topics/x.md", markdown: "# X\n\nnote.\n" }],
    };
    const desktop = assembleMemoryFeed(source);
    const kernel = kernelAssemble(source);
    assert.deepEqual(desktop, kernel);
    assert.deepEqual(
      filterMemoryFeedByLayer(desktop, "profile"),
      kernelFilter(kernel, "profile"),
    );
  });

  it("empty profile sections are skipped", () => {
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
});
