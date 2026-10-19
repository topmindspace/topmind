import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shouldShowFile,
  normalizeFileFilterMode,
  fileExtension,
  shouldSkipDirName,
} from "../electron/lib/file-filter.mjs";

test("fileExtension extracts lower-case ext", () => {
  assert.equal(fileExtension("a.MD"), "md");
  assert.equal(fileExtension("report.docx"), "docx");
  assert.equal(fileExtension("noext"), "");
});

test("normalizeFileFilterMode", () => {
  assert.equal(normalizeFileFilterMode("all"), "all");
  assert.equal(normalizeFileFilterMode("markdown"), "markdown");
  assert.equal(normalizeFileFilterMode("weird"), "default");
});

test("shouldShowFile default includes notes and office", () => {
  assert.equal(shouldShowFile("note.md", "default"), true);
  assert.equal(shouldShowFile("page.html", "default"), true);
  assert.equal(shouldShowFile("memo.txt", "default"), true);
  assert.equal(shouldShowFile("deck.pptx", "default"), true);
  assert.equal(shouldShowFile("sheet.xlsx", "default"), true);
  assert.equal(shouldShowFile("bin.exe", "default"), false);
});

test("shouldShowFile markdown is strict", () => {
  assert.equal(shouldShowFile("a.md", "markdown"), true);
  assert.equal(shouldShowFile("a.html", "markdown"), false);
  assert.equal(shouldShowFile("a.docx", "markdown"), false);
});

test("shouldSkipDirName hides packages and keeps images", () => {
  assert.equal(shouldSkipDirName("Blender.app"), true);
  assert.equal(shouldSkipDirName("EquationKit.framework"), true);
  assert.equal(shouldSkipDirName("node_modules"), true);
  assert.equal(shouldSkipDirName("images"), false);
  assert.equal(shouldSkipDirName("notes"), false);
});

test("shouldShowFile all allows any", () => {
  assert.equal(shouldShowFile("bin.exe", "all"), true);
  assert.equal(shouldShowFile("x", "all"), true);
});
