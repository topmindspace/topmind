import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDebouncedTask,
  createHiddenAwareInterval,
  createNotifyBatcher,
  createRafGate,
} from "../src/lib/hot-path.ts";
import {
  bindWorkspaceReadersForTests,
  getCachedAllNotes,
  getCachedTopicGroups,
} from "../src/lib/workspace-data-cache.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("desktop performance optimizations & code splitting integrity", async (t) => {
  await t.test("App.tsx dynamically code-splits CaptureSurface and OnboardingScreen", async () => {
    const src = await fs.readFile(
      path.join(__dirname, "../src/App.tsx"),
      "utf8",
    );
    assert.match(
      src,
      /const\s+CaptureSurface\s*=\s*lazy\(/,
      "CaptureSurface must be lazy-loaded in App.tsx",
    );
    assert.match(
      src,
      /const\s+OnboardingScreen\s*=\s*lazy\(/,
      "OnboardingScreen must be lazy-loaded in App.tsx",
    );
    assert.doesNotMatch(
      src,
      /import\s+{\s*CaptureSurface\s*}\s+from/,
      "App.tsx must not statically import CaptureSurface",
    );
  });

  await t.test("CaptureSurface.tsx dynamically code-splits QuickCapture", async () => {
    const src = await fs.readFile(
      path.join(__dirname, "../src/components/shell/CaptureSurface.tsx"),
      "utf8",
    );
    assert.match(
      src,
      /const\s+QuickCapture\s*=\s*lazy\(/,
      "QuickCapture must be lazy-loaded in CaptureSurface.tsx",
    );
    assert.doesNotMatch(
      src,
      /import\s+{\s*QuickCapture\s*}\s+from/,
      "CaptureSurface.tsx must not statically import QuickCapture",
    );
    assert.match(
      src,
      /<Suspense[\s\S]*?<QuickCapture/,
      "QuickCapture must be wrapped in Suspense",
    );
  });

  await t.test("StreamDetailView implements memoized rows and rAF scroll throttling", async () => {
    const src = await fs.readFile(
      path.join(
        __dirname,
        "../src/plugins/topmind-workspace/views/StreamDetailView.tsx",
      ),
      "utf8",
    );
    assert.match(
      src,
      /const\s+StreamFeedRowView\s*=\s*memo\(/,
      "StreamFeedRowView must be wrapped in React.memo to isolate typing/scroll renders",
    );
    assert.match(
      src,
      /requestAnimationFrame\s*\(\s*\(\)\s*=>/,
      "handleScroll must throttle scroll geometry queries with requestAnimationFrame",
    );
    assert.match(
      src,
      /appendText\s*=\s*{\s*appendIdx\s*===\s*row\.entry\.index\s*\?\s*appendText\s*:\s*""\s*}/,
      "appendText must be isolated to avoid dirtying other rows when typing in one card",
    );
  });

  await t.test("App.tsx dynamically code-splits Shell for lightweight capture boot", async () => {
    const src = await fs.readFile(
      path.join(__dirname, "../src/App.tsx"),
      "utf8",
    );
    assert.match(
      src,
      /const\s+Shell\s*=\s*lazy\(/,
      "Shell must be lazy-loaded in App.tsx",
    );
    assert.doesNotMatch(
      src,
      /import\s+{\s*Shell\s*}\s+from/,
      "App.tsx must not statically import Shell",
    );
  });

  await t.test("TreeViewNode is wrapped in React.memo and uses fine-grained selectors", async () => {
    const src = await fs.readFile(
      path.join(__dirname, "../src/components/sidebar/TreeView.tsx"),
      "utf8",
    );
    assert.match(
      src,
      /const\s+TreeViewNode\s*=\s*memo\(/,
      "TreeViewNode must be wrapped in memo",
    );
    assert.match(
      src,
      /expandedNodeIds\.has\(node\.id\)/,
      "TreeViewNode must use fine-grained selector for expansion state",
    );
  });

  await t.test("ai-store implements StreamDeltaBatcher with requestAnimationFrame", async () => {
    const src = await fs.readFile(
      path.join(__dirname, "../src/stores/ai-store.ts"),
      "utf8",
    );
    const hot = await fs.readFile(
      path.join(__dirname, "../src/lib/hot-path.ts"),
      "utf8",
    );
    assert.match(
      src,
      /class\s+StreamDeltaBatcher/,
      "ai-store must define StreamDeltaBatcher",
    );
    assert.match(src, /createNotifyBatcher/, "StreamDeltaBatcher must publish through the shared frame batcher");
    assert.match(
      hot,
      /requestAnimationFrame/,
      "the frame batcher must use requestAnimationFrame",
    );
  });

  await t.test("workspace-data-cache implements in-flight request deduplication", async () => {
    const src = await fs.readFile(
      path.join(__dirname, "../src/lib/workspace-data-cache.ts"),
      "utf8",
    );
    assert.match(
      src,
      /inFlightNotes/,
      "workspace-data-cache must track inFlightNotes to collapse concurrent IPC calls",
    );
    assert.match(
      src,
      /inFlightTopics/,
      "workspace-data-cache must track inFlightTopics to collapse concurrent IPC calls",
    );
    assert.match(
      src,
      /inflightLimit >= limit/,
      "a smaller in-flight note read must not satisfy a larger limit",
    );
  });

  await t.test("ingest jobs share one poller (no per-surface intervals)", async () => {
    const store = await fs.readFile(
      path.join(__dirname, "../src/lib/ingest-jobs-store.ts"),
      "utf8",
    );
    assert.match(store, /subscribeIngestJobs/);
    assert.match(store, /ensurePoll/);
    // One interval only; hidden windows must not spend IPC.
    assert.match(store, /createHiddenAwareInterval/);
    assert.match(store, /visibilityState === "hidden"/);
    assert.doesNotMatch(store, /setInterval/);
    const panel = await fs.readFile(
      path.join(__dirname, "../src/components/ingest/IngestQueuePanel.tsx"),
      "utf8",
    );
    assert.match(panel, /useSyncExternalStore/);
    assert.doesNotMatch(panel, /setInterval/);
  });

  await t.test("streaming elapsed lives in ElapsedSeconds leaf (no MessageRow 1s tick)", async () => {
    const src = await fs.readFile(
      path.join(__dirname, "../src/components/ai/ChatMessage.tsx"),
      "utf8",
    );
    assert.match(src, /function ElapsedSeconds/);
    assert.doesNotMatch(src, /const \[elapsedSec, setElapsedSec\]/);
  });

  await t.test("find-in-note debounces query and does not smooth-scroll while typing", async () => {
    const view = await fs.readFile(
      path.join(__dirname, "../src/plugins/topmind-workspace/views/FileEditorView.tsx"),
      "utf8",
    );
    assert.match(view, /createDebouncedTask\(160\)/);
    assert.match(view, /findSetSearch\(editor, q, \{ scroll: false \}\)/);
    const find = await fs.readFile(
      path.join(__dirname, "../src/lib/editor-find.ts"),
      "utf8",
    );
    assert.match(find, /opts\?: \{ scroll\?: boolean \}/);
  });

  await t.test("selection-ai scroll path is rAF-throttled", async () => {
    const src = await fs.readFile(
      path.join(__dirname, "../src/components/editor/useSelectionAi.ts"),
      "utf8",
    );
    assert.match(src, /const scrollGate = createRafGate\(\)/);
    assert.match(src, /scrollGate\.run\(/);
    assert.match(src, /scrollGate\.cancel\(\)/);
  });
});

test("a burst of AI stream deltas in one frame publishes one store notification", () => {
  const published = [];
  let frame = null;
  const batcher = createNotifyBatcher({
    publish: (batch) => published.push(batch),
    scheduleFrame: (fn) => {
      frame = fn;
      return 1;
    },
    cancelFrame: () => {
      frame = null;
    },
  });
  const parts = ["Hel", "lo", " ", "wor", "ld"];
  for (const part of parts) batcher.append(part, "");
  batcher.append("", "think");
  batcher.append("", "-more");
  assert.equal(published.length, 0);
  assert.equal(typeof frame, "function");
  frame();
  frame = null;
  assert.equal(published.length, 1);
  assert.equal(published[0].text, parts.join(""));
  assert.equal(published[0].reasoning, "think-more");
});

test("concurrent identical workspace note and topic reads share one in-flight call", async () => {
  let noteCalls = 0;
  let categoryCalls = 0;
  let topicCalls = 0;
  /** @type {{ limit: number, resolve: (value: object) => void }[]} */
  const noteGates = [];
  try {
    bindWorkspaceReadersForTests({
      allNotes: (limit) => {
        noteCalls += 1;
        return new Promise((resolve) => {
          noteGates.push({ limit, resolve });
        });
      },
      categories: async () => {
        categoryCalls += 1;
        return {
          categories: [
            { name: "10-日常", role: "loose-stream" },
            { name: "00-收件箱", role: "buffer" },
          ],
        };
      },
      topics: async (name) => {
        topicCalls += 1;
        return { topics: [{ name: `${name}-topic` }] };
      },
    });

    const big = getCachedAllNotes(500);
    const bigAgain = getCachedAllNotes(500);
    const smallWhileBig = getCachedAllNotes(200);
    assert.equal(noteCalls, 1, "500 and a smaller read share the larger in-flight call");
    assert.equal(noteGates[0].limit, 500);
    noteGates[0].resolve({
      notes: Array.from({ length: 500 }, (_, i) => ({ path: `n-${i}.md` })),
      total: 500,
    });
    const [bigResult, bigAgainResult, smallResult] = await Promise.all([big, bigAgain, smallWhileBig]);
    assert.equal(bigResult.notes.length, 500);
    assert.equal(bigAgainResult.notes.length, 500);
    assert.equal(smallResult.notes.length, 200);
    assert.equal(noteCalls, 1);

    noteCalls = 0;
    noteGates.length = 0;
    bindWorkspaceReadersForTests({
      allNotes: (limit) => {
        noteCalls += 1;
        return new Promise((resolve) => {
          noteGates.push({ limit, resolve });
        });
      },
    });
    const smallFirst = getCachedAllNotes(200);
    const bigSecond = getCachedAllNotes(500);
    assert.equal(noteCalls, 2, "a larger limit must not reuse a smaller in-flight read");
    const smallGate = noteGates.find((gate) => gate.limit === 200);
    const bigGate = noteGates.find((gate) => gate.limit === 500);
    bigGate.resolve({
      notes: Array.from({ length: 500 }, (_, i) => ({ path: `b-${i}.md` })),
      total: 500,
    });
    smallGate.resolve({
      notes: Array.from({ length: 200 }, (_, i) => ({ path: `s-${i}.md` })),
      total: 200,
    });
    const [smallDone, bigDone] = await Promise.all([smallFirst, bigSecond]);
    assert.equal(smallDone.notes.length, 200);
    assert.equal(bigDone.notes.length, 500);
    const before = noteCalls;
    const cachedBig = await getCachedAllNotes(500);
    assert.equal(cachedBig.notes.length, 500);
    assert.equal(noteCalls, before, "the smaller result must not replace the larger cache");

    categoryCalls = 0;
    topicCalls = 0;
    bindWorkspaceReadersForTests({
      categories: async () => {
        categoryCalls += 1;
        return { categories: [{ name: "10-日常", role: "loose-stream" }] };
      },
      topics: async () => {
        topicCalls += 1;
        return { topics: [{ name: "2026-topic" }] };
      },
    });
    const [topicsA, topicsB] = await Promise.all([
      getCachedTopicGroups(false),
      getCachedTopicGroups(false),
    ]);
    assert.equal(categoryCalls, 1);
    assert.equal(topicCalls, 1);
    assert.equal(topicsA.length, 1);
    assert.equal(topicsB.length, 1);

    bindWorkspaceReadersForTests({
      categories: async () => {
        categoryCalls += 1;
        return { categories: [{ name: "10-日常", role: "loose-stream" }] };
      },
      topics: async () => {
        topicCalls += 1;
        return { topics: [{ name: "2026-topic" }] };
      },
    });
    categoryCalls = 0;
    topicCalls = 0;
    await Promise.all([getCachedTopicGroups(false), getCachedTopicGroups(true)]);
    assert.equal(categoryCalls, 2, "different includeSystem reads do not share one call");
  } finally {
    bindWorkspaceReadersForTests(null);
  }
});

test("one hidden-aware ingest poller does not tick while hidden", () => {
  /** @type {{ fn: () => void }[]} */
  const timers = [];
  let hidden = false;
  let ticks = 0;
  const poller = createHiddenAwareInterval({
    intervalMs: 1500,
    isHidden: () => hidden,
    onTick: () => {
      ticks += 1;
    },
    setIntervalFn: (fn) => {
      const handle = { fn };
      timers.push(handle);
      return handle;
    },
    clearIntervalFn: (id) => {
      const index = timers.indexOf(/** @type {{ fn: () => void }} */ (id));
      if (index >= 0) timers.splice(index, 1);
    },
  });

  hidden = true;
  poller.start();
  poller.start();
  assert.equal(timers.length, 0);
  assert.equal(poller.ticking, false);
  assert.equal(ticks, 0);

  hidden = false;
  poller.start();
  poller.start();
  assert.equal(timers.length, 1, "a second start shares the existing timer");
  timers[0].fn();
  assert.equal(ticks, 1);
  assert.equal(timers.length, 1);

  hidden = true;
  timers[0].fn();
  assert.equal(ticks, 1, "a hidden tick does not poll");
  assert.equal(timers.length, 0);
  assert.equal(poller.ticking, false);
});

test("find-in-note debounce and selection scroll do not run layout work on every raw event", () => {
  /** @type {{ fn: () => void, ms: number }[]} */
  const timers = [];
  let runs = 0;
  const debounced = createDebouncedTask(
    160,
    (fn, ms) => {
      const handle = { fn, ms };
      timers.push(handle);
      return handle;
    },
    (id) => {
      const index = timers.indexOf(/** @type {{ fn: () => void, ms: number }} */ (id));
      if (index >= 0) timers.splice(index, 1);
    },
  );
  for (let i = 0; i < 6; i += 1) {
    debounced.schedule(() => {
      runs += 1;
    });
  }
  assert.equal(runs, 0);
  assert.equal(timers.length, 1);
  timers[0].fn();
  assert.equal(runs, 1);

  let frames = 0;
  let scrolls = 0;
  /** @type {(() => void) | null} */
  let frame = null;
  const gate = createRafGate((fn) => {
    frames += 1;
    frame = fn;
    return frames;
  });
  for (let i = 0; i < 12; i += 1) gate.run(() => {
    scrolls += 1;
  });
  assert.equal(frames, 1);
  assert.equal(scrolls, 0);
  frame();
  assert.equal(scrolls, 1);
});
