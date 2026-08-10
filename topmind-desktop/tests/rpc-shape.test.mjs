/**
 * RPC result shape helpers — pure unit tests + production return fixtures.
 * Valid fixtures come from shipped service functions (not invented keys).
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertObjectKeys,
  checkRpcResult,
  guardRpcResult,
  isRpcShapeCheckEnabled,
  RPC_RESULT_SHAPES,
} from "../electron/lib/rpc-shape.mjs";

const electronLib = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../electron/lib");
const electronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../electron");

let pathOps;
let scanOps;
let getRuntimeStatus;
let createDefaultAppSettings;
let tmpRoot;
let workspace;

function ctx() {
  return { workspaceRoot: workspace };
}

before(async () => {
  pathOps = (await import(pathToFileURL(path.join(electronLib, "workspace-path-ops.mjs")).href)).pathOps;
  scanOps = (await import(pathToFileURL(path.join(electronLib, "workspace-scan-ops.mjs")).href)).scanOps;
  getRuntimeStatus = (await import(pathToFileURL(path.join(electronDir, "ai-model.mjs")).href)).getRuntimeStatus;
  createDefaultAppSettings = (
    await import(pathToFileURL(path.join(electronLib, "settings-core.mjs")).href)
  ).createDefaultAppSettings;
});

beforeEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = mkdtempSync(path.join(tmpdir(), "topmind-rpc-shape-"));
  workspace = {
    engineRoot: path.join(tmpRoot, "engine"),
    userWorkspaceRoot: path.join(tmpRoot, "ws"),
  };
  for (const d of ["00-收件箱", "10-动态", "20-研究", "88-输出", "99-归档"]) {
    mkdirSync(path.join(workspace.userWorkspaceRoot, d), { recursive: true });
  }
  mkdirSync(workspace.engineRoot, { recursive: true });
  writeFileSync(
    path.join(workspace.userWorkspaceRoot, "20-研究", "note.md"),
    "---\ntitle: Meta\n---\n\n# Hello shape\n",
    "utf8",
  );
});

after(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

test("assertObjectKeys: valid object with required keys passes", () => {
  const v = assertObjectKeys({ path: "a.md", exists: true, extra: 1 }, ["path", "exists"]);
  assert.equal(v.ok, true);
});

test("assertObjectKeys: missing keys fails with missing list", () => {
  const v = assertObjectKeys({ path: "a.md" }, ["path", "exists"]);
  assert.equal(v.ok, false);
  assert.deepEqual(v.missing, ["exists"]);
  assert.equal(v.actualType, "object");
});

test("assertObjectKeys: null / array wrong shape fails", () => {
  assert.equal(assertObjectKeys(null, ["path"]).ok, false);
  assert.equal(assertObjectKeys([], ["path"]).ok, false);
  assert.equal(assertObjectKeys("x", ["path"]).ok, false);
});

test("assertObjectKeys: empty required keys allows array or object, rejects null", () => {
  assert.equal(assertObjectKeys([], []).ok, true);
  assert.equal(assertObjectKeys({}, []).ok, true);
  assert.equal(assertObjectKeys(null, []).ok, false);
});

test("production getFileMeta return passes registered shape (FileMetaResult keys)", async () => {
  const real = await pathOps.getFileMeta({ relativePath: "20-研究/note.md" }, ctx());
  // Must match FileMetaResult / pathOps.getFileMeta — not invented {path,exists}
  assert.ok("frontmatter" in real);
  assert.ok("bodyPreview" in real);
  assert.ok("size" in real);
  assert.ok("mtime" in real);
  assert.equal("path" in real, false, "production does not return path on getFileMeta");
  assert.equal("exists" in real, false, "production does not return exists on getFileMeta");

  const r = checkRpcResult("workspace.getFileMeta", real);
  assert.equal(r.checked, true);
  assert.equal(r.ok, true, `shape mismatch: ${JSON.stringify(r)}`);
});

test("invented getFileMeta {path,exists} fails registered shape (drift guard)", () => {
  const invented = { path: "20-研究/note.md", exists: true };
  const r = checkRpcResult("workspace.getFileMeta", invented);
  assert.equal(r.checked, true);
  assert.equal(r.ok, false);
  assert.ok(r.missing?.includes("frontmatter"));
  assert.ok(r.missing?.includes("bodyPreview"));
});

test("production search return passes registered shape", async () => {
  const real = await scanOps.search({ query: "Hello", maxResults: 10 }, ctx());
  assert.ok(Array.isArray(real.results));
  const r = checkRpcResult("workspace.search", real);
  assert.equal(r.checked, true);
  assert.equal(r.ok, true, `shape mismatch: ${JSON.stringify(r)}`);
});

test("checkRpcResult: known method intentionally wrong shape fails", () => {
  const r = checkRpcResult("workspace.search", { hits: [] });
  assert.equal(r.checked, true);
  assert.equal(r.ok, false);
  assert.ok(r.missing?.includes("results"));
});

test("production listCategories return passes registered shape", async () => {
  const real = await scanOps.listCategories({}, ctx());
  assert.ok(Array.isArray(real.categories));
  assert.ok(typeof real.rootPath === "string");
  const r = checkRpcResult("workspace.listCategories", real);
  assert.equal(r.checked, true);
  assert.equal(r.ok, true, `shape mismatch: ${JSON.stringify(r)}`);
});

test("listCategories as bare array fails registered shape", () => {
  const r = checkRpcResult("workspace.listCategories", [{ name: "00-收件箱" }]);
  assert.equal(r.checked, true);
  assert.equal(r.ok, false);
});

test("production getRuntimeStatus return passes registered shape", () => {
  const real = getRuntimeStatus({ ai: { manual: {} } });
  assert.equal(typeof real.ready, "boolean");
  assert.equal(typeof real.message, "string");
  const r = checkRpcResult("ai.getRuntimeStatus", real);
  assert.equal(r.checked, true);
  assert.equal(r.ok, true, `shape mismatch: ${JSON.stringify(r)}`);
});

test("production default settings pass system.getSettings shape", () => {
  const real = createDefaultAppSettings(workspace.userWorkspaceRoot);
  assert.ok(real.theme);
  assert.ok(real.writebackMode);
  const r = checkRpcResult("system.getSettings", real);
  assert.equal(r.checked, true);
  assert.equal(r.ok, true, `shape mismatch: ${JSON.stringify(r)}`);
});

test("checkRpcResult: unknown method is not checked", () => {
  const r = checkRpcResult("workspace.mystery", { anything: true });
  assert.equal(r.checked, false);
  assert.equal(r.ok, true);
});

test("guardRpcResult: returns result unchanged on valid production-like shape", () => {
  const payload = { ready: true, message: "ok", providers: [] };
  const out = guardRpcResult("ai.getRuntimeStatus", payload, {
    enabled: true,
    throwOnMismatch: true,
  });
  assert.equal(out, payload);
});

test("guardRpcResult: throwOnMismatch throws on wrong shape", () => {
  assert.throws(
    () =>
      guardRpcResult("system.getSettings", { theme: "dark" }, {
        enabled: true,
        throwOnMismatch: true,
      }),
    /writebackMode|rpc-shape/,
  );
});

test("guardRpcResult: disabled skips check even for bad shape", () => {
  const bad = { nope: 1 };
  const out = guardRpcResult("workspace.getFileMeta", bad, {
    enabled: false,
    throwOnMismatch: true,
  });
  assert.equal(out, bad);
});

test("isRpcShapeCheckEnabled honors force flags", () => {
  assert.equal(isRpcShapeCheckEnabled({ TOPMIND_RPC_SHAPE_CHECK: "1", NODE_ENV: "production" }), true);
  assert.equal(isRpcShapeCheckEnabled({ TOPMIND_RPC_SHAPE_CHECK: "0", NODE_ENV: "development" }), false);
  assert.equal(isRpcShapeCheckEnabled({ NODE_ENV: "production" }), false);
  assert.equal(isRpcShapeCheckEnabled({ NODE_ENV: "development" }), true);
});

test("RPC_RESULT_SHAPES keys match production FileMetaResult (not path/exists)", () => {
  const keys = RPC_RESULT_SHAPES["workspace.getFileMeta"];
  assert.deepEqual([...keys], ["frontmatter", "bodyPreview", "size", "mtime"]);
  assert.ok(RPC_RESULT_SHAPES["workspace.search"]);
  assert.ok(RPC_RESULT_SHAPES["workspace.listCategories"]);
  assert.ok(RPC_RESULT_SHAPES["system.getSettings"]);
  assert.ok(RPC_RESULT_SHAPES["ai.getRuntimeStatus"]);
});
