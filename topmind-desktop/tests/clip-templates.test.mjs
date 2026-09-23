import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyArticleTemplate,
  pickTemplate,
  matchUrlPattern,
} from "../electron/lib/clip-templates.mjs";

test("pickTemplate matches zhihu domain", () => {
  const t = pickTemplate("https://www.zhihu.com/question/123");
  assert.equal(t.id, "zhihu");
});

test("matchUrlPattern supports wildcards", () => {
  assert.equal(matchUrlPattern("*://github.com/*/*", "https://github.com/a/b"), true);
  assert.equal(matchUrlPattern("*://github.com/*/*", "https://example.com"), false);
});

test("applyArticleTemplate injects content into body", () => {
  const r = applyArticleTemplate(
    "## Hello\n\nWorld body text here.",
    { title: "Hello", source: "https://ex.com", method: "readability" },
    { templateId: "article" },
  );
  assert.equal(r.templateId, "article");
  assert.match(r.content, /Hello/);
  assert.match(r.content, /World body/);
  assert.equal(r.properties.source, "https://ex.com");
});
