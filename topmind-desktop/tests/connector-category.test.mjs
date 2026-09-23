/**
 * Connector category resolution — separator-aware, no hardcoded "30 阅读".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { pickConnectorCategory, resolveConnectorSyncCategory } from "../electron/lib/connector-category.mjs";
import { __settingsTest } from "../electron/settings.mjs";
import { resolveConnectorCategory } from "../electron/lib/template-api.mjs";
import { setEngineRoot } from "../electron/lib/workspace-home.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// template-api reads via loadTemplateJson / ENGINE_ROOT
setEngineRoot(engineRoot);

test("pickConnectorCategory: auto + hyphen workspace → 30-阅读", () => {
  const cats = ["00-收件箱", "10-动态", "30-阅读", "60-参考资料", "88-输出", "99-归档"];
  assert.equal(
    pickConnectorCategory(cats, { preferred: "auto", connectorType: "weread", separator: "-", templateResolved: "30-阅读" }),
    "30-阅读",
  );
  assert.equal(
    pickConnectorCategory(cats, { preferred: "auto", connectorType: "x", separator: "-", templateResolved: "60-参考资料" }),
    "60-参考资料",
  );
});

test("pickConnectorCategory: legacy space preference remaps to hyphen dir", () => {
  const cats = ["00-收件箱", "30-阅读", "60-参考资料"];
  assert.equal(
    pickConnectorCategory(cats, { preferred: "30 阅读", connectorType: "weread", separator: "-" }),
    "30-阅读",
  );
  assert.equal(
    pickConnectorCategory(cats, { preferred: "60 参考资料", connectorType: "x", separator: "-" }),
    "60-参考资料",
  );
});

test("pickConnectorCategory: space workspace keeps space names", () => {
  const cats = ["00 Inbox", "30 阅读", "60 参考资料"];
  assert.equal(
    pickConnectorCategory(cats, { preferred: "auto", connectorType: "weread", separator: " ", templateResolved: "30 阅读" }),
    "30 阅读",
  );
  assert.equal(
    pickConnectorCategory(cats, { preferred: "30-阅读", connectorType: "weread", separator: " " }),
    "30 阅读",
  );
});

test("pickConnectorCategory: explicit existing wins", () => {
  const cats = ["00-收件箱", "20-研究", "30-阅读"];
  assert.equal(
    pickConnectorCategory(cats, { preferred: "20-研究", connectorType: "weread", separator: "-" }),
    "20-研究",
  );
});

test("template resolveConnectorCategory honors separator", () => {
  assert.equal(resolveConnectorCategory(engineRoot, "balanced", "weread", "-"), "20-专题");
  assert.equal(resolveConnectorCategory(engineRoot, "balanced", "weread", " "), "20 专题");
  assert.equal(resolveConnectorCategory(engineRoot, "balanced", "x", "-"), "20-专题");
});

test("weread settings default syncCategory is auto; legacy hardcodes migrate", () => {
  const { createDefaultAppSettings, normalizeWereadSettings, normalizeXSettings } = __settingsTest;
  const d = createDefaultAppSettings("/tmp/ws");
  assert.equal(d.weread.syncCategory, "auto");
  assert.equal(d.x.syncCategory, "auto");
  assert.equal(normalizeWereadSettings({ syncCategory: "30 阅读" }).syncCategory, "auto");
  assert.equal(normalizeWereadSettings({ syncCategory: "30-阅读" }).syncCategory, "auto");
  assert.equal(normalizeXSettings({ syncCategory: "60 参考资料" }).syncCategory, "auto");
});

test("resolveConnectorSyncCategory reads nested v4 yaml (research → 30-研究, not stream 20-专题)", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "tm-conn-research-"));
  try {
    fs.writeFileSync(
      path.join(ws, "topmind.yaml"),
      [
        "contract_version: 4",
        "workspace:",
        "  template: research",
        "  category_separator: \"-\"",
        "  locale: zh-CN",
        "",
      ].join("\n"),
      "utf8",
    );
    for (const dir of ["00-收件箱", "10-动态", "20-专题", "30-研究", "40-参考资料", "88-输出", "99-归档"]) {
      fs.mkdirSync(path.join(ws, dir), { recursive: true });
    }
    const ctx = { engineRoot, userWorkspaceRoot: ws };
    const got = await resolveConnectorSyncCategory(ctx, "auto", "weread", { engineRoot });
    assert.equal(got, "30-研究");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("resolveConnectorSyncCategory honors ingest.connectors over template hint", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "tm-conn-ingest-"));
  try {
    fs.writeFileSync(
      path.join(ws, "topmind.yaml"),
      [
        "contract_version: 4",
        "workspace:",
        "  template: stream",
        "  category_separator: \"-\"",
        "ingest:",
        "  connectors:",
        "    weread:",
        "      syncCategory: 40-参考资料",
        "",
      ].join("\n"),
      "utf8",
    );
    for (const dir of ["00-收件箱", "10-动态", "20-专题", "40-参考资料", "88-输出", "99-归档"]) {
      fs.mkdirSync(path.join(ws, dir), { recursive: true });
    }
    const ctx = { engineRoot, userWorkspaceRoot: ws };
    const got = await resolveConnectorSyncCategory(ctx, "auto", "weread", { engineRoot });
    assert.equal(got, "40-参考资料");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("resolveConnectorSyncCategory source reads nested v4 keys only", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../electron/lib/connector-category.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /config\.template\b/);
  assert.doesNotMatch(src, /config\.categorySeparator\b/);
  assert.doesNotMatch(src, /config\.connectorDefaults/);
  assert.match(src, /config\.workspace\?\.template/);
  assert.match(src, /config\.ingest\?\.connectors/);
});

test("weread service no longer hardcodes 30 space 阅读 as SYNC_CATEGORY", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../electron/weread-service.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /SYNC_CATEGORY\s*=\s*["']30 阅读["']/);
  assert.match(src, /resolveConnectorSyncCategory|resolveWereadCategory/);
  assert.doesNotMatch(src, /MAX_FIRST_SYNC_BATCH/);
  assert.match(src, /lastSort/);
  assert.match(src, /DEFAULT_BUDGET_MS|budgetMs/);
  assert.match(src, /external-capture/);
});
