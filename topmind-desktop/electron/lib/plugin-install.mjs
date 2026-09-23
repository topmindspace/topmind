/**
 * Install / uninstall third-party Desktop plugins under plugins root.
 * Pure fs + validation — no Electron import except optional dialogs in system-service.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import {
  ensurePluginsDir,
  getPluginsRoot,
  normalizeManifest,
  exampleManifest,
  listExternalPlugins,
} from "./external-plugins.mjs";

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy directory tree. Skips node_modules / .git and any symbolic links
 * (avoids following links outside the package / symlink attacks).
 */
async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const ent of entries) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    // Never follow or copy symlinks into plugins root
    if (ent.isSymbolicLink()) continue;
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === ".git" || ent.name === ".trash") continue;
      await copyDir(from, to);
    } else if (ent.isFile()) {
      await fs.copyFile(from, to);
    }
  }
}

/**
 * After zip extract: ensure every file under unpack stays inside unpack root
 * (zip-slip / path traversal defense). Rejects absolute paths and `..` escape.
 * @param {string} unpackDir
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function assertExtractContained(unpackDir) {
  const root = path.resolve(unpackDir);
  let rootReal;
  try {
    rootReal = await fs.realpath(root);
  } catch {
    return { ok: false, error: "extract root not readable" };
  }

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      // Symlinks: resolve target must stay under root
      if (ent.isSymbolicLink()) {
        let target;
        try {
          target = await fs.realpath(full);
        } catch {
          // dangling link — skip (copyDir also skips symlinks)
          continue;
        }
        if (target !== rootReal && !target.startsWith(rootReal + path.sep)) {
          return {
            ok: false,
            error: `zip entry escapes extract root (symlink): ${ent.name}`,
          };
        }
        continue;
      }
      let resolved;
      try {
        resolved = await fs.realpath(full);
      } catch {
        // race / unreadable — use path.resolve
        resolved = path.resolve(full);
      }
      if (resolved !== rootReal && !resolved.startsWith(rootReal + path.sep)) {
        return {
          ok: false,
          error: `zip entry escapes extract root: ${path.relative(root, full) || ent.name}`,
        };
      }
      if (ent.isDirectory()) {
        const sub = await walk(full);
        if (!sub.ok) return sub;
      }
    }
    return { ok: true };
  }

  return walk(root);
}

/**
 * Find topmind-plugin.json under dir (depth ≤ 3).
 * @param {string} dir
 * @param {number} [depth]
 * @returns {Promise<string|null>} directory containing the manifest
 */
export async function findPluginPackageRoot(dir, depth = 0) {
  if (depth > 3) return null;
  const manifestPath = path.join(dir, "topmind-plugin.json");
  if (await pathExists(manifestPath)) return dir;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
    const hit = await findPluginPackageRoot(path.join(dir, ent.name), depth + 1);
    if (hit) return hit;
  }
  return null;
}

/**
 * Risk assessment for declared permissions (install preview).
 * @param {string[]} [permissions]
 * @returns {{ level: 'low'|'medium'|'high', reasons: string[], labels: string[] }}
 */
export function assessPluginPermissions(permissions) {
  const perms = Array.isArray(permissions) ? permissions.map(String) : [];
  const labels = perms.length ? perms : ["slot:action (default)"];
  /** @type {string[]} */
  const reasons = [];
  let level = /** @type {'low'|'medium'|'high'} */ ("low");

  const bump = (next, reason) => {
    if (reason) reasons.push(reason);
    if (next === "high") level = "high";
    else if (next === "medium" && level === "low") level = "medium";
  };

  // Soft-gate vocabulary only: rpc:* and slot:* are enforced on ctx.rpc / ctx.register.
  // fs:* / net:fetch are reserved (not enforced) — note if declared, do not inflate risk as if sandboxed.
  for (const p of perms) {
    if (p === "rpc:*" || p === "slot:*") {
      bump("high", `${p} 授予宽权限（ctx 门控）`);
    } else if (
      p === "rpc:workspace" ||
      p === "rpc:ai" ||
      p === "rpc:weread" ||
      p === "rpc:x"
    ) {
      bump("high", `${p} 可经 ctx.rpc 访问工作区 / AI / 连接器`);
    } else if (p === "rpc:system" || p === "rpc:tool") {
      bump("medium", `${p} 可访问系统或工具 RPC`);
    } else if (
      p === "slot:view" ||
      p === "slot:dataSource" ||
      p === "slot:sidebar" ||
      p === "slot:overlay" ||
      p === "slot:contextMenu"
    ) {
      bump("medium", `${p} 可扩展 UI 槽`);
    } else if (p === "fs:write-workspace" || p === "fs:read-workspace" || p === "net:fetch") {
      // Reserved tokens — informational only (not a runtime gate today)
      reasons.push(`${p} 为预留声明（当前不单独强制；信任模型 = 用户自装）`);
    }
  }

  if (perms.length === 0) {
    reasons.push("未声明权限 → 仅命令面板 action（默认 soft gate）");
  }
  if (level === "low" && reasons.length === 0) {
    reasons.push("仅低风险槽位（如 action / settings）；插件与应用同 renderer，非沙箱");
  }

  return { level, reasons, labels };
}

