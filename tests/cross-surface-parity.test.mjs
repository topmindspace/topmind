/**
 * Cross-surface behavior parity:
 * - memory-fence rules (ledgers exemption + path keys) Desktop vs Obsidian
 * - compact budget formula resolveCompactBudget vs resolveChatCompactBudget
 * - UTR command counts (38 / MCP 29) registry vs TOOLS.md vs topmind-pack.json
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
  pathToFileURL(path.join(root, "topmind-desktop", "electron", "lib", "memory-fence.mjs")).href
);

test("Desktop memory-fence exempts ledgers and checks every path key", () => {
  const { isFencedMemoryPath, memoryFence, MEMORY_PATH_KEYS, MEMORY_WRITE_TOOLS } = fenceMod;
  assert.deepEqual([...MEMORY_PATH_KEYS].sort(), [
    "destRelativePath",
    "inboxRelativePath",
    "relativePath",
  ]);
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

test("Obsidian fence matches Desktop rules (ledgers exemption + path keys)", (t) => {
  if (SKIP_OBSIDIAN) {
    t.skip(SKIP_OBSIDIAN);
    return;
  }
  const obs = resolveObsidianRoot();
  const src = read(path.join(obs, "src", "services", "kernel-workspace-ops.ts"));
  // Same path-shaped args as Desktop MEMORY_PATH_KEYS.
  for (const key of ["relativePath", "destRelativePath", "inboxRelativePath"]) {
    assert.match(src, new RegExp(`call\\.${key}`), `Obsidian fence must check ${key}`);
  }
  // ledgers/ exemption (same rule as Desktop isFencedMemoryPath).
  assert.match(src, /memory\/ledgers/, "Obsidian must name memory/ledgers/");
  assert.match(src, /ledgers\(/u, "Obsidian must regex-test memory/ledgers for the exemption");
  // memory plane gate + same error code.
  assert.match(src, /write-blocked:memory-plane/);
  // Must not raw-rewrite the memory plane with generic file tools.
  assert.match(src, /isFencedMemoryPath/);
});

// ── compact budget formula ────────────────────────────────────────────────────

const desktopCompact = await import(
  pathToFileURL(path.join(root, "topmind-desktop", "electron", "lib", "ai-session-compact.mjs")).href
);

test("Desktop resolveCompactBudget scales with the model window", () => {
  const { resolveCompactBudget, COMPACT_DEFAULT_MAX_MESSAGES, COMPACT_DEFAULT_KEEP_RECENT } = desktopCompact;
  const unknown = resolveCompactBudget(0);
  assert.equal(unknown.maxMessages, COMPACT_DEFAULT_MAX_MESSAGES);
  assert.equal(unknown.keepRecent, COMPACT_DEFAULT_KEEP_RECENT);
  const big = resolveCompactBudget(200_000);
  assert.ok(big.maxMessages > unknown.maxMessages);
  assert.ok(big.maxChars > unknown.maxChars);
  const small = resolveCompactBudget(32_000);
  assert.ok(small.maxMessages < unknown.maxMessages);
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

test("UTR registry exposes 38 commands / MCP default 29", async () => {
  const reg = await import(pathToFileURL(path.join(root, "utr", "core", "contract-registry.mjs")).href);
  const registry = await reg.loadContractRegistry();
  const cmds = reg.listCommands(registry);
  assert.equal(cmds.length, 38, `expected 38 UTR commands, got ${cmds.length}`);
  const byExp = { primary: 0, danger: 0, advanced: 0 };
  for (const c of cmds) {
    const exp = c.exposure || "advanced";
    byExp[exp] = (byExp[exp] || 0) + 1;
  }
  assert.equal(byExp.primary, 25, `expected 25 primary, got ${byExp.primary}`);
  assert.equal(byExp.danger, 4, `expected 4 danger, got ${byExp.danger}`);
  assert.equal(byExp.advanced, 9, `expected 9 advanced, got ${byExp.advanced}`);
  assert.equal(byExp.primary + byExp.danger, 29, `MCP default (primary+danger) must be 29`);
  // 8 command domains (kind field).
  const domains = new Set(cmds.map((c) => c.kind || c.domain || c.tool));
  assert.equal(domains.size, 8, `expected 8 command domains, got ${domains.size}`);
});

test("TOOLS.md command counts match the registry", () => {
  const tools = read("TOOLS.md");
  assert.match(tools, /8\s*(?:域|domains)\s*[\/／]\s*38\s*(?:命令|commands)/iu);
  assert.match(tools, /MCP default 29|默认只暴露 primary \+ danger（29 个）/u);
  // Section headers track the shipped exposure split (25 primary / 4 danger / 9 advanced).
  assert.match(tools, /Primary（Agent 日常 25）/u);
  assert.match(tools, /Danger（高风险 4/u);
  assert.match(tools, /Advanced（扩展 9/u);
});

test("topmind-pack.json command counts match the registry", (t) => {
  if (SKIP_SKILLS) {
    t.skip(SKIP_SKILLS);
    return;
  }
  const pack = JSON.parse(read(path.join(resolveSkillsRoot(), "topmind-pack.json")));
  assert.equal(pack.utr.command_count, 38);
  assert.equal(pack.utr.mcp_default_count, 29);
  const vocab = pack.utr.command_vocabulary;
  const vocabTotal = Object.values(vocab).reduce((n, list) => n + list.length, 0);
  assert.equal(vocabTotal, 38, `pack.json vocabulary must total 38, got ${vocabTotal}`);
  const exp = pack.utr.command_exposure;
  const primary = exp.primary.length;
  const danger = exp.danger.length;
  const advanced = exp.advanced.length;
  assert.equal(primary + danger, 29, `pack.json MCP default must be 29, got ${primary + danger}`);
  assert.equal(primary + danger + advanced, 38);
  // Domain list covers the same 8 domains.
  assert.equal(pack.utr.command_domains.length, 8);
});

test("UTR README command counts match the registry", () => {
  const readme = read("utr/README.md");
  assert.match(readme, /8\s*(?:域|domains)\s*[\/／]\s*38\s*(?:命令|commands)/iu);
  assert.match(readme, /MCP 默认 \*\*29\*\*/u);
});
