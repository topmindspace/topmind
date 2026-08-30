import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(skillsRoot, "..");

// 7 core + 2 optional connectors + 1 optional ledger
const EXPECTED_SKILLS = [
  "topmind",
  "topmind-capture",
  "topmind-organize",
  "topmind-write",
  "topmind-memory",
  "topmind-maintain",
  "topmind-loop",
  "topmind-weread",
  "topmind-x",
  "topmind-ledger",
];

const OPTIONAL_SKILLS = ["topmind-weread", "topmind-x", "topmind-ledger"];

// Core skills (excluding optional connectors / ledger)
const CORE_SKILLS = EXPECTED_SKILLS.filter(
  (s) => !OPTIONAL_SKILLS.includes(s),
);

const CONTENT_TRUTH = "topmind-workspace/categories-and-topics";

// v4.1 frontmatter schema required fields
const REQUIRED_FRONTMATTER_FIELDS = [
  "name",
  "version",
  "description",
  "action_category",
  "triggers",
];

// v4.1 action_category values
const VALID_CATEGORIES = [
  "capture",
  "organize",
  "write",
  "memory",
  "maintain",
  "loop",
  "router",
  "connector",
];

const V3_DEPRECATED = [
  /topmind-workspace\/projects\//u, // 旧 projects/ 根目录
  /\bYYYY-类型-项目名\b/u, // 旧命名规约
  /\bproject_type:\s/u, // 旧 project_type 字段
];

// 旧 UTR 命令名（v2.x — topmind-maintain 的 drift 段引用是合理的，其他 skill 不应作为活跃命令名出现）
const V3_DEPRECATED_COMMANDS = [
  /\bcreate-project\b/u,
  /\binspect-project\b/u,
  /\blist-projects\b/u,
  /\bappend-project-memory\b/u,
  /\bupdate-project\b/u,
  /\bcheck-project\b/u,
  /\bnormalize-project\b/u,
  /\barchive-project\b/u,
  /\brepair-project-index\b/u,
  /\blist-project-files\b/u,
];

const ENTRY_FILES = [
  "topmind/SKILL.md",
  "topmind-capture/SKILL.md",
  "topmind-organize/SKILL.md",
  "topmind-write/SKILL.md",
  "topmind-memory/SKILL.md",
  // topmind-maintain/SKILL.md is exempt from the deprecated-commands check because its
  // "Architecture Drift Checks" section enumerates the forbidden command names as drift signals.
  "topmind-maintain/SKILL.md",
  "topmind-loop/SKILL.md",
];

async function readJson(relativePath) {
  const raw = await fs.readFile(path.join(repoRoot, relativePath), "utf8");
  return JSON.parse(raw);
}

async function readFrontmatter(relativePath) {
  const raw = await fs.readFile(path.join(repoRoot, relativePath), "utf8");
  // Normalize \r\n → \n for cross-platform compatibility
  const normalized = raw.replace(/\r\n/gu, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---/u);
  if (!match) return null;
  const frontmatterText = match[1];
  const fields = {};
  for (const line of frontmatterText.split("\n")) {
    const kvMatch = line.match(/^(\w+):\s*(.*)$/u);
    if (kvMatch) {
      const [, key, value] = kvMatch;
      fields[key] = value;
    }
  }
  return fields;
}

