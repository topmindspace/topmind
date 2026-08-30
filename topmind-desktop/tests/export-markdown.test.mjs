/**
 * Markdown → HTML export helpers (写出来 shelf).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stripFrontmatterForExport,
  markdownToHtmlFragment,
  markdownBodyToHtmlDocument,
  exportBasenameFromPath,
} from "../src/lib/export-markdown.ts";

test("stripFrontmatterForExport peels title and published_at", () => {
  const raw = `---
title: Hello
published_at: 2026-07-20T00:00:00.000Z
---

# Body

para
`;
  const { body, title, publishedAt } = stripFrontmatterForExport(raw);
  assert.equal(title, "Hello");
  assert.equal(publishedAt, "2026-07-20T00:00:00.000Z");
  assert.match(body.trimStart(), /^# Body/u);
  assert.doesNotMatch(body, /^---/u);
});

test("markdownToHtmlFragment renders headings lists code links", () => {
  const html = markdownToHtmlFragment(
    [
      "# Title",
      "",
      "- a",
      "- b",
      "",
      "```js",
      "const x = 1;",
      "```",
      "",
      "See [docs](https://example.com) and **bold**.",
    ].join("\n"),
  );
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<li>a<\/li>/);
  assert.match(html, /<pre><code class="language-js">/);
  assert.match(html, /const x = 1;/);
  assert.match(html, /<a href="https:\/\/example.com"[^>]*>docs<\/a>/);
  assert.match(html, /<strong>bold<\/strong>/);
});

test("markdownToHtmlFragment nests indented list items under the parent", () => {
  const html = markdownToHtmlFragment(
    ["- parent", "  - child a", "  - child b", "- sibling"].join("\n"),
  );
  assert.match(html, /<ul>/);
  assert.match(html, /<li>parent/);
  assert.match(html, /<li>child a/);
  assert.match(html, /<li>sibling/);
  const parentAt = html.indexOf("<li>parent");
  const nestedUl = html.indexOf("<ul>", parentAt + 1);
  const childAt = html.indexOf("<li>child a");
  assert.ok(nestedUl > parentAt && nestedUl < childAt, "child list must nest inside parent li");
});

test("markdownToHtmlFragment rejects javascript: and data: href schemes", async () => {
  const { sanitizePreviewUrl, decodeHtmlEntitiesForUrl } = await import(
    "../src/lib/export-markdown.ts"
  );
  assert.equal(sanitizePreviewUrl("javascript:alert(1)"), null);
  assert.equal(sanitizePreviewUrl("data:text/html,x"), null);
  assert.equal(sanitizePreviewUrl("https://ok.example"), "https://ok.example");
  assert.equal(sanitizePreviewUrl("#anchor"), "#anchor");
  assert.equal(sanitizePreviewUrl("20-专题/note.md"), "20-专题/note.md");
  // Entity-obfuscated schemes must decode then die
  assert.equal(decodeHtmlEntitiesForUrl("&#106;avascript:alert(1)"), "javascript:alert(1)");
  assert.equal(decodeHtmlEntitiesForUrl("javascript&colon;alert(1)"), "javascript:alert(1)");
  assert.equal(sanitizePreviewUrl("&#106;avascript:alert(1)"), null);
  assert.equal(sanitizePreviewUrl("javascript&colon;alert(1)"), null);
  assert.equal(sanitizePreviewUrl("&amp;#106;avascript:alert(1)"), null);
  assert.equal(sanitizePreviewUrl("&#x6a;avascript:alert(1)"), null);
  const html = markdownToHtmlFragment("[x](javascript:alert(1))\n\n[y](https://ok.test)");
  assert.doesNotMatch(html, /javascript:/i);
  assert.match(html, /href="https:\/\/ok\.test"/);
  // Full path: escapeHtml → sanitize — entity vectors must not yield <a href>/<img src>
  const entityHtml = markdownToHtmlFragment(
    [
      "[x](&#106;avascript:alert(1))",
      "",
      "[y](javascript&colon;alert(1))",
      "",
      "![z](&#106;avascript:alert(1))",
      "",
      "[ok](https://example.com/safe)",
    ].join("\n"),
  );
  assert.doesNotMatch(entityHtml, /javascript:/i);
  assert.doesNotMatch(entityHtml, /href=["'][^"']*alert/i);
  assert.doesNotMatch(entityHtml, /src=["']/i);
  assert.doesNotMatch(entityHtml, /<a href=["'](?!https?:)/i);
  assert.match(entityHtml, /href="https:\/\/example\.com\/safe"/);
});

test("markdownBodyToHtmlDocument is standalone and escapes title", () => {
  const doc = markdownBodyToHtmlDocument("Hello **world**", {
    title: 'A <script> title',
    sourcePath: "88-输出/note.md",
  });
  assert.match(doc, /<!DOCTYPE html>/);
  assert.match(doc, /A &lt;script&gt; title/);
  assert.match(doc, /88-输出\/note\.md/);
  assert.match(doc, /<strong>world<\/strong>/);
});

test("exportBasenameFromPath swaps extension", () => {
  assert.equal(exportBasenameFromPath("88-输出/2026-note.md", "html"), "2026-note.html");
  assert.equal(exportBasenameFromPath("foo.md", "md"), "foo.md");
});
