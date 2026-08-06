/**
 * UI/UX Wave 2 contracts — titlebar tiers, status single-path, landing, extension
 * Design System 2.0, DESIGN post-P0 norms, no P0 regressions.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveStatusBarBusy } from "../src/lib/status-bar-busy.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "..");

function read(rel, base = root) {
  return readFileSync(path.join(base, rel), "utf8");
}

// ── AC1: Chrome hierarchy / dual CTA / status single-path ───────────────

test("TitleBar right rail exposes L1 capture+AI, L2 suggest/todo, L3 tools", () => {
  const titleBar = read("src/components/shell/TitleBar.tsx");
  assert.match(titleBar, /data-chrome-tier=["']l1["']/);
  assert.match(titleBar, /data-chrome-tier=["']l2["']/);
  assert.match(titleBar, /data-chrome-tier=["']l3["']/);
  assert.match(titleBar, /v4-titlebar-tier-l2/);
  assert.match(titleBar, /v4-titlebar-btn-capture/);
  assert.match(titleBar, /v4-titlebar-btn-ai/);
  // Capture remains solid aqua class; suggest/todo not solid capture
  const l2 = titleBar.slice(
    titleBar.indexOf("v4-titlebar-tier-l2"),
    titleBar.indexOf("data-chrome-tier=\"l3\""),
  );
  assert.doesNotMatch(l2, /v4-titlebar-btn-capture/);
});

test("status busy is single-path named chip (tasks > todo > suggest)", () => {
  const multi = deriveStatusBarBusy({
    ready: true,
    streaming: false,
    activeTaskCount: 1,
    todoMaintaining: true,
    suggestLoading: true,
  });
  assert.equal(multi.showTaskChip, true);
  assert.equal(multi.showTodoChip, false);
  assert.equal(multi.showSuggestChip, false);

  const todoOnly = deriveStatusBarBusy({
    ready: true,
    streaming: false,
    activeTaskCount: 0,
    todoMaintaining: true,
    suggestLoading: true,
  });
  assert.equal(todoOnly.showTodoChip, true);
  assert.equal(todoOnly.showSuggestChip, false);
  assert.equal(todoOnly.aiPillBusy, false);
});

test("list views do not reintroduce solid default quick-capture as L1 记一下", () => {
  for (const rel of [
    "src/plugins/topmind-workspace/views/InboxView.tsx",
    "src/plugins/topmind-workspace/views/OutputsView.tsx",
    "src/plugins/topmind-workspace/views/TopicOverviewView.tsx",
  ]) {
    const src = read(rel);
    const tags = [...src.matchAll(/<Button[^>]*openOverlay\(["']quick-capture["']\)[^>]*>/g)];
    for (const m of tags) {
      assert.match(
        m[0],
        /variant=["'](outline|ghost)["']/,
        `${rel} capture Button must be outline/ghost: ${m[0]}`,
      );
    }
  }
});

test("Archive row restore is outline (not solid default competing CTA)", () => {
  const src = read("src/plugins/topmind-workspace/views/ArchiveView.tsx");
  assert.match(src, /restoreTip|restoreBtn/);
  // Row action Button uses outline (not bare default solid)
  assert.match(
    src,
    /restoreTip[\s\S]{0,400}?variant=["']outline["']|variant=["']outline["'][\s\S]{0,400}?handleRestore\(a\)/,
  );
  assert.doesNotMatch(
    src,
    /variant=["']default["'][\s\S]{0,120}handleRestore\(a\)/,
  );
});

// ── AC2: Landing / onboarding Design System 2.0 ─────────────────────────────

test("OnboardingScreen uses Design System 2.0 landing chrome + one primary CTA", () => {
  const onboarding = read("src/components/shell/OnboardingScreen.tsx");
  const v4 = read("src/styles/v4.css");
  assert.match(onboarding, /v4-landing/);
  assert.match(onboarding, /v4-boot/);
  assert.match(onboarding, /data-landing-primary-cta/);
  assert.match(onboarding, /data-landing-workflow/);
  assert.match(v4, /\.v4-landing\s*\{/);
  assert.match(v4, /brand-mid|brand-aqua/);
  // No purple marketing
  assert.doesNotMatch(onboarding, /#6366f1|#8b5cf6|#7c3aed|indigo|purple/i);
  // Sole solid primary is select-folder Button (default variant, no second solid capture)
  assert.doesNotMatch(onboarding, /v4-titlebar-btn-capture|quick-capture/);
});

// ── AC3: Browser extension Design System 2.0 ────────────────────────────────

test("browser-extension popup CSS mirrors Design System 2.0 axis + capture CTA", () => {
  const css = read("browser-extension/popup.css", repoRoot);
  const html = read("browser-extension/popup.html", repoRoot);
  assert.match(css, /--mh-accent:\s*#31548e/i);
  assert.match(css, /--mh-capture:\s*#12897b/i);
  assert.match(css, /--mh-brand-mid|--mh-brand-aqua|5a7fb8|2fa89a/i);
  assert.match(css, /--mh-bg:\s*#f6f4ef/i);
  assert.match(css, /--mh-elevated:\s*#fdfcf8/i);
  assert.match(css, /--mh-border-dim:\s*rgba\(62,\s*54,\s*38,\s*0\.065\)/i);
  assert.doesNotMatch(css, /#6366f1|#8b5cf6|#7c3aed/i);
  assert.match(html, /btn-capture|data-capture-cta/);
  assert.match(html, /id=["']clip["']/);
});

// ── AC4: DESIGN.md post-P0 norms ────────────────────────────────────────

test("DESIGN.md documents post-P0 CTA / elevated / suggest demote / format collapse", () => {
  const design = read("DESIGN.md");
  assert.match(design, /shadow-card|surface-elevated.*#fcfcfd|#fcfcfd/);
  assert.match(design, /打开记一下|composeSubmit|记下/);
  assert.match(design, /SuggestEntryStrip|ActionBar.*demote|demote 隐藏/i);
  assert.match(design, /showFormat|格式工具.*默认.*折叠|默认折叠/);
  assert.match(design, /v4-titlebar-tier-l2|data-chrome-tier|TitleBar 右轨/);
  assert.match(design, /deriveStatusBarBusy|单路径/);
});

// ── AC5 / P0 no-regress ─────────────────────────────────────────────────

test("P0 contracts still hold: elevated ≠ surface, ActionBar demote, format collapse, tooltip key", () => {
  const tokens = read("src/styles/tokens.css");
  const light = tokens.split(/\.dark\s*\{/)[0];
  const surface = light.match(/--color-surface:\s*([^;]+);/)?.[1]?.trim();
  const elevated = light.match(/--color-surface-elevated:\s*([^;]+);/)?.[1]?.trim();
  assert.ok(surface && elevated);
  assert.notEqual(surface.toLowerCase(), elevated.toLowerCase());

  const bar = read("src/components/ai/ActionBar.tsx");
  assert.match(bar, /canvasStripActive|focusMode/);

  const editor = read("src/plugins/topmind-workspace/views/FileEditorView.tsx");
  assert.match(editor, /const \[showFormat,\s*setShowFormat\]\s*=\s*useState\(\s*false\s*\)/);

  const zh = JSON.parse(read("src/locales/zh-CN/workspace.json"));
  assert.equal(typeof zh.menu.moveToTopicTooltip, "string");
  assert.ok(zh.menu.moveToTopicTooltip.length > 0);
  assert.notEqual(zh.streamDetail.composeLabel, "记一下");
});

test("extension files exist for packaging path", () => {
  assert.ok(existsSync(path.join(repoRoot, "browser-extension/popup.css")));
  assert.ok(existsSync(path.join(repoRoot, "browser-extension/popup.html")));
  assert.ok(existsSync(path.join(repoRoot, "browser-extension/options.html")));
});
