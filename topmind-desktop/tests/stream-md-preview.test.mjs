/**
 * Stream card Markdown preview — real shipped transform (export-markdown fragment).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  streamMarkdownToPreviewHtml,
  stripHtmlCommentsForPreview,
  prepareStreamMarkdown,
  prefersMarkdownPreview,
  stripListChromeForDisplay,
} from "../src/lib/stream-md-preview.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("streamMarkdownToPreviewHtml renders headings lists links code via shipped converter", () => {
  const html = streamMarkdownToPreviewHtml(
    [
      "# Title",
      "",
      "- item a",
      "- item b",
      "",
      "See [docs](https://example.com) and **bold** with `code`.",
      "",
      "```js",
      "const x = 1;",
      "```",
      "",
      "> quote line",
      "",
      "- [ ] open task",
      "- [x] done task",
      "",
      "#### 续 · 2026-08-03（对「原条」）",
      "",
      "follow-up body",
    ].join("\n"),
  );
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<li>item a<\/li>/);
  assert.match(html, /<a href="https:\/\/example\.com"/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<pre><code class="language-js">/);
  assert.match(html, /const x = 1;/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /task-list/);
  assert.match(html, /data-checked="false"/);
  assert.match(html, /data-checked="true"/);
  assert.match(html, /stream-append-heading|续 · 2026-08-03/);
  // Must not leave raw unescaped script tags from user input
  const evil = streamMarkdownToPreviewHtml("<script>alert(1)</script>\n\n**ok**");
  assert.doesNotMatch(evil, /<script>/i);
  assert.match(evil, /&lt;script&gt;/);
  assert.match(evil, /<strong>ok<\/strong>/);
});

test("streamMarkdownToPreviewHtml blocks javascript:/data: hrefs (XSS)", () => {
  const html = streamMarkdownToPreviewHtml(
    [
      "[click me](javascript:alert(1))",
      "",
      "[data](data:text/html,<script>x</script>)",
      "",
      "[ok](https://example.com/safe)",
      "",
      "![x](javascript:alert(1))",
    ].join("\n"),
  );
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /href=["']data:/i);
  assert.doesNotMatch(html, /src=["']javascript:/i);
  assert.match(html, /href="https:\/\/example\.com\/safe"/);
  // unsafe link becomes plain text label, not an anchor
  assert.match(html, /click me/);
});

test("streamMarkdownToPreviewHtml blocks entity-obfuscated javascript: hrefs", () => {
  // Skeptic vectors: numeric entity + named &colon;
  const html = streamMarkdownToPreviewHtml(
    [
      "[x](&#106;avascript:alert(1))",
      "",
      "[y](javascript&colon;alert(1))",
      "",
      "[z](&#x6A;avascript:void(0))",
      "",
      "![img](&#106;avascript:alert(1))",
      "",
      "[safe](https://example.com/ok)",
    ].join("\n"),
  );
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /href=["'][^"']*alert/i);
  assert.doesNotMatch(html, /src=["']/i);
  // No anchor with non-http(s) href for these labels
  assert.doesNotMatch(html, /<a href="(?!https?:)/i);
  assert.match(html, /href="https:\/\/example\.com\/ok"/);
});

test("stripHtmlCommentsForPreview removes topmind append markers", () => {
  const md = [
    "- note body",
    '<!-- topmind:append parent="20-专题/x" heading="h" at="2026-08-03T00:00:00.000Z" -->',
    "#### 续 · more",
  ].join("\n");
  const cleaned = stripHtmlCommentsForPreview(md);
  assert.doesNotMatch(cleaned, /topmind:append/);
  assert.match(cleaned, /note body/);
  assert.match(cleaned, /续/);
  const html = streamMarkdownToPreviewHtml(md);
  assert.doesNotMatch(html, /topmind:append/);
});

test("prepareStreamMarkdown collapses blank lines and never throws on empty", () => {
  assert.equal(prepareStreamMarkdown(""), "");
  assert.equal(prepareStreamMarkdown("a\n\n\n\nb"), "a\n\nb");
  assert.equal(streamMarkdownToPreviewHtml(""), "");
});

test("prepareStreamMarkdown compresses blank lines before list items (no extra spacing)", () => {
  // Blank lines before list items are compressed (\n\n+ → \n) to prevent extra paragraph spacing.
  // Consecutive list items still render as a single <ul> (no split into separate lists).
  const prepared = prepareStreamMarkdown("- item a\n\n- item b\n\n- item c");
  assert.equal(prepared, "- item a\n- item b\n- item c");
  const html = streamMarkdownToPreviewHtml(prepared);
  // One list, not three separate <ul>s
  const ulCount = (html.match(/<ul>/g) || []).length;
  assert.equal(ulCount, 1);
  assert.match(html, /<li>item a<\/li>/);
  assert.match(html, /<li>item c<\/li>/);
});

test("prepareStreamMarkdown keeps paragraph separation and task markers", () => {
  const md = [
    "# Title",
    "",
    "",
    "Para one.",
    "",
    "",
    "Para two.",
    "",
    "- [ ] open",
    "",
    "- [x] done",
  ].join("\n");
  const prepared = prepareStreamMarkdown(md);
  assert.doesNotMatch(prepared, /\n{3,}/);
  assert.match(prepared, /Para one\.\n\nPara two\./);
  const html = streamMarkdownToPreviewHtml(md);
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<p>Para one\.<\/p>/);
  assert.match(html, /task-list/);
  assert.match(html, /data-checked="false"/);
  assert.match(html, /data-checked="true"/);
});

test("prepareStreamMarkdown unescapes task boxes for real checkboxes", () => {
  const html = streamMarkdownToPreviewHtml("- \\[ \\] open\n- \\[x\\] done");
  assert.match(html, /task-list/);
  assert.match(html, /data-checked="false"/);
  assert.match(html, /data-checked="true"/);
  assert.doesNotMatch(html, /\\\[/);
});

test("splitStreamPreviewParts separates main from #### 续", async () => {
  const { splitStreamPreviewParts, stripListChromeForDisplay } = await import(
    "../src/lib/stream-md-preview.ts"
  );
  const parts = splitStreamPreviewParts(
    [
      "- 10:00 note",
      "",
      "#### 续 · 2026-08-03",
      "",
      "follow body",
    ].join("\n"),
  );
  assert.match(parts.main, /10:00 note/);
  assert.equal(parts.appends.length, 1);
  assert.match(parts.appends[0].title, /续/);
  assert.match(parts.appends[0].body, /follow body/);

  // Time moves to card chip — body should not repeat HH:MM
  assert.equal(stripListChromeForDisplay("- 10:00 hello world"), "hello world");
  // Multi-line moment: only first-line chrome goes; remaining prose stays
  assert.equal(
    stripListChromeForDisplay("- 10:00 hello world\n\nsecond paragraph"),
    "hello world\n\nsecond paragraph",
  );
  const nested = stripListChromeForDisplay("- 10:00 parent\n  - child a\n  - child b");
  assert.match(nested, /^- parent/m);
  assert.doesNotMatch(nested, /10:00/);
  assert.match(nested, /child a/);
  const nestedHtml = streamMarkdownToPreviewHtml(nested);
  assert.match(nestedHtml, /<li>parent/);
  assert.match(nestedHtml, /<li>child a/);
  // Task checkboxes kept for real MD task-list render
  assert.match(stripListChromeForDisplay("- [ ] open task"), /\[ \]/);
  assert.match(streamMarkdownToPreviewHtml(stripListChromeForDisplay("- [ ] open task")), /task-list/);
});

test("StreamMdBody always strips first-line list/time chrome (not only single-line cards)", () => {
  const view = readFileSync(
    path.join(root, "src/plugins/topmind-workspace/views/StreamDetailView.tsx"),
    "utf8",
  );
  const body = view.slice(view.indexOf("function StreamMdBody"));
  assert.match(body, /stripListChromeForDisplay\(parts\.main\)/);
  assert.doesNotMatch(body, /lines\.length === 1 && \/\^\\s\*\[-\*\+\]/);
});

test("wrapped prose preview uses paragraphs, not one <li> per newline", async () => {
  const { parsePeriodNote } = await import("../src/lib/stream-period-parse.ts");
  const md = [
    "## 08-03 周一",
    "",
    "This is a long paragraph that wraps",
    "across several lines because the author",
    "hit enter without using list markers.",
  ].join("\n");
  const entries = parsePeriodNote(md);
  assert.equal(entries.length, 1);
  const html = streamMarkdownToPreviewHtml(stripListChromeForDisplay(entries[0].body));
  assert.match(html, /<p>/);
  assert.doesNotMatch(html, /<li>/);
  const liCount = (html.match(/<li>/g) || []).length;
  assert.equal(liCount, 0);
});

test("moment plus extra paragraph previews as two paragraph blocks", async () => {
  const { parsePeriodNote } = await import("../src/lib/stream-period-parse.ts");
  const md = ["## 08-03 周一", "", "- 10:00 lead", "", "second paragraph"].join("\n");
  const entries = parsePeriodNote(md);
  assert.equal(entries.length, 1);
  const prepared = stripListChromeForDisplay(entries[0].body);
  assert.match(prepared, /lead/);
  assert.match(prepared, /second paragraph/);
  const html = streamMarkdownToPreviewHtml(prepared);
  const pCount = (html.match(/<p>/g) || []).length;
  assert.ok(pCount >= 2, `expected two <p> blocks, got ${pCount}: ${html}`);
  assert.match(html, /<p>lead<\/p>/);
  assert.match(html, /<p>second paragraph<\/p>/);
});

test("real list in a prose body still produces list HTML", async () => {
  const { parsePeriodNote } = await import("../src/lib/stream-period-parse.ts");
  const md = [
    "## 08-03 周一",
    "",
    "Notes for today:",
    "",
    "- item alpha",
    "- item beta",
    "",
    "1. first numbered",
    "2. second numbered",
  ].join("\n");
  const entries = parsePeriodNote(md);
  assert.equal(entries.length, 1);
  const html = streamMarkdownToPreviewHtml(entries[0].body);
  assert.match(html, /<ul>/);
  assert.match(html, /<li>item alpha<\/li>/);
  assert.match(html, /<ol>/);
  assert.match(html, /<li>first numbered<\/li>/);
});

test("prefersMarkdownPreview detects structure", () => {
  assert.equal(prefersMarkdownPreview(""), false);
  assert.equal(prefersMarkdownPreview("plain one liner"), false);
  assert.equal(prefersMarkdownPreview("- list item"), true);
  assert.equal(prefersMarkdownPreview("see **bold**"), true);
  assert.equal(prefersMarkdownPreview("line1\nline2"), true);
});

test("StreamDetailView wires stream-md-preview (not pre-only body)", () => {
  const view = readFileSync(
    path.join(root, "src/plugins/topmind-workspace/views/StreamDetailView.tsx"),
    "utf8",
  );
  assert.match(view, /streamMarkdownToPreviewHtml|stream-md-preview/);
  assert.match(view, /splitStreamPreviewParts|StreamMdBody/);
  assert.match(view, /data-stream-md-preview|v4-stream-md/);
  assert.doesNotMatch(
    view,
    /<pre className="whitespace-pre-wrap font-sans">\{entry\.rest\}<\/pre>/,
  );
  // Cards are not whole-article click-to-open (text selection friendly)
  assert.doesNotMatch(view, /role="button"[\s\S]{0,40}data-stream-entry-card/u);
});
