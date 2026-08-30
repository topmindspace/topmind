// ── topmind Ledger Engine ──────────────────────────────────────────────────
// Per-book markdown on the semantic plane ({memory.dir}/ledgers/{id}.md).
//
// Generic capability: empty workspace has one default personal / 自己 book.
// ClassFund / Giggs / Mom are historical 50-账本 *format* fixtures only — not
// seeded product books. Users add further books and 分类.
//
// Line shape (still parsed): timestamped 收入/支出, 分类/子分类/备注, Current balance.
// Append-only add; all durable writes go through writeback-engine.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ensureMemoryPlane, memoryDirRel } from "./memory-engine.mjs";
import { executeWrite } from "./writeback-engine.mjs";
import { loadContract } from "./contract-engine.mjs";

export const LEDGER_DIR_NAME = "ledgers";
export const LEDGER_REL_DIR = "memory/ledgers";

export const LEDGER_CAPTURE_TRIGGERS = Object.freeze(["记账", "记一笔", "花了", "存入"]);
export const LEDGER_READ_TRIGGERS = Object.freeze(["查看账单", "账户余额"]);

export const LEDGER_CATALOG_FILE = "catalog.md";

/** Default personal / 自己 book. Historical ClassFund/Giggs/Mom names are not seeded. */
export const PERSONAL_LEDGER_ID = "Personal";
export const PERSONAL_LEDGER_NAME = "自己";
export const PERSONAL_LEDGER_ALIASES = Object.freeze(["自己", "我", "个人", "personal", "self"]);

/** Shipped default catalog: one personal book. */
export const DEFAULT_LEDGER_ROLES = Object.freeze([
  Object.freeze({
    id: PERSONAL_LEDGER_ID,
    name: PERSONAL_LEDGER_NAME,
    aliases: PERSONAL_LEDGER_ALIASES,
  }),
]);

const ENTRY_LINE_RE =
  /^- \[(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?)\]\s*(收入|支出)\s*([+\-]?\d+(?:\.\d+)?)\s*元\s*$/u;
const META_FIELD_RE = /(分类|子分类|备注)\s*[:：]\s*([^；;]*)/gu;
const AMOUNT_RE = /([+\-]?\d+(?:,\d{3})*(?:\.\d+)?)/u;

/**
 * Workspace-relative ledgers directory honoring contract `memory.dir`.
 * @param {string} workspaceRoot
 * @returns {string}
 */
export function resolveLedgerDirRel(workspaceRoot) {
  const dir = memoryDirRel(workspaceRoot).replace(/\\/g, "/");
  return `${dir}/${LEDGER_DIR_NAME}`;
}

/**
 * @param {string} workspaceRoot
 * @returns {string} absolute ledgers dir
 */
export function resolveLedgerDir(workspaceRoot) {
  return path.join(workspaceRoot, resolveLedgerDirRel(workspaceRoot));
}

/**
 * Reject identifiers that could hop out of the ledgers slot.
 * @param {string} id
 * @returns {boolean}
 */
export function isUnsafeLedgerRoleId(id) {
  const s = String(id || "").trim();
  return !s || s.length > 80 || /[\\/]|\.\./u.test(s) || s.startsWith(".") || s.includes("\0");
}

/**
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeLedgerRoleId(raw) {
  const s = String(raw || "").trim();
  if (isUnsafeLedgerRoleId(s)) return "";
  return s;
}

/**
 * Map a spoken/display name onto a known role id when possible.
 * @param {string} name
 * @param {Array<{ id: string, name?: string, aliases?: string[], accountName?: string }>} [roles]
 * @returns {string}
 */
export function roleIdFromName(name, roles = DEFAULT_LEDGER_ROLES) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  for (const role of flattenRoles(roles)) {
    const id = String(role.id || "").trim();
    if (!id) continue;
    if (id.toLowerCase() === lower) return id;
    if (String(role.name || "").toLowerCase() === lower) return id;
    if (String(role.accountName || "").toLowerCase() === lower) return id;
    const aliases = role.aliases || [];
    for (const a of aliases) {
      if (String(a).toLowerCase() === lower) return id;
    }
  }
  return sanitizeLedgerRoleId(raw);
}

/**
 * Capture/AI may only land on a book already in the catalog (or Personal).
 * Unlike roleIdFromName, this never invents ClassFund/Giggs/Mom or other ids.
 * @param {string} name
 * @param {object[]} roles
 * @param {string} [fallback]
 * @returns {string}
 */
