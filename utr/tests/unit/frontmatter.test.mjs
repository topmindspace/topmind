import test from "node:test";
import assert from "node:assert/strict";

import {
  parseFrontmatter,
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
