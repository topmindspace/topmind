import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const uiDir = path.join(desktopRoot, "src", "components", "ui");

function read(rel) {
  return fs.readFileSync(path.join(desktopRoot, rel), "utf-8");
}

test("Muse/Cue-borrowed UI kit files exist and export their API", () => {
  const kit = {
    "StatusDot.tsx": ["StatusDot", "StatusDotTone"],
    "ChoiceCard.tsx": ["ChoiceCardGroup", "ChoiceOption"],
    "SuggestionCard.tsx": ["SuggestionCard"],
    "view.tsx": ["RowActions"],
    "AgentPresence.tsx": ["AgentPresence", "AgentPresenceState"],
  };
  for (const [file, names] of Object.entries(kit)) {
    const src = fs.readFileSync(path.join(uiDir, file), "utf-8");
    for (const name of names) {
      assert.match(src, new RegExp(`export (function|type|interface|const) ${name}\\b|export \\{[^}]*\\b${name}\\b`),
        `${file} must export ${name}`);
    }
  }
});

test("AiMessage carries optional clarifying choices", () => {
  const types = read("src/types.ts");
  assert.match(types, /choices\?:/);
  assert.match(types, /choicesMultiple\?:/);
});

test("ChatMessage renders ChoiceCardGroup from message.choices", () => {
  const src = read("src/components/ai/ChatMessage.tsx");
  assert.match(src, /ChoiceCardGroup/);
  assert.match(src, /message\.choices/);
});

test("settings theme seed swatches use tokens, not hardcoded hex", () => {
  const src = read("src/components/settings/GeneralPanel.tsx");
  assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/);
  assert.match(src, /bg-theme-swatch-/);
});

test("theme swatch tokens are defined in tokens.css", () => {
  const css = read("src/styles/tokens.css");
  for (const name of ["sky", "teal", "graphite"]) {
    assert.match(css, new RegExp(`--color-theme-swatch-${name}\\s*:`));
  }
});

test("StatusDot stays a pure fill (no alpha on semantic stops)", () => {
  const src = fs.readFileSync(path.join(uiDir, "StatusDot.tsx"), "utf-8");
  assert.doesNotMatch(src, /(?:bg|text)-(?:success|warning|error|status-info|accent-color)\/\d+/);
});

test("UI kit and toast chrome avoid emoji / decorative unicode glyphs", () => {
  // Product icon contract: Remix line icons only. Decorative glyphs (✓ ✗ ★ ✕ ↩)
  // are banned as UI marks; status uses StatusDot / toast kind icons.
  const files = [
    "src/components/ui/StatusDot.tsx",
    "src/components/ui/ChoiceCard.tsx",
    "src/components/ui/SuggestionCard.tsx",
    "src/components/ui/view.tsx",
    "src/components/ui/AgentPresence.tsx",
    "src/components/ui/menu-select.tsx",
    "src/lib/writeback-toast.ts",
    "src/components/shell/Shell.tsx",
    "src/plugins/connector-ui.tsx",
    "src/components/settings/AiProviderPanel.tsx",
    "src/components/ai/ChatInput.tsx",
    "src/components/ai/task-list-body.tsx",
  ];
  const banned = /[✓✗★✕↩✨🎵🎉👍]/u;
  for (const rel of files) {
    const src = read(rel);
    // Strip comments so prose can mention the ban without failing the gate.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ");
    assert.doesNotMatch(code, banned, `${rel} must not use decorative unicode glyphs`);
  }
});

test("ProactiveSuggestStrip is shared and mounted on stream / inbox / memory", () => {
  const strip = read("src/components/workspace/ProactiveSuggestStrip.tsx");
  assert.match(strip, /export function ProactiveSuggestStrip/);
  assert.match(strip, /data-proactive-suggest/);
  for (const rel of [
    "src/plugins/topmind-workspace/views/StreamDetailView.tsx",
    "src/plugins/topmind-workspace/views/InboxView.tsx",
    "src/plugins/topmind-workspace/views/MemoryBrowseView.tsx",
  ]) {
    const src = read(rel);
    assert.match(src, /ProactiveSuggestStrip/, `${rel} mounts ProactiveSuggestStrip`);
  }
});

test("content surfaces use ViewHero soft-title register", () => {
  const view = read("src/components/ui/view.tsx");
  assert.match(view, /export function ViewHero/);
  assert.match(view, /text-3xl/);
  const stream = read("src/plugins/topmind-workspace/views/StreamDetailView.tsx");
  assert.match(stream, /<ViewHero/);
});

test("settings nav uses Muse-density icon rows (no second activity rail)", () => {
  const layout = read("src/components/overlays/SettingsLayout.tsx");
  assert.match(layout, /data-settings-nav/);
  assert.match(layout, /item\.tab\.icon/);
  // Soft selected fill, not accent container shout
  assert.match(layout, /data-\[state=active\]:bg-surface-elevated/);
});

test("tree rows use soft hover wash and generous radius", () => {
  const css = read("src/styles/v4.css");
  assert.match(css, /\.v4-tree-node:hover\s*\{[^}]*surface-hover/s);
  assert.match(css, /--density-tree-row/);
});

test("suggest pane cards share SuggestionCard soft language", () => {
  const src = read("src/components/ai/SuggestPopover.tsx");
  assert.match(src, /radius-card/);
  assert.match(src, /shadow-\[var\(--shadow-card\)\]/);
  // No alpha-diluted semantic rings on cards
  assert.doesNotMatch(src, /ring-warning\/\d+/);
  assert.doesNotMatch(src, /ring-accent-color\/\d+/);
});

