/**
 * Cross-surface behavior parity:
 * - shared semantic-memory policy (ledgers exemption + path keys)
 * - compact budget formula resolveCompactBudget vs resolveChatCompactBudget
 * - UTR command names and exposure: registry vs TOOLS.md vs UTR READMEs vs topmind-pack.json
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { resolveSkillsRoot, resolveObsidianRoot, SKIP_SKILLS, SKIP_OBSIDIAN } = await import(
  "./helpers/sister-repos.mjs"
);

function read(rel) {
  return readFileSync(path.isAbsolute(rel) ? rel : path.join(root, rel), "utf8");
}

// ── memory-fence: Desktop module vs Obsidian inline fence ─────────────────────

const fenceMod = await import(
  pathToFileURL(path.join(root, "lib", "agent-tool-policy.mjs")).href
);

test("Kernel memory-fence exempts ledgers and checks every path key", () => {
  const { isFencedMemoryPath, memoryFence, MEMORY_PATH_KEYS, MEMORY_WRITE_TOOLS } = fenceMod;
  assert.deepEqual([...MEMORY_PATH_KEYS].sort(), [
    "destRelativePath",
    "inboxRelativePath",
    "relativePath",
    "newPath",
    "targetTopicId",
    "category",
    "topicId",
  ].sort());
  // ledgers/ is a sanctioned generic-write plane.
  assert.equal(isFencedMemoryPath("memory/ledgers/Personal.md"), false);
  assert.equal(isFencedMemoryPath("memory/ledgers/"), false);
  assert.equal(isFencedMemoryPath("memory/ledgers"), false);
  // profile|periodic|topics|todo are fenced.
  assert.equal(isFencedMemoryPath("memory/profile.md"), true);
  assert.equal(isFencedMemoryPath("memory/periodic/2026/2026-W10.md"), true);
  assert.equal(isFencedMemoryPath("memory/topics/design.md"), true);
  assert.equal(isFencedMemoryPath("memory/todo.md"), true);
  // outside memory plane is not fenced.
  assert.equal(isFencedMemoryPath("20-专题/2026-主题/note.md"), false);
  assert.equal(isFencedMemoryPath("10-动态/2026/2026-W10.md"), false);

  // Memory write tools pass through; generic writes are blocked on any path key.
  assert.equal(memoryFence("save_file", { relativePath: "memory/profile.md" })?.error, "write-blocked:memory-plane");
  assert.equal(memoryFence("edit_file", { destRelativePath: "memory/todo.md" })?.error, "write-blocked:memory-plane");
  assert.equal(memoryFence("copy_file", { relativePath: "20-专题/a.md", destRelativePath: "memory/profile.md" })?.error, "write-blocked:memory-plane");
  assert.equal(memoryFence("save_file", { inboxRelativePath: "memory/periodic/x.md" })?.error, "write-blocked:memory-plane");
  assert.equal(memoryFence("save_file", { relativePath: "memory/ledgers/Personal.md" }), null);
  assert.equal(memoryFence("save_file", { relativePath: "20-专题/a.md" }), null);
  assert.equal(memoryFence("append_core_memory", { relativePath: "memory/profile.md" }), null);
  assert.equal(memoryFence("update_core_memory", { relativePath: "memory/profile.md" }), null);
  assert.equal(memoryFence("retire_core_memory", { relativePath: "memory/profile.md" }), null);
  assert.equal(memoryFence("restore_core_memory", { relativePath: "memory/profile.md" }), null);
  assert.equal(memoryFence("compact_core_memory_history", { relativePath: "memory/profile.md" }), null);
  assert.ok(MEMORY_WRITE_TOOLS.has("append_topic_memory"));
  assert.ok(MEMORY_WRITE_TOOLS.has("add_todo"));
  assert.ok(MEMORY_WRITE_TOOLS.has("toggle_todo"));
});

test("Obsidian uses the Kernel policy and Desktop retains its memory guard", (t) => {
  if (SKIP_OBSIDIAN) { t.skip(SKIP_OBSIDIAN); return; }
  const src = read(path.join(resolveObsidianRoot(), "src/services/chat-agent.ts"));
  assert.match(src, /memoryFence\(tool, call, \{ workspaceRoot \}\)/);
  assert.match(read("topmind-desktop/electron/ai-tools.mjs"), /(?:kernelApi\.)?memoryFence\(/);
});

// ── compact budget formula ────────────────────────────────────────────────────

const desktopCompact = await import(
  pathToFileURL(path.join(root, "topmind-desktop", "electron", "lib", "ai-session-compact.mjs")).href
);

test("Desktop resolveCompactBudget scales with the model window", () => {
  const { resolveCompactBudget } = desktopCompact;
  const unknown = resolveCompactBudget(0);
  assert.ok(unknown.maxTokens <= 32768 * 0.55);
  assert.ok(unknown.maxChars < 50000);
  const big = resolveCompactBudget(200_000);
  assert.ok(big.maxMessages > unknown.maxMessages);
  assert.ok(big.maxChars > unknown.maxChars);
  const small = resolveCompactBudget(32_000);
  assert.ok(small.maxMessages <= unknown.maxMessages);
});

test("Obsidian resolveChatCompactBudget matches Desktop formula", async (t) => {
  if (SKIP_OBSIDIAN) {
    t.skip(SKIP_OBSIDIAN);
    return;
  }
  const obs = resolveObsidianRoot();
  const utilsPath = path.join(obs, "src", "utils.ts");
  if (!existsSync(utilsPath)) {
    t.skip("topmind-obsidian/src/utils.ts not present");
    return;
  }
  const utils = await import(pathToFileURL(utilsPath).href);
  const desktop = desktopCompact.resolveCompactBudget;
  for (const cw of [undefined, 0, 32_000, 128_000, 200_000, 1_000_000]) {
    const a = desktop(cw);
    const b = utils.resolveChatCompactBudget(cw === 0 ? undefined : cw);
    for (const key of ["maxMessages", "keepRecent", "maxChars", "maxPerMessage"]) {
      assert.equal(b[key], a[key], `cw=${cw} ${key} drifted (Desktop ${a[key]} vs Obsidian ${b[key]})`);
    }
  }
  // Defaults must match even when the window is unknown.
  assert.equal(utils.CHAT_COMPACT_DEFAULTS.maxMessages, desktopCompact.COMPACT_DEFAULT_MAX_MESSAGES);
  assert.equal(utils.CHAT_COMPACT_DEFAULTS.keepRecent, desktopCompact.COMPACT_DEFAULT_KEEP_RECENT);
  assert.equal(utils.CHAT_COMPACT_DEFAULTS.maxChars, desktopCompact.COMPACT_DEFAULT_MAX_CHARS);
  assert.equal(utils.CHAT_COMPACT_DEFAULTS.maxPerMessage, desktopCompact.COMPACT_DEFAULT_MAX_PER_MESSAGE);
});

// ── UTR command counts ────────────────────────────────────────────────────────

test("UTR registry exposes 42 commands / MCP default 33", async () => {
  const reg = await import(pathToFileURL(path.join(root, "utr", "core", "contract-registry.mjs")).href);
  const registry = await reg.loadContractRegistry();
  const cmds = reg.listCommands(registry);
  assert.equal(cmds.length, 42, `expected 42 UTR commands, got ${cmds.length}`);
  const byExp = { primary: 0, danger: 0, advanced: 0 };
  for (const c of cmds) {
    const exp = c.exposure || "advanced";
    byExp[exp] = (byExp[exp] || 0) + 1;
  }
  assert.equal(byExp.primary, 29, `expected 29 primary, got ${byExp.primary}`);
  assert.equal(byExp.danger, 4, `expected 4 danger, got ${byExp.danger}`);
  assert.equal(byExp.advanced, 9, `expected 9 advanced, got ${byExp.advanced}`);
  assert.equal(byExp.primary + byExp.danger, 33, `MCP default (primary+danger) must be 33`);
  // 9 command domains (kind field).
  const domains = new Set(cmds.map((c) => c.kind || c.domain || c.tool));
  assert.equal(domains.size, 9, `expected 9 command domains, got ${domains.size}`);
});

test("TOOLS.md command counts match the registry", () => {
  const tools = read("TOOLS.md");
  assert.match(tools, /9\s*(?:域|domains)\s*[\/／]\s*42\s*(?:命令|commands)/iu);
  assert.match(tools, /MCP default 33|默认只暴露 primary \+ danger（33 个）/u);
  // Section headers track the shipped exposure split (29 primary / 4 danger / 9 advanced).
  assert.match(tools, /Primary（Agent 日常 29）/u);
  assert.match(tools, /Danger（高风险 4/u);
  assert.match(tools, /Advanced（扩展 9/u);
});

test("topmind-pack.json command counts match the registry", (t) => {
  if (SKIP_SKILLS) {
    t.skip(SKIP_SKILLS);
    return;
  }
  const pack = JSON.parse(read(path.join(resolveSkillsRoot(), "topmind-pack.json")));
  assert.equal(pack.utr.command_count, 42);
  assert.equal(pack.utr.mcp_default_count, 33);
  const vocab = pack.utr.command_vocabulary;
  const vocabTotal = Object.values(vocab).reduce((n, list) => n + list.length, 0);
  assert.equal(vocabTotal, 42, `pack.json vocabulary must total 42, got ${vocabTotal}`);
  const exp = pack.utr.command_exposure;
  const primary = exp.primary.length;
  const danger = exp.danger.length;
  const advanced = exp.advanced.length;
  assert.equal(primary + danger, 33, `pack.json MCP default must be 33, got ${primary + danger}`);
  assert.equal(primary + danger + advanced, 42);
  // Domain list covers the same 9 domains.
  assert.equal(pack.utr.command_domains.length, 9);
});

test("UTR README command counts match the registry", () => {
  const readme = read("utr/README.md");
  assert.match(readme, /9\s*(?:域|domains)\s*[\/／]\s*42\s*(?:命令|commands)/iu);
  assert.match(readme, /MCP 默认 \*\*33\*\*/u);
});

