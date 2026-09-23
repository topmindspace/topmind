/**
 * Companion detect + lifecycle (pure FS) — fixture home dirs under tmp.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  resolveAgentHosts,
  resolveBrowsers,
  resolveObsidian,
  detectCompanions,
  detectSkillsInstall,
  SKILLS_RECEIPT_NAME,
} from "../electron/lib/companion-detect.mjs";
import {
  installSkillsToHost,
  upgradeSkillsOnHost,
  uninstallSkillsFromHost,
  installObsidianPlugin,
  uninstallObsidianPlugin,
  prepareClipExtensionInstall,
  getClipExtensionStatus,
  uninstallClipExtension,
  listPackInstallEntries,
  resolveEngineSkillsRoot,
} from "../electron/lib/companion-lifecycle.mjs";

const REPO_SKILLS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../skills",
);

async function makeTempHome(prefix = "tm-comp-") {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeMiniPack(packRoot, version = "0.0.1") {
  await fs.mkdir(path.join(packRoot, "topmind"), { recursive: true });
  await fs.writeFile(
    path.join(packRoot, "topmind", "SKILL.md"),
    "---\nname: topmind\ndescription: router\n---\nbody\n",
    "utf8",
  );
  await fs.mkdir(path.join(packRoot, "topmind-capture"), { recursive: true });
  await fs.writeFile(
    path.join(packRoot, "topmind-capture", "SKILL.md"),
    "---\nname: topmind-capture\ndescription: capture\n---\n",
    "utf8",
  );
  await fs.mkdir(path.join(packRoot, "shared"), { recursive: true });
  await fs.writeFile(path.join(packRoot, "shared", "note.md"), "n", "utf8");
  await fs.writeFile(
    path.join(packRoot, "topmind-pack.json"),
    JSON.stringify({
      name: "topmind",
      version,
      skills: [{ id: "topmind" }, { id: "topmind-capture" }],
    }),
    "utf8",
  );
  // Unrelated file that must never be touched by uninstall of managed install
  return packRoot;
}

test("resolveAgentHosts reports present/absent for fake home", async () => {
  const home = await makeTempHome();
  await fs.mkdir(path.join(home, ".claude"), { recursive: true });
  await fs.mkdir(path.join(home, ".codex", "skills"), { recursive: true });

  const hosts = resolveAgentHosts(home, { platform: "darwin", cwd: home });
  const claude = hosts.find((h) => h.id === "claude-code");
  const codex = hosts.find((h) => h.id === "codex");
  const hermes = hosts.find((h) => h.id === "hermes");
  const codebuddy = hosts.find((h) => h.id === "codebuddy");

  assert.ok(claude);
  assert.equal(claude.present, true);
  assert.equal(claude.installed, false);
  assert.equal(claude.skillsRoot, path.join(home, ".claude", "skills"));

  assert.ok(codex);
  assert.equal(codex.present, true);

  assert.ok(hermes);
  assert.equal(hermes.present, false);

  assert.ok(codebuddy);
  assert.equal(codebuddy.present, false, "codebuddy best-effort absent when no path");
});

test("detectSkillsInstall reads pack + receipt", async () => {
  const root = await makeTempHome("tm-sk-det-");
  assert.equal(detectSkillsInstall(root).installed, false);

  await writeMiniPack(root, "1.2.3");
  let det = detectSkillsInstall(root);
  assert.equal(det.installed, true);
  assert.equal(det.installedVersion, "1.2.3");

  await fs.writeFile(
    path.join(root, SKILLS_RECEIPT_NAME),
    JSON.stringify({ version: "9.9.9", schema: 1 }),
    "utf8",
  );
  det = detectSkillsInstall(root);
  assert.equal(det.installedVersion, "9.9.9");
  assert.ok(det.receiptPath);
});

test("installSkillsToHost writes pack files + receipt", async () => {
  const home = await makeTempHome();
  await fs.mkdir(path.join(home, ".claude"), { recursive: true });
  const pack = await makeTempHome("tm-pack-");
  await writeMiniPack(pack, "0.1.0");

  const r = await installSkillsToHost({
    hostId: "claude-code",
    sourceRoot: pack,
    homeDir: home,
    mode: "copy",
  });
  assert.equal(r.ok, true);
  assert.equal(r.version, "0.1.0");
  assert.ok(r.installed.includes("topmind"));
  assert.ok(r.installed.includes("shared"));

  const dest = path.join(home, ".claude", "skills");
  const body = await fs.readFile(path.join(dest, "topmind", "SKILL.md"), "utf8");
  assert.match(body, /router/);
  const receipt = JSON.parse(await fs.readFile(path.join(dest, SKILLS_RECEIPT_NAME), "utf8"));
  assert.equal(receipt.version, "0.1.0");
  assert.equal(receipt.host, "claude-code");

  const hosts = resolveAgentHosts(home, { platform: "darwin" });
  const claude = hosts.find((h) => h.id === "claude-code");
  assert.equal(claude.installed, true);
  assert.equal(claude.installedVersion, "0.1.0");
});

test("upgradeSkillsOnHost refreshes version", async () => {
  const home = await makeTempHome();
  await fs.mkdir(path.join(home, ".claude"), { recursive: true });
  const pack1 = await makeTempHome("tm-p1-");
  const pack2 = await makeTempHome("tm-p2-");
  await writeMiniPack(pack1, "1.0.0");
  await writeMiniPack(pack2, "2.0.0");
  await fs.writeFile(
    path.join(pack2, "topmind", "SKILL.md"),
    "---\nname: topmind\ndescription: router v2\n---\nv2\n",
    "utf8",
  );

  await installSkillsToHost({ hostId: "claude-code", sourceRoot: pack1, homeDir: home });
  const up = await upgradeSkillsOnHost({
    hostId: "claude-code",
    sourceRoot: pack2,
    homeDir: home,
  });
  assert.equal(up.ok, true);
  assert.equal(up.version, "2.0.0");
  const body = await fs.readFile(
    path.join(home, ".claude", "skills", "topmind", "SKILL.md"),
    "utf8",
  );
  assert.match(body, /v2/);
});

test("uninstallSkillsFromHost removes managed install not unrelated files", async () => {
  const home = await makeTempHome();
  await fs.mkdir(path.join(home, ".claude"), { recursive: true });
  const pack = await makeTempHome("tm-un-");
  await writeMiniPack(pack, "1.0.0");

  const dest = path.join(home, ".claude", "skills");
  await installSkillsToHost({ hostId: "claude-code", sourceRoot: pack, homeDir: home });

  // User skill unrelated to topmind
  await fs.mkdir(path.join(dest, "my-own-skill"), { recursive: true });
  await fs.writeFile(path.join(dest, "my-own-skill", "SKILL.md"), "mine\n", "utf8");
  await fs.writeFile(path.join(dest, "user-notes.txt"), "keep me\n", "utf8");

  const un = await uninstallSkillsFromHost({ hostId: "claude-code", homeDir: home });
  assert.equal(un.ok, true);
  assert.ok(un.removed.includes("topmind"));
  assert.ok(un.removed.includes(SKILLS_RECEIPT_NAME));

  // Unrelated remains
  assert.equal(await fs.readFile(path.join(dest, "user-notes.txt"), "utf8"), "keep me\n");
  assert.ok(
    await fs
      .access(path.join(dest, "my-own-skill", "SKILL.md"))
      .then(() => true)
      .catch(() => false),
  );
  // Managed gone
  await assert.rejects(fs.access(path.join(dest, "topmind", "SKILL.md")));
  await assert.rejects(fs.access(path.join(dest, SKILLS_RECEIPT_NAME)));
});

test("install/uninstall Obsidian plugin in fixture vault", async () => {
  const vault = await makeTempHome("tm-vault-");
  await fs.mkdir(path.join(vault, ".obsidian", "plugins"), { recursive: true });

  const pluginSrc = await makeTempHome("tm-obs-src-");
  await fs.writeFile(
    path.join(pluginSrc, "manifest.json"),
    JSON.stringify({
      id: "topmind-stream",
      name: "Topmind Stream",
      version: "2.2.0",
      minAppVersion: "1.5.0",
    }),
    "utf8",
  );
  await fs.writeFile(path.join(pluginSrc, "main.js"), "/* plugin */\n", "utf8");

  const inst = await installObsidianPlugin({
    vaultRoot: vault,
    sourceDir: pluginSrc,
  });
  assert.equal(inst.ok, true);
  assert.equal(inst.pluginId, "topmind-stream");
  assert.equal(inst.version, "2.2.0");

  const main = await fs.readFile(
    path.join(vault, ".obsidian", "plugins", "topmind-stream", "main.js"),
    "utf8",
  );
  assert.match(main, /plugin/);

  const obs = resolveObsidian({ workspaceRoot: vault, homeDir: vault, platform: "darwin" });
  assert.equal(obs.pluginInstalled, true);
  assert.equal(obs.pluginVersion, "2.2.0");
  assert.ok(obs.vaultPluginsRoot);

  // Unrelated plugin must survive
  await fs.mkdir(path.join(vault, ".obsidian", "plugins", "other-plugin"), { recursive: true });
  await fs.writeFile(
    path.join(vault, ".obsidian", "plugins", "other-plugin", "manifest.json"),
    JSON.stringify({ id: "other-plugin", version: "1.0.0" }),
    "utf8",
  );

  const un = await uninstallObsidianPlugin({ vaultRoot: vault });
  assert.equal(un.ok, true);
  assert.ok(un.removed.includes("topmind-stream"));
  await assert.rejects(
    fs.access(path.join(vault, ".obsidian", "plugins", "topmind-stream", "main.js")),
  );
  // other plugin kept
  await fs.access(path.join(vault, ".obsidian", "plugins", "other-plugin", "manifest.json"));
});

