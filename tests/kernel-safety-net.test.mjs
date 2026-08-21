/**
 * Kernel safety net — coverage gaps identified in the architecture audit:
 * lifecycle-engine scan · memory-engine layers · contract v3→v4 migration ·
 * protect gate boundary conditions.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { scanLifecycle } from "../lib/lifecycle-engine.mjs";
import {
  ensureMemoryPlane,
  resolveMemoryLayerPath,
  readMemoryLayer,
  appendProfileEntry,
} from "../lib/memory-engine.mjs";
import {
  buildDefaultContract,
  migrateV3ToV4,
  loadContract,
  validateContract,
  resolveProtection,
  CONTRACT_VERSION,
} from "../lib/contract-engine.mjs";
import { evaluateWritePermission, peekFrontmatter } from "../lib/writeback-engine.mjs";
import { validateAiOutput } from "../lib/ai-content-sanitize.mjs";

const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DAY = 24 * 60 * 60 * 1000;

function makeWs(prefix) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const d of ["00-收件箱", "10-动态", "20-专题", "88-输出", "99-归档"]) {
    fs.mkdirSync(path.join(ws, d), { recursive: true });
  }
  fs.writeFileSync(
    path.join(ws, "topmind.yaml"),
    "contract_version: 4\nworkspace:\n  template: stream\n",
    "utf8",
  );
  return ws;
}

function writeAged(filePath, content, daysOld) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  const past = new Date(Date.now() - daysOld * DAY);
  fs.utimesSync(filePath, past, past);
}

describe("lifecycle-engine scanLifecycle", () => {
  let ws;
  before(() => {
    ws = makeWs("topmind-lc-");
    writeAged(path.join(ws, "00-收件箱", "old-note.md"), "# old\n", 10);
    fs.writeFileSync(path.join(ws, "00-收件箱", "fresh.md"), "# fresh\n", "utf8");
    // stale topic: dir named YYYY- with old topic.md
    writeAged(path.join(ws, "20-专题", "2024-旧研究", "topic.md"), "# 旧研究\n", 120);
    writeAged(path.join(ws, "88-输出", "2025-01-01-report.md"), "# report\n", 60);
  });
  after(() => fs.rmSync(ws, { recursive: true, force: true }));

  it("detects old inbox files but not fresh ones", () => {
    const contract = buildDefaultContract();
    const c = scanLifecycle({ workspaceRoot: ws, contract, engineRoot });
    assert.equal(c.inboxReview.length, 1);
    assert.match(c.inboxReview[0].path, /old-note\.md$/);
    assert.ok(c.inboxReview[0].daysOld >= 9);
  });

  it("detects stale topics and output lock candidates", () => {
    const contract = buildDefaultContract();
    const c = scanLifecycle({ workspaceRoot: ws, contract, engineRoot });
    assert.equal(c.staleTopics.length, 1);
    assert.match(c.staleTopics[0].path.replace(/\\/g, "/"), /2024-旧研究$/);
    assert.equal(c.outputLock.length, 1);
  });

  it("respects contract lifecycle thresholds", () => {
    const contract = buildDefaultContract();
    contract.lifecycle.inbox.review_after_days = 30; // old-note (10d) now fresh
    const c = scanLifecycle({ workspaceRoot: ws, contract, engineRoot });
    assert.equal(c.inboxReview.length, 0);
  });

  it("returns empty candidate lists on empty workspace without throwing", () => {
    const empty = makeWs("topmind-lc-empty-");
    try {
      const c = scanLifecycle({ workspaceRoot: empty, contract: buildDefaultContract(), engineRoot });
      for (const key of ["inboxReview", "catchAllCleanup", "staleTopics", "outputLock", "streamDigest"]) {
        assert.deepEqual(c[key], [], `${key} should be empty`);
      }
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it("streamDigest candidates carry a real period stem and yearDir relPath", () => {
    const streamWs = makeWs("topmind-lc-digest-");
    try {
      const yearDir = path.join(streamWs, "10-动态", "2026");
      fs.mkdirSync(yearDir, { recursive: true });
      for (let w = 20; w <= 30; w++) {
        const stem = `2026-W${String(w).padStart(2, "0")}`;
        fs.writeFileSync(path.join(yearDir, `${stem}.md`), `# ${stem}\n\n- note for ${stem}\n`, "utf8");
      }
      const c = scanLifecycle({
        workspaceRoot: streamWs,
        contract: buildDefaultContract(),
        engineRoot,
      });
      assert.ok(c.streamDigest.length > 0, "expected digest candidates beyond digest_after_periods");
      for (const item of c.streamDigest) {
        assert.equal(typeof item.period, "string");
        assert.match(item.period, /^\d{4}-W\d{2}$/u);
        assert.notEqual(item.period, "undefined");
        assert.ok(item.path);
        assert.ok(item.relPath);
        assert.match(String(item.relPath).replace(/\\/g, "/"), /10-动态\/2026\/2026-W\d{2}\.md$/u);
        assert.equal(typeof item.periodsOld, "number");
        assert.equal(path.basename(item.path, ".md"), item.period);
      }
    } finally {
      fs.rmSync(streamWs, { recursive: true, force: true });
    }
  });
});

describe("memory-engine layers", () => {
  let ws;
  before(() => {
    ws = makeWs("topmind-mem-");
  });
  after(() => fs.rmSync(ws, { recursive: true, force: true }));

  it("ensureMemoryPlane creates 3-layer structure idempotently", () => {
    ensureMemoryPlane(ws);
    ensureMemoryPlane(ws);
    assert.ok(fs.existsSync(path.join(ws, "memory", "periodic")));
    assert.ok(fs.existsSync(path.join(ws, "memory", "topics")));
  });

  it("resolveMemoryLayerPath rejects unknown layers", () => {
    assert.throws(() => resolveMemoryLayerPath(ws, "nope"), /Unknown memory layer/);
  });

  it("readMemoryLayer requires identifier for non-global layers", () => {
    assert.throws(() => readMemoryLayer(ws, "periodic"), /identifier required/);
    assert.equal(readMemoryLayer(ws, "periodic", "2026-W30"), "");
  });

  it("appendProfileEntry creates profile, appends to section, and dedupes", () => {
    const contract = buildDefaultContract();
    const r1 = appendProfileEntry({
      workspaceRoot: ws,
      entry: { section: "偏好", content: "- 喜欢晨间写作" },
      contract,
    });
    assert.notEqual(r1.operation, "skip");
    const body = readMemoryLayer(ws, "global");
    assert.match(body, /## 偏好[\s\S]*晨间写作/);

    const r2 = appendProfileEntry({
      workspaceRoot: ws,
      entry: { section: "偏好", content: "- 喜欢晨间写作" },
      contract,
    });
    assert.equal(r2.operation, "skip");
    assert.equal(r2.reason, "duplicate-fact");
  });

  it("appendProfileEntry rejects placeholder / polluted content", () => {
    const r = appendProfileEntry({
      workspaceRoot: ws,
      entry: { section: "偏好", content: "（此处填写用户偏好）" },
      contract: buildDefaultContract(),
    });
    assert.equal(r.operation, "skip");
  });
});

describe("contract-engine migration & validation", () => {
  it("migrateV3ToV4 carries template, separator, locale, extensions", () => {
    const v4 = migrateV3ToV4({
      template: "research",
      separator: " ",
      locale: "en-US",
      categoryExtensions: { 30: { name: "阅读", role: "deep-work" } },
      stream: { packing: "daily" },
    });
    assert.equal(v4.contract_version, CONTRACT_VERSION);
    assert.equal(v4.workspace.template, "research");
    assert.equal(v4.workspace.category_separator, " ");
    assert.equal(v4.workspace.locale, "en-US");
    assert.equal(v4.categories.extensions["30"].name, "阅读");
    assert.equal(v4.stream.packing, "daily");
    assert.deepEqual(validateContract(v4), { valid: true, errors: [] });
  });

  it("loadContract does not treat .topmind-config.json as operational truth", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "topmind-legacy-"));
    try {
      fs.writeFileSync(
        path.join(ws, ".topmind-config.json"),
        JSON.stringify({ template: "balanced", locale: "zh-CN" }),
        "utf8",
      );
      const contract = loadContract(ws);
      // Defaults only — v3 JSON is ensureContract's one-shot migrate, not a hot read.
      assert.equal(contract.workspace.template, "stream");
      assert.equal(contract.template, undefined);
      assert.equal(contract.contract_version, CONTRACT_VERSION);
      assert.ok(!fs.existsSync(path.join(ws, "topmind.yaml")));
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("loadContract survives corrupt topmind.yaml with defaults", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "topmind-corrupt-"));
    try {
      fs.writeFileSync(path.join(ws, "topmind.yaml"), "  :::: not yaml [", "utf8");
      const contract = loadContract(ws);
      assert.equal(contract.contract_version, CONTRACT_VERSION);
      assert.ok(contract.workspace);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("validateContract flags unknown top-level keys and bad version", () => {
    const bad = { contract_version: 3, rogue_key: true };
    const r = validateContract(bad);
    assert.equal(r.valid, false);
    assert.equal(r.errors.length, 2);
  });

  it("loadContract result passes validateContract (no false alias errors)", () => {
    // Regression: loadContract() used to inject v3 flat aliases
    // (categoryExtensions/categoryOverrides/template/categorySeparator) as
    // top-level keys, which validateContract() would flag as "unknown".
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "topmind-validate-"));
    try {
      fs.writeFileSync(
        path.join(ws, "topmind.yaml"),
        "contract_version: 4\nworkspace:\n  template: stream\n  category_separator: \"-\"\ncategories:\n  extensions: {}\n  overrides: {}\n",
        "utf8",
      );
      const contract = loadContract(ws);
      const result = validateContract(contract);
      assert.equal(result.valid, true, `Expected valid, got errors: ${result.errors.join("; ")}`);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("resolveProtection: .topmind/ machine state is always open", () => {
    const contract = buildDefaultContract();
    assert.equal(resolveProtection(contract, ".topmind/index.json", "system"), "open");
  });

  it("resolveProtection: partial by_role merges defaults; system stays locked", () => {
    const contract = {
      contract_version: 4,
      protection: {
        defaults: {
          by_role: { buffer: "open" }, // system omitted — must still lock via defaults merge
        },
      },
    };
    assert.equal(resolveProtection(contract, "99-归档/x.md", "system"), "locked");
    assert.equal(resolveProtection(contract, "00-收件箱/a.md", "buffer"), "open");
  });
});

describe("protect gate boundaries (evaluateWritePermission)", () => {
  let ws;
  before(() => {
    ws = makeWs("topmind-gate-");
  });
  after(() => fs.rmSync(ws, { recursive: true, force: true }));

  it("denies writes outside workspace (traversal)", () => {
    const contract = buildDefaultContract();
    const r = evaluateWritePermission({
      contract,
      targetPath: path.join(ws, "..", "evil.md"),
      workspaceRoot: ws,
    });
    assert.equal(r.allowed, false);
    assert.match(r.reason, /outside workspace/);
  });

  it("denies writing to workspace root itself", () => {
    const r = evaluateWritePermission({
      contract: buildDefaultContract(),
      targetPath: ws,
      workspaceRoot: ws,
    });
    assert.equal(r.allowed, false);
  });

  it("frontmatter protection: locked denies AI but allows user", () => {
    const contract = buildDefaultContract();
    const target = path.join(ws, "20-专题", "2026-测试", "topic.md");
    const fm = { protection: "locked" };
    const ai = evaluateWritePermission({ contract, targetPath: target, workspaceRoot: ws, frontmatter: fm, actor: "ai" });
    assert.equal(ai.allowed, false);
    const user = evaluateWritePermission({ contract, targetPath: target, workspaceRoot: ws, frontmatter: fm, actor: "user" });
    assert.equal(user.allowed, true);
  });

  it("confirm mode: AI writes need confirm, user writes do not", () => {
    const contract = buildDefaultContract();
    contract.writeback.mode = "confirm";
    const target = path.join(ws, "10-动态", "2026-W32.md");
    const ai = evaluateWritePermission({ contract, targetPath: target, workspaceRoot: ws, actor: "ai" });
    assert.equal(ai.needsConfirm, true);
    const user = evaluateWritePermission({ contract, targetPath: target, workspaceRoot: ws, actor: "user" });
    assert.equal(user.needsConfirm, false);
  });

  it("override wins over contract mode in both directions", () => {
    const contract = buildDefaultContract(); // auto
    const target = path.join(ws, "10-动态", "x.md");
    const forced = evaluateWritePermission({
      contract, targetPath: target, workspaceRoot: ws, actor: "ai", writebackModeOverride: "confirm",
    });
    assert.equal(forced.needsConfirm, true);
    contract.writeback.mode = "confirm";
    const relaxed = evaluateWritePermission({
      contract, targetPath: target, workspaceRoot: ws, actor: "ai", writebackModeOverride: "auto",
    });
    assert.equal(relaxed.needsConfirm, false);
  });

  it("peekFrontmatter handles complex multi-line frontmatter without losing protection", () => {
    const fm = peekFrontmatter(
      "---\ntitle: 测试\ntags:\n  - a\n  - b\nmeta:\n  nested: true\nprotection: locked\n---\n\n# body\n",
    );
    assert.equal(fm.protection, "locked");
    assert.equal(fm.title, "测试");
  });
});

describe("AI content policy (validateAiOutput)", () => {
  it("body layer accepts clean text and rejects placeholders / dumps", () => {
    const good = validateAiOutput("本周完成了架构拆分，产出四个模块。", "derived");
    assert.equal(good.ok, true);
    assert.match(good.text, /架构拆分/);

    const placeholder = validateAiOutput("（待 AI 生成）", "derived");
    assert.equal(placeholder.ok, false);

    const jsonDump = validateAiOutput('{"profile": {"add": ["x"]}, "periodic": []}', "memory");
    assert.equal(jsonDump.ok, false);

    const thinking = validateAiOutput("思考过程：首先我需要分析这个问题的本质然后得出结论", "suggest");
    assert.equal(thinking.ok, false);
  });

  it("line layer extracts clean bullets and caps count", () => {
    const raw = "- 喜欢晨间写作\n- placeholder text here\n- 每周跑步三次";
    const r = validateAiOutput(raw, "profile-lines");
    assert.equal(r.ok, true);
    assert.deepEqual(r.lines, ["喜欢晨间写作", "每周跑步三次"]);

    const empty = validateAiOutput("<think>internal</think>", "todo-lines");
    assert.equal(empty.ok, false);
    assert.deepEqual(empty.lines, []);
  });
});
