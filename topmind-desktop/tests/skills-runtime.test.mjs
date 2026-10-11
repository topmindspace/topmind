/**
 * Skills runtime — progressive disclosure for bundled pack.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  parseSkillMarkdown,
  resolveSkillMeta,
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

const LEGACY_SKILL = `---
name: topmind-wechat-post
version: 0.3.0
description: "公众号. Use when 公众号排版. Do NOT use for 小红书."
action_category: write
entrypoint: false
triggers:
  - 公众号
  - "微信排版"
tags: [wechat, write]
degradation: ../shared/capability-degradation.md
---

# Legacy body
`;

const SPEC_SKILL = `---
name: topmind-wechat-post
description: "公众号. Use when 公众号排版. Do NOT use for 小红书."
license: MIT
compatibility: topmind workspace
metadata:
  version: "0.3.1"
  action_category: "write"
  entrypoint: "false"
  triggers: "公众号, 微信排版"
  tags: "wechat, write"
  degradation: "../shared/capability-degradation.md"
  author: "TopMindSpace"
---

# Spec body
`;

test("parseSkillMarkdown reads one-level nested metadata map", () => {
  const p = parseSkillMarkdown(SPEC_SKILL);
  assert.equal(p.name, "topmind-wechat-post");
  assert.equal(p.frontmatter.license, "MIT");
  assert.equal(typeof p.frontmatter.metadata, "object");
  assert.equal(p.frontmatter.metadata.version, "0.3.1");
  assert.equal(p.frontmatter.metadata.entrypoint, "false");
  assert.match(p.body, /# Spec body/);
});

test("resolveSkillMeta: legacy top-level and spec metadata parse to the same shape", () => {
  const legacy = resolveSkillMeta(parseSkillMarkdown(LEGACY_SKILL).frontmatter);
  const spec = resolveSkillMeta(parseSkillMarkdown(SPEC_SKILL).frontmatter);
  for (const meta of [legacy, spec]) {
    assert.equal(meta.actionCategory, "write");
    assert.equal(meta.entrypoint, false);
    assert.deepEqual(meta.triggers, ["公众号", "微信排版"]);
    assert.deepEqual(meta.tags, ["wechat", "write"]);
    assert.equal(meta.degradation, "../shared/capability-degradation.md");
  }
  assert.equal(legacy.version, "0.3.0");
  assert.equal(spec.version, "0.3.1");
});

test("resolveSkillMeta: top-level wins over metadata; entrypoint true from bool or string", () => {
  const both = resolveSkillMeta({ action_category: "router", metadata: { action_category: "write", entrypoint: "true" } });
  assert.equal(both.actionCategory, "router");
  assert.equal(both.entrypoint, true);
  assert.equal(resolveSkillMeta({ entrypoint: true }).entrypoint, true);
  assert.equal(resolveSkillMeta({ metadata: { entrypoint: "false" } }).entrypoint, false);
  assert.deepEqual(resolveSkillMeta({ metadata: { triggers: "记账，记一笔、花了" } }).triggers, ["记账", "记一笔", "花了"]);
  assert.deepEqual(resolveSkillMeta({}).triggers, []);
  assert.equal(resolveSkillMeta(null).actionCategory, "");
});

test("listSkillCatalog / loadSkillBody read metadata-only skills from extra roots", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "skills-meta-"));
  try {
    mkdirSync(path.join(dir, "topmind-wechat-post"), { recursive: true });
    writeFileSync(path.join(dir, "topmind-wechat-post", "SKILL.md"), SPEC_SKILL, "utf8");
    const catalog = listSkillCatalog({ engineRoot, extraRoots: [dir] });
    const hit = catalog.find((s) => s.id === "topmind-wechat-post");
    assert.ok(hit, "metadata-only external skill discovered");
    assert.equal(hit.source, "external");
    assert.equal(hit.actionCategory, "write");
    assert.equal(hit.entrypoint, false);
    assert.deepEqual(hit.triggers, ["公众号", "微信排版"]);
    assert.equal(hit.version, "0.3.1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

test("formatCatalogForPrompt emits Pi available_skills XML + compact routing", async () => {
  const { formatCatalogForPrompt, listSkillCatalog } = await import("../electron/lib/skills-runtime.mjs");
  const catalog = listSkillCatalog({ engineRoot }).slice(0, 3);
  const text = formatCatalogForPrompt(catalog);
  assert.match(text, /<available_skills>/);
  assert.match(text, /<name>/);
  assert.match(text, /<location>/);
  assert.match(text, /`topmind/);
});

test("toPiSkills maps catalog to Pi Skill shape", async () => {
  const { toPiSkills } = await import("../electron/lib/skills-runtime.mjs");
  const skills = toPiSkills([{ id: "topmind-memory", description: "d", path: "/x/SKILL.md" }]);
  assert.equal(skills[0].name, "topmind-memory");
  assert.equal(skills[0].filePath, "/x/SKILL.md");
});