test("prepareClipExtensionInstall copies source and sets guidedInstall", async () => {
  const home = await makeTempHome("tm-desk-");
  const desktopStateHome = path.join(home, "topmind-desktop");
  const extSrc = await makeTempHome("tm-clip-src-");
  await fs.writeFile(
    path.join(extSrc, "manifest.json"),
    JSON.stringify({ name: "topmind Clip", version: "1.0.5", manifest_version: 3 }),
    "utf8",
  );
  await fs.writeFile(path.join(extSrc, "background.js"), "// bg\n", "utf8");

  const r = await prepareClipExtensionInstall({
    sourceDir: extSrc,
    desktopStateHome,
    homeDir: home,
  });
  assert.equal(r.ok, true);
  assert.equal(r.guidedInstall, true);
  assert.equal(r.version, "1.0.5");
  assert.ok(r.path);

  const st = await getClipExtensionStatus({ desktopStateHome, homeDir: home });
  assert.equal(st.prepared, true);
  assert.equal(st.version, "1.0.5");
  assert.equal(st.guidedInstall, true);
});

test("detectCompanions combines agents browsers obsidian", async () => {
  const home = await makeTempHome();
  await fs.mkdir(path.join(home, ".claude"), { recursive: true });
  const vault = path.join(home, "vault");
  await fs.mkdir(path.join(vault, ".obsidian", "plugins"), { recursive: true });

  const snap = detectCompanions({
    homeDir: home,
    workspaceRoot: vault,
    platform: "linux",
    cwd: home,
  });
  assert.ok(Array.isArray(snap.agents));
  assert.ok(Array.isArray(snap.browsers));
  assert.ok(snap.obsidian.vaultPluginsRoot);
  assert.equal(snap.obsidian.pluginInstalled, false);
  assert.ok(snap.checkedAt);
});