export function knownLedgerRoleId(name, roles, fallback = PERSONAL_LEDGER_ID) {
  const raw = String(name || "").trim();
  const list = flattenRoles(roles);
  const fallbackId =
    sanitizeLedgerRoleId(fallback) && list.some((r) => r.id === fallback)
      ? fallback
      : PERSONAL_LEDGER_ID;
  if (!raw) return fallbackId;
  const lower = raw.toLowerCase();
  for (const role of list) {
    const id = String(role.id || "").trim();
    if (!id) continue;
    if (id.toLowerCase() === lower) return id;
    if (String(role.name || "").toLowerCase() === lower) return id;
    if (String(role.accountName || "").toLowerCase() === lower) return id;
    for (const a of role.aliases || []) {
      if (String(a).toLowerCase() === lower) return id;
    }
  }
  return fallbackId;
}

/**
 * @param {string} workspaceRoot
 * @param {string} roleId
 * @returns {string}
 */
export function resolveLedgerRelPath(workspaceRoot, roleId) {
  const id = sanitizeLedgerRoleId(roleId);
  if (!id) return "";
  return `${resolveLedgerDirRel(workspaceRoot)}/${id}.md`;
}

/**
 * @param {string} workspaceRoot
 * @param {string} roleId
 * @returns {string}
 */
export function resolveLedgerPath(workspaceRoot, roleId) {
  const rel = resolveLedgerRelPath(workspaceRoot, roleId);
  if (!rel) return "";
  return path.join(workspaceRoot, rel);
}

/**
 * Signed amount for a direction. Stored amount is always the absolute yuan.
 * @param {"收入"|"支出"|string} direction
 * @param {number} amount
 * @returns {number}
 */
export function signedAmountFor(direction, amount) {
  const n = Math.abs(Number(amount));
  if (!Number.isFinite(n)) return 0;
  return direction === "支出" ? -n : n;
}

/**
 * @param {Array<{ direction?: string, amount?: number, signedAmount?: number }>} entries
 * @returns {number}
 */
export function computeLedgerBalance(entries) {
  let sum = 0;
  for (const e of entries || []) {
    if (typeof e.signedAmount === "number" && Number.isFinite(e.signedAmount)) {
      sum += e.signedAmount;
      continue;
    }
    sum += signedAmountFor(e.direction, e.amount);
  }
  return roundYuan(sum);
}

