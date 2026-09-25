// Cross-surface memory consolidation + AI engine alignment (Desktop ↔ Obsidian).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, ".."); // topmind/
const parent = path.resolve(repo, ".."); // topmind-solutions/
const desktop = path.join(repo, "topmind-desktop");
const obsidian = path.join(parent, "topmind-obsidian");

describe("memory consolidation is fusion, not blind append", () => {
  test("appendProfileEntry near-dup fuses to newest wording", async () => {
    const eng = await import(pathToFileURL(path.join(repo, "lib", "memory-engine.mjs")).href);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tm-align-mem-"));
    try {
      eng.appendProfileEntry({
        workspaceRoot: tmp,
        entry: { section: "进行中的事", content: "- 推进 topmind 记忆机制设计" },
      });
      const fused = eng.appendProfileEntry({
        workspaceRoot: tmp,
        entry: { section: "进行中的事", content: "- 推进 topmind 记忆机制设计联调" },
      });
      assert.notEqual(fused.reason, "duplicate-fact");
      const body = fs.readFileSync(path.join(tmp, "memory", "profile.md"), "utf8");
      const live = body.split(/## 历史记录|## History/u)[0];
      assert.equal((live.match(/推进 topmind 记忆机制设计/gu) || []).length, 1);
      assert.match(live, /联调/u);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("kernel-api exports the consolidation helpers", async () => {
    const api = await import(pathToFileURL(path.join(repo, "lib", "kernel-api.mjs")).href);
    for (const name of [
      "compactProfileHistory",
      "findIntraProfileNearDups",
      "findLiveFactConflictsInBody",
      "findConflictingProfileFacts",
      "appendProfileEntry",
      "updateProfileEntry",
      "retireProfileEntry",
    ]) {
      assert.equal(typeof api[name], "function", `kernel-api missing ${name}`);
    }
  });

  test("memory_organize offers fuse + history-compact cards", async () => {
    const src = fs.readFileSync(path.join(repo, "lib", "ai-operation-engine.mjs"), "utf8");
    assert.match(src, /findIntraProfileNearDups/);
    assert.match(src, /compact_history/);
    const sug = fs.readFileSync(path.join(repo, "lib", "suggest-engine.mjs"), "utf8");
    assert.match(sug, /compact_history/);
    assert.match(sug, /compactProfileHistory/);
    assert.match(sug, /findConflictingProfileFacts/);
  });
});

describe("Obsidian AI engine aligns with Desktop", () => {
  const adapter = fs.readFileSync(path.join(desktop, "electron", "ai-provider-adapter.mjs"), "utf8");
  const provider = fs.readFileSync(path.join(obsidian, "src", "bridge", "ai-provider.ts"), "utf8");
  const ops = fs.readFileSync(path.join(obsidian, "src", "services", "kernel-workspace-ops.ts"), "utf8");

  test("OP_LIMITS token budgets match Desktop", () => {
    // Desktop truth
    assert.match(adapter, /topic_summary:\s*16384/);
    assert.match(adapter, /memory_organize:\s*12288/);
    assert.match(adapter, /memory_extract:\s*4096/);
    assert.match(adapter, /todo_extract:\s*12288/);
    // Obsidian must match those numbers (not the old 2048/6144 fork)
    assert.match(provider, /return 16384/);
    assert.match(provider, /return 12288/);
    assert.match(provider, /return 4096/);
    assert.doesNotMatch(provider, /return 2048/);
    assert.doesNotMatch(provider, /return 6144/);
  });

  test("reasoning-model detection uses the tight Desktop regex", () => {
    assert.match(provider, /\/\^o\[134\]\(-mini\|-preview\)\?\(\?:\[-\/\]\|\$\)\/\.test\(lower\)/);
    assert.doesNotMatch(provider, /lower\.startsWith\("o1"\)/);
    assert.doesNotMatch(provider, /lower\.startsWith\("o3"\)/);
  });

  test("timeouts are per-operation (chat is not 30s)", () => {
    assert.match(provider, /chat:\s*480_000/);
    assert.doesNotMatch(provider, /REQUEST_TIMEOUT_MS\s*=\s*30_000/);
  });

  test("reasoning models self-heal the system role", () => {
    assert.match(provider, /systemRejected/);
    assert.match(provider, /role: "user", content: `\$\{opts\.systemPrompt\}/);
  });

  test("cancel keeps partial answer; memory plane is fenced", () => {
    assert.match(ops, /partial && !parseToolCall\(lastRaw\)/);
    assert.match(ops, /write-blocked:memory-plane/);
    const tools = fs.readFileSync(path.join(desktop, "electron", "ai-tools.mjs"), "utf8");
    assert.match(tools, /memoryFence|memory-fence/);
    const fence = fs.readFileSync(path.join(desktop, "electron", "lib", "memory-fence.mjs"), "utf8");
    assert.match(fence, /MEMORY_WRITE_TOOLS/);
    assert.match(fence, /write-blocked:memory-plane/);
    assert.match(fence, /memory\/ledgers/);
  });

  test("temperature tables agree on the low-temp ops", () => {
    assert.match(provider, /memory_organize[\s\S]{0,80}return 0\.3/);
    assert.match(adapter, /memory_organize/);
  });
});

describe("living docs state the fusion + AI alignment contract", () => {
  const parentDocs = path.join(parent, "topmind");

  test("PROJECT-MODEL documents fusion, not blind append", () => {
    const pm = fs.readFileSync(path.join(parentDocs, "PROJECT-MODEL.md"), "utf8");
    assert.match(pm, /融合到最新表述/);
    assert.match(pm, /compactProfileHistory|历史压缩/);
    assert.doesNotMatch(pm, /追加\*\*（ADD）：`appendProfileEntry` —— 去重 \+ 消毒后写入活跃段落（既有）/u);
  });

  test("AGENTS Memory row mentions fusion and compact", () => {
    const agents = fs.readFileSync(path.join(parentDocs, "AGENTS.md"), "utf8");
    assert.match(agents, /append 融合/);
    assert.match(agents, /compact-history/);
  });

  test("Obsidian ARCHITECTURE documents Desktop AI alignment", () => {
    const arch = fs.readFileSync(path.join(parentDocs, "..", "topmind-obsidian", "ARCHITECTURE.md"), "utf8");
    assert.match(arch, /OP_LIMITS/);
    assert.match(arch, /chat 480s/);
    assert.match(arch, /system 自愈|折进首条 user/);
    assert.match(arch, /obsidian-guideline-compliance/);
    assert.match(arch, /会话压缩|maxMessages 60/);
  });

  test("Obsidian DESIGN documents compact_history and chat compact", () => {
    const design = fs.readFileSync(path.join(parentDocs, "..", "topmind-obsidian", "DESIGN.md"), "utf8");
    assert.match(design, /compact_history/);
    assert.match(design, /会话压缩|maxMessages 60/);
    assert.match(design, /相似命中/);
  });
});
