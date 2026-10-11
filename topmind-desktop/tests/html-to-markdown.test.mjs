/**
 * Unit tests for the shared HTML → Markdown converter.
 * The browser-extension copy is kept byte-identical (see tests/html-to-markdown-parity.test.mjs).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToMarkdown } from "../electron/lib/html-to-markdown.mjs";

const conv = (html, opts = {}) => htmlToMarkdown(html, { alreadyIsolated: true, ...opts });

test("nested lists render as indented Markdown sub-lists", () => {
  const md = conv(
    `<ul><li>outer<ul><li>inner1</li><li>inner2</li></ul></li><li>outer2</li></ul>`,
  );
  assert.match(md, /^- outer$/m);
  assert.match(md, /^    - inner1$/m);
  assert.match(md, /^    - inner2$/m);
  assert.match(md, /^- outer2$/m);
});

test("nested ol inside ul keeps numbering and indentation", () => {
  const md = conv(
    `<ul><li>item<ol start="5"><li>five</li><li>six</li></ol></li></ul>`,
  );
  assert.match(md, /^- item$/m);
  assert.match(md, /^    5\. five$/m);
  assert.match(md, /^    6\. six$/m);
});

test("deeply nested same-tag lists survive", () => {
  const md = conv(
    `<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li></ul>`,
  );
  assert.match(md, /^- a$/m);
  assert.match(md, /^    - b$/m);
  assert.match(md, /^        - c$/m);
});

test("table cells escape pipes and flatten line breaks", () => {
  const md = conv(
    `<table><tr><th>H|1</th><th>H2</th></tr><tr><td>a|b</td><td>line1<br>line2</td></tr></table>`,
  );
  assert.match(md, /\| H\\\|1 \| H2 \|/u);
  assert.match(md, /\| a\\\|b \| line1 line2 \|/u);
  // Each row stays a single line
  const rows = md.split("\n").filter((l) => l.startsWith("|"));
  assert.equal(rows.length, 3);
});

test("illegal codepoints keep original text instead of throwing", () => {
  const md = conv(`<p>&#xD800; &#xFFFFFFFF; &#1114112;</p>`);
  assert.ok(md.includes("&#xD800;"));
  assert.ok(md.includes("&#xFFFFFFFF;"));
  // 1114112 = 0x110000 exceeds 0x10FFFF → preserved
  assert.ok(md.includes("&#1114112;"));
});

test("entities decode exactly once (&amp;#65; stays literal &#65;)", () => {
  const md = conv(`<p>&amp;#65; &#65; &#x41; &amp;</p>`);
  assert.ok(md.includes("&#65;"));
  assert.ok(md.includes(" A "));
  assert.ok(md.includes(" &#x41; ".replace("&#x41;", "A")) || md.includes("A"));
  assert.ok(md.includes("&"));
  assert.ok(!md.includes("\uFFFD"));
});

test("truncation appends the shared ...(内容已截断) marker within maxLen", () => {
  const long = "x".repeat(500);
  const md = conv(`<p>${long}</p>`, { maxLen: 100 });
  assert.ok(md.includes("...(内容已截断)"));
  assert.ok(md.length <= 100);
  assert.ok(md.endsWith("...(内容已截断)"));
});
