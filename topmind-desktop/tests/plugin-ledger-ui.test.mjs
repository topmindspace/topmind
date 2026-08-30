/**
 * Dedicated 记账 mini-app: overlay contract + 看板 helpers + UI affordances.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { summarizeLedgerBooks } from "../src/lib/ledger-summary.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const launcherUrl = pathToFileURL(path.join(root, "src/lib/plugin-launcher.ts")).href;

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

test("launcher lists 记账 when enabled and omits when off; opens as plugin-app overlay", async () => {
  const {
    listLaunchablePlugins,
    LEDGER_PLUGIN_ID,
    PLUGIN_APP_KIND,
  } = await import(launcherUrl);
  const ledgerMod = await import(pathToFileURL(path.join(root, "src/plugins/topmind-ledger/index.ts")).href);
  const plugin = { id: ledgerMod.manifest.id, status: "active", manifest: ledgerMod.manifest };
  assert.equal(listLaunchablePlugins([plugin], { ledger: { enabled: true } }).some((p) => p.id === LEDGER_PLUGIN_ID), true);
  assert.equal(listLaunchablePlugins([plugin], { ledger: { enabled: false } }).some((p) => p.id === LEDGER_PLUGIN_ID), false);

  // 2026-08-30: 记账没有 connector hub ViewSlot → Apps 菜单按 overlay 打开
  const { resolveLaunchableOpenTarget } = await import(pathToFileURL(path.join(root, "src/lib/apps-menu.ts")).href);
  assert.deepEqual(resolveLaunchableOpenTarget(LEDGER_PLUGIN_ID, []), { kind: "plugin-app" });
  assert.equal(PLUGIN_APP_KIND, "plugin-app");
});

test("summarizeLedgerBooks (UI-consumed) produces 看板 totals and honors user categories", () => {
  const summary = summarizeLedgerBooks([
    {
      roleId: "Personal",
      accountName: "自己",
      balance: 80,
      relPath: "memory/ledgers/Personal.md",
      entries: [
        { timestamp: "2026-08-29 10:00:00", direction: "收入", amount: 100, category: "工资" },
        { timestamp: "2026-08-29 12:00:00", direction: "支出", amount: 20, category: "餐饮" },
      ],
    },
    {
      roleId: "Family",
      accountName: "家庭",
      balance: -32,
      relPath: "memory/ledgers/Family.md",
      entries: [
        { timestamp: "2026-08-29 18:00:00", direction: "支出", amount: 32, category: "餐饮" },
      ],
    },
  ]);
  assert.equal(summary.bookCount, 2);
  assert.equal(summary.income, 100);
  assert.equal(summary.expense, 52);
  assert.equal(summary.balance, 48);
  const food = summary.byCategory.find((c) => c.category === "餐饮");
  assert.ok(food);
  assert.equal(food.expense, 52);
  assert.equal(food.count, 2);
  assert.ok(summary.byBook.some((b) => b.roleId === "Personal" && b.income === 100 && b.relPath === "memory/ledgers/Personal.md"));
  assert.ok(!summary.byBook.some((b) => b.roleId === "ClassFund"));
  assert.ok(!summary.byBook.some((b) => b.roleId === "Giggs"));
});

test("looksLikeLedgerText covers shipped Kernel capture and read triggers", async () => {
  const { looksLikeLedgerText } = await import(
    pathToFileURL(path.join(root, "src/components/overlays/LedgerQuickEntry.tsx")).href
  );
  const { LEDGER_CAPTURE_TRIGGERS, LEDGER_READ_TRIGGERS } = await import(
    pathToFileURL(path.resolve(root, "..", "lib/ledger-engine.mjs")).href
  );
  for (const phrase of [...LEDGER_CAPTURE_TRIGGERS, ...LEDGER_READ_TRIGGERS]) {
    assert.equal(looksLikeLedgerText(phrase), true, phrase);
  }
  assert.equal(looksLikeLedgerText("记一下今天下午开会"), false);
});

test("记账 mini-app source has 看板 / 流水 / 分类 / 快捷记账", () => {
  const app = read("src/plugins/topmind-ledger/ledger-app.tsx");
  assert.match(app, /tabs\.board/);
  assert.match(app, /tabs\.flow/);
  assert.match(app, /tabs\.categories/);
  assert.match(app, /tabs\.quick/);
  assert.match(app, /summarizeLedgerBooks/);
  assert.match(app, /api\.ledger\.addCategory/);
  assert.match(app, /nlPlaceholder/);
  assert.match(app, /current\?\.relPath|current\.relPath/);
  assert.match(app, /data-ledger-book-path/);
  assert.match(app, /bookPath/);
  assert.doesNotMatch(app, /Giggs/);
  assert.doesNotMatch(app, /ClassFund/);
  const locales = read("src/locales/zh-CN/ledger.json") + read("src/locales/en-US/ledger.json");
  assert.match(locales, /看板|Board/);
  assert.match(locales, /chromeOpen/);
  assert.match(locales, /bookPathHint/);
  assert.match(locales, /howToOpen/);
  assert.match(locales, /ledgers\//);
  assert.doesNotMatch(locales, /ClassFund/);
  assert.doesNotMatch(locales, /Giggs \/ ClassFund \/ Mom/);
  const pluginDoc = read("PLUGIN.md");
  assert.match(pluginDoc, /personal \/ 自己|Personal/);
  assert.match(pluginDoc, /historical format references, not shipped defaults/);
  assert.match(pluginDoc, /trusted-by-install|用户自装/);
  assert.match(pluginDoc, /如何打开/);
  assert.match(pluginDoc, /账本路径/);
  assert.match(pluginDoc, /memory\.dir/);
  assert.match(pluginDoc, /ledgers/);
  const skill = readFileSync(path.resolve(root, "..", "skills/topmind-ledger/SKILL.md"), "utf8");
  assert.match(skill, /entrypoint:\s*false/);
  assert.match(skill, /如何打开/);
  assert.match(skill, /账本路径/);
  assert.match(skill, /memory\.dir.*ledgers|ledgers\//);
  assert.doesNotMatch(skill, /侧栏插件区/);
  const capture = read("src/components/overlays/CaptureForm.tsx");
  assert.match(capture, /LedgerQuickEntry/);
  const stream = read("src/plugins/topmind-workspace/views/StreamDetailView.tsx");
  assert.match(stream, /looksLikeLedgerText/);
  assert.match(stream, /LedgerQuickEntry/);
  assert.doesNotMatch(stream, /\bWallet\b/);
});
