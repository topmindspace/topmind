/**
 * Clip payload normalization (extension → Desktop pipeline).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeClipPayload } from "../electron/lib/clip-payload.mjs";

test("normalizeClipPayload keeps plain content and cleans URL", () => {
  const r = normalizeClipPayload({
    title: "T",
    content: "hello world note body here",
    source: "https://ex.com/a?utm_campaign=x&id=1",
    mode: "manual",
  });
  assert.equal(r.content, "hello world note body here");
  assert.equal(r.source, "https://ex.com/a?id=1");
  assert.equal(r.frontmatter.fetch_method, "manual");
});

test("normalizeClipPayload prefers content_html markdown conversion", () => {
  const r = normalizeClipPayload({
    title: "Art",
    content: "short fallback",
    content_html: `<article><h1>Title One</h1><p>Paragraph with enough words for a solid extraction check in the shared converter path.</p><p>More body text continues here with meaningful content for readers.</p></article>`,
    source: "https://blog.example/post",
    mode: "readability",
  });
  assert.match(r.content, /Title One|Paragraph with enough/i);
  assert.doesNotMatch(r.content, /short fallback/);
  assert.equal(r.method, "readability");
  assert.ok(r.frontmatter.word_count > 10);
});

test("normalizeClipPayload selection mode skips html reprocess", () => {
  const sel = "User selected this important sentence about product decisions.";
  const r = normalizeClipPayload({
    content: sel,
    content_html: "<p>Entire page should be ignored</p>",
    selection: sel,
    mode: "selection",
    source: "https://example.com",
  });
  assert.equal(r.content, sel);
  assert.equal(r.method, "selection");
  assert.doesNotMatch(r.content, /Entire page/);
});

test("normalizeClipPayload requires some content", () => {
  const r = normalizeClipPayload({ title: "empty" });
  assert.equal(r.content, "");
});

test("normalizeClipPayload cleans site suffix from title", () => {
  const r = normalizeClipPayload({
    title: "How Systems Thinking Works | Medium",
    content: "A substantial body of text for clip normalization so empty-content checks pass easily.",
    source: "https://medium.com/x",
    site_name: "Medium",
    mode: "manual",
  });
  assert.equal(r.title, "How Systems Thinking Works");
});

test("normalizeClipPayload highlights mode formats blockquotes", () => {
  const r = normalizeClipPayload({
    title: "Page",
    mode: "highlights",
    highlights: ["First mark\nline2", "Second"],
    content: "ignored when highlights present",
    source: "https://ex.com/p",
    template_id: "selection",
    published: "2026-01-01",
  });
  assert.equal(r.method, "highlights");
  assert.match(r.content, /^> First mark/m);
  assert.match(r.content, /> line2/);
  assert.match(r.content, /> Second/);
  assert.equal(r.frontmatter.clip_template, "selection");
  assert.equal(r.frontmatter.published, "2026-01-01");
});
