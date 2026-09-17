/**
 * Inventory of shipped Desktop AI tools vs source + write-gate.
 * Drives real name lists and the shipped builder source — no invented catalog.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AI_TOOL_NAMES_READ, AI_TOOL_NAMES_WRITE } from "../electron/lib/ai-tool-names.mjs";
import { buildSystemPrompt } from "../electron/ai-prompts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toolsSrc = readFileSync(path.join(root, "electron/ai-tools.mjs"), "utf8");
const namesSrc = readFileSync(path.join(root, "electron/lib/ai-tool-names.mjs"), "utf8");
const writeGate = readFileSync(path.resolve(root, "../lib/writeback-engine.mjs"), "utf8");

test("every listed Desktop AI tool is defined once in the shipped builder", () => {
  const all = [...AI_TOOL_NAMES_READ, ...AI_TOOL_NAMES_WRITE];
  for (const name of all) {
    const re = new RegExp(`tools\\.${name}\\s*=\\s*tool\\(`, "u");
    assert.match(toolsSrc, re, `missing tools.${name} = tool(`);
  }
  // No extra write tools advertised in the name list that the builder skipped
  const defined = [...toolsSrc.matchAll(/tools\.([a-z0-9_]+)\s*=\s*tool\(/gu)].map((m) => m[1]);
  for (const name of defined) {
    assert.ok(all.includes(name), `builder defines ${name} but name list does not`);
  }
});

test("write tools go through wrapWrite; reads are windowed/summarized", () => {
  for (const name of AI_TOOL_NAMES_WRITE) {
    const idx = toolsSrc.indexOf(`tools.${name} = tool(`);
    assert.ok(idx >= 0, name);
    // Window must cover bilingual d(zh,en) schema descriptions before execute.
    const nextTool = toolsSrc.indexOf("tools.", idx + 10);
    const end = nextTool > idx ? nextTool : idx + 8000;
    const slice = toolsSrc.slice(idx, end);
    assert.match(slice, /wrapWrite\s*\(/u, `${name} must use wrapWrite`);
  }
  assert.match(toolsSrc, /tools\.read_file = tool\([\s\S]{0,4000}?readPathWindow/u);
  assert.match(toolsSrc, /summarizeForModel/u);
});

test("delete_path reports reversibility from backupPath, not always-true", () => {
  const idx = toolsSrc.indexOf("tools.delete_path = tool(");
  assert.ok(idx >= 0);
  const slice = toolsSrc.slice(idx, idx + 2200);
  assert.match(slice, /reversible = Boolean\(r\?\.backupPath\)/u);
  assert.doesNotMatch(slice, /reversible:\s*true/u);
});

test("write-gate owns high-impact + recoverable-lifecycle classifiers", () => {
  assert.match(writeGate, /export function isHighImpactContentWrite/);
  assert.match(writeGate, /export function isRecoverableLifecycle/);
  assert.match(writeGate, /ordinary open content/u);
});

test("system prompt lists the shipped write/read names and honest delete policy", () => {
  const zh = buildSystemPrompt({
    workspaceContext: { userWorkspaceRoot: "/tmp/ws" },
    toolNames: [...AI_TOOL_NAMES_READ, ...AI_TOOL_NAMES_WRITE],
    writebackMode: "auto",
  });
  const en = buildSystemPrompt({
    workspaceContext: { userWorkspaceRoot: "/tmp/ws" },
    toolNames: [...AI_TOOL_NAMES_READ, ...AI_TOOL_NAMES_WRITE],
    writebackMode: "auto",
    locale: "en-US",
  });
  for (const name of ["read_file", "edit_file", "delete_path", "load_skill"]) {
    assert.match(zh, new RegExp(name, "u"));
    assert.match(en, new RegExp(name, "u"));
  }
  assert.match(zh, /仅锁定\/核心笔记进 trash|普通开放笔记不可恢复/u);
  assert.match(en, /ordinary open notes are irreversible|trash only for locked/i);
  assert.doesNotMatch(zh, /删除\uFF08可逆\uFF09与重命名/u);
  for (const name of ["retire_core_memory", "update_core_memory", "append_core_memory", "list_todos"]) {
    assert.match(zh, new RegExp(name, "u"));
    assert.match(en, new RegExp(name, "u"));
  }
  assert.match(zh, /不是只追加/u);
  assert.match(en, /not append-only/i);
  for (const name of ["read", "write", "edit", "grep"]) {
    assert.match(zh, new RegExp(`\`${name}\``, "u"), `zh missing alias ${name}`);
    assert.match(en, new RegExp(`\`${name}\``, "u"), `en missing alias ${name}`);
  }
  assert.match(zh, /没有 `bash`/u);
  assert.match(en, /`bash` is not available/u);
});

test("both locales advertise every shipped tool and teach no phantom name", () => {
  // The prompt's Tools section is hand-authored — `buildSystemPrompt` accepts a
  // `toolNames` option but deliberately ignores it. So it can drift from the
  // registry in two directions, both silent at runtime:
  //   · a shipped tool the model is never told about (unreachable feature), or
  //   · a name the model is told to call that no longer exists (phantom call).
  // Skills are ON here so skill tools must be advertised; a separate case locks
  // the skills-off strip so the model cannot call unregistered skill tools.
  const ALIASES = new Set(["bash", "edit", "find", "grep", "read", "write"]);
  const SKILL_TOOLS = new Set(["list_skills", "load_skill", "load_skill_resource"]);
  // Skill ids are backticked in the catalog section (routing), not tool names.
  const SKILL_IDS = new Set(["topmind", "topmind-capture", "topmind-organize", "topmind-write", "topmind-memory", "topmind-maintain", "topmind-loop"]);
  const registry = [...AI_TOOL_NAMES_READ, ...AI_TOOL_NAMES_WRITE];
  /** @type {Map<string, string[]>} */
  const claimed = new Map();

  for (const locale of ["zh-CN", "en-US"]) {
    const prompt = buildSystemPrompt({
      workspaceContext: { userWorkspaceRoot: "/tmp/ws" },
      writebackMode: "auto",
      skillsEnabled: true,
      locale,
    });
    const toks = new Set();
    for (const m of prompt.matchAll(/`([a-z][a-z0-9_]{2,})`/gu)) toks.add(m[1]);
    claimed.set(locale, [...toks].sort());

    const phantom = [...toks]
      .filter((t) => !registry.includes(t) && !ALIASES.has(t) && !SKILL_IDS.has(t) && !t.startsWith("topmind"))
      .sort();
    assert.deepEqual(
      phantom,
      [],
      `${locale} prompt teaches tool name(s) that are not registered: ${phantom.join(", ")}`,
    );
    const missing = registry.filter((t) => !toks.has(t)).sort();
    assert.deepEqual(
      missing,
      [],
      `${locale} prompt never names shipped tool(s) — the model cannot reach them: ${missing.join(", ")}`,
    );
    for (const s of SKILL_TOOLS) {
      assert.ok(toks.has(s), `${locale} must advertise ${s} when skills are enabled`);
    }
  }

  // Symmetry: neither locale may advertise a tool the other hides.
  assert.deepEqual(claimed.get("zh-CN"), claimed.get("en-US"), "zh-CN / en-US tool lists diverged");
});