function registrySurface(registry) {
  const surface = new Map();
  for (const [key, entry] of registry.byCommand) {
    if (entry.command.aliasOf) continue;
    surface.set(key, entry.command.exposure || "advanced");
  }
  return surface;
}

function commandsInCell(cell) {
  if (!cell || cell === "—" || cell === "-" || cell === "–") return [];
  const found = [];
  let danger = false;
  for (const chunk of cell.split("·")) {
    if (/danger\s*:/i.test(chunk)) danger = true;
    for (const match of chunk.matchAll(/`([a-z0-9-]+)`/gi)) {
      found.push({ name: match[1], danger });
    }
  }
  return found;
}

function tableRows(markdown, heading) {
  const start = markdown.indexOf(heading);
  assert.notEqual(start, -1, `missing heading ${heading}`);
  const next = markdown.indexOf("\n## ", start + heading.length);
  const section = markdown.slice(start, next === -1 ? undefined : next);
  const rows = [];
  for (const line of section.split("\n")) {
    if (!line.startsWith("| `")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length >= 2) rows.push(cells);
  }
  return rows;
}

function surfaceFromTools(markdown) {
  const surface = new Map();
  const heading = "## Current Command Surface";
  const start = markdown.indexOf(heading);
  assert.notEqual(start, -1, "TOOLS.md missing Current Command Surface");
  const next = markdown.indexOf("\n## ", start + heading.length);
  const section = markdown.slice(start, next === -1 ? undefined : next);
  let exposure = null;
  for (const line of section.split("\n")) {
    if (line.startsWith("### Primary")) exposure = "primary";
    else if (line.startsWith("### Danger")) exposure = "danger";
    else if (line.startsWith("### Advanced")) exposure = "advanced";
    else if (line.startsWith("### ") || line.startsWith("## ")) exposure = null;
    if (!exposure || !line.startsWith("| `")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    const domain = cells[0].replace(/`/g, "");
    if (!/^[a-z0-9-]+$/i.test(domain)) continue;
    for (const { name } of commandsInCell(cells[1])) {
      surface.set(`${domain}.${name}`, exposure);
    }
  }
  return surface;
}

function surfaceFromReadme(markdown, heading) {
  const surface = new Map();
  for (const cells of tableRows(markdown, heading)) {
    const domain = cells[0].replace(/`/g, "");
    for (const { name, danger } of commandsInCell(cells[1] || "")) {
      surface.set(`${domain}.${name}`, danger ? "danger" : "primary");
    }
    for (const { name } of commandsInCell(cells[2] || "")) {
      surface.set(`${domain}.${name}`, "advanced");
    }
  }
  return surface;
}

function assertSameSurface(label, actual, expected) {
  const missing = [];
  const extra = [];
  const exposure = [];
  for (const [key, value] of expected) {
    if (!actual.has(key)) missing.push(key);
    else if (actual.get(key) !== value) exposure.push(`${key} ${actual.get(key)} != ${value}`);
  }
  for (const key of actual.keys()) {
    if (!expected.has(key)) extra.push(key);
  }
  assert.deepEqual({ missing, extra, exposure }, { missing: [], extra: [], exposure: [] }, label);
}

test("UTR command names and MCP exposure match across registry, TOOLS, READMEs, and pack", async (t) => {
  const reg = await import(pathToFileURL(path.join(root, "utr", "core", "contract-registry.mjs")).href);
  const registry = await reg.loadContractRegistry();
  const expected = registrySurface(registry);
  assert.ok(expected.has("workspace-read.list-category-files"));
  assert.equal(expected.get("workspace-read.list-category-files"), "primary");
  for (const command of ["inspect", "snapshot", "matchLengthReport"]) {
    assert.equal(expected.get(`creator.${command}`), "primary", command);
  }
  const domains = new Set([...expected.keys()].map((key) => key.slice(0, key.indexOf("."))));
  assert.equal(domains.size, 9);
  assert.ok(domains.has("creator"));

  assertSameSurface("TOOLS.md", surfaceFromTools(read("TOOLS.md")), expected);
  for (const [file, heading] of [
    ["utr/README.md", "## 命令面"],
    ["utr/README.zh-CN.md", "## 命令面"],
    ["utr/README.en.md", "## Command surface"],
  ]) {
    assertSameSurface(file, surfaceFromReadme(read(file), heading), expected);
  }

  if (SKIP_SKILLS) {
    t.diagnostic(SKIP_SKILLS);
    return;
  }
  const skillsRoot = resolveSkillsRoot();
  const pack = JSON.parse(read(path.join(skillsRoot, "topmind-pack.json")));
  const fromPack = new Map();
  for (const [domain, commands] of Object.entries(pack.utr.command_vocabulary)) {
    for (const command of commands) fromPack.set(`${domain}.${command}`, "advanced");
  }
  for (const [exposure, ids] of Object.entries(pack.utr.command_exposure)) {
    for (const id of ids) fromPack.set(id, exposure);
  }
  assertSameSurface("topmind-pack.json", fromPack, expected);
  assert.equal(pack.utr.command_domains.length, domains.size);
  assert.equal(pack.utr.command_count, expected.size);
  assert.equal(
    pack.utr.mcp_default_count,
    [...expected.values()].filter((exposure) => exposure === "primary" || exposure === "danger").length,
  );

  const degradation = read(path.join(skillsRoot, "shared", "capability-degradation.md"));
  const omitted = [];
  for (const [key, exposure] of expected) {
    if (exposure !== "primary") continue;
    const command = key.slice(key.indexOf(".") + 1);
    const bare = new RegExp(`(?<![\\w.-])${command}(?![\\w-])`, "u");
    const qualified = new RegExp(`(?<![\\w.-])${key}(?![\\w-])`, "u");
    if (!bare.test(degradation) && !qualified.test(degradation)) omitted.push(key);
  }
  assert.deepEqual(omitted, [], "skill degradation table omits primary commands");
});

test("current command docs do not state retired UTR counts as the live surface", (t) => {
  const currentDocs = [
    "TOOLS.md",
    "DESIGN.md",
    "PRODUCT-BOUNDARIES.md",
    "SKILL-ARCHITECTURE.md",
    "AGENTS.md",
    "README.md",
    "README.en.md",
    "README.zh-CN.md",
    "utr/README.md",
    "utr/README.en.md",
    "utr/README.zh-CN.md",
    "topmind-desktop/DESIGN.md",
  ];
  if (!SKIP_SKILLS) {
    currentDocs.push(path.join(resolveSkillsRoot(), "shared", "capability-degradation.md"));
    currentDocs.push(path.join(resolveSkillsRoot(), "topmind-loop", "DESIGN.md"));
  } else {
    t.diagnostic(SKIP_SKILLS);
  }
  const retired = /8\s*域\s*[/／]\s*38|8\s*domains\s*[/／]\s*(?:28|38)|41\s*命令|39\s*[/／]\s*30|MCP 默认 \*\*(?:29|30|32)\*\*|MCP default (?:29|30|32)\b/iu;
  const hits = [];
  for (const file of currentDocs) {
    const text = read(file);
    if (retired.test(text)) hits.push(path.isAbsolute(file) ? path.relative(root, file) : file);
  }
  assert.deepEqual(hits, []);
});
