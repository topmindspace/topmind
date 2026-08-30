/**
 * Kernel ledger-engine — parse/serialize/append/balance/path-resolve.
 * Inline fixtures match the referenced 50-其他/账本 ClassFund/Giggs/Mom shape.
 * Does not import live user workspace files.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  DEFAULT_LEDGER_ROLES,
  PERSONAL_LEDGER_ID,
  PERSONAL_LEDGER_NAME,
  parseLedgerMarkdown,
  serializeLedger,
  computeLedgerBalance,
  summarizeLedgerBooks,
  listLedgers,
  readLedger,
  appendLedgerEntry,
  addLedgerRole,
  addLedgerCategory,
  listLedgerCategories,
  parseLedgerCatalog,
  serializeLedgerCatalog,
  readLedgerCatalog,
  resolveLedgerRelPath,
  resolveLedgerDirRel,
  roleIdFromName,
} from "../lib/ledger-engine.mjs";
import { buildDefaultContract } from "../lib/contract-engine.mjs";

/** Frozen 50-账本 line shape (ClassFund / 班费) — abbreviated, not live user data. */
const CLASSFUND_FIXTURE = `# ClassFund Ledger

> Auto-generated from the Feishu canonical ledger base on 2026-08-08 14:52 CST.
> Cloud account: 班费
> Current balance: 0.00 元

## Transactions

- [2026-02-28 16:35:00] 收入 +3620.00 元
  分类：班费；子分类：初始余额；备注：初始余额
- [2026-02-28 16:37:00] 支出 -500.00 元
  分类：班费；子分类：开学布置；备注：Giggs 班费支出
- [2026-03-05 09:57:00] 支出 -22.90 元
  分类：班费
- [2026-03-23 17:54:00] 收入 +523.00 元
  分类：班费；子分类：存入
`;

/** Frozen Giggs personal book. */
const GIGGS_FIXTURE = `# Giggs Ledger

> Cloud account: Giggs
> Current balance: 2000.00 元

## Transactions

- [2026-02-28 16:33:00] 收入 +3000.00 元
  分类：Giggs；子分类：初始余额；备注：初始余额
- [2026-02-28 16:35:00] 支出 -500.00 元
  分类：Giggs；子分类：开学布置；备注：班费支出
- [2026-03-28 10:00:00] 支出 -500.00 元
  分类：Giggs；子分类：运动；备注：买羽毛球拍
`;

/** Frozen Mom book. */
const MOM_FIXTURE = `# Mom Ledger

> Cloud account: Mom
> Current balance: 110000.00 元

## Transactions

- [2026-02-28 16:33:00] 收入 +110000.00 元
  分类：Mom；子分类：初始余额；备注：初始余额
`;

function seedWorkspace(prefix, extraYaml = "") {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const d of ["00-收件箱", "10-动态", "20-专题", "88-输出", "99-归档", "memory"]) {
    fs.mkdirSync(path.join(ws, d), { recursive: true });
  }
  const contract = buildDefaultContract();
  fs.writeFileSync(
    path.join(ws, "topmind.yaml"),
    `contract_version: 4\nworkspace:\n  name: ledger-test\n  template: stream\nwriteback:\n  mode: auto\n  shadow: true\n${extraYaml}`,
    "utf8",
  );
  return { ws, contract };
}

