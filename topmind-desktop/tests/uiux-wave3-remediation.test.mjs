/**
 * UI/UX Wave 3 — settings/overlays, sidebar+connectors, shared kit calm.
 * Structural contracts on shipped sources; includes P0/Wave2 no-regress.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "..");

function read(rel, base = root) {
  return readFileSync(path.join(base, rel), "utf8");
}

// ── AC1: Settings + overlays quiet chrome ───────────────────────────────

test("SettingsDialog uses Design System 2.0 elevated shell (no purple, quiet nav)", () => {
  const src =
    read("src/components/overlays/SettingsDialog.tsx") +
    read("src/components/overlays/SettingsLayout.tsx");
  const v4 = read("src/styles/v4.css");
  assert.match(src, /data-settings-dialog|v4-settings-dialog/);
  assert.match(src, /data-settings-nav|v4-settings-nav/);
  assert.match(src, /v4-overlay-sheet/);
  assert.match(src, /surface-elevated|bg-surface-elevated/);
  assert.doesNotMatch(src, /#6366f1|#8b5cf6|#7c3aed|indigo|purple/i);
  assert.match(v4, /\.v4-settings-dialog|\.v4-settings-nav/);
  // Close is ghost, not solid capture
  assert.match(src, /variant=["']ghost["']/);
  assert.doesNotMatch(src, /v4-titlebar-btn-capture|quick-capture/);
});

test("QuickCapture has one solid submit; cancel ghost; polish is AI-tint not second solid", () => {
  const src = read("src/components/overlays/CaptureForm.tsx");
  assert.match(src, /handleSubmit|canSubmit/);
  // Cancel stays ghost; polish uses AI variant (not solid default CTA)
  assert.match(src, /variant=["']ghost["']/);
  assert.match(src, /variant=["']ai["']|v4-ai-btn|data-capture-ai-polish/);
  // Primary submit Button without ghost/outline near handleSubmit
  assert.match(src, /<Button[\s\S]{0,80}onClick=\{\(\)\s*=>\s*void handleSubmit/);
  assert.doesNotMatch(src, /v4-titlebar-btn-capture/);
});

test("Command palette + GlobalSearch use v4-overlay-sheet / palette chrome", () => {
  const cmd = read("src/components/overlays/CommandPalette.tsx");
  const search = read("src/components/overlays/GlobalSearch.tsx");
  assert.match(cmd, /v4-overlay-sheet/);
  assert.match(cmd, /v4-palette/);
  assert.match(search, /v4-overlay-sheet/);
  assert.match(search, /v4-palette/);
  const v4 = read("src/styles/v4.css");
  assert.match(v4, /\.v4-palette-header/);
  assert.match(v4, /surface-elevated/);
});

test("Dialog footers keep one solid primary max (outline cancel + default confirm)", () => {
  const dialog = read("src/components/ui/Dialog.tsx");
  assert.match(dialog, /data-dialog-footer/);
  assert.match(dialog, /variant=["']outline["'][\s\S]{0,80}onCancel|onCancel[\s\S]{0,120}variant=["']outline["']/);
  assert.match(dialog, /variant=["']default["']|variant=\{destructive/);
});

// ── AC2: Sidebar + connector hubs ───────────────────────────────────────

test("Sidebar plugin/connector section defaults collapsed (stream-first rail)", () => {
  const sidebar = read("src/components/shell/Sidebar.tsx");
  assert.match(sidebar, /data-sidebar-plugins-section/);
  assert.match(sidebar, /useState\(\s*true\s*\)/);
  assert.match(sidebar, /data-sidebar-plugins-collapsed/);
  // No solid capture CTA in plugin entries
  assert.doesNotMatch(sidebar, /v4-titlebar-btn-capture|variant=["']default["'][\s\S]{0,40}quick-capture/);
});

test("ConnectorHubHeader is shared quiet header language (PageHeader hierarchy)", () => {
  const hub = read("src/plugins/connector-ui.tsx");
  assert.match(hub, /data-connector-hub-header/);
  assert.match(hub, /text-xl font-semibold|font-semibold tracking-tight/);
  assert.match(hub, /export function ConnectorHubHeader/);
  // Ingest hub capture is outline
  const ingest = read("src/plugins/topmind-ingest/hub-view.tsx");
  assert.match(ingest, /ConnectorHubHeader/);
  assert.match(ingest, /variant=["']outline["'][\s\S]{0,80}quick-capture|quick-capture[\s\S]{0,120}variant=["']outline["']/);
});

test("Weread/X hubs use ConnectorHubHeader and EmptyState without dual capture solids", () => {
  for (const rel of [
    "src/plugins/topmind-weread/hub-view.tsx",
    "src/plugins/topmind-x/hub-view.tsx",
  ]) {
    const src = read(rel);
    assert.match(src, /ConnectorHubHeader/);
    assert.match(src, /EmptyState/);
    assert.doesNotMatch(src, /v4-titlebar-btn-capture/);
    // No quick-capture solid default if present
    const caps = [...src.matchAll(/<Button[^>]*quick-capture[^>]*>/g)];
    for (const m of caps) {
      assert.match(m[0], /variant=["'](outline|ghost)["']/, `${rel}: ${m[0]}`);
    }
  }
});

// ── AC3: Shared kit ─────────────────────────────────────────────────────

test("FilterChip is chip-weight (22px) with data-filter-chip, not solid button", () => {
  const view = read("src/components/ui/view.tsx");
  assert.match(view, /data-filter-chip/);
  assert.match(view, /h-\[var\(--control-h-chip\)\]/);
  assert.match(view, /export function FilterChip/);
  assert.doesNotMatch(view, /FilterChip[\s\S]{0,200}bg-primary|FilterChip[\s\S]{0,200}variant=["']default["']/);
});

test("EmptyState remains one-primary-CTA contract language", () => {
  const view = read("src/components/ui/view.tsx");
  assert.match(view, /export function EmptyState/);
  assert.match(view, /one primary|Prefer a single primary/i);
  assert.match(view, /shadow-\[var\(--shadow-card\)\]/);
});

test("CaptureModeBar uses chip language (data-filter-chip)", () => {
  const bar = read("src/components/overlays/CaptureModeBar.tsx");
  assert.match(bar, /data-capture-mode-bar|data-filter-chip/);
  assert.match(bar, /h-\[var\(--control-h-chip\)\]/);
});

test("SettingsSection uses card elevation language", () => {
  const fields = read("src/components/settings/fields.tsx");
  assert.match(fields, /data-settings-section/);
  assert.match(fields, /shadow-\[var\(--shadow-card\)\]/);
});

// ── AC4 / no-regress P0 + Wave2 ─────────────────────────────────────────

test("no-regress: P0 dual capture, elevated ladder, ActionBar demote, format collapse", () => {
  const tokens = read("src/styles/tokens.css");
  const light = tokens.split(/\.dark\s*\{/)[0];
  const surface = light.match(/--color-surface:\s*([^;]+);/)?.[1]?.trim();
  const elevated = light.match(/--color-surface-elevated:\s*([^;]+);/)?.[1]?.trim();
  assert.ok(surface && elevated);
  assert.notEqual(surface.toLowerCase(), elevated.toLowerCase());

  const titleBar = read("src/components/shell/TitleBar.tsx");
  assert.match(titleBar, /v4-titlebar-btn-capture/);
  assert.match(titleBar, /data-chrome-tier=["']l1["']/);
  assert.match(titleBar, /v4-titlebar-tier-l2/);

  const bar = read("src/components/ai/ActionBar.tsx");
  assert.match(bar, /focusMode|canvasStripActive/);

  const editor = read("src/plugins/topmind-workspace/views/FileEditorView.tsx");
  assert.match(editor, /const \[showFormat,\s*setShowFormat\]\s*=\s*useState\(\s*false\s*\)/);

  const inbox = read("src/plugins/topmind-workspace/views/InboxView.tsx");
  assert.match(inbox, /variant=["']outline["'][\s\S]{0,100}quick-capture|quick-capture[\s\S]{0,80}variant=["']outline["']/);
});

test("no-regress: landing + extension brand still present", () => {
  const onboarding = read("src/components/shell/OnboardingScreen.tsx");
  assert.match(onboarding, /v4-landing/);
  assert.match(onboarding, /data-landing-primary-cta/);
  const css = read("browser-extension/popup.css", repoRoot);
  assert.match(css, /--mh-capture:\s*#12897b/i);
  assert.match(css, /--mh-elevated:\s*#ffffff/i);
  assert.ok(existsSync(path.join(repoRoot, "browser-extension/popup.html")));
});

test("DESIGN.md documents Wave 3 sidebar collapse + settings + FilterChip rules", () => {
  const design = read("DESIGN.md");
  assert.match(design, /PluginSlotsSection|默认折叠|data-sidebar-plugins/);
  assert.match(design, /SettingsDialog|v4-settings|SettingsSection/);
  assert.match(design, /FilterChip|22px|data-filter-chip/);
  assert.match(design, /ConnectorHubHeader/);
});

// Wave 4 stream density + suggest lifecycle (no-regress extension)
test("stream density: period chips limited and composer quieter", () => {
  const stream = read("src/plugins/topmind-workspace/views/StreamDetailView.tsx");
  assert.match(stream, /data-stream-period-chips|slice\(0,\s*6\)/);
  assert.match(stream, /data-stream-inline-composer/);
  assert.match(stream, /composeSubmit|data-stream-compose-submit/);
  assert.match(stream, /opacity-0[\s\S]{0,80}group-hover:opacity-100/);
});

test("suggest boot policy + durable fingerprint modules ship", () => {
  const policy = read("src/lib/suggest-boot-policy.ts");
  assert.match(policy, /decideSuggestRefresh/);
  assert.match(policy, /auto_prepare_off|soft_throttled/);
  const store = read("src/stores/action-store.ts");
  assert.match(store, /decideSuggestRefresh/);
  const fp = readFileSync(
    path.join(path.resolve(root, ".."), "lib/suggest-fingerprint.mjs"),
    "utf8",
  );
  assert.match(fp, /suggest-fingerprints\.json|shouldSkipAiForFingerprint/);
});
