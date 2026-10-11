/**
 * Unit tests for lib/yaml-writer.mjs escapeYamlString hardening:
 * multi-line folding, trap words, control characters.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeYamlString, buildFrontmatter } from "../lib/yaml-writer.mjs";

test("multi-line values fold to spaces (no multi-line scalars)", () => {
  const out = escapeYamlString("line1\nline2\r\nline3\ttabbed");
  assert.ok(!out.includes("\n"));
  assert.ok(!out.includes("\r"));
  assert.ok(!out.includes("\t"));
  assert.equal(out, "line1 line2 line3 tabbed");
  // When folding introduces a special char, output is quoted
  const quoted = escapeYamlString("line1\nline2: x");
  assert.equal(quoted, '"line1 line2: x"');
});

test("trap words are quoted", () => {
  for (const w of ["true", "false", "null", "yes", "no", "on", "off", "y", "n", "True", "NO", "~"]) {
    const out = escapeYamlString(w);
    assert.ok(out.startsWith('"') && out.endsWith('"'), `${w} -> ${out}`);
  }
});

test("numeric-looking strings are quoted", () => {
  for (const w of ["123", "-4.5", "+7", "3.14", "0x1F", "1e3", ".5", "1_000"]) {
    const out = escapeYamlString(w);
    assert.ok(out.startsWith('"') && out.endsWith('"'), `${w} -> ${out}`);
  }
});

test("plain strings stay unquoted", () => {
  assert.equal(escapeYamlString("hello world"), "hello world");
  assert.equal(escapeYamlString("草稿"), "草稿");
});

test("control characters are stripped", () => {
  const out = escapeYamlString("a\u0000b\u0007c\u001fd");
  assert.ok(!out.includes("\u0000"));
  assert.ok(!out.includes("\u0007"));
  assert.ok(!out.includes("\u001f"));
  assert.equal(out, "abcd");
});

test("null/undefined become empty quoted string", () => {
  assert.equal(escapeYamlString(null), '""');
  assert.equal(escapeYamlString(undefined), '""');
  assert.equal(escapeYamlString("  "), '""');
});

test("quotes and backslashes are escaped inside quoted output", () => {
  assert.equal(escapeYamlString('say "hi"'), '"say \\"hi\\""');
  assert.equal(escapeYamlString("back\\slash"), '"back\\\\slash"');
});

test("buildFrontmatter produces single-line scalar values", () => {
  const fm = buildFrontmatter({ title: "a\nb", status: "true" });
  const lines = fm.split("\n").filter(Boolean);
  assert.deepEqual(lines, ["---", "title: a b", 'status: "true"', "---"]);
});
