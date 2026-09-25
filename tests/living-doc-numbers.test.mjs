/**
 * Living-doc numbers must match shipped Kernel constants.
 * Drives EXTRACT_CORPUS_MAX / MAINTAIN_CORPUS_MAX / SUGGEST_CORPUS_MAX_CHARS
 * / activity-window defaults — no hardcoded expected blobs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXTRACT_CORPUS_MAX,
  MAINTAIN_CORPUS_MAX,
} from "../lib/todo-engine.mjs";
import {
  DEFAULT_WINDOW_DAYS,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_PERIODS,
  SUGGEST_CORPUS_MAX_CHARS,
} from "../lib/activity-window.mjs";

const { resolveSkillsRoot, resolveObsidianRoot, SKIP_SKILLS, SKIP_OBSIDIAN, repoRoot: _sisterRepoRoot } = await import("./helpers/sister-repos.mjs");
const skillsRoot = resolveSkillsRoot() || path.join(_sisterRepoRoot, "skills");
const obsidianRoot = resolveObsidianRoot() || path.join(_sisterRepoRoot, "obsidian-plugin");
function absJoin(root, rel) {
  return path.isAbsolute(rel) ? rel : path.join(root, rel);
}

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(absJoin(repo, rel), "utf8");
}

const extractK = EXTRACT_CORPUS_MAX / 1000;
const maintainK = MAINTAIN_CORPUS_MAX / 1000;
const suggestK = SUGGEST_CORPUS_MAX_CHARS / 1000;

test("activity-window and todo-engine expose the shipped corpus/window constants", () => {
  assert.equal(typeof DEFAULT_WINDOW_DAYS, "number");
  assert.equal(typeof DEFAULT_MAX_FILES, "number");
  assert.equal(typeof DEFAULT_MAX_PERIODS, "number");
  assert.equal(typeof SUGGEST_CORPUS_MAX_CHARS, "number");
  assert.equal(typeof EXTRACT_CORPUS_MAX, "number");
  assert.equal(typeof MAINTAIN_CORPUS_MAX, "number");
  assert.ok(EXTRACT_CORPUS_MAX >= MAINTAIN_CORPUS_MAX);
  assert.equal(EXTRACT_CORPUS_MAX, SUGGEST_CORPUS_MAX_CHARS);
});

test("AGENTS.md activity-window numbers match shipped constants", () => {
  const src = read("AGENTS.md");
  assert.match(src, new RegExp(`${DEFAULT_WINDOW_DAYS} 天`));
  assert.match(src, new RegExp(`${DEFAULT_MAX_FILES} 文件`));
  assert.match(src, new RegExp(`${DEFAULT_MAX_PERIODS} 周期`));
  assert.match(src, new RegExp(`suggest ${suggestK}K`));
  assert.match(src, new RegExp(`todo extract ${extractK}K`));
  assert.match(src, new RegExp(`maintain ${maintainK}K`));
});

test("Desktop DESIGN corpus budget matches todo-engine", () => {
  const src = read("topmind-desktop/DESIGN.md");
  assert.match(
    src,
    new RegExp(`extract ${extractK}K / maintain ${maintainK}K`),
  );
  assert.doesNotMatch(src, /extract 12K \/ maintain 8K/);
  assert.match(
    src,
    new RegExp(`${DEFAULT_WINDOW_DAYS} 天 / ${DEFAULT_MAX_FILES} 文件 / ${DEFAULT_MAX_PERIODS} 周期`),
  );
});

test("suggest / todo / ops call activity-window defaults, not magic 21/30/16000", () => {
  for (const rel of ["lib/suggest-engine.mjs", "lib/ai-operation-engine.mjs"]) {
    const src = read(rel);
    assert.match(src, /SUGGEST_CORPUS_MAX_CHARS/, `${rel} must use SUGGEST_CORPUS_MAX_CHARS`);
    assert.doesNotMatch(src, /windowDays:\s*21/, `${rel} must not hardcode windowDays: 21`);
    assert.doesNotMatch(src, /maxFiles:\s*30/, `${rel} must not hardcode maxFiles: 30`);
    assert.doesNotMatch(src, /maxChars:\s*16000/, `${rel} must not hardcode maxChars: 16000`);
  }
  const todo = read("lib/todo-engine.mjs");
  assert.match(todo, /DEFAULT_WINDOW_DAYS/);
  assert.match(todo, /DEFAULT_MAX_FILES/);
  assert.doesNotMatch(todo, /windowDays:\s*21/);
  assert.doesNotMatch(todo, /maxFiles:\s*30/);
});

test("living docs describe 我的情况 as memory-plane browse, not a sixth concept", (t) => {
  if (SKIP_OBSIDIAN) { t.skip(SKIP_OBSIDIAN); return; }
  const design = read("DESIGN.md");
  const reset = read("docs/ARCHITECTURE-RESET.md");
  const desktopDesign = read("topmind-desktop/DESIGN.md");
  const obsidianDesign = read(absJoin(obsidianRoot, "DESIGN.md"));
  assert.match(design, /记忆浏览/);
  assert.match(desktopDesign, /记忆浏览/);
  assert.match(obsidianDesign, /记忆浏览/);
  assert.match(reset, /记忆浏览/);
  assert.doesNotMatch(design, /(?<!不)是第六个用户概念/u);
});

test("optional 记账 is memory-plane satellite, not a sixth concept or ninth engine", () => {
  const design = read("DESIGN.md");
  const boundaries = read("PRODUCT-BOUNDARIES.md");
  const model = read("PROJECT-MODEL.md");
  const agents = read("AGENTS.md");
  const reset = read("docs/ARCHITECTURE-RESET.md");
  const tools = read("TOOLS.md");
  const desktopDesign = read("topmind-desktop/DESIGN.md");
  for (const [rel, src] of [
    ["DESIGN.md", design],
    ["PRODUCT-BOUNDARIES.md", boundaries],
    ["PROJECT-MODEL.md", model],
    ["AGENTS.md", agents],
    ["docs/ARCHITECTURE-RESET.md", reset],
    ["TOOLS.md", tools],
    ["topmind-desktop/DESIGN.md", desktopDesign],
  ]) {
    assert.match(src, /ledgers\//, `${rel} must name memory/ledgers`);
    assert.match(src, /ledger-engine|可选记账/, `${rel} must name optional 记账 / ledger-engine`);
  }
  const conceptTable = design.match(/## 1\. 用户概念硬上限[\s\S]*?(?=\n## 2\.)/);
  assert.ok(conceptTable, "DESIGN.md concept table");
  assert.doesNotMatch(conceptTable[0], /^\| \*\*记账\*\*/m);
  assert.match(design, /不是第六个用户概念/);
  assert.match(agents, /ledger-engine/);
  assert.match(agents, /不是第九引擎/);
  assert.match(agents, /contract · workspace-model · stream · memory · lifecycle · \*\*writeback/);
  assert.match(tools, /8 个 UTR 命令域/);
  assert.match(desktopDesign, /不是\*\* PrimaryNav|不是\*\*PrimaryNav|\*\*不是\*\* PrimaryNav/);
});