test("stream day groups avoid alpha accent rings; cards use soft shadow", () => {
  const stream = read("src/plugins/topmind-workspace/views/StreamDetailView.tsx");
  assert.doesNotMatch(stream, /ring-accent-color\/\d+/);
  const css = read("src/styles/v4.css");
  assert.match(css, /\[data-stream-feed\]\[data-layout="card"\] \[data-stream-entry-card\]\s*\{[^}]*shadow-card/s);
});

test("AI tool cards use soft card chrome (no harsh wash rows)", () => {
  const src = read("src/components/ai/ChatMessage.tsx");
  assert.match(src, /data-tool-card/);
  assert.match(src, /radius-card/);
});

test("LoadingState and ErrorState share soft surface language", () => {
  const view = read("src/components/ui/view.tsx");
  assert.match(view, /export function LoadingState/);
  assert.match(view, /surface-wash-30/);
  assert.match(view, /export function ErrorState/);
  assert.doesNotMatch(view, /ErrorState[\s\S]{0,400}border border-border-subtle-dim/);
});

test("palette and toast share soft sheet language", () => {
  const css = read("src/styles/v4.css");
  assert.match(css, /\.v4-palette-row\[data-active="true"\]\s*\{[^}]*surface-selected/s);
  assert.doesNotMatch(css, /\.v4-palette-row\[data-active="true"\][^}]*accent-bg-subtle/);
  assert.match(css, /\.v4-overlay-sheet\s*\{[^}]*radius-dialog/s);
  const shell = read("src/components/shell/Shell.tsx");
  assert.match(shell, /radius-toast/);
});

test("suggestion ignore is always-visible text, never hover-only X", () => {
  const card = read("src/components/ui/SuggestionCard.tsx");
  assert.match(card, /data-suggestion-dismiss/);
  assert.doesNotMatch(card, /opacity-0/);
  assert.doesNotMatch(card, /onDismiss[\s\S]{0,800}svg/);
});

test("proactive strip never one-click rejects pending_write", () => {
  const strip = read("src/components/workspace/ProactiveSuggestStrip.tsx");
  assert.match(strip, /pending_write/);
  // Must gate dismiss on source, not call rejectItem for every card
  assert.match(strip, /isPendingWrite\s*\?\s*undefined/);
  assert.doesNotMatch(strip, /rejectItem/);
});

test("suggest dismiss is two-tier: strip card-local hide, pane durable", () => {
  const store = read("src/stores/action-store.ts");
  assert.match(store, /dismissItem:\s*\(id: string\)/);
  // Pane dismissItem must persist
  assert.match(store, /dismissItem:[\s\S]{0,400}persistDismissals/);
  const strip = read("src/components/workspace/ProactiveSuggestStrip.tsx");
  // Strip hide is React-local — never mutates ActionStore / never persists.
  assert.match(strip, /hiddenIds/);
  assert.match(strip, /hideCard/);
  assert.doesNotMatch(strip, /dismissItem\(/);
  assert.doesNotMatch(strip, /softDismissItem/);
  assert.doesNotMatch(strip, /persistDismissals/);
  // 查看 also only hides the strip card, then opens the pane
  assert.match(strip, /hideCard\(item\.id\);\s*\n\s*onOpenAll\(\)/);
});

test("settings rows use Cue left-copy / right-control layout", () => {
  const fields = read("src/components/settings/fields.tsx");
  assert.match(fields, /data-settings-row/);
  assert.match(fields, /data-settings-card/);
  // Field must right-align the control, not stack label-above-control only
  assert.match(fields, /flex flex-wrap items-center gap-x-4/);
  // Section title lives outside the card (Cue 外观/其他 register)
  assert.match(fields, /data-settings-section/);
  assert.match(fields, /data-settings-card/);
  assert.ok(
    fields.indexOf("data-settings-section") < fields.indexOf("data-settings-card"),
    "section wraps card",
  );
});

test("list stream entries stay unboxed (Muse open feed)", () => {
  const css = read("src/styles/v4.css");
  assert.match(
    css,
    /\[data-stream-feed\]\[data-layout="list"\] \[data-stream-entry-card\]\s*\{[^}]*background:\s*transparent/s,
  );
  assert.match(
    css,
    /\[data-stream-feed\]\[data-layout="list"\] \[data-stream-entry-card\]\s*\{[^}]*box-shadow:\s*none/s,
  );
});

test("settings buttons do not fight control-height tokens", () => {
  // size="sm" is 32px; inline h-5/h-6/h-7 overrides created 24px footguns
  for (const file of [
    "src/components/settings/GeneralPanel.tsx",
    "src/components/settings/ManagePanel.tsx",
    "src/components/settings/SkillsPanel.tsx",
    "src/components/settings/ToolsPanel.tsx",
    "src/components/settings/WorkspacePanel.tsx",
    "src/components/settings/PluginsPanel.tsx",
  ]) {
    const src = read(file);
    assert.doesNotMatch(
      src,
      /size="sm"[^>]{0,40}className="h-[567]"/,
      `${file}: size=sm must not override height to 20-28px`,
    );
  }
});

test("button variants do not swap border on hover (state-layer only)", () => {
  const btn = read("src/components/ui/Button.tsx");
  assert.doesNotMatch(btn, /outline:[\s\S]{0,120}hover:border-/);
  assert.doesNotMatch(btn, /secondary:[\s\S]{0,120}hover:border-/);
});