export function roundYuan(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

export function formatYuan(n) {
  return roundYuan(n).toFixed(2);
}

/**
 * Local timestamp `YYYY-MM-DD HH:MM:SS` (matches the 50-账本 cache lines).
 * @param {Date} [date]
 * @returns {string}
 */
export function formatLedgerTimestamp(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return formatLedgerTimestamp(new Date());
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function defaultAccountName(roleId) {
  if (roleId === PERSONAL_LEDGER_ID) return PERSONAL_LEDGER_NAME;
  const found = DEFAULT_LEDGER_ROLES.find((r) => r.id === roleId);
  return found?.name || roleId;
}

function emptyBook(workspaceRoot, roleId, extras = {}) {
  const id = sanitizeLedgerRoleId(roleId) || roleId;
  return {
    roleId: id,
    accountName: extras.accountName || defaultAccountName(id),
    balance: 0,
    entries: [],
    relPath: resolveLedgerRelPath(workspaceRoot, id),
    exists: false,
    headerNotes: extras.headerNotes || [],
    rawContent: extras.rawContent || "",
  };
}

/**
 * Parse a 50-账本-shaped markdown book.
 * @param {string} content
 * @param {{ roleId?: string, relPath?: string }} [meta]
 * @returns {{ roleId: string, accountName: string, balance: number, entries: object[], headerNotes: string[], rawContent: string, relPath?: string }}
 */
export function parseLedgerMarkdown(content, meta = {}) {
  const raw = String(content || "").replace(/\r\n?/gu, "\n");
  let roleId = sanitizeLedgerRoleId(meta.roleId) || "";
  const headerNotes = [];
  let accountName = defaultAccountName(roleId);
  let headerBalance = null;
  /** @type {object[]} */
  const entries = [];
  const lines = raw.split("\n");
  let i = 0;
  /** Blocks replayed verbatim on rewrite — hand-written lines survive appends. */
  const blocks = [];
  let rawBuf = [];
  const flushRaw = () => {
    if (rawBuf.length) {
      blocks.push({ type: "raw", text: rawBuf.join("\n") });
      rawBuf = [];
    }
  };

  if (lines[0] && /^#\s+/.test(lines[0])) {
    const title = lines[0].replace(/^#\s+/, "").replace(/\s+Ledger\s*$/iu, "").trim();
    if (!roleId && title) roleId = sanitizeLedgerRoleId(title) || title;
    i = 1;
  }
  if (accountName === defaultAccountName("") && roleId) {
    accountName = defaultAccountName(roleId);
  }

  while (i < lines.length) {
    const line = lines[i];
    if (/^##\s+Transactions\s*$/iu.test(line)) {
      i += 1;
      break;
    }
    const cloud = line.match(/^>\s*Cloud account:\s*(.+)\s*$/iu);
    if (cloud) {
      accountName = cloud[1].trim();
      i += 1;
      continue;
    }
    const bal = line.match(/^>\s*Current balance:\s*([+\-]?\d+(?:\.\d+)?)\s*元/iu);
    if (bal) {
      headerBalance = Number(bal[1]);
      i += 1;
      continue;
    }
    if (line.startsWith(">") && line.trim() !== ">") {
      headerNotes.push(line.replace(/^>\s?/, "").trimEnd());
    }
    i += 1;
  }

  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(ENTRY_LINE_RE);
    if (m) {
      flushRaw();
      const direction = m[2] === "支出" ? "支出" : "收入";
      const amount = Math.abs(Number(m[3]));
      const entry = {
        timestamp: m[1].replace("T", " "),
        direction,
        amount: roundYuan(amount),
        signedAmount: signedAmountFor(direction, amount),
        category: "",
        subcategory: "",
        note: "",
      };
      let rawText = line;
      const next = lines[i + 1];
      if (next && /^\s+\S/.test(next) && !ENTRY_LINE_RE.test(next.trim())) {
        META_FIELD_RE.lastIndex = 0;
        let field;
        while ((field = META_FIELD_RE.exec(next))) {
          const key = field[1];
          const val = field[2].trim();
          if (key === "分类") entry.category = val;
          else if (key === "子分类") entry.subcategory = val;
          else if (key === "备注") entry.note = val;
        }
        rawText += `\n${next}`;
        i += 2;
      } else {
        i += 1;
      }
      blocks.push({ type: "entry", rawText });
      entries.push(entry);
      continue;
    }
    rawBuf.push(line);
    i += 1;
  }
  flushRaw();

  const computed = computeLedgerBalance(entries);
  const resolvedId = sanitizeLedgerRoleId(meta.roleId) || roleId || "ledger";
  return {
    roleId: resolvedId,
    accountName,
    balance: Number.isFinite(headerBalance) ? roundYuan(headerBalance) : computed,
    computedBalance: computed,
    entries,
    blocks,
    headerNotes,
    rawContent: raw,
    relPath: meta.relPath || "",
    exists: true,
  };
}

function formatEntryBlock(entry) {
  const direction = entry.direction === "支出" ? "支出" : "收入";
  const amount = Math.abs(Number(entry.amount));
  const sign = direction === "支出" ? "-" : "+";
  const ts = String(entry.timestamp || formatLedgerTimestamp()).trim();
  const head = `- [${ts}] ${direction} ${sign}${formatYuan(amount)} 元`;
  const parts = [];
  if (entry.category) parts.push(`分类：${entry.category}`);
  if (entry.subcategory) parts.push(`子分类：${entry.subcategory}`);
  if (entry.note) parts.push(`备注：${entry.note}`);
  if (parts.length === 0) return head;
  return `${head}\n  ${parts.join("；")}`;
}

/**
 * Serialize a book back to the 50-账本 markdown shape.
 * @param {object} book
 * @returns {string}
 */
export function serializeLedger(book) {
  const roleId = sanitizeLedgerRoleId(book?.roleId) || "ledger";
  const accountName = String(book?.accountName || defaultAccountName(roleId)).trim() || roleId;
  const entries = Array.isArray(book?.entries) ? book.entries : [];
  const balance = computeLedgerBalance(entries);
  const notes = Array.isArray(book?.headerNotes)
    ? book.headerNotes.filter((n) => {
        const s = String(n || "").trim();
        if (!s) return false;
        if (/^Cloud account:/iu.test(s)) return false;
        if (/^Current balance:/iu.test(s)) return false;
        return true;
      })
    : [];

  const quoteLines = [
    ...notes.map((n) => `> ${n}`),
    `> Cloud account: ${accountName}`,
    `> Current balance: ${formatYuan(balance)} 元`,
  ];

  let body;
  const blocks = Array.isArray(book?.blocks) ? book.blocks : null;
  if (blocks && blocks.length) {
    // Append-only honesty: replay parsed blocks verbatim (hand-written lines
    // and original entry formatting survive), then append new entries.
    const parts = [];
    let entryIdx = 0;
    for (const b of blocks) {
      if (b && b.type === "entry") {
        parts.push(String(b.rawText || ""));
        entryIdx += 1;
      } else if (b && b.type === "raw" && String(b.text || "").trim()) {
        parts.push(String(b.text));
      }
    }
    for (; entryIdx < entries.length; entryIdx += 1) {
      parts.push(formatEntryBlock(entries[entryIdx]));
    }
    body = parts.join("\n");
  } else {
    body = entries.map(formatEntryBlock).join("\n");
  }
  return [
    `# ${roleId} Ledger`,
    "",
    ...quoteLines,
    "",
    "## Transactions",
    "",
    body ? `${body}\n` : "",
  ].join("\n");
}

function scanLedgerFiles(workspaceRoot) {
  const dir = resolveLedgerDir(workspaceRoot);
  /** @type {string[]} */
  const ids = [];
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return ids;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".md") || name.startsWith(".") || name.startsWith("_")) continue;
    if (name === LEDGER_CATALOG_FILE) continue;
    const id = sanitizeLedgerRoleId(name.replace(/\.md$/u, ""));
    if (id) ids.push(id);
  }
  ids.sort((a, b) => a.localeCompare(b));
  return ids;
}