test("ADR index pairs list 2026-08-27 desktop log rotation", () => {
  const en = read("docs/README.en.md");
  const zh = read("docs/README.zh-CN.md");
  assert.match(en, /2026-08-27-desktop-log-rotation\.md/);
  assert.match(zh, /2026-08-27-desktop-log-rotation\.md/);
});

test("ADR index pairs list 2026-09-07 pi/three-column and do not freeze No Pi Agent Base as current", () => {
  // docs/README.md = 简体中文 default · docs/README.en.md = English
  const en = read("docs/README.en.md");
  const zh = read("docs/README.zh-CN.md");
  assert.match(en, /2026-09-07-pi-engine-and-three-column-reevaluation\.md/);
  assert.match(zh, /2026-09-07-pi-engine-and-three-column-reevaluation\.md/);
  assert.match(en, /loop choice superseded 2026-09-07/);
  assert.match(zh, /循环选型被 2026-09-07 覆盖/);
});

test("living docs do not teach deleted TitleBar chrome as current", () => {
  const design = read("DESIGN.md");
  const agents = read("AGENTS.md");
  const boundaries = read("PRODUCT-BOUNDARIES.md");
  const model = read("PROJECT-MODEL.md");
  const reset = read("docs/ARCHITECTURE-RESET.md");
  const desktopReadme = read("topmind-desktop/README.md");
  const desktopReadmeZh = read("topmind-desktop/README.zh-CN.md");
  const audit = read("docs/UIUX-AUDIT-2026-09-01.md");

  assert.doesNotMatch(design, /标题栏灯泡/);
  assert.doesNotMatch(agents, /作为 Apps 菜单 mini-app/);
  assert.doesNotMatch(boundaries, /标题栏 Apps 菜单/);
  assert.doesNotMatch(model, /入口在 Apps 菜单/);
  assert.doesNotMatch(desktopReadme, /AI panel \*\*ActionBar\*\*/);
  assert.doesNotMatch(desktopReadme, /Title-bar \*\*Note it\*\*/);
  assert.doesNotMatch(desktopReadmeZh, /AI 面板 \*\*ActionBar\*\*/);
  assert.doesNotMatch(desktopReadmeZh, /顶栏 \*\*记一下\*\*/);
  assert.match(reset, /搜索=⌘K\/⌘P 非 PrimaryNav/);
  assert.doesNotMatch(reset, /主锚 动态\/Inbox\/交付\/搜索；/);
  assert.match(audit, /\*\*NON-LIVING\*\*/);

  const ledgerZh = read("topmind-desktop/src/locales/zh-CN/ledger.json");
  const ledgerEn = read("topmind-desktop/src/locales/en-US/ledger.json");
  const settingsZh = read("topmind-desktop/src/locales/zh-CN/settings.json");
  const settingsEn = read("topmind-desktop/src/locales/en-US/settings.json");
  assert.doesNotMatch(ledgerZh, /标题栏 Apps 菜单/);
  assert.doesNotMatch(ledgerEn, /header Apps menu/i);
  assert.match(ledgerZh, /AI 工作区应用 pane/);
  assert.match(ledgerEn, /AI workspace Apps pane/);
  assert.doesNotMatch(settingsZh, /标题栏 Apps 菜单/);
  assert.doesNotMatch(settingsEn, /header Apps menu/i);
  assert.match(settingsZh, /AI 工作区应用 pane/);
  assert.match(settingsEn, /AI workspace Apps pane/);
});

