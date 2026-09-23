/**
 * Skills runtime — progressive disclosure for bundled pack.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseSkillMarkdown,
  listSkillCatalog,
  loadSkillBody,
  loadSkillResource,
  getSkillsStatus,
  formatCatalogForPrompt,
  resolveSkillsRoot,
} from "../electron/lib/skills-runtime.mjs";
import { buildSystemPrompt } from "../electron/ai-prompts.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const engineRoot = repoRoot;

test("parseSkillMarkdown extracts folded description", () => {
  const raw = `---
name: topmind-capture
description: >-
  Capture links. Use when the user says capture.
  Do NOT use for write.
action_category: capture
---

# Body

Hello
`;
  const p = parseSkillMarkdown(raw);
  assert.equal(p.name, "topmind-capture");
  assert.match(p.description, /Capture links/);
  assert.match(p.description, /Do NOT/);
  assert.match(p.body, /# Body/);
});

test("listSkillCatalog discovers monorepo skills pack", () => {
  const root = resolveSkillsRoot(engineRoot);
  assert.ok(root.includes("skills"));
  const catalog = listSkillCatalog({ engineRoot });
  assert.ok(catalog.length >= 7, `expected >=7 skills, got ${catalog.length}`);
  const ids = catalog.map((s) => s.id);
  assert.ok(ids.includes("topmind"));
  assert.ok(ids.includes("topmind-capture"));
  for (const s of catalog) {
    assert.ok(s.description.length > 20, s.id);
  }
});

test("loadSkillBody returns activation content", () => {
  const body = loadSkillBody("topmind-capture", { engineRoot });
  assert.equal(body.id, "topmind-capture");
  assert.match(body.raw || body.body || "", /Activation checklist|capture/i);
});

test("loadSkillResource reads shared brief", () => {
  const res = loadSkillResource("shared/project-model-brief.md", { engineRoot });
  assert.match(res.content, /Category|类别|规约/i);
});

test("getSkillsStatus reports pack version", () => {
  const st = getSkillsStatus({ engineRoot });
  assert.ok(st.packVersion);
  assert.ok(st.skillCount >= 7);
  assert.equal(st.hasShared, true);
});

test("system prompt skill-first includes catalog and load_skill protocol", () => {
  const prompt = buildSystemPrompt({
    workspaceContext: { userWorkspaceRoot: "/tmp/ws", engineRoot },
    toolNames: ["list_skills", "load_skill", "list_categories"],
    skillsEnabled: true,
    engineRoot,
  });
  assert.match(prompt, /skill-first|load_skill/i);
  assert.match(prompt, /list_skills|Skills 目录/i);
  assert.match(prompt, /topmind-capture|topmind/);
  assert.match(prompt, /list_categories/);
});

test("formatCatalogForPrompt is compact discovery text", () => {
  const catalog = listSkillCatalog({ engineRoot });
  const text = formatCatalogForPrompt(catalog.slice(0, 3));
  assert.match(text, /`topmind/);
  assert.match(text, /Use when|收进来|路由/i);
  assert.ok(text.length < 5000);
});
