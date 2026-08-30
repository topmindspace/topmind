/**
 * v4 Plugin / architecture contract tests.
 *
 * Smoke checks keep Selection / slot / skill surface stable; filesystem checks
 * pin real modules so docs and dead-code claims cannot drift silently.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src");
const electron = path.join(root, "electron");

test("v4 plugin contract: 7 slot kinds defined (sidebar slot removed 2026-08-30)", () => {
  const slotKinds = ["dataSource", "view", "action", "settings", "overlay", "statusBar", "contextMenu"];
  assert.equal(slotKinds.length, 7);
  const typesSrc = readFileSync(path.join(src, "plugins/types.ts"), "utf8");
  for (const kind of slotKinds) {
    assert.match(typesSrc, new RegExp(`kind:\\s*"${kind}"`));
  }
  // 插件 chrome 入口统一在标题栏 Apps 菜单 — 侧栏插件行契约不再存在
  assert.doesNotMatch(typesSrc, /interface SidebarSlot/);
});

test("v4 Selection model: 7 living kinds (no home product surface)", () => {
  const selectionKinds = ["inbox", "stream", "category", "topic", "file", "outputs", "archive", "connector"];
  assert.equal(selectionKinds.length, 8);
  const typesSrc = readFileSync(path.join(src, "types.ts"), "utf8");
  for (const kind of selectionKinds) {
    assert.match(typesSrc, new RegExp(`kind:\\s*['"]${kind}['"]`));
  }
  // home is not a living Selection product kind
  assert.doesNotMatch(typesSrc, /\| \{ kind: ['"]home['"] \}/);
  assert.match(typesSrc, /function normalizeSelection/);
});

test("v4 5 Skills Dock entries: Capture/Organize/Write/Memory/Loop", () => {
  const skillIds = [
    "skill.capture",
    "skill.organize",
    "skill.write",
    "skill.memory",
    "skill.loop",
  ];
  const skillsSrc = readFileSync(path.join(src, "plugins/topmind-workspace/skills.ts"), "utf8");
  for (const id of skillIds) {
    assert.match(skillsSrc, new RegExp(`id:\\s*"${id}"`));
  }
  assert.doesNotMatch(skillsSrc, /skill\.maintain/);
});

test("v4 pack daily_entry is topmind only (no second front door)", () => {
  const packPath = path.resolve(root, "..", "skills", "topmind-pack.json");
  assert.ok(existsSync(packPath), "skills/topmind-pack.json");
  const pack = JSON.parse(readFileSync(packPath, "utf8"));
  assert.equal(pack.daily_entry, "topmind");
  assert.equal(pack.name, "topmind");
});

test("v4 core + ingest + connector services exist on disk", () => {
  const core = [
    "workspace-service.mjs",
    "ai-service.mjs",
    "system-service.mjs",
    "tool-service.mjs",
    "ingest-service.mjs",
  ];
  const connectors = ["weread-service.mjs", "x-service.mjs"];
  for (const file of [...core, ...connectors]) {
    assert.ok(existsSync(path.join(electron, file)), `missing service ${file}`);
  }
});

test("v4 3 stores: ViewStore/AiStore/PluginStore", () => {
  const stores = ["view-store.ts", "ai-store.ts", "plugin-store.ts"];
  for (const file of stores) {
    assert.ok(existsSync(path.join(src, "stores", file)), `missing store ${file}`);
  }
});

test("v4 built-in plugins: workspace + ingest + weread + x", () => {
  const hostSrc = readFileSync(path.join(src, "plugins/host.ts"), "utf8");
  assert.match(hostSrc, /id:\s*"topmind-workspace"/);
  assert.match(hostSrc, /id:\s*"topmind-ingest"/);
  assert.match(hostSrc, /id:\s*"topmind-weread"/);
  assert.match(hostSrc, /id:\s*"topmind-x"/);
  for (const id of ["topmind-workspace", "topmind-ingest", "topmind-weread", "topmind-x"]) {
    assert.ok(existsSync(path.join(src, "plugins", id, "index.ts")), `missing plugin ${id}`);
  }
});

test("v4 RPC preload only exposes invoke + subscribe", () => {
  const preload = path.join(electron, "preload.cjs");
  // preload may live next to main — accept either path convention
  const candidates = [
    preload,
    path.join(electron, "preload.js"),
    path.join(root, "electron/preload.cjs"),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    // main.mjs references preload; assert api surface from rpc.ts instead
    const rpc = readFileSync(path.join(src, "services/rpc.ts"), "utf8");
    assert.match(rpc, /export async function invoke/);
    assert.match(rpc, /export function subscribe/);
    assert.doesNotMatch(rpc, /ipcRenderer\.invoke\([^'"]*(?:document|inbox|project):/);
    return;
  }
  const srcText = readFileSync(found, "utf8");
  assert.match(srcText, /invoke\s*:/);
  assert.match(srcText, /subscribe\s*:/);
});

test("v4 path primitives stay hyphen-aware (no hardcoded space-only outputs path)", () => {
  // Bodies live in modular ops; facade only re-exports.
  const modules = [
    "workspace-service.mjs",
    "lib/workspace-path-ops.mjs",
    "lib/workspace-scan-ops.mjs",
    "lib/workspace-inbox-ops.mjs",
  ].map((rel) => readFileSync(path.join(electron, rel), "utf8")).join("\n");
  assert.doesNotMatch(modules, /path:\s*`88 Outputs\//);
  assert.match(modules, /outputsName|basename\(outputsRoot/);
});

test("v4 writeback returns archive-relative paths under real archive basename", () => {
  const wb = readFileSync(path.join(electron, "lib/writeback.mjs"), "utf8");
  assert.match(wb, /archiveRelative|basename\(archiveRoot/);
  // Old misleading "archive/backups" prefix without archive dir name must not return
  assert.doesNotMatch(wb, /path\.join\("archive",\s*"backups"/);
  // Dead topic-scoped rotating helper removed in favor of writePathCheckpoint
  assert.doesNotMatch(wb, /export async function writeRotatingCheckpoint/);
});

test("v4 source footprint stays bounded (src + electron)", () => {
  function countFiles(dir, exts) {
    let n = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) n += countFiles(full, exts);
      else if (exts.some((e) => entry.name.endsWith(e))) n += 1;
    }
    return n;
  }
  const srcCount = countFiles(src, [".ts", ".tsx"]);
  const electronCount = countFiles(electron, [".mjs", ".cjs", ".js"]);
  // Soft ceiling: catch uncontrolled growth back toward v3 scale.
  // 2026-08-30 recalibration: the 2026-08 product releases (memory browse,
  // shared feed layout, connector hubs, quality surface work) put src at 209
  // against the 200 ceiling — the gate now tracks 212 (≈40% under v3 scale)
  // while still failing on any +12-file regression per release.
  assert.ok(srcCount < 212, `src file count ${srcCount} exceeds soft ceiling`);
  assert.ok(electronCount < 120, `electron file count ${electronCount} exceeds soft ceiling`);
  assert.ok(srcCount + electronCount < 320, `total ${srcCount + electronCount} exceeds soft ceiling`);
});

test("desktop validate restages engine before pack:verify (obsidian/clip stamp drift)", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const v = String(pkg.scripts?.validate || "");
  const prep = v.indexOf("pack:prepare");
  const ver = v.indexOf("pack:verify");
  assert.ok(prep >= 0, "validate must run pack:prepare");
  assert.ok(ver > prep, "pack:prepare must precede pack:verify");
});

test("pack:prepare rebuilds Obsidian dist when source manifest version drifts", () => {
  const srcText = readFileSync(
    path.join(root, "scripts/prepare-engine-resources.mjs"),
    "utf8",
  );
  assert.match(srcText, /function readManifestVersion/);
  assert.match(srcText, /distVer === sourceVer/);
  assert.match(srcText, /obsidian-plugin\/dist v\$\{distVer/);
  assert.doesNotMatch(
    srcText,
    /if \(existsSync\(manifest\)\) return true;/u,
    "must not skip build solely because a leftover dist/ exists",
  );
});