test("onboarding tagline is the five user concepts; capture skill and CLI match registry", () => {
  const zh = JSON.parse(read("topmind-desktop/src/locales/zh-CN/common.json"));
  const en = JSON.parse(read("topmind-desktop/src/locales/en-US/common.json"));
  assert.equal(zh.app.tagline, "记一下 · 动态 · 专题 · 我的情况 · 交付");
  assert.equal(en.app.tagline, "Note it · Stream · Topic · My profile · Delivery");
  const settingsZh = JSON.parse(read("topmind-desktop/src/locales/zh-CN/settings.json"));
  const settingsEn = JSON.parse(read("topmind-desktop/src/locales/en-US/settings.json"));
  assert.doesNotMatch(settingsZh.general.writebackDesc, /也可在 AI 面板切换/);
  assert.doesNotMatch(settingsEn.general.writebackDesc, /also switchable from AI panel/);
  const desktopDesign = read("topmind-desktop/DESIGN.md");
  assert.doesNotMatch(desktopDesign, /点击徽章循环切换模式/);
  assert.doesNotMatch(desktopDesign, /写回两态 `auto \| confirm` 循环/);
  const cli = read("utr/bin/topmind-cli.mjs");
  assert.doesNotMatch(cli, /workspace-check/);
  assert.match(cli, /contract \| memory \| lifecycle \| derived/);
});

test("living DESIGN files do not copy surface version digits into headings", (t) => {
  if (SKIP_OBSIDIAN) { t.skip(SKIP_OBSIDIAN); return; }
  for (const rel of [
    "DESIGN.md",
    "topmind-desktop/DESIGN.md",
    absJoin(obsidianRoot, "DESIGN.md"),
    "README.md",
    "README.zh-CN.md",
    "AGENTS.md",
    "CLAUDE.md",
  ]) {
    const src = read(rel);
    assert.doesNotMatch(
      src,
      /### Desktop \d+\.\d+\.\d+/u,
      `${rel} must not stamp Desktop x.y.z in a heading`,
    );
    assert.doesNotMatch(
      src,
      /Status Bar Item · \d+\.\d+\.\d+/u,
      `${rel} must not stamp a surface version on the status-bar entry`,
    );
  }
});

