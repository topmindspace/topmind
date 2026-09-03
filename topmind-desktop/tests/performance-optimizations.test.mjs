import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
    assert.match(
      src,
      /class\s+StreamDeltaBatcher/,
      "ai-store must define StreamDeltaBatcher",
    );
    assert.match(
      src,
      /requestAnimationFrame/,
      "StreamDeltaBatcher must use requestAnimationFrame for frame-rate synchronized delta flush",
    );
  });

  await t.test("workspace-data-cache implements in-flight request deduplication", async () => {
    const src = await fs.readFile(
      path.join(__dirname, "../src/lib/workspace-data-cache.ts"),
      "utf8",
    );
    assert.match(
      src,
      /inFlightNotesPromise/,
      "workspace-data-cache must track inFlightNotesPromise to collapse concurrent IPC calls",
    );
    assert.match(
      src,
      /inFlightTopicsPromise/,
      "workspace-data-cache must track inFlightTopicsPromise to collapse concurrent IPC calls",
    );
  });
});
