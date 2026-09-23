#!/usr/bin/env node
/**
 * i18n quality gate (Desktop locales + Electron + UTR + command-palette).
 *
 * 1. zh-CN / en-US key parity for every renderer namespace
 * 2. Electron main-process STRINGS key parity
 * 3. UTR STRINGS key parity
 * 4. Command-palette ActionSlots must ship labelKey (live locale, not frozen t())
 * 5. Palette groups used by actions must be in GROUP_KEY_MAP
 * 6. Static t() / i18n.t() / labelKey lookups exist in locale JSON
 * 7. Product-vocab + no CJK leaking into en-US values
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const desktopRoot = join(import.meta.dirname, "..");
const repoRoot = join(desktopRoot, "..");
const localesDir = join(desktopRoot, "src", "locales");
const srcDir = join(desktopRoot, "src");

const REQUIRED_NAMESPACES = ["weread", "x", "ledger"];
const CJK_RE = /[\u4e00-\u9fff]/u;
const CJK_ALLOW_KEYS = new Set(["languageZhCN"]);
const PRODUCT_BANS_EN = [
  { re: /\bMy Status\b/u, why: 'use "My profile" (product term for 我的情况)' },
  { re: /\bAbout me\b/u, why: 'use "My profile", not "About me"' },
  { re: /\bQuick Note\b/u, why: 'use "Note it" (product term for 记一下)' },
];

const namespaces = readdirSync(join(localesDir, "zh-CN"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

let failed = false;
function error(msg) {
  failed = true;
  console.error(msg);
}

if (REQUIRED_NAMESPACES.some((ns) => !namespaces.includes(ns))) {
  error("Desktop locales must ship weread, x, and ledger namespaces.");
}

function flatten(obj, prefix = "") {
  const keys = new Set();
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      for (const sub of flatten(v, full)) keys.add(sub);
    } else {
      keys.add(full);
    }
  }
  return keys;
}

function loadNs(locale, ns) {
  return JSON.parse(readFileSync(join(localesDir, locale, `${ns}.json`), "utf-8"));
}

function walkTs(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkTs(p, acc);
    else if (/\.(tsx|ts)$/.test(name)) acc.push(p);
  }
  return acc;
}

function sliceLocaleObject(src, localeId) {
  const marker = `"${localeId}": {`;
  const start = src.indexOf(marker);
  if (start < 0) return "";
  let i = start + marker.length - 1;
  let depth = 0;
  const from = i;
  while (i < src.length) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(from, i + 1);
    }
    i++;
  }
  return src.slice(from);
}

function keysFromStringMap(block) {
  const keys = new Set();
  const re = /"([^"]+)":\s*"/g;
  let m;
  while ((m = re.exec(block))) keys.add(m[1]);
  return keys;
}

function reportKeyDiff(label, aName, aKeys, bName, bKeys) {
  const missingInB = [...aKeys].filter((k) => !bKeys.has(k)).sort();
  const missingInA = [...bKeys].filter((k) => !aKeys.has(k)).sort();
  if (missingInB.length === 0 && missingInA.length === 0) return;
  error(`\n=== ${label} ===`);
  if (missingInB.length > 0) {
    error(`  Missing in ${bName} (${missingInB.length}):`);
    for (const k of missingInB) error(`    - ${k}`);
  }
  if (missingInA.length > 0) {
    error(`  Missing in ${aName} (${missingInA.length}):`);
    for (const k of missingInA) error(`    - ${k}`);
  }
}

// ── 1. Renderer namespace key parity ────────────────────────────────────────
const localeMaps = { "zh-CN": {}, "en-US": {} };
for (const ns of namespaces) {
  try {
    const zh = loadNs("zh-CN", ns);
    const en = loadNs("en-US", ns);
    localeMaps["zh-CN"][ns] = { data: zh, keys: flatten(zh) };
    localeMaps["en-US"][ns] = { data: en, keys: flatten(en) };
    reportKeyDiff(ns, "zh-CN", localeMaps["zh-CN"][ns].keys, "en-US", localeMaps["en-US"][ns].keys);
  } catch (e) {
    error(`Failed to read locale pair for ${ns}: ${e instanceof Error ? e.message : e}`);
  }
}

function lookup(locale, ns, path) {
  const bag = localeMaps[locale]?.[ns];
  if (!bag) return false;
  return bag.keys.has(path);
}

function getValue(locale, ns, path) {
  let cur = localeMaps[locale]?.[ns]?.data;
  if (!cur) return undefined;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

// ── 2. Electron main-process key parity ─────────────────────────────────────
{
  const electronI18n = readFileSync(join(desktopRoot, "electron/lib/electron-i18n.mjs"), "utf-8");
  const zh = keysFromStringMap(sliceLocaleObject(electronI18n, "zh-CN"));
  const en = keysFromStringMap(sliceLocaleObject(electronI18n, "en-US"));
  reportKeyDiff("electron-i18n", "zh-CN", zh, "en-US", en);
  if (zh.size < 50) error("electron-i18n zh-CN looks truncated (too few keys).");
}

// ── 3. UTR key parity ───────────────────────────────────────────────────────
{
  const utrI18n = readFileSync(join(repoRoot, "utr/core/i18n-strings.mjs"), "utf-8");
  const en = keysFromStringMap(sliceLocaleObject(utrI18n, "en-US"));
  const zh = keysFromStringMap(sliceLocaleObject(utrI18n, "zh-CN"));
  reportKeyDiff("utr/i18n-strings", "en-US", en, "zh-CN", zh);
  if (en.size < 30) error("UTR i18n-strings en-US looks truncated (too few keys).");
}

// ── 4–5. Command palette: labelKey + group map ──────────────────────────────
{
  const palette = readFileSync(join(srcDir, "components/overlays/CommandPalette.tsx"), "utf-8");
  const mappedGroups = new Set();
  const mapBlock = palette.match(/GROUP_KEY_MAP[^=]*=\s*\{([\s\S]*?)\}\s*;/);
  if (!mapBlock) {
    error("CommandPalette is missing GROUP_KEY_MAP.");
  } else {
    for (const m of mapBlock[1].matchAll(/^\s*([A-Za-z0-9_]+):/gm)) mappedGroups.add(m[1]);
  }

  const actionFiles = [];
  walkTs(join(srcDir, "plugins"), actionFiles);
  const groupUsed = new Set();
  let actionCount = 0;
  let labelKeyCount = 0;
  const missingLabelKeyFiles = [];
  for (const f of actionFiles) {
    const rel = relative(srcDir, f);
    if (!/actions\.ts$|skills\.ts$/.test(rel)) continue;
    const src = readFileSync(f, "utf-8");
    const actions = src.match(/kind:\s*"action"/g)?.length ?? 0;
    const keys = src.match(/\blabelKey\s*:/g)?.length ?? 0;
    actionCount += actions;
    labelKeyCount += keys;
    if (actions > 0 && actions !== keys) missingLabelKeyFiles.push(`${rel} (actions=${actions} labelKey=${keys})`);
    for (const m of src.matchAll(/\bgroup:\s*["']([^"']+)["']/g)) groupUsed.add(m[1]);
  }
  if (missingLabelKeyFiles.length > 0) {
    error("Command-palette actions must set labelKey (so labels follow the active locale):");
    for (const row of missingLabelKeyFiles) error(`  - ${row}`);
  }
  if (actionCount < 10) error(`Expected many command-palette actions, got ${actionCount}.`);
  if (labelKeyCount !== actionCount) {
    error(`labelKey count ${labelKeyCount} != action count ${actionCount}.`);
  }
  for (const g of [...groupUsed].sort()) {
    if (g === "other") continue;
    if (!mappedGroups.has(g)) {
      error(`Action group "${g}" is not in CommandPalette GROUP_KEY_MAP (palette would show the raw id).`);
    }
  }
}

// ── 6. Static t() / labelKey existence ──────────────────────────────────────
function fileNamespaces(src) {
  const nss = [];
  for (const m of src.matchAll(/useTranslation\(\s*\)/g)) {
    nss.push("common");
  }
  for (const m of src.matchAll(/useTranslation\(\s*["']([^"']+)["']\s*\)/g)) {
    nss.push(m[1]);
  }
  for (const m of src.matchAll(/useTranslation\(\s*\[([^\]]+)\]/g)) {
    for (const inner of m[1].matchAll(/["']([^"']+)["']/g)) nss.push(inner[1]);
  }
  return nss.length ? [...new Set(nss)] : ["common"];
}

const missingLookups = [];
for (const f of walkTs(srcDir)) {
  const src = readFileSync(f, "utf-8");
  const fileNs = fileNamespaces(src);
  const found = [];
  // Word-boundary so `import(` is not mistaken for `t(`.
  const re = /\b(?:i18n\.)?t\(\s*(["'])([^"'\\]+)\1/g;
  let m;
  while ((m = re.exec(src))) found.push(m[2]);
  const reKey = /\blabelKey:\s*(["'])([^"'\\]+)\1/g;
  while ((m = reKey.exec(src))) found.push(m[2]);

  const allNs = namespaces;
  for (const raw of found) {
    if (!raw.includes(".") && !raw.includes(":")) continue;
    if (raw.startsWith(".") || raw.startsWith("/") || raw.includes("/") || /\s/.test(raw)) continue;
    if (raw.includes(":")) {
      const i = raw.indexOf(":");
      const ns = raw.slice(0, i);
      const path = raw.slice(i + 1);
      if (!namespaces.includes(ns)) continue;
      if (!lookup("zh-CN", ns, path) || !lookup("en-US", ns, path)) {
        missingLookups.push(`${relative(srcDir, f)} → ${raw}`);
      }
      continue;
    }
    const tryNs = [...new Set([...fileNs, ...allNs])];
    const hit = tryNs.some((candidate) => lookup("zh-CN", candidate, raw) && lookup("en-US", candidate, raw));
    if (!hit) missingLookups.push(`${relative(srcDir, f)} → ${raw}`);
  }
}
if (missingLookups.length > 0) {
  error(`\nMissing locale keys (${missingLookups.length}):`);
  for (const row of missingLookups.slice(0, 80)) error(`  - ${row}`);
  if (missingLookups.length > 80) error(`  … ${missingLookups.length - 80} more`);
}

// ── 7. Product vocab + CJK-in-English ───────────────────────────────────────
for (const ns of namespaces) {
  const enKeys = localeMaps["en-US"][ns]?.keys;
  if (!enKeys) continue;
  for (const key of enKeys) {
    const val = getValue("en-US", ns, key);
    if (typeof val !== "string") continue;
    if (CJK_RE.test(val) && !CJK_ALLOW_KEYS.has(key.split(".").pop() || "")) {
      error(`en-US/${ns}.json ${key} contains CJK: ${JSON.stringify(val)}`);
    }
    for (const ban of PRODUCT_BANS_EN) {
      if (ban.re.test(val)) error(`en-US/${ns}.json ${key} ${ban.why}: ${JSON.stringify(val)}`);
    }
  }
}

{
  const electronI18n = readFileSync(join(desktopRoot, "electron/lib/electron-i18n.mjs"), "utf-8");
  const enBlock = sliceLocaleObject(electronI18n, "en-US");
  for (const ban of PRODUCT_BANS_EN) {
    if (ban.re.test(enBlock)) error(`electron-i18n en-US ${ban.why}`);
  }
  const utrI18n = readFileSync(join(repoRoot, "utr/core/i18n-strings.mjs"), "utf-8");
  const utrEn = sliceLocaleObject(utrI18n, "en-US");
  for (const ban of PRODUCT_BANS_EN) {
    if (ban.re.test(utrEn)) error(`UTR i18n en-US ${ban.why}`);
  }
}

if (!failed) {
  console.log("✅ i18n gate: locale parity, Electron/UTR keys, command palette, lookups, product vocab.");
} else {
  process.exit(1);
}