test("resolveBrowsers returns four browser ids", () => {
  const browsers = resolveBrowsers(os.homedir(), "linux");
  assert.equal(browsers.length, 4);
  assert.deepEqual(
    browsers.map((b) => b.id).sort(),
    ["brave", "chrome", "chromium", "edge"].sort(),
  );
});

test("listPackInstallEntries and resolveEngineSkillsRoot against monorepo", async () => {
  // monorepo skills pack if present
  const root = resolveEngineSkillsRoot({});
  if (root) {
    const plan = await listPackInstallEntries(root);
    assert.ok(plan.skillIds.length >= 1);
    assert.ok(plan.version);
  } else {
    // still allow empty engined environments
    assert.equal(root, null);
  }
  // Explicit source
  const pack = await makeTempHome("tm-list-");
  await writeMiniPack(pack, "3.0.0");
  const plan2 = await listPackInstallEntries(pack);
  assert.deepEqual(plan2.skillIds.sort(), ["topmind", "topmind-capture"].sort());
  assert.ok(plan2.entries.includes("shared"));
});

test("resolveEngineSkillsRoot finds monorepo skills when available", () => {
  // When running in this monorepo, skills/ should resolve
  const root = resolveEngineSkillsRoot({});
  if (existsSync(path.join(REPO_SKILLS, "topmind-pack.json"))) {
    assert.ok(root);
    assert.ok(existsSync(path.join(root, "topmind-pack.json")));
  }
});

