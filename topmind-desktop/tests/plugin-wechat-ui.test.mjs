/**
 * Dedicated 公众号创作 mini-app: launcher contract + overlay / quality / format /
 * i18n key alignment + chrome registration.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const launcherUrl = pathToFileURL(path.join(root, "src/lib/plugin-launcher.ts")).href;

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

function flattenKeys(obj, prefix = "") {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...flattenKeys(v, key));
    } else {
      keys.push(key);
    }
  }
  return keys.sort();
}

test("launcher lists 公众号创作 when enabled and omits when off; opens as plugin-app overlay", async () => {
  const {
    listLaunchablePlugins,
    WECHAT_PLUGIN_ID,
    WECHAT_CHROME_IDS,
    PLUGIN_APP_KIND,
  } = await import(launcherUrl);

  const wechatMod = await import(
    pathToFileURL(path.join(root, "src/plugins/topmind-wechat/index.ts")).href
  );
  const plugin = {
    id: wechatMod.manifest.id,
    status: "active",
    manifest: wechatMod.manifest,
  };

  assert.equal(wechatMod.manifest.id, WECHAT_PLUGIN_ID);
  assert.equal(wechatMod.manifest.launchable, true);
  assert.equal(wechatMod.manifest.settingsKey, "wechat");
  assert.equal(wechatMod.manifest.nameKey, "wechat:name");
  assert.equal(wechatMod.manifest.icon, "file-text");

  // 默认就绪：settings.wechat.enabled 为 true 时列出；false 时省略
  assert.equal(
    listLaunchablePlugins([plugin], { wechat: { enabled: true } }).some(
      (p) => p.id === WECHAT_PLUGIN_ID,
    ),
    true,
  );
  assert.equal(
    listLaunchablePlugins([plugin], { wechat: { enabled: false } }).some(
      (p) => p.id === WECHAT_PLUGIN_ID,
    ),
    false,
  );

  // 无 connector hub ViewSlot → Apps 菜单按 overlay 打开；AppsLaunchList 不写死 id
  const { resolveLaunchableOpenTarget, pluginReadiness } = await import(
    pathToFileURL(path.join(root, "src/lib/apps-menu.ts")).href
  );
  assert.deepEqual(resolveLaunchableOpenTarget(WECHAT_PLUGIN_ID, []), { kind: "plugin-app" });
  assert.equal(PLUGIN_APP_KIND, "plugin-app");
  // 默认就绪 — 不在 pluginReadiness 加硬编码特例
  assert.deepEqual(pluginReadiness(WECHAT_PLUGIN_ID, null), {
    needsConfig: false,
    settingsTopicId: "topmind-wechat.settings",
  });

  assert.deepEqual(Object.values(WECHAT_CHROME_IDS).sort(), [
    "topmind-wechat.open",
    "topmind-wechat.statusbar",
  ]);
});

test("wechat-app exists as overlay slot and implements the five-step workflow", () => {
  const app = read("src/plugins/topmind-wechat/wechat-app.tsx");
  assert.ok(existsSync(path.join(root, "src/plugins/topmind-wechat/wechat-app.tsx")));
  assert.ok(existsSync(path.join(root, "src/plugins/topmind-wechat/settings-slot.tsx")));
  assert.ok(existsSync(path.join(root, "src/plugins/topmind-wechat/actions.ts")));
  assert.ok(existsSync(path.join(root, "src/plugins/topmind-wechat/status-bar-slot.tsx")));

  // OverlaySlot id + matches plugin-app:topmind-wechat
  assert.match(app, /id:\s*["']topmind-wechat\.app["']/);
  assert.match(app, /plugin-app:topmind-wechat/);
  assert.match(app, /v4-plugin-app-panel|data-wechat-app/);

  // 五步：包列表 / 改稿 / 质检 / 排版
  assert.match(app, /data-wechat-packages/);
  assert.match(app, /data-wechat-edit/);
  assert.match(app, /data-wechat-quality/);
  assert.match(app, /data-wechat-preview/);
  assert.match(app, /steps\.packages/);
  assert.match(app, /steps\.edit/);
  assert.match(app, /steps\.quality/);
  assert.match(app, /steps\.preview/);

  // 新建包骨架 + 改稿保存走 api.ws
  assert.match(app, /公众号稿\.md/);
  assert.match(app, /api\.ws\.save/);
  assert.match(app, /api\.ws\.read/);
  assert.match(app, /api\.ws\.listDir/);
  assert.match(app, /toastWriteback/);

  // 质检：AI 味分 + lint + 事实勾选
  assert.match(app, /analyzeWechatQuality|scanAiFlavor/);
  assert.match(app, /data-wechat-ai-score/);
  assert.match(app, /data-wechat-facts/);
  assert.match(app, /defaultFactChecklist/);

  // 排版预览 + 导出/复制
  assert.match(app, /wechatCopyHtml|wechatHtmlDocument/);
  assert.match(app, /copyHtml/);
  assert.match(app, /exportHtml/);

  // 禁止裸 fs / PrimaryNav / 侧栏插件行
  assert.doesNotMatch(app, /\bnode:fs\b|\brequire\(["']fs["']\)/);
  assert.doesNotMatch(app, /PrimaryNav/);
});

test("wechat-quality / wechat-format are skill-sourced subsets", async () => {
  const qualitySrc = read("src/lib/wechat-quality.ts");
  assert.match(qualitySrc, /skills\/topmind-wechat/);
  assert.match(qualitySrc, /scan_ai_flavor/);
  assert.match(qualitySrc, /lint-wechat/);
  assert.match(qualitySrc, /export function scanAiFlavor/);
  assert.match(qualitySrc, /export function lintWechat/);
  assert.match(qualitySrc, /export function analyzeWechatQuality/);
  assert.match(qualitySrc, /WECHAT_AI_TARGET|WECHAT_MAX_PARA/);

  const formatSrc = read("src/lib/wechat-format.ts");
  assert.match(formatSrc, /wechat-constraints/);
  assert.match(formatSrc, /md2wechat/);
  assert.match(formatSrc, /export function wechatMarkdownToHtml/);
  assert.match(formatSrc, /export function wechatCopyHtml/);
  // 约束：不用 h1/pre/figure；容器 note/tip/warn/pull/stat
  assert.match(formatSrc, /note/);
  assert.match(formatSrc, /tip/);
  assert.match(formatSrc, /warn/);
  assert.match(formatSrc, /pull/);
  assert.match(formatSrc, /stat/);

  const quality = await import(pathToFileURL(path.join(root, "src/lib/wechat-quality.ts")).href);
  const report = quality.analyzeWechatQuality(
    "众所周知，赋能很重要。\n\n这是一段正常文字。\n\n综上所述，让我们一起砥砺前行。",
  );
  assert.ok(report.aiScore < 100);
  assert.ok(report.aiHits.length > 0);
  assert.ok(Array.isArray(report.lintIssues));

  // 与 lint-wechat.py 默认值对拍：max-item 必须是 70（不是 80）
  assert.equal(quality.WECHAT_MAX_ITEM, 70);
  assert.equal(quality.WECHAT_MAX_PARA, 110);

  // 结构扣分生效：无数字 + 无「我」+ 重复段首标签
  const structuralSample = [
    "## 一",
    "",
    "**结论**：A",
    "",
    "**结论**：B",
    "",
    "**结论**：C",
    "",
    "值得注意，这很重要。",
  ].join("\n");
  const scanned = quality.scanAiFlavor(structuralSample);
  assert.ok(scanned.structuralDeduction > 0, "structural deduction must fire");
  assert.ok(scanned.score < 85, `score ${scanned.score} should fail 85 gate on structural sample`);

  const clean = "我测了 3 次，结果是 2 过 1 挂。\n\n细节见下文。";
  const cleanScan = quality.scanAiFlavor(clean);
  assert.equal(cleanScan.structuralDeduction, 0);

  const format = await import(pathToFileURL(path.join(root, "src/lib/wechat-format.ts")).href);
  const html = format.wechatMarkdownToHtml("# 标题\n\n正文**加粗**\n\n::: pull\n金句\n:::\n");
  assert.match(html, /style="/);
  assert.doesNotMatch(html, /<h1\b/);
  assert.doesNotMatch(html, /<pre\b/);
  assert.doesNotMatch(html, /<figure\b/);
  assert.doesNotMatch(html, /class=/);

  // stat 管道行：非 `值 | 说明` 静默丢弃（md2wechat.py 语义）
  const statHtml = format.wechatMarkdownToHtml("::: stat\n12ms | 打包耗时\n坏行无管道\n85 分 | AI 味\n:::\n");
  assert.match(statHtml, /12ms/);
  assert.match(statHtml, /85 分/);
  assert.doesNotMatch(statHtml, /坏行无管道/);
});

test("export path uses embed-images + upload checklist + slug naming", () => {
  const app = read("src/plugins/topmind-wechat/wechat-app.tsx");
  assert.match(app, /embedLocalImagesWithChecklist/);
  assert.match(app, /readBinary/);
  assert.match(app, /图片上传清单/);
  assert.match(app, /公众号版\.html/);
  assert.match(app, /\$\{slug\}-公众号版\.html/);
  assert.doesNotMatch(app, /公众号稿-公众号版\.html/);
  assert.match(app, /finalizePackage/);
  assert.match(app, /-released/);
  assert.match(app, /polishDraft/);
  assert.match(app, /api\.ai\.complete/);
  assert.match(app, /STATUS_FINAL/);
  // skill-script export bypass + i18n quality messages
  assert.match(app, /exportViaScript/);
  assert.match(app, /messageKey/);
});

test("quality issues expose i18n keys and skill-script export RPC exists", async () => {
  const quality = await import(pathToFileURL(path.join(root, "src/lib/wechat-quality.ts")).href);
  const report = quality.analyzeWechatQuality("众所周知，赋能。\n\n短段。\n");
  if (report.lintIssues[0]) {
    assert.ok(report.lintIssues[0].messageKey.startsWith("lintRules."));
  }
  if (report.aiHits[0]) {
    assert.ok(report.aiHits[0].nameKey.startsWith("aiNames."));
  }
  const wechatSvc = read("electron/wechat-service.mjs");
  assert.match(wechatSvc, /exportViaScript/);
  assert.match(wechatSvc, /md2wechat\.py/);
  assert.match(wechatSvc, /probeScripts/);
  const apiSrc = read("src/services/api.ts");
  assert.match(apiSrc, /exportViaScript/);

  // skill stdout compliance parsed into UI
  const svc = read("electron/wechat-service.mjs");
  assert.match(svc, /parseCompliance|合规自检/);
  const app = read("src/plugins/topmind-wechat/wechat-app.tsx");
  assert.match(app, /ConnectorToolChip/);
  assert.match(app, /probeScripts/);
  assert.match(app, /exportNote|complianceNote/);
  assert.match(app, /ArrowRight/);
  assert.match(app, /PluginAppHeader/);
  assert.match(app, /AppModeTabs/);
  assert.match(app, /openExportedHtml|lastHtmlPath/);
  assert.match(app, /data-wechat-checklist/);
});

test("unified mini-app shell primitives are shared across first-party apps", () => {
  const shell = read("src/plugins/connector-ui.tsx");
  assert.match(shell, /PluginAppHeader/);
  assert.match(shell, /AppModeTabs/);
  assert.match(shell, /ConnectorToastBanner/);
  assert.match(shell, /ConnectorToolChip/);

  const ledger = read("src/plugins/topmind-ledger/ledger-app.tsx");
  assert.match(ledger, /PluginAppHeader/);
  assert.match(ledger, /AppModeTabs/);
  assert.match(ledger, /ConnectorToastBanner/);

  const ingest = read("src/plugins/topmind-ingest/hub-view.tsx");
  assert.match(ingest, /ConnectorToastBanner/);
  assert.match(ingest, /ConnectorHubHeader/);

  // connector hubs keep hub header + toast
  for (const f of ["src/plugins/topmind-weread/hub-view.tsx", "src/plugins/topmind-x/hub-view.tsx"]) {
    const src = read(f);
    assert.match(src, /ConnectorHubHeader/);
    assert.match(src, /ConnectorToastBanner/);
  }
});

test("DS 4.2 UI contracts: sticky banner · one primary CTA · close-guard · ConfirmDialog · step fill layout", () => {
  const app = read("src/plugins/topmind-wechat/wechat-app.tsx");
  // sticky status banner via ConnectorToastBanner (container colors)
  assert.match(app, /ConnectorToastBanner/);
  // dirty close-guard
  assert.match(app, /setOverlayCloseGuard/);
  // finalize confirm
  assert.match(app, /ConfirmDialog/);
  assert.match(app, /confirmFinalize/);
  // step-aware layout (edit/preview fill, others scroll)
  assert.match(app, /fillBody/);
  // EmptyState / LoadingState / listRowClass primitives
  assert.match(app, /EmptyState/);
  assert.match(app, /LoadingState/);
  assert.match(app, /listRowClass/);
  // package search + missing draft
  assert.match(app, /searchPackages|hasDraft/);
  // polish lives on edit step
  const editBlock = app.slice(app.indexOf('data-wechat-edit'), app.indexOf('data-wechat-quality'));
  assert.match(editBlock, /polishDraft/);
  // Cmd+S save
  assert.match(app, /metaKey|ctrlKey/);
  // one default CTA per step region: packages submit / edit save / preview export
  assert.match(app, /type="submit"/);
});

test("i18n wechat keys are strictly aligned zh-CN ↔ en-US and registered", () => {
  const zh = JSON.parse(read("src/locales/zh-CN/wechat.json"));
  const en = JSON.parse(read("src/locales/en-US/wechat.json"));
  assert.deepEqual(flattenKeys(zh), flattenKeys(en));

  const localesIndex = read("src/locales/index.ts");
  assert.match(localesIndex, /"wechat"/);
  assert.match(localesIndex, /zhCNWechat/);
  assert.match(localesIndex, /enUSWechat/);

  const overlaysZh = read("src/locales/zh-CN/overlays.json");
  const overlaysEn = read("src/locales/en-US/overlays.json");
  assert.match(overlaysZh, /wechatOpen/);
  assert.match(overlaysEn, /wechatOpen/);
});

test("settings / host / launcher / chrome registration is complete", () => {
  const host = read("src/plugins/host.ts");
  assert.match(host, /topmind-wechat/);
  assert.match(host, /BUILTIN_PLUGINS/);

  const types = read("src/types.ts");
  assert.match(types, /WechatSettings/);
  assert.match(types, /wechat:\s*WechatSettings/);
  assert.match(types, /packageRoot\?:/);

  const settingsCore = read("electron/lib/settings-core.mjs");
  assert.match(settingsCore, /defaultWechatSettings/);
  assert.match(settingsCore, /normalizeWechatSettings/);

  const launcher = read("src/lib/plugin-launcher.ts");
  assert.match(launcher, /WECHAT_PLUGIN_ID/);
  assert.match(launcher, /WECHAT_CHROME_IDS/);
  assert.match(launcher, /topmind-wechat\.open/);

  // AppsLaunchList ICON_MAP has file-text; no hardcoded plugin ids
  const appsList = read("src/components/shell/AppsLaunchList.tsx");
  assert.match(appsList, /file-text/);
  assert.doesNotMatch(appsList, /topmind-wechat/);

  // SettingsDialog SLOT_ICON_MAP
  const settingsDialog = read("src/components/overlays/SettingsDialog.tsx");
  assert.match(settingsDialog, /file-text/);

  // actions / status-bar chrome ids
  const actions = read("src/plugins/topmind-wechat/actions.ts");
  assert.match(actions, /WECHAT_CHROME_IDS\.action/);
  assert.match(actions, /PLUGIN_APP_KIND/);
  assert.match(actions, /labelKey:\s*["']wechat:/);

  const status = read("src/plugins/topmind-wechat/status-bar-slot.tsx");
  assert.match(status, /data-wechat-open/);
  assert.match(status, /PLUGIN_APP_KIND/);

  // index uses defineConnectorPlugin + launchable
  const index = read("src/plugins/topmind-wechat/index.ts");
  assert.match(index, /defineConnectorPlugin/);
  assert.match(index, /launchable:\s*true/);
  assert.match(index, /settingsKey:\s*["']wechat["']/);
  assert.match(index, /createWechatOverlaySlot/);
  assert.match(index, /createWechatSettingsSlot/);
  assert.match(index, /createWechatActions/);
  assert.match(index, /createWechatStatusBarSlot/);
});

test("docs list 公众号创作 in the app inventory", () => {
  assert.match(read("PLUGIN.md"), /topmind-wechat|公众号创作/);
  assert.match(read("DESIGN.md"), /公众号创作|wechat mini-app/);
  assert.match(read("ARCHITECTURE.md"), /topmind-wechat/);
});
