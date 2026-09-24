/**
 * Guards for canon claims that the tree must satisfy:
 * workspace content truth, shared-pack files, doc links, plugin slots.
 * Expected values are read from the shipped canon or from the filesystem,
 * not copied into the test as a second implementation.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSkillsRoot, SKIP_SKILLS } from "./helpers/sister-repos.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

function workspaceTruthName() {
  const boundaries = read("PRODUCT-BOUNDARIES.md");
  const marked = boundaries.match(/^├──\s+([A-Za-z0-9._-]+)\/\s+#\s*内容真源/m);
  assert.ok(marked, "PRODUCT-BOUNDARIES home layout must mark one directory as 内容真源");
  return marked[1];
}

test("portable content_truth is the workspace root named in PRODUCT-BOUNDARIES", (t) => {
  const skillsRoot = resolveSkillsRoot();
  if (!skillsRoot) {
    t.skip(SKIP_SKILLS);
    return;
  }
  const truth = workspaceTruthName();
  assert.equal(truth.includes("/"), false);
  const pack = JSON.parse(readFileSync(path.join(skillsRoot, "topmind-pack.json"), "utf8"));
  assert.equal(pack.portable_contract.content_truth, truth);
  assert.equal(pack.product_contract.content_truth, truth);
  for (const target of pack.install_targets) {
    const config = JSON.parse(readFileSync(path.join(skillsRoot, target.path), "utf8"));
    assert.equal(config.content_truth, truth, target.path);
  }
  for (const plugin of [
    path.join(repoRoot, "integrations/opencode/plugins/topmind-plugin.ts"),
    path.join(skillsRoot, "integrations/opencode/plugins/topmind-plugin.ts"),
  ]) {
    const source = readFileSync(plugin, "utf8");
    assert.match(source, new RegExp(`contentTruth:\\s*"${truth}"`));
    assert.doesNotMatch(source, /categories-and-topics/u);
  }
});

test("SKILL-ARCHITECTURE shared tree matches files in the skills pack", (t) => {
  const skillsRoot = resolveSkillsRoot();
  if (!skillsRoot) {
    t.skip(SKIP_SKILLS);
    return;
  }
  const arch = read("SKILL-ARCHITECTURE.md");
  const start = arch.indexOf("├── shared/");
  const end = arch.indexOf("├── topmind/", start);
  assert.ok(start >= 0 && end > start, "SKILL-ARCHITECTURE must show the shared/ tree");
  const names = [...arch.slice(start, end).matchAll(/([a-z0-9-]+\.md)/g)].map((match) => match[1]);
  assert.ok(names.length > 0);
  for (const name of names) {
    assert.ok(
      existsSync(path.join(skillsRoot, "shared", name)),
      `shared/${name} is listed in SKILL-ARCHITECTURE but missing from the pack`,
    );
  }
});

test("living docs only cite skills/shared files the pack ships", (t) => {
  const skillsRoot = resolveSkillsRoot();
  if (!skillsRoot) {
    t.skip(SKIP_SKILLS);
    return;
  }
  const docs = [
    "SKILL-ARCHITECTURE.md",
    "PROJECT-MODEL.md",
    "SECURITY.md",
    "docs/capture-clip-matrix.md",
    "topmind-desktop/ARCHITECTURE.md",
    "topmind-desktop/DESIGN.md",
    "topmind-desktop/PLUGIN.md",
    "topmind-desktop/electron/lib/workspace-note-media.mjs",
  ];
  const missing = [];
  for (const rel of docs) {
    const source = read(rel);
    for (const match of source.matchAll(/skills\/shared\/([a-z0-9-]+\.md)/g)) {
      const name = match[1];
      if (!existsSync(path.join(skillsRoot, "shared", name))) {
        missing.push(`${rel} -> skills/shared/${name}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("docs README relative links resolve inside this repo", () => {
  for (const rel of ["docs/README.md", "docs/README.en.md", "docs/README.zh-CN.md"]) {
    const source = read(rel);
    const base = path.dirname(path.join(repoRoot, rel));
    for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
      const link = match[1];
      if (/^(https?:|mailto:|#)/u.test(link)) continue;
      const abs = path.resolve(base, link.split("#")[0]);
      assert.ok(existsSync(abs), `${rel} links to missing ${link}`);
    }
  }
});

test("host integration READMEs in this repo do not link at the removed skills/ tree", () => {
  for (const host of ["codex", "hermes", "opencode"]) {
    const rel = path.join("integrations", host, "README.md");
    const source = read(rel);
    const base = path.dirname(path.join(repoRoot, rel));
    for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
      const link = match[1];
      if (/^(https?:|mailto:|#)/u.test(link)) continue;
      const abs = path.resolve(base, link.split("#")[0]);
      assert.ok(existsSync(abs), `${rel} links to missing ${link}`);
    }
    assert.doesNotMatch(source, /categories-and-topics/u);
  }
});

function countFiles(dir, accept) {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      count += countFiles(abs, accept);
    } else if (accept(entry.name)) {
      count += 1;
    }
  }
  return count;
}

function frontmatterActionCategory(markdown) {
  const fm = String(markdown).split("---")[1] || "";
  return fm.match(/^action_category:\s*(\S+)/m)?.[1] || "";
}

test("SKILL-ARCHITECTURE action rows match shipped SKILL.md categories", (t) => {
  const skillsRoot = resolveSkillsRoot();
  if (!skillsRoot) {
    t.skip(SKIP_SKILLS);
    return;
  }
  const arch = read("SKILL-ARCHITECTURE.md");
  const pack = JSON.parse(readFileSync(path.join(skillsRoot, "topmind-pack.json"), "utf8"));
  const start = arch.indexOf("### 3.3 Action Subskills");
  const end = arch.indexOf("\n### ", start + 10);
  assert.ok(start >= 0 && end > start);
  const rows = [];
  for (const line of arch.slice(start, end).split("\n")) {
    const match = line.match(/^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|/u);
    if (!match || match[1] === "子 skill") continue;
    rows.push({
      ids: match[1].split(/[·,]/u).map((part) => part.trim()).filter(Boolean),
      category: match[2].trim(),
    });
  }
  for (const skill of pack.skills) {
    const markdown = readFileSync(path.join(skillsRoot, skill.path, "SKILL.md"), "utf8");
    const category = frontmatterActionCategory(markdown);
    assert.ok(category, `${skill.id} action_category`);
    if (category === "router") continue;
    const hits = rows.filter((row) => row.ids.includes(skill.id));
    assert.equal(hits.length, 1, skill.id);
    assert.deepEqual(hits[0].ids, [skill.id], `${skill.id} must not share a row`);
    assert.equal(hits[0].category, category, skill.id);
  }
});

test("SKILL-ARCHITECTURE install-target sentence matches pack.install_targets", (t) => {
  const skillsRoot = resolveSkillsRoot();
  if (!skillsRoot) {
    t.skip(SKIP_SKILLS);
    return;
  }
  const arch = read("SKILL-ARCHITECTURE.md");
  const pack = JSON.parse(readFileSync(path.join(skillsRoot, "topmind-pack.json"), "utf8"));
  const ids = pack.install_targets.map((target) => target.id);
  const mentions = [...arch.matchAll(/(\d+)\s*个安装目标（([^）]+)）/gu)];
  assert.ok(mentions.length >= 1);
  for (const mention of mentions) {
    assert.equal(Number(mention[1]), ids.length);
    assert.deepEqual(mention[2].split("/").map((part) => part.trim()), ids);
  }
});

test("PRODUCT-BOUNDARIES optional-skill sketch lists every optional pack skill", (t) => {
  const skillsRoot = resolveSkillsRoot();
  if (!skillsRoot) {
    t.skip(SKIP_SKILLS);
    return;
  }
  const pack = JSON.parse(readFileSync(path.join(skillsRoot, "topmind-pack.json"), "utf8"));
  const boundaries = read("PRODUCT-BOUNDARIES.md");
  const section = boundaries.split("### 4.1 Skills Pack")[1]?.split("### 4.2")[0] || "";
  assert.ok(section);
  for (const skill of pack.skills.filter((item) => item.optional)) {
    assert.match(section, new RegExp(skill.id), skill.id);
  }
  assert.match(section, /不是第六个用户概念|不是新的用户概念/u);
});

test("Desktop ARCHITECTURE slot line and source counts match the tree", () => {
  const architecture = read("topmind-desktop/ARCHITECTURE.md");
  const types = read("topmind-desktop/src/plugins/types.ts");
  const slotLine = architecture.split("\n").find((line) => line.includes("插件槽:"));
  assert.ok(slotLine);
  const labels = slotLine
    .split("插件槽:")[1]
    .split("·")
    .map((part) => part.replace(/[│\s]/g, ""))
    .filter(Boolean);
  const kindCount = [...types.matchAll(/^\s+\| "(dataSource|view|action|settings|overlay|statusBar|contextMenu)"/gm)].length;
  assert.equal(labels.length, kindCount);
  assert.deepEqual(labels, ["DataSource", "View", "Action", "Settings", "Overlay", "StatusBar", "ContextMenu"]);
  assert.doesNotMatch(architecture, /interface SidebarSlot|Sidebar 同步/u);

  const srcCount = countFiles(
    path.join(repoRoot, "topmind-desktop/src"),
    (name) => name.endsWith(".ts") || name.endsWith(".tsx"),
  );
  const electronCount = countFiles(
    path.join(repoRoot, "topmind-desktop/electron"),
    (name) => /\.(?:mjs|ts|js)$/u.test(name),
  );
  assert.match(
    architecture,
    new RegExp(`源文件计数：\`src/\` ${srcCount} · \`electron/\` ${electronCount}`),
  );
});