/**
 * List books: always the personal default (virtual if missing), plus files on disk.
 * Does not seed ClassFund/Giggs/Mom.
 * @param {string} workspaceRoot
 * @returns {Array<object>}
 */
export function listLedgers(workspaceRoot) {
  const onDisk = new Set(scanLedgerFiles(workspaceRoot));
  const seen = new Set();
  /** @type {object[]} */
  const out = [];

  const push = (roleId, nameHint) => {
    const id = sanitizeLedgerRoleId(roleId);
    if (!id || seen.has(id)) return;
    seen.add(id);
    const exists = onDisk.has(id);
    if (exists) {
      const book = readLedger(workspaceRoot, id);
      if (book) {
        out.push(book);
        return;
      }
    }
    out.push(emptyBook(workspaceRoot, id, { accountName: nameHint }));
  };

  push(PERSONAL_LEDGER_ID, PERSONAL_LEDGER_NAME);
  for (const id of onDisk) {
    push(id);
  }
  return out;
}

/**
 * @param {string} workspaceRoot
 * @param {string} roleId
 * @returns {object | null}
 */
export function readLedger(workspaceRoot, roleId) {
  const id = sanitizeLedgerRoleId(roleId);
  if (!id) return null;
  const abs = resolveLedgerPath(workspaceRoot, id);
  const rel = resolveLedgerRelPath(workspaceRoot, id);
  if (!abs || !fs.existsSync(abs)) {
    return emptyBook(workspaceRoot, id);
  }
  const raw = fs.readFileSync(abs, "utf8");
  const parsed = parseLedgerMarkdown(raw, { roleId: id, relPath: rel });
  parsed.relPath = rel;
  parsed.exists = true;
  parsed.balance = parsed.computedBalance;
  return parsed;
}

function writeLedgerBook(workspaceRoot, book, options = {}) {
  const id = sanitizeLedgerRoleId(book.roleId);
  if (!id) {
    return { ok: false, reason: "invalid-role", targetPath: "", writebackEvidence: null };
  }
  ensureMemoryPlane(workspaceRoot);
  const dir = resolveLedgerDir(workspaceRoot);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const abs = resolveLedgerPath(workspaceRoot, id);
  const rel = resolveLedgerRelPath(workspaceRoot, id);
  const content = serializeLedger({ ...book, roleId: id });
  const resolvedContract = options.contract || loadContract(workspaceRoot);
  const result = executeWrite({
    targetPath: abs,
    content,
    workspaceRoot,
    contract: resolvedContract,
    operation: fs.existsSync(abs) ? "update" : "create",
    actor: options.actor || "user",
    confirmed: true,
    role: "memory",
  });
  return {
    ok: result.wroteFiles !== false,
    targetPath: rel,
    writebackEvidence: result,
    book: {
      ...book,
      roleId: id,
      relPath: rel,
      exists: true,
      balance: computeLedgerBalance(book.entries || []),
      rawContent: content,
    },
  };
}

/**
 * Append a transaction (does not rewrite historical lines' fields).
 * @param {string} workspaceRoot
 * @param {string} roleId
 * @param {{ direction: "收入"|"支出", amount: number, category?: string, subcategory?: string, note?: string, timestamp?: string }} entry
 * @param {{ contract?: object, actor?: "user"|"ai" }} [options]
 */