/**
 * Build install preview from validated package + plugins root state.
 * @param {{ ok: true, manifest: object, sourceDir: string }} validated
 * @param {string} [pluginsRoot]
 */
export async function buildPluginPreview(validated, pluginsRoot) {
  const root = pluginsRoot || getPluginsRoot();
  const manifest = validated.manifest;
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  const risk = assessPluginPermissions(permissions);
  const listed = await listExternalPlugins(root);
  const existing = listed.find((p) => p.id === manifest.id) || null;
  return {
    ok: true,
    manifest,
    sourceDir: validated.sourceDir,
    permissions: risk.labels,
    slots: Array.isArray(manifest.slots) ? manifest.slots : [],
    risk: risk.level,
    riskReasons: risk.reasons,
    alreadyInstalled: Boolean(existing),
    existingVersion: existing?.manifest?.version || null,
    existingStatus: existing?.status || null,
    replaces: Boolean(existing),
  };
}

/**
 * Read + validate plugin package at sourceDir (folder with topmind-plugin.json).
 * @returns {Promise<{ ok: true, manifest: object, sourceDir: string } | { ok: false, error: string }>}
 */
export async function validatePluginPackage(sourceDir) {
  const root = await findPluginPackageRoot(path.resolve(sourceDir));
  if (!root) {
    return { ok: false, error: "no topmind-plugin.json found (need plugin folder)" };
  }
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(path.join(root, "topmind-plugin.json"), "utf8"));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const norm = normalizeManifest(raw, path.basename(root));
  if (!norm.ok) return { ok: false, error: norm.error };
  const entry = path.join(root, norm.manifest.main);
  if (!(await pathExists(entry))) {
    return { ok: false, error: `entry not found: ${norm.manifest.main}` };
  }
  return { ok: true, manifest: norm.manifest, sourceDir: root };
}

/**
 * Preview plugin from folder (no install).
 */
export async function previewPluginFromFolder(sourceDir, opts = {}) {
  const validated = await validatePluginPackage(sourceDir);
  if (!validated.ok) return validated;
  return buildPluginPreview(validated, opts.root);
}

async function extractZipToTemp(zipPath) {
  const abs = path.resolve(zipPath);
  if (!(await pathExists(abs))) {
    return { ok: false, error: `zip not found: ${abs}` };
  }
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "mh-plugin-zip-"));
  const unpack = path.join(work, "unpack");
  await fs.mkdir(unpack, { recursive: true });
  let extracted = false;
  const unzip = spawnSync("unzip", ["-q", abs, "-d", unpack], { encoding: "utf8" });
  if (unzip.status === 0) extracted = true;
  if (!extracted) {
    const tar = spawnSync("tar", ["-xf", abs, "-C", unpack], { encoding: "utf8" });
    if (tar.status === 0) extracted = true;
  }
  if (!extracted && process.platform === "win32") {
    const ps = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${abs.replace(/'/g, "''")}' -DestinationPath '${unpack.replace(/'/g, "''")}' -Force`,
      ],
      { encoding: "utf8" },
    );
    if (ps.status === 0) extracted = true;
  }
  if (!extracted) {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    return {
      ok: false,
      error: "failed to extract zip (need unzip, tar, or PowerShell Expand-Archive)",
    };
  }
  const contained = await assertExtractContained(unpack);
  if (!contained.ok) {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    return contained;
  }
  return { ok: true, work, unpack };
}

/**
 * Preview plugin from zip (extract → validate → cleanup).
 */