// ── Inline upgrade property name regression tests ─────────────────────────────
// These tests verify that installObsidianPlugin and prepareClipExtensionInstall
// correctly accept the zip path via the property names used by
// downloadAndInstallCompanion in system-service.mjs.
// Regression: sourcePath was previously used instead of zipPath/bundledZipPath,
// causing the downloaded zip to be silently ignored and the bundled/monorepo
// version to be installed instead of the newly downloaded one.

async function makeFakePluginZip(zipVersion = "9.9.9") {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tm-plugin-zip-"));
  const pluginDir = path.join(tempDir, "topmind-obsidian");
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.writeFile(
    path.join(pluginDir, "manifest.json"),
    JSON.stringify({
      id: "topmind-stream",
      name: "Topmind Stream",
      version: zipVersion,
      minAppVersion: "1.5.0",
    }),
    "utf8",
  );
  await fs.writeFile(path.join(pluginDir, "main.js"), "/* test plugin */\n", "utf8");
  // Create zip using system zip command
  const zipPath = path.join(tempDir, `topmind-obsidian-${zipVersion}.zip`);
  // Try zip first, then tar as fallback
  const zipResult = spawnSync("zip", ["-q", "-r", zipPath, "."], {
    cwd: pluginDir,
    encoding: "utf8",
  });
  if (zipResult.status !== 0) {
    // tar fallback (zip format is also readable by tar on some systems)
    const tarResult = spawnSync("tar", ["cf", zipPath, "-C", pluginDir, "."], {
      encoding: "utf8",
    });
    if (tarResult.status !== 0) {
      // If neither zip nor tar is available, skip this test
      return { tempDir, zipPath: null };
    }
  }
  return { tempDir, zipPath };
}

