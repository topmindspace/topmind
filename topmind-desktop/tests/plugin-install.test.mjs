/**
 * Plugin install / uninstall / permissions (no Electron).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  validatePluginPackage,
  installPluginFromFolder,
  uninstallPlugin,
  scaffoldExamplePlugin,
  assessPluginPermissions,
  previewPluginFromFolder,
  assertExtractContained,
} from "../electron/lib/plugin-install.mjs";
import { listExternalPlugins, exampleManifest } from "../electron/lib/external-plugins.mjs";

test("validatePluginPackage accepts example layout", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mh-plug-val-"));
  const dir = path.join(root, "hello");
  await fs.mkdir(dir);
  const m = exampleManifest();
  await fs.writeFile(path.join(dir, "topmind-plugin.json"), JSON.stringify(m), "utf8");
  await fs.writeFile(path.join(dir, "index.mjs"), "export default {};\n", "utf8");
  const v = await validatePluginPackage(dir);
  assert.equal(v.ok, true);
  assert.equal(v.manifest.id, "example-hello");
});

test("installPluginFromFolder + uninstallPlugin parks under .trash", async () => {
  const pluginsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mh-plug-root-"));
  // Source must live outside plugins root so uninstall does not leave a second copy
  const src = await fs.mkdtemp(path.join(os.tmpdir(), "mh-plug-src-"));
  const m = exampleManifest();
  await fs.writeFile(path.join(src, "topmind-plugin.json"), JSON.stringify(m), "utf8");
  await fs.writeFile(
    path.join(src, "index.mjs"),
    "export default { manifest: { id: 'example-hello', name: 'H', version: '0.1.0' }, activate() {} };\n",
    "utf8",
  );

  const installed = await installPluginFromFolder(src, { root: pluginsRoot, force: true });
  assert.equal(installed.ok, true);
  assert.equal(installed.id, "example-hello");
  const listed = await listExternalPlugins(pluginsRoot);
  assert.ok(listed.some((p) => p.id === "example-hello" && p.status === "ready"));

  const un = await uninstallPlugin("example-hello", { root: pluginsRoot });
  assert.equal(un.ok, true);
  assert.ok(un.trashPath);
  assert.ok(un.trashPath.includes(".trash"));
  const after = await listExternalPlugins(pluginsRoot);
  assert.equal(after.some((p) => p.id === "example-hello"), false);
});

test("scaffoldExamplePlugin writes ready package", async () => {
  const pluginsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mh-scaffold-"));
  const r = await scaffoldExamplePlugin({ root: pluginsRoot });
  assert.equal(r.ok, true);
  assert.equal(r.id, "example-hello");
  const listed = await listExternalPlugins(pluginsRoot);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].status, "ready");
});

test("uninstall refuses topmind-* ids", async () => {
  const r = await uninstallPlugin("topmind-workspace");
  assert.equal(r.ok, false);
  assert.match(r.error, /reserved|first-party|topmind/i);
});

test("assessPluginPermissions ranks workspace write as high", () => {
  const low = assessPluginPermissions(["slot:action"]);
  assert.equal(low.level, "low");
  const high = assessPluginPermissions(["slot:action", "rpc:workspace"]);
  assert.equal(high.level, "high");
  const med = assessPluginPermissions(["rpc:system"]);
  assert.equal(med.level, "medium");
  const empty = assessPluginPermissions([]);
  assert.equal(empty.level, "low");
  assert.ok(empty.labels.length >= 1);
});

test("previewPluginFromFolder returns risk without installing", async () => {
  const src = await fs.mkdtemp(path.join(os.tmpdir(), "mh-prev-"));
  const m = {
    ...exampleManifest(),
    permissions: ["slot:action", "rpc:workspace", "fs:write-workspace"],
  };
  await fs.writeFile(path.join(src, "topmind-plugin.json"), JSON.stringify(m), "utf8");
  await fs.writeFile(path.join(src, "index.mjs"), "export default {};\n", "utf8");
  const pluginsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mh-prev-root-"));
  const prev = await previewPluginFromFolder(src, { root: pluginsRoot });
  assert.equal(prev.ok, true);
  assert.equal(prev.manifest.id, "example-hello");
  assert.equal(prev.risk, "high");
  assert.equal(prev.alreadyInstalled, false);
  assert.ok(Array.isArray(prev.riskReasons));
  assert.ok(prev.riskReasons.some((r) => /预留|reserved|信任/i.test(r) || r.includes("fs:write-workspace")));
  const listed = await listExternalPlugins(pluginsRoot);
  assert.equal(listed.length, 0);
});

test("installPluginFromFolder defaults force=false (refuse replace); force:true parks", async () => {
  const pluginsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mh-plug-force-"));
  const src = await fs.mkdtemp(path.join(os.tmpdir(), "mh-plug-force-src-"));
  const m = exampleManifest();
  await fs.writeFile(path.join(src, "topmind-plugin.json"), JSON.stringify(m), "utf8");
  await fs.writeFile(path.join(src, "index.mjs"), "export default {};\n", "utf8");
  const first = await installPluginFromFolder(src, { root: pluginsRoot });
  assert.equal(first.ok, true);
  // Omitted force → refuse
  const omitted = await installPluginFromFolder(src, { root: pluginsRoot });
  assert.equal(omitted.ok, false);
  assert.match(omitted.error, /already installed/i);
  const refused = await installPluginFromFolder(src, { root: pluginsRoot, force: false });
  assert.equal(refused.ok, false);
  const replaced = await installPluginFromFolder(src, { root: pluginsRoot, force: true });
  assert.equal(replaced.ok, true);
  const trash = await fs.readdir(path.join(pluginsRoot, ".trash"));
  assert.ok(trash.length >= 1);
});

test("scaffoldExamplePlugin parks previous example-hello", async () => {
  const pluginsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mh-scaffold2-"));
  const a = await scaffoldExamplePlugin({ root: pluginsRoot });
  assert.equal(a.ok, true);
  await fs.writeFile(path.join(a.dir, "custom.txt"), "user edit", "utf8");
  const b = await scaffoldExamplePlugin({ root: pluginsRoot });
  assert.equal(b.ok, true);
  const trash = await fs.readdir(path.join(pluginsRoot, ".trash"));
  assert.ok(trash.some((n) => n.startsWith("example-hello-")));
  // Fresh scaffold should not keep custom.txt
  let hasCustom = true;
  try {
    await fs.access(path.join(b.dir, "custom.txt"));
  } catch {
    hasCustom = false;
  }
  assert.equal(hasCustom, false);
});

test("assertExtractContained rejects path outside unpack root via symlink", async (t) => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "mh-zip-slip-"));
  const unpack = path.join(work, "unpack");
  await fs.mkdir(unpack, { recursive: true });
  const outside = path.join(work, "secret.txt");
  await fs.writeFile(outside, "x", "utf8");
  // Symlink inside unpack pointing outside.
  // Windows without Developer Mode/admin denies symlink creation (EPERM) — skip there.
  try {
    await fs.symlink(outside, path.join(unpack, "escape-link"));
  } catch (err) {
    if (err?.code === "EPERM" && process.platform === "win32") {
      t.skip("symlink not permitted on this Windows host");
      return;
    }
    throw err;
  }
  const r = await assertExtractContained(unpack);
  assert.equal(r.ok, false);
  assert.match(r.error, /escapes|symlink/i);
});

test("assertExtractContained accepts normal tree", async () => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "mh-zip-ok-"));
  const unpack = path.join(work, "unpack");
  await fs.mkdir(path.join(unpack, "plugin"), { recursive: true });
  await fs.writeFile(path.join(unpack, "plugin", "index.mjs"), "export default {};\n", "utf8");
  const r = await assertExtractContained(unpack);
  assert.equal(r.ok, true);
});