export async function previewPluginFromZip(zipPath, opts = {}) {
  const extracted = await extractZipToTemp(zipPath);
  if (!extracted.ok) return extracted;
  try {
    const validated = await validatePluginPackage(extracted.unpack);
    if (!validated.ok) return validated;
    return buildPluginPreview(validated, opts.root);
  } finally {
    await fs.rm(extracted.work, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Install a validated plugin folder into plugins root.
 * Same id without force: refuse. With force:true: park previous under .trash then copy.
 * @param {string} sourceDir
 * @param {{ force?: boolean, root?: string }} [opts]
 *   force — default false (safe); UI must pass true after install-preview confirm.
 */
export async function installPluginFromFolder(sourceDir, opts = {}) {
  const root = opts.root || (await ensurePluginsDir());
  const force = opts.force === true;
  const validated = await validatePluginPackage(sourceDir);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }
  const { manifest, sourceDir: pkgDir } = validated;
  const dest = path.join(root, manifest.id);

  if (await pathExists(dest)) {
    if (!force) {
      return {
        ok: false,
        error: `plugin already installed: ${manifest.id} (pass force:true to replace; previous copy goes to .trash)`,
      };
    }
    // Park previous under .trash for recovery
    await parkPluginDir(dest, root);
  }

  await copyDir(pkgDir, dest);

  // Ensure manifest id matches folder
  const writtenManifest = path.join(dest, "topmind-plugin.json");
  try {
    const m = JSON.parse(await fs.readFile(writtenManifest, "utf8"));
    if (m.id !== manifest.id) {
      m.id = manifest.id;
      await fs.writeFile(writtenManifest, `${JSON.stringify(m, null, 2)}\n`, "utf8");
    }
  } catch {
    /* ignore */
  }

  const listed = await listExternalPlugins(root);
  const info = listed.find((p) => p.id === manifest.id) || null;
  return {
    ok: true,
    id: manifest.id,
    dir: dest,
    version: manifest.version,
    status: info?.status || "ready",
    error: info?.error || null,
  };
}

/**
 * Unzip archive to temp, locate plugin package, install.
 * Uses system unzip / tar (no extra deps).
 * @param {string} zipPath
 * @param {{ force?: boolean, root?: string }} [opts]
 */
export async function installPluginFromZip(zipPath, opts = {}) {
  const extracted = await extractZipToTemp(zipPath);
  if (!extracted.ok) return extracted;
  try {
    return await installPluginFromFolder(extracted.unpack, opts);
  } finally {
    await fs.rm(extracted.work, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Move plugin dir to plugins/.trash/<id>-<ts> (recoverable uninstall).
 */
async function parkPluginDir(dir, pluginsRoot) {
  if (!(await pathExists(dir))) return null;
  const trash = path.join(pluginsRoot, ".trash");
  await fs.mkdir(trash, { recursive: true });
  const base = path.basename(dir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(trash, `${base}-${stamp}`);
  await fs.rename(dir, dest);
  return dest;
}

/**
 * Uninstall by plugin id (folder under plugins root).
 * @param {string} pluginId
 * @param {{ root?: string, hard?: boolean }} [opts]
 */
export async function uninstallPlugin(pluginId, opts = {}) {
  const id = String(pluginId || "").trim();
  if (!id) return { ok: false, error: "pluginId required" };
  if (id.startsWith("topmind-")) {
    return { ok: false, error: "cannot uninstall first-party / reserved topmind-* plugins" };
  }
  const root = opts.root || getPluginsRoot();
  const listed = await listExternalPlugins(root);
  const hit = listed.find((p) => p.id === id);
  // Prefer resolved dir from scan; fallback to folder named by id
  const dir = hit?.dir || path.join(root, id);
  if (!(await pathExists(dir))) {
    return { ok: false, error: `plugin not found: ${id}` };
  }
  // Safety: must be under plugins root
  const resolvedRoot = path.resolve(root);
  const resolvedDir = path.resolve(dir);
  if (!resolvedDir.startsWith(resolvedRoot + path.sep) && resolvedDir !== resolvedRoot) {
    return { ok: false, error: "refusing to delete path outside plugins root" };
  }
  if (path.basename(resolvedDir) === ".trash") {
    return { ok: false, error: "invalid plugin path" };
  }

  let trashPath = null;
  if (opts.hard) {
    await fs.rm(resolvedDir, { recursive: true, force: true });
  } else {
    trashPath = await parkPluginDir(resolvedDir, root);
  }
  return {
    ok: true,
    id,
    removed: resolvedDir,
    trashPath,
    hard: Boolean(opts.hard),
  };
}

/**
 * Write example-hello scaffold into plugins root.
 * If example-hello already exists, parks previous under .trash (same as install replace).
 */
export async function scaffoldExamplePlugin(opts = {}) {
  const root = opts.root || (await ensurePluginsDir());
  const manifest = exampleManifest();
  const dir = path.join(root, manifest.id);
  if (await pathExists(dir)) {
    await parkPluginDir(dir, root);
  }
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "topmind-plugin.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(dir, "index.mjs"),
    `/** Minimal topmind external plugin (example-hello). */
export default {
  manifest: {
    id: ${JSON.stringify(manifest.id)},
    name: ${JSON.stringify(manifest.name)},
    version: ${JSON.stringify(manifest.version)},
    description: ${JSON.stringify(manifest.description)},
  },
  async activate(ctx) {
    ctx.register({
      kind: "action",
      id: "example-hello.ping",
      pluginId: ctx.pluginId,
      label: "Hello · Ping",
      group: "plugin",
      run: async () => {
        ctx.toast("Hello from external plugin");
      },
    });
  },
};
`,
    "utf8",
  );
  await fs.writeFile(
    path.join(dir, "README.md"),
    `# ${manifest.name}

Scaffold from topmind Desktop. Edit \`index.mjs\`, then Settings → Plugins → 重新加载.

Permissions: \`${manifest.permissions.join("`, `")}\`
`,
    "utf8",
  );
  return { ok: true, id: manifest.id, dir, manifest };
}