test("installObsidianPlugin accepts zipPath (inline upgrade property)", async () => {
  const vault = await makeTempHome("tm-vault-zip-");
  await fs.mkdir(path.join(vault, ".obsidian", "plugins"), { recursive: true });

  const { tempDir, zipPath } = await makeFakePluginZip("9.9.9");
  if (!zipPath) {
    // zip/tar not available — skip gracefully
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    return;
  }

  try {
    // Test with zipPath (the correct property name)
    const inst = await installObsidianPlugin({
      vaultRoot: vault,
      zipPath,
    });
    assert.equal(inst.ok, true, `install failed: ${inst.error || ""}`);
    assert.equal(inst.pluginId, "topmind-stream");
    assert.equal(inst.version, "9.9.9");

    // Verify the plugin was actually installed from the zip
    const manifestPath = path.join(
      vault, ".obsidian", "plugins", "topmind-stream", "manifest.json",
    );
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    assert.equal(manifest.version, "9.9.9", "installed version must match zip version");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("installObsidianPlugin accepts sourcePath as alias (regression)", async () => {
  const vault = await makeTempHome("tm-vault-alias-");
  await fs.mkdir(path.join(vault, ".obsidian", "plugins"), { recursive: true });

  const { tempDir, zipPath } = await makeFakePluginZip("8.8.8");
  if (!zipPath) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    return;
  }

  try {
    // Test with sourcePath (alias — should also work)
    const inst = await installObsidianPlugin({
      vaultRoot: vault,
      sourcePath: zipPath,
    });
    assert.equal(inst.ok, true, `install with sourcePath alias failed: ${inst.error || ""}`);
    assert.equal(inst.version, "8.8.8");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("prepareClipExtensionInstall accepts bundledZipPath (inline upgrade)", async () => {
  const home = await makeTempHome("tm-clip-zip-");
  const desktopStateHome = path.join(home, "topmind-desktop");

  // Create a fake extension zip
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tm-ext-zip-"));
  const extDir = path.join(tempDir, "topmind-clip-extension");
  await fs.mkdir(extDir, { recursive: true });
  await fs.writeFile(
    path.join(extDir, "manifest.json"),
    JSON.stringify({ name: "topmind Clip", version: "7.7.7", manifest_version: 3 }),
    "utf8",
  );
  await fs.writeFile(path.join(extDir, "background.js"), "// bg\n", "utf8");
  const zipPath = path.join(tempDir, "topmind-clip-extension-7.7.7.zip");
  const zipResult = spawnSync("zip", ["-q", "-r", zipPath, "."], {
    cwd: extDir,
    encoding: "utf8",
  });
  if (zipResult.status !== 0) {
    const tarResult = spawnSync("tar", ["cf", zipPath, "-C", extDir, "."], {
      encoding: "utf8",
    });
    if (tarResult.status !== 0) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      return;
    }
  }

  try {
    const r = await prepareClipExtensionInstall({
      bundledZipPath: zipPath,
      desktopStateHome,
      homeDir: home,
    });
    assert.equal(r.ok, true, `install failed: ${r.error || ""}`);
    assert.equal(r.version, "7.7.7");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("uninstallClipExtension cleans managed dir contents", async () => {
  const home = await makeTempHome("tm-clip-uninstall-");
  const desktopStateHome = path.join(home, "topmind-desktop");

  // Prepare first
  const prep = await prepareClipExtensionInstall({
    sourceDir: REPO_SKILLS,
    desktopStateHome,
    homeDir: home,
  });
  if (!prep.ok) {
    // Skills dir may not have manifest.json — create a minimal extension dir
    const managedDir = path.join(desktopStateHome, "companions", "clip-extension");
    await fs.mkdir(managedDir, { recursive: true });
    await fs.writeFile(
      path.join(managedDir, "manifest.json"),
      JSON.stringify({ manifest_version: 3, name: "test", version: "1.0.0" }),
      "utf8",
    );
    await fs.writeFile(path.join(managedDir, "test.txt"), "hello", "utf8");
  }

  // Verify something exists
  const statusBefore = await getClipExtensionStatus({ desktopStateHome, homeDir: home });
  const managedDir = statusBefore.managedDir;
  assert.ok(existsSync(managedDir), "managed dir should exist");

  // Uninstall
  const result = await uninstallClipExtension({ desktopStateHome, homeDir: home });
  assert.equal(result.ok, true);
  assert.ok(result.removed.length > 0, "should have removed contents");
  assert.ok(existsSync(managedDir), "managed dir itself should still exist (for re-prepare)");

  // Verify contents are gone
  const entries = await fs.readdir(managedDir).catch(() => []);
  assert.equal(entries.length, 0, "managed dir should be empty after uninstall");

  // Uninstall again (idempotent — dir already empty)
  const result2 = await uninstallClipExtension({ desktopStateHome, homeDir: home });
  assert.equal(result2.ok, true);
});
