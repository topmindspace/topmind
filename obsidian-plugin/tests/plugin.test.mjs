// ── topmind Obsidian Plugin — Unit Tests ───────────────────────────────────
//
// Honesty rule: pure-logic cases import the **shipped** TypeScript sources
// (Node --experimental-strip-types). Tests must not re-copy algorithms.
//
// Coverage:
// 1. i18n locale key alignment (reads actual locale files)
// 2. Stream entry parsing / tags / sanitize / frontmatter (src/utils.ts)
// 3. Todo mapping (Kernel `done` field)
// 4. Suggestion normalize/map + kind meta
// 5. Capture text normalization + lone URL detect
// 6. Path filter isStreamOrTodoPath
// 7. DEFAULT_SETTINGS + AI_PROVIDER_PRESETS from shipped modules
// 8. AI isTransientError from shipped ai-provider.ts
// 9. Build output / pack artifacts

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, "..", "src");

/** Import a shipped TypeScript source module via strip-types. */
async function importShipped(relFromSrc) {
  const abs = path.join(srcDir, relFromSrc);
  return import(pathToFileURL(abs).href);
}

// ── i18n locale key alignment ──────────────────────────────────────────────

describe("i18n locale key alignment", () => {
  test("zh-CN and en-US have identical key sets", () => {
    const zhContent = fs.readFileSync(
      path.join(srcDir, "i18n", "locales", "zh-CN.ts"),
      "utf-8",
    );
    const enContent = fs.readFileSync(
      path.join(srcDir, "i18n", "locales", "en-US.ts"),
      "utf-8",
    );

    const keyRegex = /^\s*(\w+):\s*"/gmu;
    const zhKeys = new Set();
    const enKeys = new Set();

    let match;
    while ((match = keyRegex.exec(zhContent)) !== null) {
      zhKeys.add(match[1]);
    }
    keyRegex.lastIndex = 0;
    while ((match = keyRegex.exec(enContent)) !== null) {
      enKeys.add(match[1]);
    }

    for (const key of zhKeys) {
      assert.ok(enKeys.has(key), `en-US missing key: ${key}`);
    }
    for (const key of enKeys) {
      assert.ok(zhKeys.has(key), `zh-CN missing key: ${key}`);
    }
    assert.equal(zhKeys.size, enKeys.size, "Key count mismatch");
    // URL / a11y keys that UI uses must be present
    assert.ok(zhKeys.has("notice_url_to_inbox"), "missing notice_url_to_inbox");
    assert.ok(zhKeys.has("stream_expand_entry"), "missing stream_expand_entry");
    assert.ok(zhKeys.has("quick_capture_hint_enter_note"), "missing quick_capture_hint_enter_note");
    assert.ok(zhKeys.size >= 90, `Expected at least 90 keys, got ${zhKeys.size}`);
  });

  test("user-facing titles use 动态/Stream and 记下/记一下 distinctly", () => {
    const zhContent = fs.readFileSync(
      path.join(srcDir, "i18n", "locales", "zh-CN.ts"),
      "utf-8",
    );
    const enContent = fs.readFileSync(
      path.join(srcDir, "i18n", "locales", "en-US.ts"),
      "utf-8",
    );
    assert.match(zhContent, /stream_workbench_title:\s*"动态"/);
    assert.match(enContent, /stream_workbench_title:\s*"Stream"/);
    assert.doesNotMatch(zhContent, /stream_workbench_title:\s*"[^"]*工作台/);
    assert.doesNotMatch(enContent, /stream_workbench_title:\s*"[^"]*Workbench/);
    assert.match(zhContent, /quick_capture_note_it:\s*"记一下"/);
    assert.match(zhContent, /quick_capture_log_it:\s*"记下"/);
    assert.match(zhContent, /toolbar_btn_profile:\s*"我的情况"/);
    assert.match(enContent, /toolbar_btn_profile:\s*"My profile"/);
    assert.match(zhContent, /pending_writes_title:\s*"待确认写入"/);
    assert.match(enContent, /pending_writes_title:\s*"Pending writes"/);
    assert.doesNotMatch(zhContent, /notice_write_pending:\s*"[^"]*审阅/);
    assert.doesNotMatch(zhContent, /quick_capture_submit:/);
    assert.doesNotMatch(enContent, /quick_capture_submit:/);
  });
});

// ── Toolbar / labeled-button chrome (shipped CSS + views) ───────────────────