test("living DESIGN/ARCHITECTURE do not present canvas SuggestEntryStrip as current chrome", () => {
  const design = read("topmind-desktop/DESIGN.md");
  const arch = read("topmind-desktop/ARCHITECTURE.md");
  assert.match(design, /状态栏(?:建议)?计数 chip/);
  assert.doesNotMatch(design, /有 `items` 时画布顶 `SuggestEntryStrip`/);
  assert.doesNotMatch(design, /建议计数\*\*恰好两处\*\*：标题栏 💡 badge \+ 画布顶/);
  assert.doesNotMatch(arch, /EditorArea（SuggestEntryStrip/);
  assert.equal(
    existsSync(path.join(repo, "docs/stream-first-optimization-scheme.md")),
    false,
    "stream-first memo was a second spec; numbers live in DESIGN.md",
  );
  // PrimaryNav lists 工作区 · 动态 · Inbox · 交付; default selection is home
  // (workspace canvas), not a fourth product concept.
  assert.match(arch, /PrimaryNav 文案为 \*\*动态 · Inbox · 交付\*\*/);
  assert.match(arch, /默认 selection 是 `\{ kind: "home" \}`/);
  assert.doesNotMatch(arch, /交付 · 搜索\*\*/);
  assert.doesNotMatch(design, /AI 轨 `ActionBar`/);
  assert.match(design, /浮动 `SuggestPopover`/);
});

test("living Desktop DESIGN matches shipped Design System tokens (not legacy leftover)", (t) => {
  if (SKIP_OBSIDIAN) { t.skip(SKIP_OBSIDIAN); return; }
  const design = read("topmind-desktop/DESIGN.md");
  const tokens = read("topmind-desktop/src/styles/tokens.css");
  // Pick the .dark block that actually defines the surface ladder (MD3 alias
  // blocks also use `.dark` and must not win the first-match race).
  const darkBlocks = [...tokens.matchAll(/\.dark\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1] || "");
  const dark = darkBlocks.find((b) => /--color-sidebar:\s*#/.test(b)) || "";
  const sidebar = dark.match(/--color-sidebar:\s*([^;]+);/)?.[1]?.trim();
  const canvas = dark.match(/--color-background:\s*([^;]+);/)?.[1]?.trim();
  assert.ok(sidebar && canvas, "dark sidebar/canvas tokens");
  assert.match(design, new RegExp(sidebar.replace("#", "\\#")));
  assert.match(design, new RegExp(canvas.replace("#", "\\#")));
  // Legacy DS 2.x graphite leftovers must stay gone
  assert.doesNotMatch(design, /#171715|#1e1e1c|#262624|#2e2e2b/);
  assert.doesNotMatch(design, /Typography\*\*：Inter/);
  assert.match(design, /--font-family-ui/);
  // Living spec should reference the current design system generation
  assert.match(design, /Design System 4\./);
  assert.doesNotMatch(design, /\| ⌘N \|[^\n]*快速捕获/);
  assert.doesNotMatch(design, /\| ⌘⇧N \|[^\n]*快速捕获/);
  const obsidian = read(absJoin(obsidianRoot, "DESIGN.md"));
  assert.doesNotMatch(obsidian, /橙=todo_extract/);
  assert.doesNotMatch(obsidian, /蓝=create_topic\/inbox_review\/topic_classify/);
  assert.match(obsidian, /inbox_organize/);
});

test("PrimaryNav lives on the sidebar primary header (not StatusBar)", () => {
  const design = read("topmind-desktop/DESIGN.md");
  assert.match(design, /侧栏主 header.*PrimaryNav|PrimaryNav.*侧栏主 header/u);
  assert.match(design, /不含 PrimaryNav/u);
  assert.doesNotMatch(design, /状态栏 PrimaryNav/u);
  assert.doesNotMatch(design, /状态栏常驻 \*\*动态/u);
});

test("记一下 is one concept one glyph (RiPencilLine / pencil)", () => {
  const design = read("topmind-desktop/DESIGN.md");
  assert.match(design, /记一下[\s\S]{0,40}RiPencilLine|RiPencilLine[\s\S]{0,40}记一下/u);
  assert.doesNotMatch(design, /记一下[\s\S]{0,20}RiFlashlightLine/u);
  assert.doesNotMatch(design, /`RiFlashlightLine`/u);
});

test("⌘⇧T opens the personal list pane (not a TitleBar todo popup)", () => {
  const design = read("topmind-desktop/DESIGN.md");
  assert.match(design, /⌘⇧T[\s\S]{0,40}清单 pane/u);
  assert.doesNotMatch(design, /待办清单弹层（TitleBar/u);
  assert.doesNotMatch(design, /快速捕获/u); // banned product word
});
