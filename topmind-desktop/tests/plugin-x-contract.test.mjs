/**
 * X connector + plugin contract smoke tests (no network).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electron = path.join(root, "electron");
const plugins = path.join(root, "src/plugins");

test("PLUGIN.md documents connector layers and slot kinds", () => {
  const doc = path.join(root, "PLUGIN.md");
  assert.ok(existsSync(doc));
  const text = readFileSync(doc, "utf8");
  assert.match(text, /dataSource|sidebar|view|action|settings/);
  assert.match(text, /api\.x\.com\/mcp|Bearer|xurl/i);
  assert.match(text, /topmind-x|connector/i);
  assert.match(text, /activateConnector|defineConnectorPlugin|connector\.ts/i);
});

test("XService refuses app-only post and uses shared x-normalize", () => {
  const src = readFileSync(path.join(electron, "x-service.mjs"), "utf8");
  assert.match(src, /async testConnection/);
  assert.match(src, /async probeTools/);
  assert.match(src, /async postTweet/);
  assert.match(src, /writeLayer/);
  assert.match(src, /from "\.\/lib\/x-normalize\.mjs"/);
  assert.match(src, /isOverTweetLimit|normalizeTweet|extractTweets/);
  assert.match(src, /savePostDraft|x-draft/);
  assert.match(src, /XURL_INSTALL_HINTS|installHints/);
  // Must not claim Bearer can post
  assert.match(src, /Bearer App-Only cannot post|不能写|cannot post|x\.cannotPostDraft/i);
  assert.doesNotMatch(src, /layer === "mcp"[\s\S]{0,80}xApiV2[\s\S]{0,40}POST/);
  // Inline normalize must not remain (shared module is source of truth)
  assert.doesNotMatch(src, /function normalizeTweet\(/);
  // Official REST via xurl — no unofficial `timeline --user`
  assert.match(src, /xurlPostRestArgs|xurlSearchRestArgs|userTweetsPath/);
  assert.doesNotMatch(src, /timeline["'],\s*["']--user/);
  assert.match(src, /decideArchiveTweets/);
  assert.match(src, /timestampStamp/);
});

test("x-normalize pure helpers exist on disk", () => {
  const p = path.join(electron, "lib/x-normalize.mjs");
  assert.ok(existsSync(p));
  const src = readFileSync(p, "utf8");
  assert.match(src, /export function normalizeTweet/);
  assert.match(src, /export function extractTweets/);
  assert.match(src, /export function tweetLength/);
  assert.match(src, /export function isOverTweetLimit/);
  assert.match(src, /export function searchRecentQueryPath/);
  assert.match(src, /export function decideArchiveTweets/);
});

test("X plugin uses defineConnectorPlugin shared activate", () => {
  const index = readFileSync(path.join(plugins, "topmind-x/index.ts"), "utf8");
  assert.match(index, /defineConnectorPlugin/);
  assert.match(index, /createXSettingsSlot/);
  assert.match(index, /createXActions/);
  assert.match(index, /createXStatusBarSlot/);
  assert.match(index, /settingsKey:\s*["']x["']/);
  // 侧栏插件行已删除（2026-08-30）— chrome 入口统一在标题栏 Apps 菜单
  assert.doesNotMatch(index, /createXSidebarSlot/);
});

test("WeRead plugin uses defineConnectorPlugin (aligned with X)", () => {
  const index = readFileSync(path.join(plugins, "topmind-weread/index.ts"), "utf8");
  assert.match(index, /defineConnectorPlugin/);
  assert.match(index, /settingsKey:\s*["']weread["']/);
  assert.match(index, /createWereadSettingsSlot/);
  assert.match(index, /createWereadHubView/);
  assert.doesNotMatch(index, /createWereadSidebarSlot/);
});

test("connector.ts exports activateConnector + defineConnectorPlugin", () => {
  const src = readFileSync(path.join(plugins, "connector.ts"), "utf8");
  assert.match(src, /export async function activateConnector/);
  assert.match(src, /export function defineConnectorPlugin/);
  assert.match(src, /settingsKey/);
  assert.match(src, /interactiveSlots/);
});

test("X settings UI probes xurl and documents install + MCP", () => {
  const settings = readFileSync(path.join(plugins, "topmind-x/settings-slot.tsx"), "utf8");
  assert.match(settings, /api\.x\.com\/mcp/);
  assert.match(settings, /testConnection|测试连接/);
  assert.match(settings, /probeTools|重新探测/);
  assert.match(settings, /xurl/);
  assert.match(settings, /installHints|brew install|auth oauth2/i);
});

test("api.x exposes probeTools, testConnection and typed status fields", () => {
  const api = readFileSync(path.join(root, "src/services/api.ts"), "utf8");
  assert.match(api, /probeTools/);
  assert.match(api, /testConnection/);
  assert.match(api, /canPost/);
  assert.match(api, /installHints/);
  assert.match(api, /x\.getStatus/);
  assert.match(api, /x\.probeTools/);
});

test("X syncToNotes supports append mode", () => {
  const svc = readFileSync(path.join(root, "electron/x-service.mjs"), "utf8");
  assert.match(svc, /append/);
  assert.match(svc, /appended/);
  assert.match(svc, /splitMarkdownFrontmatter/);
  const api = readFileSync(path.join(root, "src/services/api.ts"), "utf8");
  assert.match(api, /append\?:/);
});

test("connector hubs register view slots", () => {
  const weread = readFileSync(path.join(plugins, "topmind-weread/index.ts"), "utf8");
  const x = readFileSync(path.join(plugins, "topmind-x/index.ts"), "utf8");
  assert.match(weread, /createWereadHubView/);
  assert.match(x, /createXHubView/);
  assert.match(readFileSync(path.join(root, "src/types.ts"), "utf8"), /kind:\s*['"]connector['"]/);
});