describe("Obsidian labeled-button chrome (shipped)", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf-8");
  const workbench = fs.readFileSync(path.join(srcDir, "views", "stream-workbench-view.ts"), "utf-8");
  const sidebar = fs.readFileSync(path.join(srcDir, "views", "sidebar-dock-view.ts"), "utf-8");
  const zh = fs.readFileSync(path.join(srcDir, "i18n", "locales", "zh-CN.ts"), "utf-8");
  const en = fs.readFileSync(path.join(srcDir, "i18n", "locales", "en-US.ts"), "utf-8");

  test("labeled buttons keep width:auto and do not clip labels at default width", () => {
    assert.match(css, /\.tm-toolbar-btn-labeled\s*\{[^}]*width:\s*auto/s);
    assert.match(css, /\.tm-sidebar-btn-labeled\s*\{[^}]*width:\s*auto/s);
    const toolbarLabel = css.match(/\.tm-toolbar-btn-label\s*\{[^}]+\}/)?.[0] || "";
    const sidebarLabel = css.match(/\.tm-sidebar-btn-label\s*\{[^}]+\}/)?.[0] || "";
    assert.match(toolbarLabel, /overflow:\s*visible/);
    assert.match(sidebarLabel, /overflow:\s*visible/);
    assert.doesNotMatch(toolbarLabel, /display:\s*none/);
    assert.doesNotMatch(sidebarLabel, /display:\s*none/);
    // Default toolbar/header must not rely on overflow:hidden alone to hide labels
    assert.match(css, /\.tm-toolbar\s*\{[^}]*overflow:\s*visible/s);
    assert.match(css, /\.tm-sidebar-header\s*\{[^}]*overflow:\s*visible/s);
  });

  test("narrow pane hides labels only under an explicit container query", () => {
    assert.match(css, /@container tm-workbench \(max-width:\s*560px\)/);
    assert.match(css, /@container tm-sidebar \(max-width:\s*260px\)/);
    assert.match(css, /container-name:\s*tm-workbench/);
    assert.match(css, /container-name:\s*tm-sidebar/);
  });

  test("refresh and organize use distinct icons and handlers", () => {
    assert.match(workbench, /setIcon\(refreshStreamBtn,\s*"refresh-cw"\)/);
    assert.match(workbench, /setIcon\(this\.organizeBtn,\s*"list-tree"\)/);
    assert.match(workbench, /refreshStreamBtn\.addEventListener\("click".*refreshStream/s);
    assert.match(workbench, /this\.organizeBtn\.addEventListener\("click".*organizePeriod/s);
    assert.doesNotMatch(workbench, /setIcon\(this\.organizeBtn,\s*"refresh-cw"\)/);
    assert.match(sidebar, /setIcon\(workbenchBtn,\s*"waves"\)/);
    assert.doesNotMatch(sidebar, /setIcon\(workbenchBtn,\s*"monitor"\)/);
  });

  test("icon-only and labeled buttons ship aria-label / title", () => {
    assert.match(workbench, /refreshStreamBtn\.setAttribute\("aria-label"/);
    assert.match(workbench, /refreshStreamBtn\.setAttribute\("title"/);
    assert.match(workbench, /sidebarBtn\.setAttribute\("aria-label"/);
    assert.match(workbench, /newNoteBtn\.setAttribute\("title"/);
    assert.match(sidebar, /workbenchBtn\.setAttribute\("aria-label"/);
    assert.match(sidebar, /settingsBtn\.setAttribute\("title"/);
  });

  test("toolbar label keys exist in both locales", () => {
    for (const key of [
      "toolbar_btn_sidebar",
      "toolbar_btn_settings",
      "toolbar_btn_new_note",
      "toolbar_btn_profile",
      "toolbar_btn_refresh",
      "stream_organize",
      "sidebar_btn_workbench",
    ]) {
      const re = new RegExp(`${key}:\\s*"`);
      assert.match(zh, re, `zh missing ${key}`);
      assert.match(en, re, `en missing ${key}`);
    }
    assert.match(zh, /sidebar_btn_workbench:\s*"动态"/);
    assert.match(en, /sidebar_btn_workbench:\s*"Stream"/);
    assert.doesNotMatch(zh, /sidebar_btn_workbench:\s*"[^"]*工作台/);
  });
});

// ── Stream entry parsing (shipped) ─────────────────────────────────────────

describe("assembleMemoryFeed (shipped)", () => {
  test("profile + periodic + topic are separate rows; empty plane is empty", async () => {
    const { assembleMemoryFeed } = await importShipped("utils.ts");
    assert.deepEqual(assembleMemoryFeed(null), []);
    const items = assembleMemoryFeed({
      profile: {
        path: "memory/profile.md",
        markdown: "# 我的情况\n\n## 偏好\n\n- 喜欢简洁\n",
      },
      periodic: [
        {
          path: "memory/periodic/2026-W32.md",
          markdown: "---\ntitle: W32\n---\n\n本周反思一段。\n",
        },
      ],
      topics: [
        { path: "memory/topics/ui.md", markdown: "# UI\n\n单列卡片。\n" },
      ],
    });
    assert.ok(items.some((i) => i.kind === "profile" && i.path === "memory/profile.md"));
    assert.ok(items.some((i) => i.kind === "periodic" && i.path === "memory/periodic/2026-W32.md"));
    assert.ok(items.some((i) => i.kind === "topic" && i.path === "memory/topics/ui.md"));
  });

  test("filterMemoryFeedByLayer keeps one kind (shipped grouping, not a reimplementation)", async () => {
    const { assembleMemoryFeed, filterMemoryFeedByLayer } = await importShipped("utils.ts");
    const items = assembleMemoryFeed({
      profile: {
        path: "memory/profile.md",
        markdown: "# 我的情况\n\n## 偏好\n\n- 喜欢简洁\n",
      },
      periodic: [
        {
          path: "memory/periodic/2026-W32.md",
          markdown: "---\ntitle: W32\n---\n\n本周反思一段。\n",
        },
      ],
      topics: [
        { path: "memory/topics/ui.md", markdown: "# UI\n\n单列卡片。\n" },
      ],
    });
    assert.ok(items.length >= 3);
    const profile = filterMemoryFeedByLayer(items, "profile");
    assert.ok(profile.length >= 1);
    assert.ok(profile.every((i) => i.kind === "profile"));
    assert.ok(profile.every((i) => i.path === "memory/profile.md"));
    const periodic = filterMemoryFeedByLayer(items, "periodic");
    assert.equal(periodic.length, 1);
    assert.equal(periodic[0].kind, "periodic");
    assert.equal(periodic[0].path, "memory/periodic/2026-W32.md");
    const topic = filterMemoryFeedByLayer(items, "topic");
    assert.equal(topic.length, 1);
    assert.equal(topic[0].kind, "topic");
    assert.equal(topic[0].path, "memory/topics/ui.md");
    const all = filterMemoryFeedByLayer(items, "all");
    assert.equal(all.length, items.length);
    assert.deepEqual(filterMemoryFeedByLayer(null, "profile"), []);
  });
});

describe("parseStreamEntries (shipped)", () => {
  test("parses simple time-prefixed entries and tags", async () => {
    const { parseStreamEntries } = await importShipped("utils.ts");
    const content = "# 2026-W01\n\n- 09:30 开始写文档\n- 14:00 开会讨论方案 #urgent #项目A\n";
    const entries = parseStreamEntries(content);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].time, "09:30");
    assert.equal(entries[0].text, "开始写文档");
    assert.equal(entries[1].time, "14:00");
    assert.deepEqual(entries[1].tags, ["urgent", "项目A"]);
  });

  test("prose-first body stays one card and still extracts tags", async () => {
    const { parseStreamEntries } = await importShipped("utils.ts");
    const content = "# Title\n\nSome paragraph\n\n- 11:00 读完书 #阅读 #思考\n";
    const entries = parseStreamEntries(content);
    assert.equal(entries.length, 1);
    assert.match(entries[0].text, /Some paragraph/);
    assert.match(entries[0].text, /读完书/);
    assert.ok(entries[0].tags.includes("阅读"));
    assert.ok(entries[0].tags.includes("思考"));
  });

  test("wrapped prose with no list markers is one card, not one card per newline", async () => {
    const { parseStreamEntries } = await importShipped("utils.ts");
    const content = [
      "## 08-03 周一",
      "",
      "This is a long paragraph that wraps",
      "across several lines because the author",
      "hit enter without using list markers.",
    ].join("\n");
    const entries = parseStreamEntries(content);
    assert.equal(entries.length, 1);
    assert.match(entries[0].text, /long paragraph/);
    assert.match(entries[0].text, /list markers/);
    assert.equal(entries[0].text.split("\n").filter((l) => l.trim()).length, 3);
  });

  test("list-led day splits timed items; extra paragraphs stay on the same card", async () => {
    const { parseStreamEntries } = await importShipped("utils.ts");
    const timed = parseStreamEntries("## 08-03\n\n- 10:00 a\n- 11:00 b\n");
    assert.equal(timed.length, 2);
    assert.equal(timed[0].time, "10:00");
    assert.equal(timed[1].time, "11:00");

    const continued = parseStreamEntries("## 08-03\n\n- 10:00 lead\n\nsecond paragraph\n");
    assert.equal(continued.length, 1);
    assert.match(continued[0].text, /lead/);
    assert.match(continued[0].text, /second paragraph/);
  });

  test("returns empty array for empty content", async () => {
    const { parseStreamEntries } = await importShipped("utils.ts");
    assert.equal(parseStreamEntries("").length, 0);
  });

  test("keeps Kernel 增补 after a blank line and strips the machine comment for display", async () => {
    const { parseStreamEntries, prepareStreamEntryTextForDisplay } = await importShipped("utils.ts");
    const content = [
      "- 10:00 原条正文",
      "",
      '<!-- topmind:append parent="10-动态/x" heading="原条正文" at="2026-08-13T00:00:00.000Z" -->',
      "#### 续 · 2026-08-13 12:00",
      "",
      "后续补充一句",
    ].join("\n");
    const entries = parseStreamEntries(content);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].time, "10:00");
    assert.match(entries[0].text, /原条正文/);
    assert.match(entries[0].text, /后续补充一句/);
    assert.match(entries[0].text, /topmind:append/);
    const display = prepareStreamEntryTextForDisplay(entries[0].text);
    assert.doesNotMatch(display, /topmind:append/);
    assert.match(display, /原条正文/);
    assert.match(display, /续 · 2026-08-13/);
    assert.match(display, /后续补充一句/);
  });

  test("formatAppendBlock list and task bodies stay on the same card", async () => {
    const { parseStreamEntries, prepareStreamEntryTextForDisplay } = await importShipped("utils.ts");
    const { formatAppendBlock } = await import(
      pathToFileURL(path.join(__dirname, "..", "..", "lib", "activity-window.mjs")).href
    );
    const when = new Date("2026-08-13T12:00:00.000Z");
    const body =
      "- 10:00 原条正文" +
      formatAppendBlock({
        content: "- 补充一条列表",
        heading: "原条正文",
        date: when,
      }) +
      formatAppendBlock({
        content: "- [ ] 补充待办",
        heading: "原条正文",
        date: new Date("2026-08-13T12:01:00.000Z"),
      });
    const entries = parseStreamEntries(body);
    assert.equal(entries.length, 1, "list/task 增补 must not start a new timed card or be dropped");
    assert.equal(entries[0].time, "10:00");
    assert.match(entries[0].text, /原条正文/);
    assert.match(entries[0].text, /补充一条列表/);
    assert.match(entries[0].text, /补充待办/);
    const display = prepareStreamEntryTextForDisplay(entries[0].text);
    assert.doesNotMatch(display, /topmind:append/);
    assert.match(display, /补充一条列表/);
    assert.match(display, /补充待办/);
  });
});

describe("stream workbench display path (shipped)", () => {
  test("workbench has list/card switch and memory browse entry", () => {
    const workbench = fs.readFileSync(
      path.join(srcDir, "views", "stream-workbench-view.ts"),
      "utf-8",
    );
    const main = fs.readFileSync(path.join(srcDir, "main.ts"), "utf-8");
    const memView = fs.readFileSync(
      path.join(srcDir, "views", "memory-browse-view.ts"),
      "utf-8",
    );
    assert.match(workbench, /data-feed-layout-toggle/);
    assert.match(workbench, /data-layout-option/);
    assert.match(workbench, /data-stream-feed/);
    assert.match(workbench, /data-stream-column/);
    assert.match(workbench, /data-stream-open-memory/);
    assert.match(workbench, /openMemoryBrowse/);
    assert.match(main, /VIEW_TYPE_MEMORY_BROWSE/);
    assert.match(main, /openMemoryBrowse/);
    assert.match(main, /CMD_MEMORY_ORGANIZE/);
    const utils = fs.readFileSync(path.join(srcDir, "utils.ts"), "utf-8");
    assert.match(utils, /from ["']\.\.\/\.\.\/lib\/memory-feed\.mjs["']/);
    assert.doesNotMatch(utils, /export function assembleMemoryFeed/);
    assert.match(memView, /assembleMemoryFeed/);
    assert.match(memView, /data-memory-feed/);
    assert.match(memView, /data-memory-organize/);
    assert.match(memView, /enqueueAiOperation/);
    assert.match(memView, /memory_organize/);
    assert.match(memView, /filterMemoryFeedByLayer/);
    assert.match(memView, /filterMemoryFeedByLayer\(items,\s*this\.layer\)/);
    assert.match(memView, /chip\.addEventListener\(\s*"click"/);
    assert.match(memView, /aria-pressed/);
    assert.match(memView, /this\.layer\s*=\s*id/);
    assert.match(memView, /for \(const item of visible\)/);
    assert.doesNotMatch(memView, /for \(const item of items\)/);
    const design = fs.readFileSync(path.join(__dirname, "..", "DESIGN.md"), "utf-8");
    assert.match(design, /卡片式|单列/);
    assert.match(design, /我的情况/);
  });

  test("cards render prepared display text, not raw append comments", () => {
    const src = fs.readFileSync(
      path.join(srcDir, "views", "stream-workbench-view.ts"),
      "utf-8",
    );
    assert.match(src, /prepareStreamEntryTextForDisplay/);
    assert.match(src, /MarkdownRenderer\.render\(this\.app, displayText/);
    assert.doesNotMatch(src, /MarkdownRenderer\.render\(this\.app, entry\.text/);
    assert.match(src, /displayText\.length > 600/);
    assert.match(src, /navigator\.clipboard\.writeText\(copyText\)/);
    assert.match(src, /length > 20/);
    assert.doesNotMatch(src, /STREAM_EXPAND_CHAR_BUDGET=480/);
  });

  test("sidebar stream preview and createNewNote go through display strip / Kernel", () => {
    const sidebar = fs.readFileSync(
      path.join(srcDir, "views", "sidebar-dock-view.ts"),
      "utf-8",
    );
    const workbench = fs.readFileSync(
      path.join(srcDir, "views", "stream-workbench-view.ts"),
      "utf-8",
    );
    assert.match(sidebar, /prepareStreamEntryTextForDisplay\(entry\.text\)/);
    assert.doesNotMatch(sidebar, /entry\.text\.slice\(0,\s*80\)/);
    assert.match(sidebar, /renderPendingWrites/);
    assert.match(sidebar, /pending_writes_accept/);
    assert.match(workbench, /createInboxNote/);
    assert.doesNotMatch(workbench, /adapter\.write\(filePath/);
  });

  test("DESIGN/ARCHITECTURE fold copy matches shipped 600/20 not 2-line default", () => {
    const design = fs.readFileSync(path.join(__dirname, "..", "DESIGN.md"), "utf-8");
    const arch = fs.readFileSync(path.join(__dirname, "..", "ARCHITECTURE.md"), "utf-8");
    assert.match(design, /600/);
    assert.match(design, /20/);
    assert.doesNotMatch(design, /折叠行数\s*\|\s*2 行/);
    assert.match(arch, /600/);
    assert.match(arch, /20/);
    assert.doesNotMatch(arch, /卡片默认折叠 2 行/);
  });
});

// ── Tag extraction (shipped) ───────────────────────────────────────────────

describe("extractTags (shipped)", () => {
  test("extracts multi-language and hyphenated tags", async () => {
    const { extractTags } = await importShipped("utils.ts");
    assert.deepEqual(extractTags("hello #world"), ["world"]);
    assert.deepEqual(extractTags("#a #b #c"), ["a", "b", "c"]);
    assert.deepEqual(extractTags("完成了 #项目A 的评审"), ["项目A"]);
    assert.deepEqual(extractTags("no tags here"), []);
    assert.deepEqual(extractTags("check #todo-item"), ["todo-item"]);
  });
});

// ── File name sanitization (shipped) ───────────────────────────────────────

describe("sanitizeFileName (shipped)", () => {
  test("removes invalid characters and falls back to untitled", async () => {
    const { sanitizeFileName } = await importShipped("utils.ts");
    assert.equal(sanitizeFileName("test<file>"), "test-file");
    assert.equal(sanitizeFileName('test:file"name'), "test-file-name");
    assert.equal(sanitizeFileName("test|file?name*"), "test-file-name");
    assert.equal(sanitizeFileName(""), "untitled");
    assert.equal(sanitizeFileName("   "), "untitled");
    assert.equal(sanitizeFileName("正常文件名.txt"), "正常文件名.txt");
    assert.equal(sanitizeFileName("<test>"), "test");
  });
});

// ── Period note frontmatter helpers (shipped) ──────────────────────────────

describe("frontmatter helpers (shipped)", () => {
  test("seedPeriodFrontmatter", async () => {
    const { seedPeriodFrontmatter } = await importShipped("utils.ts");
    const result = seedPeriodFrontmatter("10-动态/2026-W01.md");
    assert.ok(result.includes("period: 2026-W01"));
    assert.ok(seedPeriodFrontmatter("2026-W02.md").includes("period: 2026-W02"));
  });

  test("stripFrontmatter / extractFrontmatter", async () => {
    const { stripFrontmatter, extractFrontmatter } = await importShipped("utils.ts");
    const raw = "---\nperiod: 2026-W01\n---\n\n# 2026-W01\n\n- 09:00 hello\n";
    const body = stripFrontmatter(raw);
    assert.ok(!body.startsWith("---"));
    assert.ok(body.includes("# 2026-W01"));
    assert.equal(stripFrontmatter("# No frontmatter\n\nText"), "# No frontmatter\n\nText");
    const fm = extractFrontmatter(raw);
    assert.ok(fm?.startsWith("---"));
    assert.ok(fm?.includes("period: 2026-W01"));
    assert.equal(extractFrontmatter("# No fm\n\nText"), null);
  });
});

// ── Todo mapping (shipped — Kernel `done` field) ───────────────────────────

describe("mapKernelTodoItem (shipped)", () => {
  test("maps Kernel done=true to done:true (not completed)", async () => {
    const { mapKernelTodoItem } = await importShipped("utils.ts");
    const mapped = mapKernelTodoItem({
      id: "abc",
      text: "ship plugin",
      done: true,
      dueDate: "2026-08-10",
      source: "ai",
    });
    assert.equal(mapped.id, "abc");
    assert.equal(mapped.text, "ship plugin");
    assert.equal(mapped.done, true);
    assert.equal(mapped.dueDate, "2026-08-10");
    // Must NOT invent completion from a non-existent `completed` field
    assert.equal("completed" in mapped, false);
  });

  test("maps Kernel done=false and ignores phantom completed field", async () => {
    const { mapKernelTodoItem } = await importShipped("utils.ts");
    const mapped = mapKernelTodoItem({
      id: "x",
      text: "active",
      done: false,
      completed: true, // must be ignored — Kernel does not use this field
    });
    assert.equal(mapped.done, false);
  });
});

// ── Suggestion normalize / map / kind meta (shipped) ───────────────────────

describe("suggestion helpers (shipped)", () => {
  test("normalizeSuggestionList handles array and legacy wrapper", async () => {
    const { normalizeSuggestionList, mapKernelSuggestion } = await importShipped("utils.ts");
    const direct = normalizeSuggestionList([
      { id: "a", kind: "promote_memory", title: "A", summary: "sa", impact: "high" },
    ]);
    assert.equal(direct.length, 1);
    assert.equal(mapKernelSuggestion(direct[0]).id, "a");

    const legacy = normalizeSuggestionList({
      suggestions: [{ id: "x", kind: "create_topic", title: "X", summary: "sx", impact: "medium" }],
    });
    assert.equal(legacy.length, 1);
    assert.equal(mapKernelSuggestion(legacy[0]).kind, "create_topic");

    assert.equal(normalizeSuggestionList(null).length, 0);
    assert.equal(normalizeSuggestionList({}).length, 0);
  });

  test("mergeSoftSuggestionSession keeps previous ids Kernel skipped", async () => {
    const { mergeSoftSuggestionSession } = await importShipped("utils.ts");
    const prev = [
      { id: "ai-1", kind: "promote_memory", title: "A", summary: "keep", impact: "high" },
      { id: "rule", kind: "open_profile", title: "P", summary: "old", impact: "low" },
    ];
    const next = [
      { id: "rule", kind: "open_profile", title: "P", summary: "new", impact: "low" },
    ];
    const dropped = new Set(["gone"]);
    const merged = mergeSoftSuggestionSession(prev, next, dropped);
    assert.equal(merged[0].id, "rule");
    assert.equal(merged[0].summary, "new");
    assert.equal(merged[1].id, "ai-1");
    assert.equal(merged.some((s) => s.id === "gone"), false);
    const forced = mergeSoftSuggestionSession([], next, dropped);
    assert.deepEqual(forced.map((s) => s.id), ["rule"]);
  });

  test("every SuggestionKind has kindMeta icon and border", async () => {
    const { SUGGESTION_KIND_META, ALL_SUGGESTION_KINDS } = await importShipped("utils.ts");
    for (const kind of ALL_SUGGESTION_KINDS) {
      assert.ok(kind in SUGGESTION_KIND_META, `kindMeta missing: ${kind}`);
      const meta = SUGGESTION_KIND_META[kind];
      assert.ok(typeof meta.icon === "string" && meta.icon.length > 0, `${kind} icon`);
      assert.ok(typeof meta.border === "string" && meta.border.length > 0, `${kind} border`);
    }
  });
});

// ── Capture normalization (shipped) ────────────────────────────────────────

describe("normalizeCaptureText / isLoneUrlCapture (shipped)", () => {
  test("rejects empty and truncates long text", async () => {
    const { normalizeCaptureText, MAX_CAPTURE_LEN, isLoneUrlCapture } = await importShipped("utils.ts");
    assert.equal(normalizeCaptureText("   \n\t  ").ok, false);
    assert.equal(normalizeCaptureText("   \n\t  ").error, "empty-text");

    const long = "a".repeat(20_000);
    const r = normalizeCaptureText(long);
    assert.equal(r.ok, true);
    assert.equal(r.truncated, true);
    assert.ok(r.text.includes("(truncated)"));
    assert.ok(r.text.length < long.length);
    assert.ok(MAX_CAPTURE_LEN === 10_000);

    const normal = normalizeCaptureText("完成需求评审 #urgent");
    assert.equal(normal.ok, true);
    assert.equal(normal.text, "完成需求评审 #urgent");

    assert.equal(isLoneUrlCapture("https://example.com/page"), true);
    assert.equal(isLoneUrlCapture("see https://example.com later"), false);
    assert.equal(isLoneUrlCapture("plain text"), false);
  });
});

// ── Path filter (shipped) ──────────────────────────────────────────────────

describe("isStreamOrTodoPath (shipped)", () => {
  test("matches stream 10-19, todo, periodic; rejects topics/output/system", async () => {
    const { isStreamOrTodoPath } = await importShipped("utils.ts");
    assert.ok(isStreamOrTodoPath("10-动态/2026-W01.md"));
    assert.ok(isStreamOrTodoPath("10-Stream/2026-W01.md"));
    assert.ok(isStreamOrTodoPath("11-健康/2026-W01.md"));
    assert.ok(isStreamOrTodoPath("memory/todo.md"));
    assert.ok(isStreamOrTodoPath("memory/periodic/2026-W01.md"));
    assert.ok(isStreamOrTodoPath("70-记忆/todo.md"));
    assert.ok(isStreamOrTodoPath("70-记忆/periodic/2026-W01.md"));
    assert.ok(!isStreamOrTodoPath("memory/profile.md"));
    assert.ok(!isStreamOrTodoPath(".topmind/index.json"));
    assert.ok(!isStreamOrTodoPath("topmind.yaml"));
    assert.ok(!isStreamOrTodoPath("20-专题/2026-项目A/topic.md"));
    assert.ok(!isStreamOrTodoPath("88-输出/report.md"));
    assert.ok(!isStreamOrTodoPath("99-归档/backup.md"));
  });
});

describe("Obsidian profile/todo open paths honor Kernel (no hardcoded memory/)", () => {
  test("commands and views open contract-resolved paths", () => {
    const main = fs.readFileSync(path.join(srcDir, "main.ts"), "utf8");
    const stream = fs.readFileSync(path.join(srcDir, "views", "stream-workbench-view.ts"), "utf8");
    const dock = fs.readFileSync(path.join(srcDir, "views", "sidebar-dock-view.ts"), "utf8");
    const mem = fs.readFileSync(path.join(srcDir, "views", "memory-browse-view.ts"), "utf8");
    assert.doesNotMatch(main, /openLinkText\("memory\/profile\.md"/);
    assert.match(main, /openMemoryBrowse/);
    assert.match(main, /VIEW_TYPE_MEMORY_BROWSE/);
    assert.doesNotMatch(stream, /openLinkText\("memory\/profile\.md"/);
    assert.match(stream, /openMemoryBrowse/);
    assert.match(mem, /profileRelPath\(\)/);
    assert.doesNotMatch(mem, /openLinkText\("memory\/profile\.md"/);
    assert.doesNotMatch(dock, /openLinkText\("memory\/todo\.md"/);
    assert.match(dock, /todoRelPath\(\)/);
  });
});

// ── DEFAULT_SETTINGS + AI presets (shipped) ────────────────────────────────

describe("DEFAULT_SETTINGS and AI_PROVIDER_PRESETS (shipped)", () => {
  test("DEFAULT_SETTINGS has required fields and safe defaults", async () => {
    const { DEFAULT_SETTINGS } = await importShipped("types.ts");
    const required = [
      "autoOpenWorkbench", "timelineOrder", "autoTag",
      "aiProvider", "aiApiKey", "aiBaseUrl", "aiModel",
      "writebackMode", "autoSuggest", "autoMaintainTodos",
      "backupKeep", "receiptKeep",
      // New multi-provider model
      "ai", "localeOverride", "feedLayout",
    ];
    for (const field of required) {
      assert.ok(field in DEFAULT_SETTINGS, `Missing field: ${field}`);
    }
    // Display cache default must match the contract default ("auto") — an
    // uninitialized workspace must not display "confirm" while Kernel runs "auto".
    assert.equal(DEFAULT_SETTINGS.writebackMode, "auto");
    // Plugin data.json is a display cache — Kernel must not take settings.writebackMode
    // as a permanent executeWrite override (operational truth is topmind.yaml).
    const svc = fs.readFileSync(path.join(srcDir, "services", "kernel-service.ts"), "utf8");
    assert.doesNotMatch(
      svc,
      /return this\.settings\.writebackMode/,
      "writebackModeOverride must not fork yaml from plugin data",
    );
    assert.match(svc, /hydrateWritebackModeFromContract/);
    assert.match(svc, /mirrorWritebackMode/);
    assert.equal(DEFAULT_SETTINGS.aiProvider, "none");
    assert.equal(DEFAULT_SETTINGS.aiApiKey, "");
    assert.equal(DEFAULT_SETTINGS.autoMaintainTodos, false);
    assert.equal(DEFAULT_SETTINGS.feedLayout, "list");
    assert.equal(DEFAULT_SETTINGS.receiptKeep, 50);
    assert.ok(DEFAULT_SETTINGS.receiptKeep >= 10);
    // backupKeep=0 is a valid configuration (disables backups)
    assert.ok(typeof DEFAULT_SETTINGS.backupKeep === "number");
    // New: ai multi-provider model
    assert.ok(DEFAULT_SETTINGS.ai, "ai config object must exist");
    assert.ok(DEFAULT_SETTINGS.ai.manual, "ai.manual must exist");
    assert.equal(DEFAULT_SETTINGS.ai.sourcePreference, "");
    assert.equal(DEFAULT_SETTINGS.ai.defaultModel, "");
    // All manual keys exist and default to empty
    for (const key of ["openAiKey", "anthropicKey", "googleKey", "deepseekKey",
      "moonshotKey", "zhipuKey", "minimaxKey", "xaiKey",
      "customBaseUrl", "customKey", "ollamaBaseUrl"]) {
      assert.ok(key in DEFAULT_SETTINGS.ai.manual, `Missing manual key: ${key}`);
      assert.equal(DEFAULT_SETTINGS.ai.manual[key], "", `${key} should default to empty`);
    }
  });

  test("AI_PROVIDER_PRESETS has all Desktop-aligned providers", async () => {
    const { AI_PROVIDER_PRESETS } = await importShipped("constants.ts");
    // Must include all providers that Desktop supports
    const expectedProviders = ["openai", "anthropic", "google", "deepseek",
      "moonshot", "zhipu", "minimax", "xai", "ollama", "custom"];
    for (const pid of expectedProviders) {
      assert.ok(pid in AI_PROVIDER_PRESETS, `Missing provider: ${pid}`);
      const preset = AI_PROVIDER_PRESETS[pid];
      assert.ok(typeof preset.baseUrl === "string", `${pid} missing baseUrl`);
      assert.ok(typeof preset.model === "string", `${pid} missing model`);
      assert.ok(typeof preset.label === "string", `${pid} missing label`);
      assert.ok(typeof preset.helpUrl === "string", `${pid} missing helpUrl`);
      assert.ok(["international", "domestic", "local"].includes(preset.group),
        `${pid} invalid group: ${preset.group}`);
      assert.ok(["openai-compat", "anthropic", "google"].includes(preset.apiType),
        `${pid} invalid apiType: ${preset.apiType}`);
    }
    assert.equal(AI_PROVIDER_PRESETS.custom.baseUrl, "");
    assert.equal(AI_PROVIDER_PRESETS.custom.model, "");
    assert.ok(AI_PROVIDER_PRESETS.ollama.baseUrl.startsWith("http://127.0.0.1"));
    // Google must use google API type (not openai-compat)
    assert.equal(AI_PROVIDER_PRESETS.google.apiType, "google");
    // Anthropic must use anthropic API type
    assert.equal(AI_PROVIDER_PRESETS.anthropic.apiType, "anthropic");
  });
});

// ── Migration + multi-provider helpers (shipped) ───────────────────────────

describe("migrateSettings + hasConfiguredProvider (shipped)", () => {
  test("migrateSettings converts old single-provider to multi-provider", async () => {
    const { migrateSettings } = await importShipped("types.ts");
    const oldSettings = {
      aiProvider: "deepseek",
      aiApiKey: "sk-test-123",
      aiBaseUrl: "https://api.deepseek.com/v1",
      aiModel: "deepseek-chat",
    };
    const migrated = migrateSettings(oldSettings);
    assert.ok(migrated.ai, "ai object must exist after migration");
    assert.equal(migrated.ai.manual.deepseekKey, "sk-test-123");
    assert.equal(migrated.ai.sourcePreference, "deepseek");
    assert.equal(migrated.ai.defaultModel, "deepseek-chat");
  });

  test("migrateSettings handles ollama (no key, URL only)", async () => {
    const { migrateSettings } = await importShipped("types.ts");
    const oldSettings = {
      aiProvider: "ollama",
      aiBaseUrl: "http://127.0.0.1:11434/v1",
      aiModel: "llama3.2",
    };
    const migrated = migrateSettings(oldSettings);
    assert.equal(migrated.ai.manual.ollamaBaseUrl, "http://127.0.0.1:11434/v1");
    assert.equal(migrated.ai.sourcePreference, "ollama");
  });

  test("migrateSettings preserves existing multi-provider config", async () => {
    const { migrateSettings, DEFAULT_SETTINGS } = await importShipped("types.ts");
    const settings = {
      ai: {
        sourcePreference: "openai",
        defaultModel: "gpt-4o",
        manual: { ...DEFAULT_SETTINGS.ai.manual, openAiKey: "sk-existing" },
      },
    };
    const migrated = migrateSettings(settings);
    assert.equal(migrated.ai.manual.openAiKey, "sk-existing");
    assert.equal(migrated.ai.sourcePreference, "openai");
  });

  test("migrateSettings normalizes junk values from damaged data.json", async () => {
    const { migrateSettings } = await importShipped("types.ts");
    const migrated = migrateSettings({
      timelineOrder: 42,
      writebackMode: "yolo",
      localeOverride: "fr-FR",
      backupKeep: "x",
      receiptKeep: 99999,
      autoOpenWorkbench: "yes",
      autoTag: 0,
    });
    assert.equal(migrated.timelineOrder, "desc");
    assert.equal(migrated.writebackMode, "auto");
    assert.equal(migrated.localeOverride, "");
    assert.equal(migrated.backupKeep, 3, "non-numeric backupKeep falls back to default");
    assert.equal(migrated.receiptKeep, 200, "receiptKeep clamps to slider max");
    assert.equal(migrated.autoOpenWorkbench, true);
    assert.equal(migrated.autoTag, true);
  });

  test("migrateSettings preserves unknown ai.* keys for forward compat", async () => {
    const { migrateSettings } = await importShipped("types.ts");
    const migrated = migrateSettings({
      ai: {
        sourcePreference: "",
        defaultModel: "",
        manual: {},
        futureProviderKey: "keep-me",
      },
    });
    assert.equal(
      migrated.ai.futureProviderKey,
      "keep-me",
    );
  });

  test("hasConfiguredProvider detects configured vs empty", async () => {
    const { hasConfiguredProvider, DEFAULT_SETTINGS } = await importShipped("types.ts");
    assert.equal(hasConfiguredProvider(DEFAULT_SETTINGS.ai), false);
    const configured = {
      sourcePreference: "",
      defaultModel: "",
      manual: { ...DEFAULT_SETTINGS.ai.manual, deepseekKey: "sk-test" },
    };
    assert.equal(hasConfiguredProvider(configured), true);
    // Ollama URL counts as configured
    const ollamaConfigured = {
      sourcePreference: "",
      defaultModel: "",
      manual: { ...DEFAULT_SETTINGS.ai.manual, ollamaBaseUrl: "http://127.0.0.1:11434/v1" },
    };
    assert.equal(hasConfiguredProvider(ollamaConfigured), true);
  });

  test("getProviderKey returns correct key for each provider", async () => {
    const { getProviderKey, DEFAULT_SETTINGS } = await importShipped("types.ts");
    const manual = { ...DEFAULT_SETTINGS.ai.manual, openAiKey: "sk-oai", deepseekKey: "sk-ds" };
    assert.equal(getProviderKey("openai", manual), "sk-oai");
    assert.equal(getProviderKey("deepseek", manual), "sk-ds");
    assert.equal(getProviderKey("anthropic", manual), "");
    assert.equal(getProviderKey("ollama", manual), "ollama"); // sentinel
  });
});

// ── AI provider transient error detection (shipped pure util) ──────────────

describe("AI task manager + chat write-gate hygiene (source)", () => {
  test("ai-task-manager is a serial queue with honest stop-tracking abort", () => {
    const src = fs.readFileSync(path.join(srcDir, "services", "ai-task-manager.ts"), "utf8");
    assert.match(src, /if \(this\.active\) return/);
    // Abort = stop-tracking: task marked aborted immediately, late result discarded
    assert.match(src, /task\.status = "aborted"/);
    assert.match(src, /abortedMidFlight/);
    // No AbortSignal plumbing — Obsidian requestUrl cannot cancel mid-flight,
    // so the UI must never imply engine-level cancellation.
    assert.doesNotMatch(src, /AbortController/);
    assert.match(src, /subscribe\(fn: TaskListener\)/);
    assert.match(src, /multiActive/);
  });

  test("chat UI chrome follows getLocale; durable answer uses Kernel 3-tier", () => {
    const src = fs.readFileSync(path.join(srcDir, "services", "kernel-service.ts"), "utf8");
    const ops = fs.readFileSync(path.join(srcDir, "services", "kernel-workspace-ops.ts"), "utf8");
    assert.match(src, /getLocale\(\)/);
    assert.match(src, /localeOverride \|\| getLocale/);
    assert.match(src, /resolveChatDurableLocale/);
    assert.match(src, /surfaceUiLocale/);
    assert.match(ops, /resolveAgentOutputLanguage/);
    assert.match(ops, /用户可见回答语言|User-visible answer language/);
  });

  test("chat sanitizes thinking and does not write notes", () => {
    const src = fs.readFileSync(path.join(srcDir, "services", "kernel-service.ts"), "utf8");
    const ops = fs.readFileSync(path.join(srcDir, "services", "kernel-workspace-ops.ts"), "utf8");
    assert.match(src, /runWorkspaceChatTurn/);
    assert.match(src, /<think>/);
    assert.match(ops, /splitAssistantVisible|applyUniqueSpan/);
    assert.doesNotMatch(src, /executeWrite\(\s*\{[\s\S]{0,200}operation:\s*["']chat["']/u);
    assert.doesNotMatch(ops, /executeWrite\(\s*\{[\s\S]{0,200}operation:\s*["']chat["']/u);
  });
});

describe("isTransientError (shipped)", () => {
  test("classifies network/timeout vs client errors", async () => {
    const { isTransientError } = await importShipped("utils.ts");
    assert.ok(isTransientError(new TypeError("fetch failed")));
    assert.ok(isTransientError(new Error("Request timeout")));
    assert.ok(isTransientError(new Error("The operation was aborted")));
    assert.ok(!isTransientError(new Error("AI request failed (400): bad request")));
    assert.ok(!isTransientError(null));
    assert.ok(!isTransientError(undefined));
  });
});

// ── Build output verification ─────────────────────────────────────────────

describe("build output", () => {
  test("dist/main.js exists and is non-trivial", () => {
    const mainPath = path.join(__dirname, "..", "dist", "main.js");
    assert.ok(fs.existsSync(mainPath), "dist/main.js not found — run build first");
    const stat = fs.statSync(mainPath);
    assert.ok(stat.size > 10000, `main.js too small: ${stat.size} bytes`);
  });

  test("dist/manifest.json exists and has correct id", () => {
    const manifestPath = path.join(__dirname, "..", "dist", "manifest.json");
    assert.ok(fs.existsSync(manifestPath), "dist/manifest.json not found");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    assert.equal(manifest.id, "topmind-stream");
    assert.ok(manifest.version, "manifest missing version");
    assert.equal(manifest.isDesktopOnly, true);
    assert.ok(manifest.minAppVersion, "manifest missing minAppVersion");
  });

  test("dist/templates/ has template files", () => {
    const templatesDir = path.join(__dirname, "..", "dist", "templates");
    assert.ok(fs.existsSync(templatesDir), "templates dir not found");
    const files = fs.readdirSync(templatesDir).filter((f) => f.endsWith(".json"));
    assert.ok(files.length >= 4, `Expected at least 4 template files, got ${files.length}`);
  });

  test("dist/styles.css is scoped (no bare :root pollution)", () => {
    const cssPath = path.join(__dirname, "..", "dist", "styles.css");
    assert.ok(fs.existsSync(cssPath), "styles.css missing");
    const css = fs.readFileSync(cssPath, "utf-8");
    // Plugin may define vars under .tm-* scopes only
    const bareRoot = /^\s*:root\s*\{/mu.test(css);
    assert.equal(bareRoot, false, "styles.css must not pollute global :root");
    assert.ok(css.includes("--background-primary") || css.includes("var(--"), "should use Obsidian CSS variables");
  });

  test("source has no default hotkeys on commands", () => {
    const mainSrc = fs.readFileSync(path.join(srcDir, "main.ts"), "utf-8");
    assert.ok(!mainSrc.includes("hotkeys:"), "commands must not set default hotkeys");
  });

  test("LICENSE present", () => {
    assert.ok(
      fs.existsSync(path.join(__dirname, "..", "LICENSE")),
      "LICENSE required for community plugin guidelines",
    );
  });
});

// ── Write-path contract (structural — ops module + service wire-up) ────────

describe("write-path contract (structural)", () => {
  const serviceSrc = fs.readFileSync(
    path.join(srcDir, "services", "kernel-service.ts"),
    "utf-8",
  );
  const opsSrc = fs.readFileSync(
    path.join(srcDir, "services", "kernel-workspace-ops.ts"),
    "utf-8",
  );
  const loaderSrc = fs.readFileSync(
    path.join(srcDir, "bridge", "kernel-loader.ts"),
    "utf-8",
  );

  test("ops use periodRelPath + appendToPeriodBody + executeWrite", () => {
    assert.ok(opsSrc.includes("periodRelPath"), "must use Kernel periodRelPath");
    assert.ok(opsSrc.includes("periodAbsPath"), "must use Kernel periodAbsPath");
    assert.ok(opsSrc.includes("appendToPeriodBody"));
    assert.ok(opsSrc.includes("executeWrite"));
    assert.ok(!opsSrc.includes("streamTarget.relPath"), "must not invent .relPath");
  });

  test("listStreamPeriods is awaited with options object", () => {
    assert.ok(opsSrc.includes("await kernel.listStreamPeriods"));
    assert.ok(opsSrc.includes("workspaceRoot"));
    assert.ok(!opsSrc.includes("listStreamPeriods(workspaceRoot,"));
  });

  test("reconcilePeriodBody is positional (body, opts) and uses .changed", () => {
    assert.ok(opsSrc.includes("reconcilePeriodBody(body,"));
    assert.ok(opsSrc.includes("result.changed"));
    assert.ok(!opsSrc.includes("result.reconciled"));
  });

  test("KernelService delegates to pure ops + mapApplySuggestionResult", () => {
    assert.ok(serviceSrc.includes("captureToWorkspace"));
    assert.ok(serviceSrc.includes("listStreamPeriodsForWorkspace"));
    assert.ok(serviceSrc.includes("reconcilePeriodNote"));
    assert.ok(serviceSrc.includes("mapApplySuggestionResult"));
    assert.ok(serviceSrc.includes("toggleTodoItem"));
    assert.ok(serviceSrc.includes("runOperation"));
    assert.ok(opsSrc.includes("createInboxNoteInWorkspace"));
    assert.ok(opsSrc.includes("acceptPendingWrite"));
    assert.ok(serviceSrc.includes("createInboxNoteInWorkspace"));
    assert.ok(serviceSrc.includes("acceptPendingWrite"));
  });

  test("KernelApi types document real Kernel shapes", () => {
    assert.ok(loaderSrc.includes("periodRelPath"));
    assert.ok(loaderSrc.includes("Promise<ListedStreamPeriod[]>"));
    assert.ok(loaderSrc.includes("changed: boolean"));
    assert.ok(loaderSrc.includes("reconcilePeriodBody("));
  });

  test("stream workbench new-note goes through Kernel writeback", () => {
    const workbench = fs.readFileSync(
      path.join(srcDir, "views", "stream-workbench-view.ts"),
      "utf-8",
    );
    assert.match(workbench, /createInboxNote\(\)/);
    assert.doesNotMatch(workbench, /adapter\.write/);
  });
});

describe("pending-writes queue (shipped)", () => {
  test("stash / list / take / reject / restore", async () => {
    const pw = await importShipped("services/pending-writes.ts");
    pw.clearPendingWrites();
    const e = pw.stashPendingWrite({
      relativePath: "20-专题/a.md",
      content: "hello",
      toolName: "edit_file",
    });
    assert.equal(pw.listPendingWrites().length, 1);
    assert.equal(pw.listPendingWrites()[0].id, e.id);
    assert.equal(pw.listPendingWrites()[0].relativePath, "20-专题/a.md");
    assert.equal(pw.rejectPendingWrite("missing"), false);
    const taken = pw.takePendingWrite(e.id);
    assert.equal(taken?.content, "hello");
    assert.equal(pw.listPendingWrites().length, 0);
    pw.restorePendingWrite(taken);
    assert.equal(pw.listPendingWrites().length, 1);
    assert.equal(pw.rejectPendingWrite(e.id), true);
    assert.equal(pw.listPendingWrites().length, 0);
  });
});