test("skills-disabled prompt strips skill tools the model cannot call", () => {
  for (const locale of ["zh-CN", "en-US"]) {
    const prompt = buildSystemPrompt({
      workspaceContext: { userWorkspaceRoot: "/tmp/ws" },
      writebackMode: "auto",
      skillsEnabled: false,
      locale,
    });
    assert.doesNotMatch(prompt, /`list_skills`/u, `${locale} must not advertise list_skills when skills off`);
    assert.doesNotMatch(prompt, /`load_skill`/u, `${locale} must not advertise load_skill when skills off`);
    // Core write tools stay available.
    assert.match(prompt, /`edit_file`/u);
  }
});

test("name list source stays the single advertised Desktop catalog", () => {
  assert.match(namesSrc, /export const AI_TOOL_NAMES_READ/);
  assert.match(namesSrc, /export const AI_TOOL_NAMES_WRITE/);
  assert.equal(AI_TOOL_NAMES_READ.length, 15);
  assert.equal(AI_TOOL_NAMES_WRITE.length, 16);
  assert.ok(AI_TOOL_NAMES_READ.includes("list_todos"));
  assert.ok(AI_TOOL_NAMES_WRITE.includes("retire_core_memory"));
  assert.ok(AI_TOOL_NAMES_WRITE.includes("update_core_memory"));
  assert.ok(AI_TOOL_NAMES_WRITE.includes("add_todo"));
  assert.ok(AI_TOOL_NAMES_WRITE.includes("toggle_todo"));
});

test("living TOOLS.md inventory matches shipped names; dropped bash is absent", () => {
  const toolsMd = readFileSync(path.resolve(root, "../TOOLS.md"), "utf8");
  assert.match(toolsMd, /## Inventory \(keep \/ update \/ drop\)/);
  assert.match(toolsMd, /Desktop named AI tools — all \*\*keep\*\*/);
  assert.match(toolsMd, /Skills pack — all \*\*keep\*\*/);
  assert.match(toolsMd, /UTR commands — all \*\*keep\*\*/);
  assert.match(toolsMd, /drop — never registered/);
  assert.match(toolsMd, /8 域 \/ 28 命令/);
  const all = [...AI_TOOL_NAMES_READ, ...AI_TOOL_NAMES_WRITE];
  for (const name of all) {
    assert.match(toolsMd, new RegExp(`\`${name}\``, "u"), `TOOLS.md missing ${name}`);
  }
  for (const dropped of ["bash", "shell", "exec"]) {
    assert.ok(!all.includes(dropped), `${dropped} must not be in AI_TOOL_NAMES`);
    assert.doesNotMatch(toolsSrc, new RegExp(`tools\\.${dropped}\\s*=\\s*tool\\(`, "u"));
  }
  const pack = JSON.parse(readFileSync(path.resolve(root, "../skills/topmind-pack.json"), "utf8"));
  const skillIds = pack.skills.map((s) => s.id);
  for (const id of [
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
  ]) {
    assert.ok(skillIds.includes(id), id);
  }
  assert.match(toolsMd, /topmind-ledger/);
  assert.match(toolsMd, /Obsidian does not ship a ledger mini-app/);
  assert.match(toolsMd, /Pi native aliases/);
  assert.match(toolsMd, /keep as fenced aliases/);
  const arch = readFileSync(path.join(root, "ARCHITECTURE.md"), "utf8");
  for (const name of all) {
    assert.match(arch, new RegExp(`\`${name}\``, "u"), `ARCHITECTURE.md missing ${name}`);
  }
  assert.match(arch, /bash/);
  assert.match(arch, /read`→`read_file|read.*read_file/u);
});
