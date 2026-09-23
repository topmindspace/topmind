/**
 * 看板 totals from books already loaded in the 记账 mini-app.
 * Pure — Kernel has the same summarizer for RPC/skills; this is the UI path.
 */
import type { LedgerBook } from "../types";

export type LedgerCategoryTotal = {
  category: string;
  income: number;
  expense: number;
  count: number;
};

export type LedgerBookTotal = {
  roleId: string;
  accountName?: string;
  balance: number;
  income: number;
  expense: number;
  count: number;
  relPath?: string;
};

export type LedgerSummary = {
  bookCount: number;
  entryCount: number;
  balance: number;
  income: number;
  expense: number;
  byBook: LedgerBookTotal[];
  byCategory: LedgerCategoryTotal[];
};

function roundYuan(n: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

export function summarizeLedgerBooks(books: LedgerBook[] | null | undefined): LedgerSummary {
  const list = Array.isArray(books) ? books : [];
  const catMap = new Map<string, LedgerCategoryTotal>();
  const byBook: LedgerBookTotal[] = [];
  let income = 0;
  let expense = 0;
  let balance = 0;
  let entryCount = 0;
  for (const book of list) {
    let bIn = 0;
    let bOut = 0;
    for (const e of book.entries || []) {
      entryCount += 1;
      const amt = Math.abs(Number(e.amount) || 0);
      if (e.direction === "支出") {
        expense += amt;
        bOut += amt;
      } else {
        income += amt;
        bIn += amt;
      }
      const cat = String(e.category || "").trim();
      const slot = catMap.get(cat) || { category: cat, income: 0, expense: 0, count: 0 };
      if (e.direction === "支出") slot.expense += amt;
      else slot.income += amt;
      slot.count += 1;
      catMap.set(cat, slot);
    }
    const bal = typeof book.balance === "number" ? book.balance : 0;
    balance += bal;
    byBook.push({
      roleId: book.roleId,
      accountName: book.accountName,
      balance: roundYuan(bal),
      income: roundYuan(bIn),
      expense: roundYuan(bOut),
      count: (book.entries || []).length,
      relPath: book.relPath,
    });
  }
  return {
    bookCount: list.length,
    entryCount,
    balance: roundYuan(balance),
    income: roundYuan(income),
    expense: roundYuan(expense),
    byBook,
    byCategory: [...catMap.values()]
      .map((c) => ({ ...c, income: roundYuan(c.income), expense: roundYuan(c.expense) }))
      .sort((a, b) => a.category.localeCompare(b.category)),
  };
}