describe("ledger-engine fixtures + roles", () => {
  it("shipped default is one personal / 自己 book, not ClassFund/Giggs/Mom", () => {
    const ids = DEFAULT_LEDGER_ROLES.map((r) => r.id);
    assert.deepEqual(ids, [PERSONAL_LEDGER_ID]);
    assert.equal(roleIdFromName("自己"), PERSONAL_LEDGER_ID);
    assert.equal(roleIdFromName("个人"), PERSONAL_LEDGER_ID);
    assert.equal(roleIdFromName("班费"), "班费");
    assert.ok(!ids.includes("ClassFund"));
    assert.ok(!ids.includes("Giggs"));
    assert.ok(!ids.includes("Mom"));
  });

  it("parses ClassFund/Giggs/Mom 50-账本 lines and recomputes running balance", () => {
    const cf = parseLedgerMarkdown(CLASSFUND_FIXTURE, { roleId: "ClassFund" });
    assert.equal(cf.accountName, "班费");
    assert.equal(cf.entries.length, 4);
    assert.equal(cf.entries[0].direction, "收入");
    assert.equal(cf.entries[0].amount, 3620);
    assert.equal(cf.entries[0].subcategory, "初始余额");
    assert.equal(cf.entries[1].direction, "支出");
    assert.equal(cf.entries[1].amount, 500);
    assert.equal(cf.entries[2].note, "");
    assert.equal(cf.entries[3].subcategory, "存入");
    assert.equal(cf.computedBalance, 3620 - 500 - 22.9 + 523);

    const giggs = parseLedgerMarkdown(GIGGS_FIXTURE, { roleId: "Giggs" });
    assert.equal(giggs.accountName, "Giggs");
    assert.equal(giggs.entries.length, 3);
    assert.equal(giggs.entries[2].note, "买羽毛球拍");
    assert.equal(computeLedgerBalance(giggs.entries), 2000);

    const mom = parseLedgerMarkdown(MOM_FIXTURE, { roleId: "Mom" });
    assert.equal(mom.accountName, "Mom");
    assert.equal(mom.entries.length, 1);
    assert.equal(computeLedgerBalance(mom.entries), 110000);
  });

  it("serialize round-trips 收入/支出 amount + 分类/子分类/备注 + Current balance", () => {
    const parsed = parseLedgerMarkdown(GIGGS_FIXTURE, { roleId: "Giggs" });
    const out = serializeLedger(parsed);
    assert.match(out, /^# Giggs Ledger/m);
    assert.match(out, /> Cloud account: Giggs/);
    assert.match(out, /> Current balance: 2000\.00 元/);
    assert.match(out, /\[2026-03-28 10:00:00\] 支出 -500\.00 元/);
    assert.match(out, /分类：Giggs；子分类：运动；备注：买羽毛球拍/);
    const again = parseLedgerMarkdown(out, { roleId: "Giggs" });
    assert.equal(again.entries.length, parsed.entries.length);
    assert.equal(again.entries[2].note, "买羽毛球拍");
    assert.equal(again.computedBalance, 2000);
  });
});

describe("ledger-engine writeback + memory.dir", () => {
  /** @type {{ ws: string }} */
  let env;

  before(() => {
    env = seedWorkspace("topmind-ledger-");
  });

  after(() => {
    fs.rmSync(env.ws, { recursive: true, force: true });
  });

  it("empty workspace lists personal/自己 only — not ClassFund/Giggs/Mom", () => {
    const books = listLedgers(env.ws);
    const ids = books.map((b) => b.roleId);
    assert.deepEqual(ids, [PERSONAL_LEDGER_ID]);
    assert.equal(books[0].accountName, PERSONAL_LEDGER_NAME);
    assert.equal(books[0].exists, false);
    assert.ok(!ids.includes("ClassFund"));
    assert.ok(!ids.includes("Giggs"));
    assert.ok(!ids.includes("Mom"));
    assert.equal(resolveLedgerDirRel(env.ws), "memory/ledgers");
    assert.equal(resolveLedgerRelPath(env.ws, PERSONAL_LEDGER_ID), "memory/ledgers/Personal.md");
  });

  it("append-only add updates running balance and returns writeback path + affected files", () => {
    const ledgersDir = path.join(env.ws, "memory", "ledgers");
    fs.mkdirSync(ledgersDir, { recursive: true });
    fs.writeFileSync(path.join(ledgersDir, "Giggs.md"), GIGGS_FIXTURE, "utf8");
    fs.writeFileSync(path.join(ledgersDir, "ClassFund.md"), CLASSFUND_FIXTURE, "utf8");
    fs.writeFileSync(path.join(ledgersDir, "Mom.md"), MOM_FIXTURE, "utf8");

    const before = readLedger(env.ws, "Giggs");
    assert.equal(before.entries.length, 3);
    assert.equal(before.balance, 2000);

    const result = appendLedgerEntry(env.ws, "Giggs", {
      direction: "支出",
      amount: 50,
      category: "Giggs",
      subcategory: "运动",
      note: "羽毛球拍补差",
      timestamp: "2026-08-29 10:00:00",
    });
    assert.equal(result.ok, true);
    assert.equal(result.targetPath, "memory/ledgers/Giggs.md");
    assert.ok(result.writebackEvidence);
    assert.equal(result.writebackEvidence.targetPath, "memory/ledgers/Giggs.md");
    assert.ok(Array.isArray(result.writebackEvidence.affectedFiles));
    assert.ok(result.writebackEvidence.affectedFiles.includes("memory/ledgers/Giggs.md"));
    assert.equal(result.writebackEvidence.wroteFiles, true);

    const after = readLedger(env.ws, "Giggs");
    assert.equal(after.entries.length, 4);
    assert.equal(after.entries[0].timestamp, "2026-02-28 16:33:00");
    assert.equal(after.entries[3].note, "羽毛球拍补差");
    assert.equal(after.balance, 1950);
    const onDisk = fs.readFileSync(path.join(ledgersDir, "Giggs.md"), "utf8");
    assert.match(onDisk, /Current balance: 1950\.00 元/);
    assert.match(onDisk, /羽毛球拍补差/);
    assert.match(onDisk, /初始余额/);
  });

  it("multi-book by role: ClassFund and Mom stay independent", () => {
    const cf = readLedger(env.ws, "ClassFund");
    const mom = readLedger(env.ws, "Mom");
    assert.equal(cf.accountName, "班费");
    assert.equal(mom.accountName, "Mom");
    assert.notEqual(cf.relPath, mom.relPath);
    assert.equal(mom.balance, 110000);
  });

  it("custom memory.dir does not twin-write memory/", () => {
    const { ws } = seedWorkspace("topmind-ledger-memdir-", "memory:\n  dir: notes-mem\n");
    try {
      const result = appendLedgerEntry(ws, PERSONAL_LEDGER_ID, {
        direction: "收入",
        amount: 523,
        category: "工资",
        note: "入账",
        timestamp: "2026-03-23 17:54:00",
      });
      assert.equal(result.ok, true);
      assert.equal(result.targetPath, "notes-mem/ledgers/Personal.md");
      assert.ok(fs.existsSync(path.join(ws, "notes-mem", "ledgers", "Personal.md")));
      assert.equal(fs.existsSync(path.join(ws, "memory", "ledgers", "Personal.md")), false);
      const book = readLedger(ws, PERSONAL_LEDGER_ID);
      assert.equal(book.balance, 523);
      assert.equal(book.relPath, "notes-mem/ledgers/Personal.md");
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("user-added book + user 分类 round-trip; historical names appear only if files exist", () => {
    const result = addLedgerRole(env.ws, { id: "Family", name: "家庭" });
    assert.equal(result.ok, true);
    assert.equal(result.targetPath, "memory/ledgers/Family.md");
    const cat = addLedgerCategory(env.ws, "餐饮");
    assert.equal(cat.ok, true);
    const added = appendLedgerEntry(env.ws, "Family", {
      direction: "支出",
      amount: 32,
      category: "餐饮",
      note: "午饭",
      timestamp: "2026-08-29 12:00:00",
    });
    assert.equal(added.ok, true);
    const family = readLedger(env.ws, "Family");
    assert.equal(family.accountName, "家庭");
    assert.equal(family.entries[0].category, "餐饮");
    const cats = listLedgerCategories(env.ws);
    assert.ok(cats.includes("餐饮"));
    const ids = listLedgers(env.ws).map((b) => b.roleId);
    assert.ok(ids.includes(PERSONAL_LEDGER_ID));
    assert.ok(ids.includes("Family"));
    assert.ok(ids.includes("Giggs")); // seeded as historical file in prior test
    const summary = summarizeLedgerBooks(listLedgers(env.ws));
    assert.ok(summary.expense >= 32);
    assert.ok(summary.byCategory.some((c) => c.category === "餐饮"));
  });

  it("catalog parse/serialize + addLedgerCategory writes via writeback under memory/ledgers/", () => {
    const { ws } = seedWorkspace("topmind-ledger-catalog-");
    try {
      const written = addLedgerCategory(ws, "餐饮");
      assert.equal(written.ok, true);
      assert.equal(written.targetPath, "memory/ledgers/catalog.md");
      assert.ok(written.writebackEvidence);
      assert.equal(written.writebackEvidence.wroteFiles, true);
      assert.ok(written.writebackEvidence.affectedFiles.includes("memory/ledgers/catalog.md"));
      const onDisk = fs.readFileSync(path.join(ws, "memory", "ledgers", "catalog.md"), "utf8");
      const parsed = parseLedgerCatalog(onDisk);
      assert.deepEqual(parsed.categories, ["餐饮"]);
      const round = serializeLedgerCatalog(parsed);
      assert.deepEqual(parseLedgerCatalog(round).categories, ["餐饮"]);
      const catalog = readLedgerCatalog(ws);
      assert.equal(catalog.exists, true);
      assert.equal(catalog.relPath, "memory/ledgers/catalog.md");
      assert.ok(catalog.categories.includes("餐饮"));
      assert.ok(listLedgerCategories(ws).includes("餐饮"));
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});

it("rewrite replays Transactions verbatim — hand-written lines survive appends", async () => {
  const { parseLedgerMarkdown, serializeLedger } = await import("../lib/ledger-engine.mjs");
  const raw = [
    "# Personal Ledger",
    "",
    "> Cloud account: 自己",
    "> Current balance: -25.50 元",
    "",
    "## Transactions",
    "",
    "- [2024-01-01 10:00:00] 支出 -25.5 元",
    "  分类：交通；备注：地铁",
    "手写的一行备注不会被丢掉",
    "",
  ].join("\n");
  const parsed = parseLedgerMarkdown(raw, { roleId: "Personal" });
  const serialized = serializeLedger({
    ...parsed,
    entries: [
      ...parsed.entries,
      { timestamp: "2024-01-02 09:00:00", direction: "支出", amount: 3, category: "", subcategory: "", note: "" },
    ],
  });
  assert.match(serialized, /手写的一行备注不会被丢掉/, "raw user line must survive");
  assert.match(serialized, /- \[2024-01-01 10:00:00\] 支出 -25\.5 元/, "historical entry stays verbatim");
  assert.match(serialized, /支出 -3\.00 元/, "appended entry is formatted");
  // New entry appended after the replayed content
  const replayedIdx = serialized.indexOf("手写的一行备注");
  const appendedIdx = serialized.indexOf("支出 -3.00 元");
  assert.ok(appendedIdx > replayedIdx, "append lands after replayed history");
});

it("append preserves balance computation from parsed entries (no header drift)", async () => {
  const { parseLedgerMarkdown, computeLedgerBalance } = await import("../lib/ledger-engine.mjs");
  const raw = [
    "# Personal Ledger",
    "",
    "> Current balance: 999.00 元",
    "",
    "## Transactions",
    "",
    "- [2024-01-01 10:00:00] 支出 -25.5 元",
    "",
  ].join("\n");
  const parsed = parseLedgerMarkdown(raw, { roleId: "Personal" });
  // readLedger semantics: balance always from entries, never the stale header
  assert.equal(parsed.computedBalance, -25.5);
  assert.equal(computeLedgerBalance(parsed.entries), -25.5);
});
