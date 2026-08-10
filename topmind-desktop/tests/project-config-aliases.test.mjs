/**
 * Desktop config loaders project clean v4 nested keys → flat aliases (in-memory).
 * Kernel loadContract() no longer injects aliases; validateContract stays clean.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { projectConfigAliases } from "../electron/lib/workspace-home.mjs";

test("projectConfigAliases maps v4 nested workspace/categories to flat keys", () => {
  const projected = projectConfigAliases({
    contract_version: 4,
    workspace: {
      template: "research",
      category_separator: " ",
      locale: "en-US",
    },
    categories: {
      extensions: { "25": { name: "写作", role: "deep-work" } },
      overrides: { "10": { role: "loose-stream" } },
    },
  });
  assert.equal(projected.template, "research");
  assert.equal(projected.categorySeparator, " ");
  assert.equal(projected.locale, "en-US");
  assert.deepEqual(projected.categoryExtensions, { "25": { name: "写作", role: "deep-work" } });
  assert.deepEqual(projected.categoryOverrides, { "10": { role: "loose-stream" } });
  // Nested structure preserved
  assert.equal(projected.workspace.template, "research");
  assert.equal(projected.categories.extensions["25"].name, "写作");
});

test("projectConfigAliases does not overwrite existing flat aliases", () => {
  const projected = projectConfigAliases({
    template: "stream",
    categorySeparator: "-",
    workspace: { template: "research", category_separator: " " },
  });
  assert.equal(projected.template, "stream");
  assert.equal(projected.categorySeparator, "-");
});

test("projectConfigAliases is pure and handles empty/null", () => {
  assert.deepEqual(projectConfigAliases(null), {});
  assert.deepEqual(projectConfigAliases(undefined), {});
  assert.deepEqual(projectConfigAliases([]), {});
  const raw = { workspace: { template: "balanced" } };
  const a = projectConfigAliases(raw);
  assert.equal(a.template, "balanced");
  assert.equal(raw.template, undefined, "must not mutate input");
});
