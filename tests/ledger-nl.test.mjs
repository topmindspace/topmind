/**
 * Shipped NL/AI ledger capture path — drives kernel-api captureLedgerPhrase.
 * Does not re-implement the parser in the test.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  parseLedgerCapture,
  captureLedgerPhrase,
  readLedger,
  addLedgerRole,
  addLedgerCategory,
  PERSONAL_LEDGER_ID,
  LEDGER_CAPTURE_TRIGGERS,
  LEDGER_READ_TRIGGERS,
} from "../lib/kernel-api.mjs";

describe("ledger NL/AI capture", () => {
  it("ships the must-have capture and read triggers", () => {
    for (const t of ["记账", "记一笔", "花了", "存入"]) {
      assert.ok(LEDGER_CAPTURE_TRIGGERS.includes(t), t);
    }
    for (const t of ["查看账单", "账户余额"]) {
      assert.ok(LEDGER_READ_TRIGGERS.includes(t), t);
    }
  });

  it("花了 50 买羽毛球拍 → 支出 into the personal default book", async () => {
    const parsed = await captureLedgerPhrase(null, "花了 50 买羽毛球拍");
    assert.equal(parsed.ok, true);
    assert.equal(parsed.intent, "capture");
    assert.equal(parsed.complete, true);
    assert.equal(parsed.direction, "支出");
    assert.equal(parsed.amount, 50);
    assert.equal(parsed.roleId, PERSONAL_LEDGER_ID);
    assert.match(String(parsed.note), /羽毛球拍/);
    assert.equal(parsed.persisted, false);
  });

  it("存入 523 班费 does not invent ClassFund when that book does not exist", async () => {
    const parsed = await captureLedgerPhrase(null, "存入 523 班费");
    assert.equal(parsed.ok, true);
    assert.equal(parsed.intent, "capture");
    assert.equal(parsed.complete, true);
    assert.equal(parsed.direction, "收入");
    assert.equal(parsed.amount, 523);
    assert.equal(parsed.roleId, PERSONAL_LEDGER_ID);
    assert.notEqual(parsed.roleId, "ClassFund");
  });

  it("记一笔 is a capture intent even without amount", async () => {
    const parsed = await captureLedgerPhrase(null, "记一笔");
    assert.equal(parsed.ok, true);
    assert.equal(parsed.intent, "capture");
    assert.equal(parsed.complete, false);
    assert.equal(parsed.persisted, false);
  });

  it("查看账单 / 账户余额 are structured reads", () => {
    const list = parseLedgerCapture("查看账单");
    assert.equal(list.ok, true);
    assert.equal(list.intent, "list");
    assert.equal(list.complete, true);

    const bal = parseLedgerCapture("账户余额");
    assert.equal(bal.ok, true);
    assert.equal(bal.intent, "balance");
    assert.equal(bal.roleId, PERSONAL_LEDGER_ID);
  });

  it("persist writes unnamed 存入 onto the personal book, not ClassFund", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "topmind-ledger-nl-"));
    try {
      for (const d of ["00-收件箱", "10-动态", "88-输出", "99-归档", "memory"]) {
        fs.mkdirSync(path.join(ws, d), { recursive: true });
      }
      fs.writeFileSync(
        path.join(ws, "topmind.yaml"),
        "contract_version: 4\nworkspace:\n  template: stream\nwriteback:\n  mode: auto\n",
        "utf8",
      );
      const parsed = await captureLedgerPhrase(ws, "存入 523 班费", { persist: true });
      assert.equal(parsed.ok, true);
      assert.equal(parsed.persisted, true);
      assert.equal(parsed.roleId, PERSONAL_LEDGER_ID);
      assert.equal(parsed.direction, "收入");
      assert.equal(parsed.amount, 523);
      assert.equal(parsed.targetPath, "memory/ledgers/Personal.md");
      assert.ok(parsed.writebackEvidence?.wroteFiles);
      assert.ok(parsed.writebackEvidence?.affectedFiles?.includes("memory/ledgers/Personal.md"));
      const book = readLedger(ws, PERSONAL_LEDGER_ID);
      assert.equal(book.exists, true);
      assert.equal(book.entries.length, 1);
      assert.equal(book.entries[0].amount, 523);
      assert.equal(fs.existsSync(path.join(ws, "memory", "ledgers", "ClassFund.md")), false);
      assert.equal(fs.existsSync(path.join(ws, "50-其他", "账本", "ClassFund.md")), false);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("phrase that names a user book/category lands there", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "topmind-ledger-nl-named-"));
    try {
      for (const d of ["00-收件箱", "10-动态", "88-输出", "99-归档", "memory"]) {
        fs.mkdirSync(path.join(ws, d), { recursive: true });
      }
      fs.writeFileSync(
        path.join(ws, "topmind.yaml"),
        "contract_version: 4\nworkspace:\n  template: stream\nwriteback:\n  mode: auto\n",
        "utf8",
      );
      const book = addLedgerRole(ws, { name: "家用" });
      assert.equal(book.ok, true);
      const cat = addLedgerCategory(ws, "运动");
      assert.equal(cat.ok, true);
      const named = await captureLedgerPhrase(ws, "花了 80 家用", { persist: true });
      assert.equal(named.ok, true);
      assert.equal(named.roleId, book.book.roleId);
      assert.equal(named.amount, 80);
      const catHit = await captureLedgerPhrase(ws, "花了 50 运动", { persist: true });
      assert.equal(catHit.ok, true);
      assert.equal(catHit.roleId, PERSONAL_LEDGER_ID);
      assert.equal(catHit.category, "运动");
      const personal = readLedger(ws, PERSONAL_LEDGER_ID);
      assert.ok(personal.entries.some((e) => e.category === "运动" && e.amount === 50));
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("AI refine fills an incomplete 记账 phrase via the shipped capture path", async () => {
    const aiProvider = {
      async generate() {
        return JSON.stringify({
          intent: "capture",
          roleId: PERSONAL_LEDGER_ID,
          direction: "支出",
          amount: 88,
          category: "运动",
          subcategory: "",
          note: "羽毛球拍",
        });
      },
    };
    const parsed = await captureLedgerPhrase(null, "记一笔 羽毛球拍", { aiProvider });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.intent, "capture");
    assert.equal(parsed.complete, true);
    assert.equal(parsed.direction, "支出");
    assert.equal(parsed.amount, 88);
    assert.equal(parsed.roleId, PERSONAL_LEDGER_ID);
    assert.match(String(parsed.note), /羽毛球拍/);
  });

  it("AI refine does not invent ClassFund when that book is not in the catalog", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "topmind-ledger-nl-ai-"));
    try {
      for (const d of ["00-收件箱", "10-动态", "88-输出", "99-归档", "memory"]) {
        fs.mkdirSync(path.join(ws, d), { recursive: true });
      }
      fs.writeFileSync(
        path.join(ws, "topmind.yaml"),
        "contract_version: 4\nworkspace:\n  template: stream\nwriteback:\n  mode: auto\n",
        "utf8",
      );
      const aiProvider = {
        async generate() {
          return JSON.stringify({
            intent: "capture",
            roleId: "ClassFund",
            direction: "支出",
            amount: 50,
            category: "运动",
            note: "羽毛球拍",
          });
        },
      };
      const parsed = await captureLedgerPhrase(ws, "记一笔 羽毛球拍", { persist: true, aiProvider });
      assert.equal(parsed.ok, true);
      assert.equal(parsed.complete, true);
      assert.equal(parsed.roleId, PERSONAL_LEDGER_ID);
      assert.notEqual(parsed.roleId, "ClassFund");
      assert.equal(parsed.persisted, true);
      assert.equal(fs.existsSync(path.join(ws, "memory", "ledgers", "ClassFund.md")), false);
      const personal = readLedger(ws, PERSONAL_LEDGER_ID);
      assert.equal(personal.exists, true);
      assert.ok(personal.entries.some((e) => e.amount === 50 && /羽毛球拍/.test(String(e.note || ""))));
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