export function appendLedgerEntry(workspaceRoot, roleId, entry, options = {}) {
  const id = sanitizeLedgerRoleId(roleId);
  if (!id) {
    return { ok: false, reason: "invalid-role", targetPath: "", writebackEvidence: null, book: null };
  }
  const amount = Math.abs(Number(entry?.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      ok: false,
      reason: "invalid-amount",
      targetPath: resolveLedgerRelPath(workspaceRoot, id),
      writebackEvidence: null,
      book: readLedger(workspaceRoot, id),
    };
  }
  const direction = entry.direction === "支出" ? "支出" : "收入";
  const existing = readLedger(workspaceRoot, id) || emptyBook(workspaceRoot, id);
  const nextEntry = {
    timestamp: String(entry.timestamp || formatLedgerTimestamp()).trim(),
    direction,
    amount: roundYuan(amount),
    signedAmount: signedAmountFor(direction, amount),
    category: String(entry.category || "").trim(),
    subcategory: String(entry.subcategory || "").trim(),
    note: String(entry.note || "").trim(),
  };
  const nextBook = {
    ...existing,
    entries: [...existing.entries, nextEntry],
  };
  nextBook.balance = computeLedgerBalance(nextBook.entries);
  const written = writeLedgerBook(workspaceRoot, nextBook, options);
  if (written.ok && nextEntry.category) {
    addLedgerCategory(workspaceRoot, nextEntry.category, options);
  }
  return {
    ...written,
    entry: nextEntry,
  };
}

/**
 * Add a custom role/book. Default roles are already listed even before files exist.
 * @param {string} workspaceRoot
 * @param {{ id?: string, name?: string }} spec
 * @param {{ contract?: object, actor?: "user"|"ai" }} [options]
 */
export function addLedgerRole(workspaceRoot, spec = {}, options = {}) {
  const name = String(spec.name || spec.id || "").trim();
  const id = sanitizeLedgerRoleId(spec.id) || roleIdFromName(name) || "";
  if (!id) {
    return { ok: false, reason: "invalid-role", targetPath: "", writebackEvidence: null, book: null };
  }
  const existing = readLedger(workspaceRoot, id);
  if (existing?.exists) {
    return {
      ok: true,
      reason: "already-exists",
      targetPath: existing.relPath,
      writebackEvidence: null,
      book: existing,
    };
  }
  const book = emptyBook(workspaceRoot, id, { accountName: name || defaultAccountName(id) });
  return writeLedgerBook(workspaceRoot, book, options);
}

/**
 * @param {string} workspaceRoot
 * @returns {string}
 */
export function resolveLedgerCatalogRelPath(workspaceRoot) {
  return `${resolveLedgerDirRel(workspaceRoot)}/${LEDGER_CATALOG_FILE}`;
}

/**
 * @param {string} content
 * @returns {{ categories: string[] }}
 */
export function parseLedgerCatalog(content) {
  const raw = String(content || "").replace(/\r\n?/gu, "\n");
  /** @type {string[]} */
  const categories = [];
  let inCats = false;
  for (const line of raw.split("\n")) {
    if (/^##\s+(Categories|分类)\s*$/iu.test(line)) {
      inCats = true;
      continue;
    }
    if (/^##\s+/.test(line)) {
      inCats = false;
      continue;
    }
    if (!inCats) continue;
    const m = line.match(/^- \s*(.+?)\s*$/u);
    if (!m) continue;
    const name = m[1].trim();
    if (name && !categories.includes(name)) categories.push(name);
  }
  return { categories };
}

/**
 * @param {{ categories?: string[] }} catalog
 * @returns {string}
 */
export function serializeLedgerCatalog(catalog) {
  const cats = [];
  for (const raw of catalog?.categories || []) {
    const name = String(raw || "").trim();
    if (!name || cats.includes(name)) continue;
    cats.push(name);
  }
  const body = cats.map((c) => `- ${c}`).join("\n");
  return ["# Ledger catalog", "", "## Categories", "", body ? `${body}\n` : ""].join("\n");
}

function sanitizeCategoryName(raw) {
  const s = String(raw || "").trim();
  if (!s || s.length > 80 || /[\\/]|\.\./u.test(s) || s.startsWith(".")) return "";
  return s;
}

/**
 * @param {string} workspaceRoot
 * @returns {{ categories: string[], relPath: string, exists: boolean, rawContent: string }}
 */
export function readLedgerCatalog(workspaceRoot) {
  const rel = resolveLedgerCatalogRelPath(workspaceRoot);
  const abs = path.join(workspaceRoot, rel);
  if (!fs.existsSync(abs)) {
    return { categories: [], relPath: rel, exists: false, rawContent: "" };
  }
  const raw = fs.readFileSync(abs, "utf8");
  const parsed = parseLedgerCatalog(raw);
  return { ...parsed, relPath: rel, exists: true, rawContent: raw };
}