test("topmind skill pack declares pack-level metadata (license / authors / repository / homepage / keywords / compatibility)", async () => {
  const manifest = await readJson("skills/topmind-pack.json");

  assert.ok(manifest.metadata, "pack.json should declare a metadata block");
  assert.equal(manifest.metadata.license, "MIT", "license should be MIT (industry-standard permissive)");
  assert.ok(Array.isArray(manifest.metadata.authors) && manifest.metadata.authors.length >= 1, "should have at least one author");
  for (const author of manifest.metadata.authors) {
    assert.ok(author.name, "each author should have a name");
  }
  assert.match(manifest.metadata.repository, /^https:\/\/github\.com\//u, "repository should be a GitHub URL");
  assert.match(manifest.metadata.homepage, /^https?:\/\//u, "homepage should be a URL");
  assert.ok(Array.isArray(manifest.metadata.keywords) && manifest.metadata.keywords.length >= 5, "should have at least 5 keywords");

  // Compatibility block
  assert.ok(manifest.metadata.compatibility, "should declare compatibility block");
  assert.ok(Array.isArray(manifest.metadata.compatibility.hosts) && manifest.metadata.compatibility.hosts.length >= 3, "should list supported hosts");
  assert.ok(manifest.metadata.compatibility.hosts.includes("opencode"));
  assert.ok(manifest.metadata.compatibility.hosts.includes("hermes"));
  assert.ok(manifest.metadata.compatibility.hosts.includes("codex"));
  assert.equal(manifest.metadata.compatibility.runtime, "pure-markdown", "runtime should be pure-markdown (v3.4 portability)");

  // Content schema block (machine-readable frontmatter schema)
  assert.ok(manifest.metadata.content_schema, "should declare content_schema for frontmatter contract");
  assert.deepEqual(
    manifest.metadata.content_schema.frontmatter_required_fields,
    ["name", "version", "description", "action_category", "triggers"],
  );
  assert.ok(manifest.metadata.content_schema.frontmatter_optional_fields.includes("author"));
  assert.ok(manifest.metadata.content_schema.frontmatter_optional_fields.includes("license"));
  assert.ok(manifest.metadata.content_schema.frontmatter_optional_fields.includes("homepage"));
  assert.ok(manifest.metadata.content_schema.frontmatter_optional_fields.includes("updated"));
});

test("all declared SKILL.md files have recommended metadata frontmatter (author / license / homepage / updated)", async () => {
  const manifest = await readJson("skills/topmind-pack.json");
  const packMeta = manifest.metadata;

  for (const skill of manifest.skills) {
    const skillPath = path.join(skillsRoot, skill.path, "SKILL.md");
    const raw = await fs.readFile(skillPath, "utf8");
    // Normalize \r\n → \n for cross-platform compatibility
    const frontmatterText = raw.replace(/\r\n/gu, "\n").match(/^---\n([\s\S]*?)\n---/u)[1];

    // Each field is recommended (not enforced as required), but every shipped skill carries them.
    assert.match(frontmatterText, /^author:\s*\S+/mu, `${skill.id} should have author field`);
    assert.match(frontmatterText, /^license:\s*\S+/mu, `${skill.id} should have license field`);
    assert.match(frontmatterText, /^homepage:\s*https?:\/\//mu, `${skill.id} should have homepage URL`);
    assert.match(frontmatterText, /^updated:\s*\d{4}-\d{2}-\d{2}/mu, `${skill.id} should have ISO updated date`);

    // License must be SPDX-compliant and match pack license
    const licenseMatch = frontmatterText.match(/^license:\s*(\S+)/mu);
    assert.equal(licenseMatch[1], packMeta.license, `${skill.id} license should match pack license`);

    // Author should reference the pack author (by name)
    const authorMatch = frontmatterText.match(/^author:\s*(.+)$/mu);
    assert.match(authorMatch[1], new RegExp(packMeta.authors[0].name, "u"), `${skill.id} author should match pack primary author`);
  }
});

test("all install-targets/*.json declare metadata (license / authors / repository / homepage)", async () => {
  const manifest = await readJson("skills/topmind-pack.json");

  for (const target of manifest.install_targets) {
    const config = await readJson(target.path);
    assert.ok(config.metadata, `${target.id} should declare metadata block`);
    assert.equal(config.metadata.license, "MIT", `${target.id} license should be MIT`);
    assert.ok(Array.isArray(config.metadata.authors) && config.metadata.authors.length >= 1, `${target.id} should have authors`);
    assert.match(config.metadata.repository, /^https:\/\/github\.com\//u, `${target.id} repository should be a GitHub URL`);
    assert.match(config.metadata.homepage, /^https?:\/\//u, `${target.id} homepage should be a URL`);
  }
});

test("skills/LICENSE file exists and matches metadata.license (MIT)", async () => {
  const manifest = await readJson("skills/topmind-pack.json");
  const licensePath = path.join(skillsRoot, "LICENSE");
  const stat = await fs.stat(licensePath);
  assert.equal(stat.isFile(), true, "skills/LICENSE should exist");
  const text = await fs.readFile(licensePath, "utf8");
  assert.match(text, /MIT License/u, "LICENSE should be the MIT License");
  assert.match(text, /Copyright \(c\) 2026 TopMindSpace/u, "LICENSE should declare the pack author");
  assert.equal(manifest.metadata.license, "MIT", "metadata.license should match the LICENSE file");
});

test("topmind skill pack declares one daily entry and action modules including loop, connectors, and optional ledger (v4)", async () => {
  const manifest = await readJson("skills/topmind-pack.json");

  assert.equal(manifest.name, "topmind");
  assert.equal(manifest.daily_entry, "topmind");
  // Product epoch may advance on unified public cuts (1.x → 2.x); keep semver X.Y.Z only.
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/u, "version should be semver X.Y.Z");
  assert.deepEqual(manifest.skills.map((skill) => skill.id), EXPECTED_SKILLS);
  assert.ok(CORE_SKILLS.includes("topmind"));
  assert.ok(!CORE_SKILLS.includes("topmind-ledger"));
  assert.equal(manifest.product_contract.capture_first, true);
  assert.equal(manifest.product_contract.category_first, true);
  assert.equal(manifest.product_contract.topic_emerges, true);
  assert.deepEqual(manifest.writeback_modes, ["auto", "confirm"]);

  // TUI surface was removed; CLI/MCP cover deterministic ops
  assert.ok(!manifest.surfaces.includes("tui"), "pack should not include tui surface");
  assert.ok(manifest.surfaces.includes("codex"));
  assert.ok(manifest.surfaces.includes("hermes"));
  assert.ok(manifest.surfaces.includes("opencode"));
  assert.ok(manifest.surfaces.includes("desktop"));
  assert.ok(manifest.surfaces.includes("mcp"));
  assert.ok(manifest.install_targets.every((target) => target.path.startsWith("skills/install-targets/")));

  // v4.1: topmind-loop registered as independent skill
  const loopSkill = manifest.skills.find((s) => s.id === "topmind-loop");
  assert.ok(loopSkill, "topmind-loop should be registered in skills[]");
  assert.equal(loopSkill.role, "loop");
  assert.equal(loopSkill.human_facing, false);

  // v4.1: connector skills are optional
  const wereadSkill = manifest.skills.find((s) => s.id === "topmind-weread");
  assert.ok(wereadSkill, "topmind-weread should be registered in skills[]");
  assert.equal(wereadSkill.role, "connector");
  assert.equal(wereadSkill.optional, true);
  const xSkill = manifest.skills.find((s) => s.id === "topmind-x");
  assert.ok(xSkill, "topmind-x should be registered in skills[]");
  assert.equal(xSkill.role, "connector");
  assert.equal(xSkill.optional, true);
  const ledgerSkill = manifest.skills.find((s) => s.id === "topmind-ledger");
  assert.ok(ledgerSkill, "topmind-ledger should be registered in skills[]");
  assert.equal(ledgerSkill.optional, true);
  assert.equal(ledgerSkill.human_facing, false);
  assert.equal(ledgerSkill.role, "memory");

  // v4.2: template-driven category slots (replaces hardcoded slot entries)
  assert.equal(manifest.category_slots._mode, "template-driven-dynamic-discovery");
  assert.equal(manifest.category_slots._default_template, "stream");
  assert.ok(Array.isArray(manifest.category_slots._templates));
  assert.ok(manifest.category_slots._templates.includes("stream"));
  assert.ok(manifest.category_slots._templates.includes("balanced"));
  assert.ok(manifest.category_slots._templates.includes("research"));
  assert.ok(manifest.category_slots._templates.includes("periodic"));
  // v4.2: category roles array
  assert.ok(Array.isArray(manifest.category_roles));
  assert.ok(manifest.category_roles.includes("buffer"));
  assert.ok(manifest.category_roles.includes("delivery"));
  assert.ok(manifest.category_roles.includes("system"));
  // v3.4: 不再有 01/06/07/08/09 硬编码槽位
  assert.equal(manifest.category_slots["01"], undefined);
  assert.equal(manifest.category_slots["09"], undefined);

  // 6+ 条规约（v4.2 模板属性参数化）
  assert.ok(manifest.category_rules.length >= 6);
  assert.ok(manifest.category_rules.some((rule) => rule.startsWith("no_overlap")));
  assert.ok(manifest.category_rules.some((rule) => rule.startsWith("topic_emerges")));
  assert.ok(manifest.category_rules.some((rule) => rule.startsWith("template_catch_all")));
  assert.ok(manifest.category_rules.some((rule) => rule.startsWith("category_naming_stable")));
  assert.ok(manifest.category_rules.some((rule) => rule.startsWith("config_v4")));
  assert.ok(manifest.category_rules.some((rule) => rule.startsWith("workspace_model")));
  assert.ok(manifest.category_rules.some((rule) => rule.startsWith("hidden_categories")));

  // 专题命名
  assert.equal(manifest.topic_naming.format, "YYYY-主题");
  assert.equal(manifest.topic_naming.style, "kebab-case");
  assert.equal(manifest.topic_naming.deprecated_field, "project_type");

  // 命令面（command_vocabulary） — v4: 8 域 / 28 命令
  assert.ok(manifest.utr.command_vocabulary["workspace-read"].includes("list-categories"));
  assert.ok(manifest.utr.command_vocabulary["workspace-read"].includes("list-topics"));
  assert.ok(manifest.utr.command_vocabulary["workspace-read"].includes("inspect-topic"));
  assert.ok(manifest.utr.command_vocabulary["workspace-write"].includes("create-topic"));
  assert.ok(manifest.utr.command_vocabulary["memory"].includes("append-topic"));
  assert.ok(manifest.utr.command_vocabulary["workspace-transform"].includes("migrate-v4"));
  assert.ok(manifest.utr.command_vocabulary["contract"].includes("validate"));
  assert.ok(manifest.utr.command_vocabulary["lifecycle"].includes("scan"));
  assert.ok(manifest.utr.command_vocabulary["derived"].includes("rebuild"));
  // v4: 不再有 workspace-check 域
  assert.equal(manifest.utr.command_vocabulary["workspace-check"], undefined);
  // v3.4: 不应再有 command_vocabulary_v3_1 / v3_3
  assert.equal(manifest.utr.command_vocabulary_v3_1, undefined);
  assert.equal(manifest.utr.command_vocabulary_v3_3, undefined);
});

test("topmind skill pack has a portable host contract for non-Codex agents (v3.4)", async () => {
  const manifest = await readJson("skills/topmind-pack.json");

  assert.deepEqual(manifest.entry_files, EXPECTED_SKILLS.map((skill) => `${skill}/SKILL.md`));
  assert.equal(manifest.portable_contract.requires_desktop, false);
  assert.equal(manifest.portable_contract.requires_utr, false);
  assert.equal(manifest.portable_contract.content_truth, CONTENT_TRUTH);
  assert.equal(manifest.portable_contract.host_may_provide.includes("skills"), true);
  assert.equal(manifest.portable_contract.host_may_provide.includes("mcp"), true);
  // v3.4: tui removed from host_may_provide
  assert.equal(manifest.portable_contract.host_may_provide.includes("tui"), false);
  assert.equal(manifest.portable_contract.host_must_not.includes("change-content-truth"), true);
  assert.equal(manifest.portable_contract.host_must_not.includes("add-daily-entrypoints"), true);
  assert.equal(manifest.portable_contract.host_must_not.includes("introduce-legacy-project-naming"), true);
  assert.equal(manifest.portable_contract.host_must_not.includes("introduce-project_type-field"), true);
});

test("all declared topmind skills have SKILL.md files", async () => {
  const manifest = await readJson("skills/topmind-pack.json");

  for (const skill of manifest.skills) {
    const skillPath = path.join(skillsRoot, skill.path, "SKILL.md");
    const stat = await fs.stat(skillPath);
    assert.equal(stat.isFile(), true, `${skill.id} should have SKILL.md`);
  }
});

test("agent install target manifests include topmind-loop and use v3.4 content truth (no hardcoded home paths)", async () => {
  const manifest = await readJson("skills/topmind-pack.json");

  for (const target of manifest.install_targets) {
    const config = await readJson(target.path);
    assert.equal(config.package, "topmind");
    assert.equal(config.daily_entry, "topmind");
    assert.deepEqual(config.skills, EXPECTED_SKILLS);
    assert.equal(config.install_strategy, "symlink-or-copy");
    assert.ok(Array.isArray(config.capabilities) && config.capabilities.includes("skills"));
    assert.equal(config.content_truth, CONTENT_TRUTH);
    assert.ok(config.host_must_not.includes("change-content-truth"));
    assert.ok(config.host_must_not.includes("add-daily-entrypoints"));
    assert.ok(config.host_must_not.includes("introduce-legacy-project-naming"));
    assert.ok(config.host_must_not.includes("introduce-project_type-field"));
    assert.doesNotMatch(JSON.stringify(config), /\/Users\/|\/home\/|~\//u);
  }
});

test("all SKILL.md files have v4 frontmatter schema (name+version+description+action_category+triggers)", async () => {
  const manifest = await readJson("skills/topmind-pack.json");

  for (const skill of manifest.skills) {
    const skillPath = path.join(skillsRoot, skill.path, "SKILL.md");
    const raw = await fs.readFile(skillPath, "utf8");
    // Normalize \r\n → \n for cross-platform compatibility
    const frontmatterMatch = raw.replace(/\r\n/gu, "\n").match(/^---\n([\s\S]*?)\n---/u);
    assert.ok(frontmatterMatch, `${skill.id} should have frontmatter`);

    const frontmatterText = frontmatterMatch[1];
    for (const field of REQUIRED_FRONTMATTER_FIELDS) {
      assert.ok(
        new RegExp(`^${field}:`, "mu").test(frontmatterText),
        `${skill.id} frontmatter should have required field: ${field}`,
      );
    }

    // version 跟随 pack 版本（非独立 semver）
    const packVersion = manifest.version;
    assert.match(
      frontmatterText,
      new RegExp(`^version:\\s*${packVersion.replace(/\./g, "\\.")}\\s*$`, "mu"),
      `${skill.id} frontmatter version should equal pack version ${packVersion}`,
    );

    // action_category 应是有效值
    const categoryMatch = frontmatterText.match(/^action_category:\s*(\w+)/mu);
    assert.ok(categoryMatch, `${skill.id} should have action_category field`);
    assert.ok(
      VALID_CATEGORIES.includes(categoryMatch[1]),
      `${skill.id} action_category "${categoryMatch[1]}" should be one of: ${VALID_CATEGORIES.join(", ")}`,
    );

    // v4.0: 确保不再使用旧的 `category` 键（语义碰撞修复）
    assert.doesNotMatch(
      frontmatterText,
      /^category:\s*\w+/mu,
      `${skill.id} must not use legacy 'category' key (use 'action_category' instead)`,
    );
  }
});

test("optional 记账 skill is not a daily entry and lists 记账/记一笔/花了/存入 triggers", async () => {
  const skillPath = path.join(skillsRoot, "topmind-ledger", "SKILL.md");
  const raw = await fs.readFile(skillPath, "utf8");
  const frontmatterText = raw.replace(/\r\n/gu, "\n").match(/^---\n([\s\S]*?)\n---/u)[1];
  assert.match(frontmatterText, /entrypoint:\s*false/u);
  for (const trig of ["记账", "记一笔", "花了", "存入"]) {
    assert.match(frontmatterText, new RegExp(trig, "u"), `triggers should include ${trig}`);
  }
  assert.doesNotMatch(frontmatterText, /entrypoint:\s*true/u);
  assert.match(raw, /如何打开/);
  assert.match(raw, /账本路径/);
  assert.match(raw, /\{memory\.dir\}\/ledgers\//);
});

test("only topmind router has entrypoint: true (v3.4 single daily entry)", async () => {
  const manifest = await readJson("skills/topmind-pack.json");

  for (const skill of manifest.skills) {
    const skillPath = path.join(skillsRoot, skill.path, "SKILL.md");
    const raw = await fs.readFile(skillPath, "utf8");
    // Normalize \r\n → \n for cross-platform compatibility
    const frontmatterMatch = raw.replace(/\r\n/gu, "\n").match(/^---\n([\s\S]*?)\n---/u);
    const frontmatterText = frontmatterMatch[1];

    if (skill.id === "topmind") {
      assert.match(frontmatterText, /entrypoint:\s*true/u, "topmind router should have entrypoint: true");
    } else {
      // 其他 skill 要么显式 entrypoint: false，要么不写（默认 false）
      const entrypointMatch = frontmatterText.match(/^entrypoint:\s*(\w+)/mu);
      if (entrypointMatch) {
        assert.equal(entrypointMatch[1], "false", `${skill.id} should have entrypoint: false (not true)`);
      }
      // 不强制要求显式 entrypoint: false，但绝不能是 true
      assert.doesNotMatch(frontmatterText, /entrypoint:\s*true/u, `${skill.id} must not have entrypoint: true`);
    }
  }
});

test("all SKILL.md files point to shared capability-degradation.md (v3.4 single source)", async () => {
  const manifest = await readJson("skills/topmind-pack.json");
  const sharedPath = path.join(skillsRoot, "shared", "capability-degradation.md");
  const sharedStat = await fs.stat(sharedPath);
  assert.equal(sharedStat.isFile(), true, "shared/capability-degradation.md should exist");

  for (const skill of manifest.skills) {
    const skillPath = path.join(skillsRoot, skill.path, "SKILL.md");
    const raw = await fs.readFile(skillPath, "utf8");
    assert.match(
      raw,
      /degradation:\s*\.\.\/shared\/capability-degradation\.md/u,
      `${skill.id} frontmatter should point to shared/capability-degradation.md`,
    );
  }
});

test("skill evals are tied to the packaged skill ids and use category/topic references", async () => {
  const manifest = await readJson("skills/topmind-pack.json");
  const evals = await readJson("skills/evals/evals.json");
  const skillIds = new Set(manifest.skills.map((skill) => skill.id));

  assert.equal(evals.skill_name, manifest.name);
  assert.equal(evals.daily_entry, manifest.daily_entry);
  assert.equal(evals.version, manifest.version);

  for (const evalCase of evals.evals) {
    assert.ok(skillIds.has(evalCase.primary_skill), `${evalCase.id} has unknown primary_skill`);
    for (const extra of evalCase.extra_skills || []) {
      assert.ok(skillIds.has(extra), `${evalCase.id} has unknown extra skill ${extra}`);
    }
  }

  // v3.4: eval #15 应该 primary_skill: topmind-loop（不是 topmind-maintain）
  const eval15 = evals.evals.find((e) => e.id === 15);
  assert.ok(eval15, "eval #15 should exist");
  assert.equal(eval15.primary_skill, "topmind-loop", "eval #15 should route to topmind-loop (independent skill)");
  assert.doesNotMatch(eval15.expected_output, /topmind-maintain's loop dispatch/u, "eval #15 should not reference maintain dispatch");
});

test("portable skill copy describes actions instead of legacy foreground modes", async () => {
  const evals = await readJson("skills/evals/evals.json");
  const organizeSkill = await fs.readFile(path.join(skillsRoot, "topmind-organize", "SKILL.md"), "utf8");
  const combinedEvalCopy = evals.evals.map((evalCase) => evalCase.expected_output).join("\n");

  assert.doesNotMatch(
    organizeSkill,
    /##\s*三个触发模式|###\s*(整理模式|研究模式|提取模式)|所有模式遵循|按模式处理/u,
  );
  assert.doesNotMatch(combinedEvalCopy, /（(整理|研究|提取)模式）|\((organize|research|extract) mode\)/iu);

  assert.match(organizeSkill, /动作入口/u);
  assert.match(organizeSkill, /整理结构/u);
  assert.match(organizeSkill, /研究分析/u);
  assert.match(organizeSkill, /实体提取/u);
});

test("portable skill copy uses save settings language without approval-first prompts", async () => {
  const manifest = await readJson("skills/topmind-pack.json");
  const packageSources = await Promise.all([
    fs.readFile(path.join(skillsRoot, "README.md"), "utf8"),
    ...manifest.entry_files.map((entryFile) => fs.readFile(path.join(skillsRoot, entryFile), "utf8")),
  ]);
  const combined = packageSources.join("\n");

  assert.match(combined, /writeback_mode:\s*auto\s*\|\s*confirm/u);
  assert.match(combined, /auto.*receipt|auto.*回执/iu);
  assert.match(combined, /confirm.*review|confirm.*审阅/iu);
  assert.match(combined, /保存设置/u);
  assert.match(combined, /自动保存/u);
  assert.match(combined, /需要审阅|审阅入口/u);
  assert.doesNotMatch(combined, /confirm previews first|confirm previews before writing|confirm.*preview.*approval|wait for approval|confirm.*wait for approval/iu);
  assert.doesNotMatch(combined, /确认后才|等待用户确认|用户确认后/u);
  assert.doesNotMatch(combined, /Which writeback mode|configured writeback mode|according to configured writeback mode|follow global `writeback_mode`|Respect global `writeback_mode`|honor global `writeback_mode`|当前写回模式|全局写回模式/u);
});

test("v3.4 skill pack is free of legacy project naming and project_type", async () => {
  const manifest = await readJson("skills/topmind-pack.json");
  const packageSources = await Promise.all([
    fs.readFile(path.join(skillsRoot, "README.md"), "utf8"),
    ...manifest.entry_files.map((entryFile) => fs.readFile(path.join(skillsRoot, entryFile), "utf8")),
  ]);
  const combined = packageSources.join("\n");

  for (const pattern of V3_DEPRECATED) {
    assert.doesNotMatch(combined, pattern, `v3.4 pack should not contain deprecated pattern ${pattern}`);
  }
});

test("v3.4 SKILL.md files (except topmind-maintain/topmind-loop drift sections) do not name v2.x UTR commands as active", async () => {
  const manifest = await readJson("skills/topmind-pack.json");
  // 排除 topmind-maintain/SKILL.md 和 topmind-loop/SKILL.md：
  // 它们故意列出弃用命令名作为 drift 巡检依据
  const activeEntryFiles = manifest.entry_files.filter(
    (f) => !f.startsWith("topmind-maintain/") && !f.startsWith("topmind-loop/"),
  );
  const activeSources = await Promise.all([
    fs.readFile(path.join(skillsRoot, "README.md"), "utf8"),
    ...activeEntryFiles.map((entryFile) => fs.readFile(path.join(skillsRoot, entryFile), "utf8")),
  ]);
  const combined = activeSources.join("\n");

  for (const pattern of V3_DEPRECATED_COMMANDS) {
    assert.doesNotMatch(combined, pattern, `v3.4 active skills should not reference v2.x UTR command ${pattern}`);
  }
});

test("dist/ build output (if present) is internally consistent with the pack", async () => {
  const manifest = await readJson("skills/topmind-pack.json");
  const version = manifest.version;
  const distDir = path.join(repoRoot, "dist");

  // Skip if dist/ doesn't exist or build artifacts are missing (build is opt-in)
  try {
    const stat = await fs.stat(distDir);
    if (!stat.isDirectory()) return;
  } catch {
    return;
  }

  const tarPath = path.join(distDir, `topmind-skills-${version}.tar.gz`);
  // Skip if tar.gz doesn't exist (e.g. partial build on Windows without tar)
  try {
    await fs.stat(tarPath);
  } catch {
    return;
  }

  const zipPath = path.join(distDir, `topmind-skills-${version}.zip`);
  const manifestPath = path.join(distDir, `topmind-skills-${version}-manifest.json`);
  const sumsPath = path.join(distDir, `topmind-skills-${version}.SHA256SUMS`);

  for (const f of [tarPath, zipPath, manifestPath, sumsPath]) {
    assert.equal(
      (await fs.stat(f)).isFile(),
      true,
      `dist/${path.basename(f)} should exist after pack build`,
    );
  }

  // Manifest should reference the same metadata as the pack
  const distManifest = await readJson(`dist/topmind-skills-${version}-manifest.json`);
  assert.equal(distManifest.version, manifest.version);
  assert.equal(distManifest.metadata.license, manifest.metadata.license);
  assert.equal(distManifest.metadata.repository, manifest.metadata.repository);
  assert.deepEqual(
    distManifest.skills.map((s) => s.id).sort(),
    manifest.skills.map((s) => s.id).sort(),
  );

  // Pack root SKILL.md (router) for hosts that load zip as single-skill
  const { execFileSync } = await import("node:child_process");
  const listing = execFileSync("tar", ["-tzf", tarPath], { encoding: "utf8" });
  assert.match(
    listing,
    new RegExp(`topmind-skills-${version}/SKILL\\.md`, "u"),
    "skills pack tar must include root SKILL.md for Agent Skills zip loaders",
  );
  assert.match(
    listing,
    new RegExp(`topmind-skills-${version}/topmind/SKILL\\.md`, "u"),
    "skills pack tar must include topmind/SKILL.md",
  );
});

test("topmind-maintain/SKILL.md and topmind-loop/SKILL.md drift sections reference forbidden v2.x command names", async () => {
  const maintainSkill = await fs.readFile(path.join(skillsRoot, "topmind-maintain", "SKILL.md"), "utf8");
  const loopSkill = await fs.readFile(path.join(skillsRoot, "topmind-loop", "SKILL.md"), "utf8");
  const loopWalk = await fs.readFile(
    path.join(skillsRoot, "topmind-loop", "references", "scopes-and-walk.md"),
    "utf8",
  );
  // maintain and loop should reference v2.x commands as drift signals (at least some of them)
  // They may use a summary pattern like "create-project / inspect-project etc." instead of listing all
  const hasV2xRef = (text) =>
    /create-project|inspect-project|list-projects/u.test(text);
  assert.ok(hasV2xRef(maintainSkill), "topmind-maintain should reference some forbidden v2.x commands");
  assert.ok(
    hasV2xRef(loopSkill) || hasV2xRef(loopWalk),
    "topmind-loop SKILL or references should reference some forbidden v2.x commands",
  );
});

test("v1.0 progressive disclosure: shared resources + skill references exist and are linked", async () => {
  const sharedRequired = [
    "capability-degradation.md",
    "project-model-brief.md",
    "output-language.md",
    "writeback-receipt.md",
    "trigger-disambiguation.md",
    "long-url-capture.md",
    "document-ingest.md",
  ];
  for (const f of sharedRequired) {
    const p = path.join(skillsRoot, "shared", f);
    assert.equal((await fs.stat(p)).isFile(), true, `shared/${f} should exist`);
  }

  const routerRefs = ["multi-intent.md", "template-categories.md", "connector-resolution.md"];
  for (const f of routerRefs) {
    const p = path.join(skillsRoot, "topmind", "references", f);
    assert.equal((await fs.stat(p)).isFile(), true, `topmind/references/${f} should exist`);
  }

  const loopRefs = ["scopes-and-walk.md", "state-file.md"];
  for (const f of loopRefs) {
    const p = path.join(skillsRoot, "topmind-loop", "references", f);
    assert.equal((await fs.stat(p)).isFile(), true, `topmind-loop/references/${f} should exist`);
  }

  const router = await fs.readFile(path.join(skillsRoot, "topmind", "SKILL.md"), "utf8");
  assert.match(router, /shared\/trigger-disambiguation\.md/u);
  assert.match(router, /references\/multi-intent\.md/u);

  const capture = await fs.readFile(path.join(skillsRoot, "topmind-capture", "SKILL.md"), "utf8");
  assert.match(capture, /shared\/long-url-capture\.md/u);
});

test("v1.0 description quality: non-empty, under 1024 chars, includes use-when signal", async () => {
  const manifest = await readJson("skills/topmind-pack.json");
  for (const skill of manifest.skills) {
    const raw = await fs.readFile(path.join(skillsRoot, skill.path, "SKILL.md"), "utf8");
    const fm = raw.replace(/\r\n/gu, "\n").match(/^---\n([\s\S]*?)\n---/u)?.[1] ?? "";
    // Support single-line or YAML folded (>-) multi-line description
    let desc = "";
    const single = fm.match(/^description:\s*(.+)$/mu);
    if (single && !single[1].startsWith(">") && single[1].trim()) {
      desc = single[1].trim();
    } else {
      const block = fm.match(/^description:\s*>-?\n((?:[ \t]+.+\n?)+)/mu);
      if (block) {
        desc = block[1]
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .join(" ");
      }
    }
    assert.ok(desc.length >= 40, `${skill.id} description too short (${desc.length})`);
    assert.ok(desc.length <= 1024, `${skill.id} description exceeds Agent Skills 1024 limit (${desc.length})`);
    // When-to-use signal: "Use when" or Chinese trigger phrases / 用于
    assert.ok(
      /Use when|use when|当|用于|Routes|Sync|Capture|Write|Update|Cyclic|Deterministic|topmind|entrypoint|Append|Organize/iu.test(desc),
      `${skill.id} description should signal when to activate`,
    );
    // Negative boundary reduces false activation (Agent Skills best practice)
    assert.ok(
      /Do NOT|do not|不要|禁止|并非/iu.test(desc),
      `${skill.id} description should include Do NOT / negative boundary`,
    );
    // Prefer must not over-claim all workspace tasks (except router may route)
    if (skill.id !== "topmind") {
      assert.doesNotMatch(
        desc,
        /any workspace knowledge task|所有知识|任意工作区任务/iu,
        `${skill.id} must not use over-broad discovery phrasing that steals sibling skills`,
      );
    }
  }
});

test("v1.0 each skill has When NOT / When NOT to use section", async () => {
  const manifest = await readJson("skills/topmind-pack.json");
  for (const skill of manifest.skills) {
    if (skill.id === "topmind") continue; // router is always-on entry
    const raw = await fs.readFile(path.join(skillsRoot, skill.path, "SKILL.md"), "utf8");
    assert.match(
      raw,
      /When NOT|When not to use|不要用|不得用于/iu,
      `${skill.id} should document when NOT to use`,
    );
  }
});

test("v1.0 SKILL.md bodies stay under 500 lines (progressive disclosure budget)", async () => {
  const manifest = await readJson("skills/topmind-pack.json");
  for (const skill of manifest.skills) {
    const raw = await fs.readFile(path.join(skillsRoot, skill.path, "SKILL.md"), "utf8");
    const lines = raw.split("\n").length;
    assert.ok(lines <= 500, `${skill.id} SKILL.md has ${lines} lines (max 500)`);
  }
});

test("v1.0.7 compound discipline: leave-a-trace, topic.md-first write, memory gate, no hard INDEX", async () => {
  const organize = await fs.readFile(path.join(skillsRoot, "topmind-organize", "SKILL.md"), "utf8");
  const write = await fs.readFile(path.join(skillsRoot, "topmind-write", "SKILL.md"), "utf8");
  const memory = await fs.readFile(path.join(skillsRoot, "topmind-memory", "SKILL.md"), "utf8");
  const capture = await fs.readFile(path.join(skillsRoot, "topmind-capture", "SKILL.md"), "utf8");
  const router = await fs.readFile(path.join(skillsRoot, "topmind", "SKILL.md"), "utf8");
  const loop = await fs.readFile(path.join(skillsRoot, "topmind-loop", "SKILL.md"), "utf8");
  const loopWalk = await fs.readFile(
    path.join(skillsRoot, "topmind-loop", "references", "scopes-and-walk.md"),
    "utf8",
  );
  const brief = await fs.readFile(path.join(skillsRoot, "shared", "project-model-brief.md"), "utf8");
  const disambig = await fs.readFile(path.join(skillsRoot, "shared", "trigger-disambiguation.md"), "utf8");

  assert.match(organize, /整理留痕|默认落盘|写回/u);
  assert.match(organize, /INDEX\.md/u);
  assert.match(write, /先读.*topic\.md|topic\.md.*先读|读序/u);
  assert.match(memory, /禁止.*capture|capture.*禁止/iu);
  assert.match(capture, /禁止.*topic\.md|不.*改.*topic\.md/u);
  assert.match(router, /复利纪律|INDEX\.md/u);
  assert.match(loop + loopWalk, /首页偏空|材料多而首页空|不代写/u);
  assert.match(brief, /复利纪律/u);
  assert.match(disambig, /写回边界|复利纪律/u);
  // Must not encourage hard index as a product requirement
  assert.doesNotMatch(organize + router + brief, /必须维护\s*INDEX|强制\s*INDEX|required\s+INDEX/iu);
});

test("skill pack states the two-track output-language rule once and router links it", async () => {
  const brief = await fs.readFile(path.join(skillsRoot, "shared", "output-language.md"), "utf8");
  const router = await fs.readFile(path.join(skillsRoot, "topmind", "SKILL.md"), "utf8");
  const modelBrief = await fs.readFile(path.join(skillsRoot, "shared", "project-model-brief.md"), "utf8");
  const disambig = await fs.readFile(path.join(skillsRoot, "shared", "trigger-disambiguation.md"), "utf8");
  const memory = await fs.readFile(path.join(skillsRoot, "topmind-memory", "SKILL.md"), "utf8");

  assert.match(brief, /用户本轮明确要求/u);
  assert.match(brief, /正在处理的原文/u);
  assert.match(brief, /workspace\.locale/u);
  assert.match(brief, /文档 AI/u);
  assert.match(brief, /产品 AI/u);
  assert.match(brief, /当前宿主 UI/u);
  assert.match(brief, /文档 AI 不跟 UI/u);
  assert.match(router, /shared\/output-language\.md/u);
  assert.match(modelBrief, /output-language\.md/u);

  // Memory writes profile/periodic, not topic.md as the default sink
  assert.doesNotMatch(memory, /写进 topic\.md/u);
  assert.doesNotMatch(disambig, /memory \| 仅 confirmed stable → `topic\.md`/u);
  assert.doesNotMatch(brief, /输出语言跟随 UI|AI follows the UI/u);
});
