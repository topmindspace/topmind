import test from "node:test";
import assert from "node:assert/strict";

import {
  parseFrontmatter,
  replaceFrontmatterBody,
  setFrontmatterField,
  stringifyFrontmatter,
  touchUpdatedFrontmatter,
} from "../../core/frontmatter.mjs";

test("parseFrontmatter handles leading blank lines and simple YAML pairs", () => {
  const parsed = parseFrontmatter("\n\n---\ntitle: Demo\nlocked: true\nsource_type: user-original\n---\n# Demo\n");

  assert.deepEqual(parsed.data, {
    title: "Demo",
    locked: "true",
    source_type: "user-original",
  });
  assert.equal(parsed.body, "# Demo\n");
  assert.equal(parsed.leading, "\n\n");
});

test("stringifyFrontmatter preserves body and writes stable key order", () => {
  const text = stringifyFrontmatter({
    data: { title: "Demo", source_type: "ai-derived" },
    body: "# Demo\nBody\n",
  });

  assert.equal(text, "---\ntitle: Demo\nsource_type: ai-derived\n---\n# Demo\nBody\n");
});

test("setFrontmatterField updates existing fields and creates frontmatter when absent", () => {
  const updated = setFrontmatterField("---\ntitle: Old\n---\n# Body\n", "title", "New");
  assert.equal(updated, "---\ntitle: New\n---\n# Body\n");

  const created = setFrontmatterField("# Body\n", "source_type", "user-original");
  assert.equal(created, "---\nsource_type: user-original\n---\n# Body\n");
});

test("touchUpdatedFrontmatter updates existing timestamp or appends updated_at", () => {
  const touched = touchUpdatedFrontmatter("---\ntitle: Demo\n---\n# Body\n", "2026-06-13T00:00:00Z");
  assert.equal(touched, "---\ntitle: Demo\nupdated_at: 2026-06-13T00:00:00Z\n---\n# Body\n");

  const replaced = touchUpdatedFrontmatter("---\nupdated: old\n---\n# Body\n", "2026-06-13T00:00:00Z");
  assert.equal(replaced, "---\nupdated: 2026-06-13T00:00:00Z\n---\n# Body\n");
});

test("nested YAML, arrays, comments and body survive targeted field edits", () => {
  const source = [
    "---",
    "# keep this comment",
    "title: 'Old # title' # title comment",
    "creation_id: 1f59ea30-226f-41c2-8891-71c237dc4462",
    "creation_target:",
    "  platform: x",
    "  format: article",
    "tags:",
    "  - writing",
    "  - research",
    "updated_at: old # clock comment",
    "---",
    "# Body",
    "",
    "Text with --- and # signs.",
    "",
  ].join("\n");
  const parsed = parseFrontmatter(source);
  assert.deepEqual(parsed.data.creation_target, { platform: "x", format: "article" });
  assert.deepEqual(parsed.data.tags, ["writing", "research"]);
  const touched = touchUpdatedFrontmatter(source, "2026-10-28T00:00:00Z");
  assert.equal(touched, source.replace("updated_at: old # clock comment", "updated_at: 2026-10-28T00:00:00Z # clock comment"));
  const renamed = setFrontmatterField(touched, "title", "New # title");
  assert.equal(renamed, touched.replace("title: 'Old # title' # title comment", 'title: "New # title" # title comment'));
  assert.deepEqual(parseFrontmatter(renamed).data.tags, ["writing", "research"]);
  assert.equal(parseFrontmatter(renamed).body, parsed.body);
});

test("stringifyFrontmatter keeps nested structures and rejects damaged YAML", () => {
  const source = stringifyFrontmatter({
    data: { title: "Example", creation_target: { platform: "x", format: "article" }, tags: ["a", "b"] },
    body: "Body\n",
  });
  assert.deepEqual(parseFrontmatter(source).data.creation_target, { platform: "x", format: "article" });
  assert.deepEqual(parseFrontmatter(source).data.tags, ["a", "b"]);
  assert.throws(() => touchUpdatedFrontmatter("---\ntitle: [broken\n---\nBody", "2026-10-28T00:00:00Z"));
  assert.throws(() => setFrontmatterField("---\ntitle: broken\nBody", "title", "New"));
  assert.throws(() => setFrontmatterField("---\ncreation_target:\n  platform: x\n---\nBody", "creation_target", "other"));
  assert.throws(() => touchUpdatedFrontmatter("---\nupdated_at: >-\n  old timestamp\n---\nBody", "2026-10-28T00:00:00Z"));
});

test("targeted edit preserves BOM, CRLF and comments", () => {
  const source = "\ufeff---\r\ntitle: Demo\r\n# keep\r\nupdated_at: old\r\n---\r\n\r\nBody\r\n";
  const touched = touchUpdatedFrontmatter(source, "2026-10-28T00:00:00Z");
  assert.equal(touched, source.replace("updated_at: old", "updated_at: 2026-10-28T00:00:00Z"));
  const replacedBody = replaceFrontmatterBody(touched, "\r\nNew body\r\n");
  assert.equal(replacedBody, touched.slice(0, parseFrontmatter(touched).bodyStart) + "\r\nNew body\r\n");
  assert.throws(() => replaceFrontmatterBody("# No frontmatter", "new"));
});