function writeLedgerCatalog(workspaceRoot, categories, options = {}) {
  ensureMemoryPlane(workspaceRoot);
  const dir = resolveLedgerDir(workspaceRoot);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const rel = resolveLedgerCatalogRelPath(workspaceRoot);
  const abs = path.join(workspaceRoot, rel);
  const content = serializeLedgerCatalog({ categories });
  const resolvedContract = options.contract || loadContract(workspaceRoot);
  const result = executeWrite({
    targetPath: abs,
    content,
    workspaceRoot,
    contract: resolvedContract,
    operation: fs.existsSync(abs) ? "update" : "create",
    actor: options.actor || "user",
    confirmed: true,
    role: "memory",
  });
  return {
    ok: result.wroteFiles !== false,
    targetPath: rel,
    writebackEvidence: result,
    categories,
  };
}

/**
 * Catalog + categories already used on entries.
 * @param {string} workspaceRoot
 * @param {object[]} [books]
 * @returns {string[]}
 */
export function listLedgerCategories(workspaceRoot, books) {
  const catalog = readLedgerCatalog(workspaceRoot).categories;
  const seen = new Set(catalog);
  const out = [...catalog];
  const source = Array.isArray(books) ? books : listLedgers(workspaceRoot);
  for (const book of source) {
    for (const e of book.entries || []) {
      const c = String(e.category || "").trim();
      if (!c || seen.has(c)) continue;
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

/**
 * @param {string} workspaceRoot
 * @param {string} name
 * @param {{ contract?: object, actor?: "user"|"ai" }} [options]
 */
export function addLedgerCategory(workspaceRoot, name, options = {}) {
  const cat = sanitizeCategoryName(name);
  if (!cat) {
    return { ok: false, reason: "invalid-category", categories: listLedgerCategories(workspaceRoot), targetPath: resolveLedgerCatalogRelPath(workspaceRoot) };
  }
  const current = readLedgerCatalog(workspaceRoot).categories;
  if (current.includes(cat)) {
    return {
      ok: true,
      reason: "already-exists",
      categories: listLedgerCategories(workspaceRoot),
      targetPath: resolveLedgerCatalogRelPath(workspaceRoot),
      writebackEvidence: null,
    };
  }
  const written = writeLedgerCatalog(workspaceRoot, [...current, cat], options);
  return { ...written, categories: listLedgerCategories(workspaceRoot) };
}

/**
 * @param {string} workspaceRoot
 * @param {string} name
 * @param {{ contract?: object, actor?: "user"|"ai" }} [options]
 */
export function removeLedgerCategory(workspaceRoot, name, options = {}) {
  const cat = String(name || "").trim();
  const current = readLedgerCatalog(workspaceRoot).categories;
  const next = current.filter((c) => c !== cat);
  if (next.length === current.length) {
    return {
      ok: true,
      reason: "not-in-catalog",
      categories: listLedgerCategories(workspaceRoot),
      targetPath: resolveLedgerCatalogRelPath(workspaceRoot),
      writebackEvidence: null,
    };
  }
  const written = writeLedgerCatalog(workspaceRoot, next, options);
  return { ...written, categories: listLedgerCategories(workspaceRoot) };
}

/**
 * 看板 totals from books already loaded (pure; UI-consumed via Desktop copy too).
 * @param {object[]} books
 */
export function summarizeLedgerBooks(books) {
  const list = Array.isArray(books) ? books : [];
  /** @type {Map<string, { category: string, income: number, expense: number, count: number }>} */
  const catMap = new Map();
  /** @type {object[]} */
  const byBook = [];
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
    const bal = typeof book.balance === "number" ? book.balance : computeLedgerBalance(book.entries);
    balance += bal;
    byBook.push({
      roleId: book.roleId,
      accountName: book.accountName,
      balance: roundYuan(bal),
      income: roundYuan(bIn),
      expense: roundYuan(bOut),
      count: (book.entries || []).length,
      relPath: book.relPath || "",
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
      .sort((a, b) => String(a.category).localeCompare(String(b.category))),
  };
}

function matchRoleInText(text, roles) {
  const src = String(text || "");
  if (!src) return null;
  /** @type {{ id: string, alias: string }[]} */
  const needles = [];
  for (const role of roles) {
    const id = String(role.id || role.roleId || "").trim();
    if (!id) continue;
    needles.push({ id, alias: id });
    if (role.name) needles.push({ id, alias: String(role.name) });
    if (role.accountName) needles.push({ id, alias: String(role.accountName) });
    for (const a of role.aliases || []) needles.push({ id, alias: String(a) });
  }
  needles.sort((a, b) => b.alias.length - a.alias.length);
  const lower = src.toLowerCase();
  for (const n of needles) {
    if (!n.alias) continue;
    if (lower.includes(n.alias.toLowerCase())) return n.id;
  }
  return null;
}

function extractAmount(text) {
  const src = String(text || "");
  const m = src.match(AMOUNT_RE);
  if (!m) return null;
  const n = Number(String(m[1]).replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return roundYuan(n);
}

function remainderNote(text, { amount, roleLabels }) {
  let s = String(text || "");
  for (const trig of [...LEDGER_CAPTURE_TRIGGERS, ...LEDGER_READ_TRIGGERS, "支出", "收入", "买了", "消费"]) {
    s = s.replace(new RegExp(trig.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gu"), " ");
  }
  if (amount != null) {
    s = s.replace(String(amount), " ");
    s = s.replace(formatYuan(amount), " ");
  }
  for (const label of roleLabels) {
    if (!label) continue;
    s = s.replace(new RegExp(String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu"), " ");
  }
  s = s.replace(/元|块钱|块/gu, " ");
  s = s.replace(/[，。,.!！?？:：]/gu, " ");
  return s.replace(/\s+/gu, " ").trim();
}

function flattenRoles(roles) {
  const source = Array.isArray(roles) && roles.length ? roles : DEFAULT_LEDGER_ROLES;
  return source
    .map((r) => {
      const id = String(r.id || r.roleId || "").trim();
      const known = DEFAULT_LEDGER_ROLES.find((d) => d.id === id);
      return {
        id,
        roleId: id,
        name: r.name || r.accountName || known?.name || id,
        accountName: r.accountName || r.name || known?.name || id,
        aliases: r.aliases && r.aliases.length ? r.aliases : known?.aliases || [],
      };
    })
    .filter((r) => r.id);
}

function matchCategoryInText(text, categories) {
  const src = String(text || "").toLowerCase();
  const cats = (categories || [])
    .map((c) => String(c || "").trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const c of cats) {
    if (src.includes(c.toLowerCase())) return c;
  }
  return "";
}

/**
 * Pure NL capture → structured ledger intent.
 * Must-have triggers: 记账 / 记一笔 / 花了 / 存入; read: 查看账单 / 账户余额.
 *
 * @param {string} text
 * @param {{ roles?: object[], categories?: string[], defaultRoleId?: string }} [options]
 * @returns {object}
 */
export function parseLedgerCapture(text, options = {}) {
  const src = String(text || "").trim();
  const roles = flattenRoles(options.roles);
  const categories = Array.isArray(options.categories) ? options.categories : [];
  const defaultRoleId =
    sanitizeLedgerRoleId(options.defaultRoleId) ||
    roleIdFromName(options.defaultRoleId, roles) ||
    PERSONAL_LEDGER_ID;
  const roleLabels = roles.flatMap((r) => [r.id, r.name, r.accountName, ...(r.aliases || [])]).filter(Boolean);
  const matchedBook = matchRoleInText(src, roles);
  const matchedCat = matchCategoryInText(src, categories);
  const roleId = matchedBook || defaultRoleId;
  const role = roles.find((r) => r.id === roleId);
  const accountName = role?.accountName || role?.name || defaultAccountName(roleId);
  const amount = extractAmount(src);

  const hasList = /查看账单|账单/u.test(src);
  const hasBalance = /账户余额|余额/u.test(src);
  const hasIncome = /存入|收入|收了/u.test(src);
  const hasExpense = /花了|支出|买了|消费/u.test(src);
  const hasCaptureTrigger = LEDGER_CAPTURE_TRIGGERS.some((t) => src.includes(t)) || hasIncome || hasExpense;

  if ((hasList || hasBalance) && !hasIncome && !hasExpense && amount == null) {
    const intent = hasBalance && !hasList ? "balance" : hasList ? "list" : "balance";
    return {
      ok: true,
      intent,
      complete: true,
      roleId,
      accountName,
      direction: null,
      amount: null,
      category: matchedCat || "",
      subcategory: "",
      note: "",
      text: src,
    };
  }

  if (!hasCaptureTrigger && amount == null) {
    return {
      ok: false,
      intent: null,
      complete: false,
      roleId,
      accountName,
      direction: null,
      amount: null,
      category: "",
      subcategory: "",
      note: "",
      text: src,
      reason: "unrecognized",
    };
  }

  const direction = hasIncome && !hasExpense ? "收入" : hasExpense ? "支出" : hasIncome ? "收入" : null;
  const stripLabels = [...roleLabels, ...categories];
  const note = remainderNote(src, { amount, roleLabels: stripLabels });
  const category = matchedCat || "";
  const subcategory = "";
  const complete = Boolean(direction && amount != null && amount > 0);

  return {
    ok: true,
    intent: "capture",
    complete,
    roleId,
    accountName,
    direction,
    amount,
    category,
    subcategory,
    note,
    text: src,
    reason: complete ? undefined : "incomplete",
  };
}

function extractJsonObject(text) {
  const src = String(text || "");
  const start = src.indexOf("{");
  const end = src.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(src.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function refineLedgerCaptureWithAi(text, parsed, options) {
  const generate = options.aiProvider?.generate;
  if (typeof generate !== "function") return parsed;
  const roles = flattenRoles(options.roles);
  const catalog = roles.map((r) => `${r.id} (${r.name || r.accountName || r.id})`).join(", ");
  let raw = "";
  try {
    raw = await generate(
      [
        "Extract one ledger capture as JSON with keys:",
        'intent (capture|list|balance), roleId, direction (收入|支出|null), amount (number|null),',
        "category, subcategory, note.",
        `Known books: ${catalog}.`,
        `Known categories: ${(options.categories || []).join(", ") || "(none)"}.`,
        "Do not invent ClassFund, Giggs, or Mom unless they are in Known books.",
        "Only JSON. No markdown.",
        `Text: ${text}`,
      ].join("\n"),
      { operation: "ledger_capture" },
    );
  } catch {
    return parsed;
  }
  const obj = extractJsonObject(raw);
  if (!obj || typeof obj !== "object") return parsed;
  const direction = obj.direction === "支出" || obj.direction === "收入" ? obj.direction : parsed.direction;
  const amount = obj.amount == null ? parsed.amount : Math.abs(Number(obj.amount));
  const roleId = knownLedgerRoleId(
    obj.roleId || obj.accountName || obj.book || parsed.roleId,
    roles,
    parsed.roleId || PERSONAL_LEDGER_ID,
  );
  const complete = parsed.intent === "list" || parsed.intent === "balance"
    ? true
    : Boolean(direction && Number.isFinite(amount) && amount > 0);
  const role = roles.find((r) => r.id === roleId);
  return {
    ...parsed,
    ok: true,
    intent: obj.intent === "list" || obj.intent === "balance" ? obj.intent : "capture",
    complete,
    roleId,
    accountName: role?.accountName || role?.name || parsed.accountName,
    direction: complete && parsed.intent !== "list" ? direction : parsed.intent === "capture" ? direction : parsed.direction,
    amount: Number.isFinite(amount) ? roundYuan(amount) : parsed.amount,
    category: String(obj.category || parsed.category || "").trim(),
    subcategory: String(obj.subcategory || parsed.subcategory || "").trim(),
    note: String(obj.note || parsed.note || "").trim(),
    reason: complete ? undefined : parsed.reason,
  };
}

/**
 * Shipped NL/AI capture path. Parses phrases; optionally persists via writeback.
 * @param {string|null} workspaceRoot
 * @param {string} text
 * @param {{ roles?: object[], defaultRoleId?: string, persist?: boolean, aiProvider?: { generate: Function }, contract?: object, actor?: "user"|"ai" }} [options]
 */
export async function captureLedgerPhrase(workspaceRoot, text, options = {}) {
  const roles = options.roles
    || (workspaceRoot ? listLedgers(workspaceRoot) : DEFAULT_LEDGER_ROLES.map((r) => ({
      id: r.id,
      name: r.name,
      aliases: r.aliases,
      accountName: r.name,
    })));
  const categories = options.categories
    || (workspaceRoot ? listLedgerCategories(workspaceRoot, Array.isArray(roles) ? roles : undefined) : []);
  let parsed = parseLedgerCapture(text, {
    roles,
    categories,
    defaultRoleId: options.defaultRoleId || PERSONAL_LEDGER_ID,
  });
  if (!parsed.complete && parsed.intent === "capture" && options.aiProvider) {
    parsed = await refineLedgerCaptureWithAi(text, parsed, { ...options, roles, categories });
  }
  parsed.roleId = knownLedgerRoleId(parsed.roleId, roles, options.defaultRoleId || PERSONAL_LEDGER_ID);
  const known = flattenRoles(roles).find((r) => r.id === parsed.roleId);
  if (known) parsed.accountName = known.accountName || known.name || parsed.accountName;
  if (options.persist && workspaceRoot && parsed.intent === "capture" && parsed.complete) {
    const written = appendLedgerEntry(
      workspaceRoot,
      parsed.roleId,
      {
        direction: parsed.direction,
        amount: parsed.amount,
        category: parsed.category,
        subcategory: parsed.subcategory,
        note: parsed.note,
      },
      options,
    );
    return { ...parsed, persisted: Boolean(written.ok), ...written };
  }
  return { ...parsed, persisted: false };
}

/** Stable id for UI keys (not used as the on-disk role id). */
export function ledgerEntryKey(entry) {
  const s = `${entry?.timestamp || ""}|${entry?.direction || ""}|${entry?.amount || ""}|${entry?.note || ""}`;
  return createHash("sha1").update(s).digest("hex").slice(0, 12);
}
