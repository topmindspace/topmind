/**
 * Client frontmatter split/join for editor body isolation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitMarkdownFile,
  joinMarkdownFile,
  stripFrontmatter,
} from "../src/lib/md-frontmatter.ts";

test("splitMarkdownFile extracts YAML block and body", () => {
  const raw = `---
title: Hello
status: 草稿
---

# Body

paragraph
`;
  const { frontmatterBlock, body } = splitMarkdownFile(raw);
  assert.ok(frontmatterBlock?.startsWith("---"));
  assert.match(frontmatterBlock || "", /title: Hello/);
  assert.match(body, /^# Body/m);
  assert.doesNotMatch(body, /^---/);
});

test("joinMarkdownFile preserves frontmatter and body", () => {
  const fm = "---\ntitle: T\n---\n";
  const body = "# Hi\n\nworld\n";
  const full = joinMarkdownFile(fm, body);
  assert.equal(splitMarkdownFile(full).body.replace(/^\n+/, ""), body.replace(/^\n+/, ""));
  assert.match(full, /title: T/);
  assert.match(full, /# Hi/);
});

test("joinMarkdownFile without frontmatter returns body", () => {
  assert.equal(joinMarkdownFile(null, "plain"), "plain");
});

test("stripFrontmatter removes YAML fence", () => {
  const raw = "---\na: 1\n---\n\nhello";
  assert.equal(stripFrontmatter(raw).trim(), "hello");
});
