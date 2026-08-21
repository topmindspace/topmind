/**
 * Non-markdown FilePreviewView — shipped helpers + wiring.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extOf,
  isHtmlPreviewExt,
  isPreviewableText,
  truncatePreviewContent,
  HTML_PREVIEW_MAX_BYTES,
  TEXT_PREVIEW_MAX_CHARS,
} from "../src/lib/file-preview.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("extOf / html / text routing", () => {
  assert.equal(extOf("88-输出/a.html"), "html");
  assert.equal(extOf("note.HTM"), "htm");
  assert.equal(extOf("bin/photo.png"), "png");
  assert.equal(extOf("Makefile"), "");
  assert.equal(isHtmlPreviewExt("html"), true);
  assert.equal(isHtmlPreviewExt("txt"), false);
  assert.equal(isPreviewableText("json"), true);
  assert.equal(isPreviewableText("png"), false);
  assert.equal(isPreviewableText(""), true);
});

test("truncatePreviewContent is honest about caps", () => {
  const small = truncatePreviewContent("hello", true);
  assert.equal(small.truncated, false);
  assert.equal(small.body, "hello");
  const html = "x".repeat(HTML_PREVIEW_MAX_BYTES + 10);
  const htmlCut = truncatePreviewContent(html, true);
  assert.equal(htmlCut.truncated, true);
  assert.equal(htmlCut.body.length, HTML_PREVIEW_MAX_BYTES);
  const text = "y".repeat(TEXT_PREVIEW_MAX_CHARS + 5);
  const textCut = truncatePreviewContent(text, false);
  assert.equal(textCut.truncated, true);
  assert.equal(textCut.body.length, TEXT_PREVIEW_MAX_CHARS);
});

test("FilePreviewView wires sandbox iframe, truncation, cannot-preview + open-external", () => {
  const view = readFileSync(
    path.join(root, "src/plugins/topmind-workspace/views/FilePreviewView.tsx"),
    "utf8",
  );
  assert.match(view, /truncatePreviewContent/);
  assert.match(view, /sandbox=""/);
  assert.match(view, /cannotPreviewTitle/);
  assert.match(view, /truncated/);
  assert.match(view, /api\.ws\.open\(path\)/);
  const views = readFileSync(
    path.join(root, "src/plugins/topmind-workspace/views.tsx"),
    "utf8",
  );
  assert.match(views, /FilePreviewView/);
  assert.match(views, /fileExt\(sel\.path\) === "md"/);
});
