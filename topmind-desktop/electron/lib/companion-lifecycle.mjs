/**
 * Companion install / upgrade / uninstall — pure FS (no Electron).
 * Skills semantics mirror scripts/install-skills.mjs (copy/symlink + receipt).
 * Clip extension: extract/copy to managed dir + guided load (never silent Chrome install).
 * Obsidian: copy plugin into vault .obsidian/plugins/<id>/.
 */
import { promises as fs } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  SKILLS_RECEIPT_NAME,
  AGENT_HOST_DEFS,
  resolveAgentHosts,
  resolveOpencodeSkillsRoot,
  resolveCodebuddy,
  resolveWorkbuddy,
  OBSIDIAN_PLUGIN_IDS,
} from "./companion-detect.mjs";

const require = createRequire(import.meta.url);
const DESKTOP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "tests",
  "evals",
  "install-targets",
  ".trash",
  "_locales", // only skip at pack root when not a skill; handled carefully below
]);

const SUPPORT_FILES = ["topmind-pack.json", "skills.md", "LICENSE", "README.md", "INSTALL.md"];
const SUPPORT_DIRS = ["shared"];

/**
 * @param {string} p
 */
async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve monorepo / packaged engine skills pack root.
 * @param {{ sourceRoot?: string|null, engineRoot?: string|null }} [opts]
 * @returns {string|null}
 */
export function resolveEngineSkillsRoot(opts = {}) {
  const candidates = [];
  if (opts.sourceRoot) candidates.push(path.resolve(opts.sourceRoot));
  if (opts.engineRoot) {
    candidates.push(path.join(path.resolve(opts.engineRoot), "skills"));
    candidates.push(path.resolve(opts.engineRoot));
  }
  // monorepo: topmind/skills
  candidates.push(path.join(DESKTOP_DIR, "..", "skills"));
  // packaged engine
  candidates.push(path.join(DESKTOP_DIR, "resources", "topmind-engine", "skills"));
  try {
    const { app } = require("electron");
    if (app?.isPackaged && process.resourcesPath) {
      candidates.unshift(path.join(process.resourcesPath, "topmind-engine", "skills"));
    }
  } catch {
    /* tests / non-electron */
  }

  for (const c of candidates) {
    if (!c) continue;
    if (existsSync(path.join(c, "topmind-pack.json"))) return c;
    if (existsSync(path.join(c, "topmind", "SKILL.md"))) return c;
    if (existsSync(path.join(c, "skills", "topmind-pack.json"))) {
      return path.join(c, "skills");
    }
  }
  return null;
}

/**
 * Resolve default skills dest for a host id.
 * @param {string} hostId
 * @param {{ homeDir?: string, cwd?: string, platform?: string }} [opts]
 */
export function resolveHostSkillsDest(hostId, opts = {}) {
  const homeDir = opts.homeDir || os.homedir();
  const cwd = opts.cwd || process.cwd();
  const platform = opts.platform || process.platform;
  const id = String(hostId || "").trim();

  if (id === "opencode") return resolveOpencodeSkillsRoot(homeDir, cwd);
  if (id === "codebuddy") return resolveCodebuddy(homeDir, platform).skillsRoot;
  if (id === "workbuddy") return resolveWorkbuddy(homeDir, platform).skillsRoot;
  if (id === "generic") return path.join(cwd, "topmind-skills");

  const def = AGENT_HOST_DEFS.find((h) => h.id === id);
  if (def?.skillsRel) return path.join(homeDir, def.skillsRel);

  // Fall through: treat hostId as absolute dest? No — require known host
  return null;
}

/**
 * List pack entries to install (skill dirs + shared + pack json).
 * @param {string} skillsRoot
 * @param {Set<string>|null} [skillsFilter]
 */
export async function listPackInstallEntries(skillsRoot, skillsFilter = null) {
  let version = "unknown";
  let name = "topmind";
  /** @type {string[]} */
  let skillIds = [];

  const packPath = path.join(skillsRoot, "topmind-pack.json");
  if (await pathExists(packPath)) {
    try {
      const pack = JSON.parse(await fs.readFile(packPath, "utf8"));
      version = pack.version || version;
      name = pack.name || name;
      if (Array.isArray(pack.skills)) {
        skillIds = pack.skills.map((s) => s.id || s.path).filter(Boolean);
      }
    } catch {
      /* */
    }
  }
  if (!skillIds.length) {
    const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      if (SUPPORT_DIRS.includes(e.name) || SKIP_DIRS.has(e.name)) continue;
      if (await pathExists(path.join(skillsRoot, e.name, "SKILL.md"))) {
        skillIds.push(e.name);
      }
    }
  }

  if (skillsFilter && skillsFilter.size) {
    skillIds = skillIds.filter((id) => skillsFilter.has(id));
  }

  /** @type {Set<string>} */
  const entries = new Set(skillIds);
  // Always bring shared + pack metadata when installing any skills
  for (const d of SUPPORT_DIRS) {
    if (await pathExists(path.join(skillsRoot, d))) entries.add(d);
  }
  for (const f of SUPPORT_FILES) {
    if (await pathExists(path.join(skillsRoot, f))) entries.add(f);
  }

  return { version, name, entries: [...entries], skillIds };
}

async function copyDirRecursive(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.name === "node_modules" || ent.name === ".git" || ent.name === ".trash") continue;
    // Skip locale source trees in installed copy (install-skills cleans these)
    if (ent.name === "locales" && ent.isDirectory()) continue;
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isSymbolicLink()) continue;
    if (ent.isDirectory()) {
      await copyDirRecursive(from, to);
    } else if (ent.isFile()) {
      await fs.copyFile(from, to);
    }
  }
}

/**
 * @param {string} skillsRoot
 * @param {string} dest
 * @param {string[]} entries
 * @param {{ force?: boolean }} [opts]
 */
async function installCopy(skillsRoot, dest, entries) {
  await fs.mkdir(dest, { recursive: true });
  for (const name of entries) {
    const src = path.join(skillsRoot, name);
    const dst = path.join(dest, name);
    if (!(await pathExists(src))) continue;
    const st = await fs.lstat(src);
    if (await pathExists(dst)) await fs.rm(dst, { recursive: true, force: true });
    if (st.isDirectory()) {
      await copyDirRecursive(src, dst);
    } else {
      await fs.copyFile(src, dst);
    }
  }
}

/**
 * @param {string} skillsRoot
 * @param {string} dest
 * @param {string[]} entries
 * @param {{ force?: boolean }} [opts]
 */
async function installSymlink(skillsRoot, dest, entries, opts = {}) {
  await fs.mkdir(dest, { recursive: true });
  for (const name of entries) {
    const src = path.join(skillsRoot, name);
    const dst = path.join(dest, name);
    if (!(await pathExists(src))) continue;
    if (await pathExists(dst)) {
      const st = await fs.lstat(dst);
      if (st.isSymbolicLink() || opts.force) {
        await fs.rm(dst, { recursive: true, force: true });
      } else {
        return { ok: false, error: `${dst} exists and is not a symlink (pass force)` };
      }
    }
    await fs.symlink(src, dst, "junction");
  }
  return { ok: true };
}

/**
 * Write host install receipt (compatible with scripts/install-skills.mjs).
 * @param {string} dest
 * @param {object} meta
 */
export async function writeSkillsInstallReceipt(dest, meta) {
  const receipt = {
    schema: 1,
    package: meta.name || "topmind",
    version: meta.version,
    installed_at: new Date().toISOString(),
    installedAt: new Date().toISOString(),
    source: meta.sourceLabel || meta.source || null,
    source_raw: meta.sourceRaw || meta.source || null,
    mode: meta.mode || "copy",
    host: meta.hostId || meta.host || null,
    skill_ids: meta.skillIds || [],
    entries: meta.entries || [],
    repository: "https://github.com/topmindspace/topmind",
    update: {
      command: "add",
      source: meta.sourceRaw || meta.source || null,
      mode: meta.mode || "copy",
      host: meta.hostId || meta.host || null,
    },
  };
  const receiptPath = path.join(dest, SKILLS_RECEIPT_NAME);
  await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return { receipt, receiptPath };
}

/**
 * @param {string} dest
 */
export async function readSkillsInstallReceipt(dest) {
  const p = path.join(dest, SKILLS_RECEIPT_NAME);
  if (!(await pathExists(p))) return null;
  try {
    const j = JSON.parse(await fs.readFile(p, "utf8"));
    if (!j || typeof j !== "object") return null;
    return { ...j, path: p };
  } catch {
    return null;
  }
}

/**
 * Install skills pack into an agent host skills root.
 *
 * @param {{
 *   sourceRoot?: string|null,
 *   hostId: string,
 *   dest?: string|null,
 *   mode?: 'copy'|'symlink',
 *   homeDir?: string,
 *   force?: boolean,
 *   skillIds?: string[]|null,
 * }} opts
 */
export async function installSkillsToHost(opts) {
  const hostId = String(opts.hostId || "").trim();
  if (!hostId) return { ok: false, error: "hostId required" };

  const mode = opts.mode === "symlink" ? "symlink" : "copy";
  const homeDir = opts.homeDir || os.homedir();
  const dest =
    (opts.dest && path.resolve(opts.dest)) ||
    resolveHostSkillsDest(hostId, { homeDir, cwd: opts.cwd });
  if (!dest) return { ok: false, error: `unknown hostId: ${hostId}` };

  const sourceRoot =
    (opts.sourceRoot && path.resolve(opts.sourceRoot)) ||
    resolveEngineSkillsRoot({
      sourceRoot: opts.sourceRoot,
      engineRoot: opts.engineRoot,
    });
  if (!sourceRoot || !(await pathExists(sourceRoot))) {
    return { ok: false, error: `skills source not found: ${sourceRoot || "(none)"}` };
  }

  const filter =
    opts.skillIds && opts.skillIds.length ? new Set(opts.skillIds.map(String)) : null;
  const plan = await listPackInstallEntries(sourceRoot, filter);
  if (!plan.skillIds.length) {
    return { ok: false, error: "no skill directories with SKILL.md found to install" };
  }

  if (mode === "symlink") {
    const r = await installSymlink(sourceRoot, dest, plan.entries, { force: opts.force === true });
    if (r && r.ok === false) return r;
  } else {
    await installCopy(sourceRoot, dest, plan.entries);
  }

  const { receipt, receiptPath } = await writeSkillsInstallReceipt(dest, {
    name: plan.name,
    version: plan.version,
    source: sourceRoot,
    sourceRaw: sourceRoot,
    sourceLabel: sourceRoot,
    mode,
    hostId,
    skillIds: plan.skillIds,
    entries: plan.entries,
  });

  return {
    ok: true,
    hostId,
    dest,
    mode,
    source: sourceRoot,
    version: plan.version,
    name: plan.name,
    installed: plan.entries,
    skillIds: plan.skillIds,
    receipt,
    receiptPath,
  };
}

/**
 * Reinstall over managed install (upgrade).
 * @param {{ hostId: string, sourceRoot?: string|null, dest?: string|null, homeDir?: string, mode?: 'copy'|'symlink' }} opts
 */
export async function upgradeSkillsOnHost(opts) {
  const dest =
    (opts.dest && path.resolve(opts.dest)) ||
    resolveHostSkillsDest(opts.hostId, { homeDir: opts.homeDir || os.homedir() });
  let mode = opts.mode;
  let sourceRoot = opts.sourceRoot;
  if (dest) {
    const receipt = await readSkillsInstallReceipt(dest);
    if (receipt) {
      if (!mode && receipt.mode === "symlink") mode = "symlink";
      if (!sourceRoot && receipt.source_raw && (await pathExists(receipt.source_raw))) {
        sourceRoot = receipt.source_raw;
      }
    }
  }
  return installSkillsToHost({
    ...opts,
    mode: mode || "copy",
    sourceRoot: sourceRoot || undefined,
  });
}

/**
 * Remove only managed skill dirs listed in receipt (or known pack skill ids).
 * Does NOT delete unrelated user skills under the same root.
 *
 * @param {{ hostId: string, dest?: string|null, homeDir?: string }} opts
 */
export async function uninstallSkillsFromHost(opts) {
  const hostId = String(opts.hostId || "").trim();
  if (!hostId) return { ok: false, error: "hostId required" };
  const homeDir = opts.homeDir || os.homedir();
  const dest =
    (opts.dest && path.resolve(opts.dest)) ||
    resolveHostSkillsDest(hostId, { homeDir });
  if (!dest) return { ok: false, error: `unknown hostId: ${hostId}` };
  if (!(await pathExists(dest))) {
    return { ok: true, hostId, dest, removed: [], note: "dest not present" };
  }

  const receipt = await readSkillsInstallReceipt(dest);
  /** @type {string[]} */
  let managed = [];
  if (receipt) {
    if (Array.isArray(receipt.entries) && receipt.entries.length) {
      managed = receipt.entries.map(String);
    } else if (Array.isArray(receipt.skill_ids) && receipt.skill_ids.length) {
      managed = [...receipt.skill_ids.map(String), "shared", "topmind-pack.json"];
    }
  }
  // Fallback known pack ids when receipt missing but topmind router present
  if (!managed.length) {
    if (await pathExists(path.join(dest, "topmind", "SKILL.md"))) {
      const entries = await fs.readdir(dest, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        if (e.name === "shared" || e.name === "topmind-pack.json" || e.name === "INSTALL.md") {
          managed.push(e.name);
          continue;
        }
        if (e.isDirectory() && e.name.startsWith("topmind")) {
          managed.push(e.name);
        }
      }
    }
  }

  if (!managed.length) {
    return {
      ok: false,
      error: `no managed topmind install found under ${dest} (missing receipt and pack markers)`,
      dest,
      hostId,
    };
  }

  /** @type {string[]} */
  const removed = [];
  for (const name of managed) {
    // Never remove the receipt first — remove last
    if (name === SKILLS_RECEIPT_NAME) continue;
    const target = path.join(dest, name);
    if (await pathExists(target)) {
      await fs.rm(target, { recursive: true, force: true });
      removed.push(name);
    }
  }
  const receiptPath = path.join(dest, SKILLS_RECEIPT_NAME);
  if (await pathExists(receiptPath)) {
    await fs.rm(receiptPath, { force: true });
    removed.push(SKILLS_RECEIPT_NAME);
  }

  return { ok: true, hostId, dest, removed, receipt: receipt || null };
}

// ─── Clip extension ─────────────────────────────────────────────────────────

/**
 * Managed dir for unpacked Clip extension under Desktop state home.
 * @param {{ desktopStateHome?: string, homeDir?: string }} [opts]
 */
export function getClipExtensionManagedDir(opts = {}) {
  let base = opts.desktopStateHome;
  if (!base) {
    try {
      const { resolveDesktopStateHome } = require("./workspace-home.mjs");
      base = resolveDesktopStateHome({ homeDir: opts.homeDir });
    } catch {
      base = path.join(opts.homeDir || os.homedir(), "topmind", "topmind-desktop");
    }
  }
  return path.join(base, "companions", "clip-extension");
}

/**
 * Resolve bundled / monorepo browser-extension source (unpacked dir or zip).
 * @param {{ engineRoot?: string|null, bundledZipPath?: string|null }} [opts]
 */
export function resolveClipExtensionSource(opts = {}) {
  if (opts.bundledZipPath && existsSync(opts.bundledZipPath)) {
    return { kind: "zip", path: path.resolve(opts.bundledZipPath) };
  }
  const dirCandidates = [];
  if (opts.engineRoot) {
    dirCandidates.push(path.join(opts.engineRoot, "browser-extension"));
  }
  dirCandidates.push(path.join(DESKTOP_DIR, "..", "browser-extension"));
  dirCandidates.push(path.join(DESKTOP_DIR, "resources", "topmind-engine", "browser-extension"));
  try {
    const { app } = require("electron");
    if (app?.isPackaged && process.resourcesPath) {
      dirCandidates.unshift(path.join(process.resourcesPath, "topmind-engine", "browser-extension"));
    }
  } catch {
    /* */
  }
  for (const d of dirCandidates) {
    if (existsSync(path.join(d, "manifest.json"))) {
      return { kind: "dir", path: d };
    }
  }

  // Optional packaged zip next to engine
  const zipCandidates = [
    path.join(DESKTOP_DIR, "resources", "topmind-engine", "topmind-clip-extension.zip"),
    path.join(DESKTOP_DIR, "..", "dist"),
  ];
  for (const z of zipCandidates) {
    if (z.endsWith(".zip") && existsSync(z)) return { kind: "zip", path: z };
    if (existsSync(z) && !z.endsWith(".zip")) {
      try {
        const files = require("node:fs").readdirSync(z);
        const hit = files.find((f) => /^topmind-clip-extension-.*\.zip$/i.test(f));
        if (hit) return { kind: "zip", path: path.join(z, hit) };
      } catch {
        /* */
      }
    }
  }
  return null;
}

/**
 * Extract zip with system tools (same pattern as plugin-install.mjs).
 * @param {string} zipPath
 * @param {string} unpackDir
 */
async function extractZip(zipPath, unpackDir) {
  await fs.mkdir(unpackDir, { recursive: true });
  const abs = path.resolve(zipPath);
  let extracted = false;
  const unzip = spawnSync("unzip", ["-q", abs, "-d", unpackDir], { encoding: "utf8" });
  if (unzip.status === 0) extracted = true;
  if (!extracted) {
    const tar = spawnSync("tar", ["-xf", abs, "-C", unpackDir], { encoding: "utf8" });
    if (tar.status === 0) extracted = true;
  }
  if (!extracted && process.platform === "win32") {
    const ps = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${abs.replace(/'/g, "''")}' -DestinationPath '${unpackDir.replace(/'/g, "''")}' -Force`,
      ],
      { encoding: "utf8" },
    );
    if (ps.status === 0) extracted = true;
  }
  if (!extracted) {
    return { ok: false, error: "failed to extract zip (need unzip, tar, or PowerShell Expand-Archive)" };
  }
  return { ok: true };
}

/**
 * Find directory containing manifest.json under unpack (depth ≤ 3).
 * @param {string} dir
 * @param {number} [depth]
 */
async function findExtensionRoot(dir, depth = 0) {
  if (depth > 3) return null;
  if (await pathExists(path.join(dir, "manifest.json"))) return dir;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
    const hit = await findExtensionRoot(path.join(dir, ent.name), depth + 1);
    if (hit) return hit;
  }
  return null;
}

/**
 * Prepare Clip extension for guided load-unpacked install.
 * NEVER silent-loads into Chrome Web Store / browser profiles.
 *
 * @param {{
 *   bundledZipPath?: string|null,
 *   sourceDir?: string|null,
 *   extractTo?: string|null,
 *   desktopStateHome?: string,
 *   homeDir?: string,
 *   engineRoot?: string|null,
 * }} [opts]
 */
export async function prepareClipExtensionInstall(opts = {}) {
  const managedDir = opts.extractTo
    ? path.resolve(opts.extractTo)
    : getClipExtensionManagedDir({
        desktopStateHome: opts.desktopStateHome,
        homeDir: opts.homeDir,
      });

  let source = null;
  if (opts.sourceDir && (await pathExists(opts.sourceDir))) {
    source = { kind: "dir", path: path.resolve(opts.sourceDir) };
  } else if (opts.bundledZipPath && (await pathExists(opts.bundledZipPath))) {
    source = { kind: "zip", path: path.resolve(opts.bundledZipPath) };
  } else {
    source = resolveClipExtensionSource({
      engineRoot: opts.engineRoot,
      bundledZipPath: opts.bundledZipPath,
    });
  }

  if (!source) {
    return {
      ok: false,
      error: "clip extension source not found (browser-extension/ or zip)",
      guidedInstall: true,
    };
  }

  await fs.mkdir(managedDir, { recursive: true });
  // Clear previous managed copy (except keep dir)
  const existing = await fs.readdir(managedDir).catch(() => []);
  for (const name of existing) {
    await fs.rm(path.join(managedDir, name), { recursive: true, force: true });
  }

  let extensionRoot = managedDir;
  if (source.kind === "zip") {
    const work = path.join(managedDir, "_unpack");
    await fs.mkdir(work, { recursive: true });
    const ex = await extractZip(source.path, work);
    if (!ex.ok) return { ...ex, guidedInstall: true };
    const found = await findExtensionRoot(work);
    if (!found) {
      return { ok: false, error: "manifest.json not found in zip", guidedInstall: true };
    }
    // Move contents into managedDir root
    const ents = await fs.readdir(found, { withFileTypes: true });
    for (const ent of ents) {
      await fs.rename(path.join(found, ent.name), path.join(managedDir, ent.name));
    }
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    extensionRoot = managedDir;
  } else {
    await copyDirRecursive(source.path, managedDir);
    extensionRoot = managedDir;
  }

  let version = null;
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(extensionRoot, "manifest.json"), "utf8"));
    version = manifest.version ? String(manifest.version) : null;
  } catch {
    /* */
  }

  const receipt = {
    preparedAt: new Date().toISOString(),
    version,
    source: source.path,
    managedDir: extensionRoot,
    guidedInstall: true,
    // Intentional limit: browsers require user to load unpacked; we never inject into profiles.
    note: "Open chrome://extensions (or edge://extensions), enable Developer mode, Load unpacked → this folder",
  };
  await fs.writeFile(
    path.join(extensionRoot, ".topmind-clip-prepare.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    "utf8",
  );

  return {
    ok: true,
    path: extensionRoot,
    version,
    guidedInstall: true,
    instructionsKey: "companions.clipGuidedInstructions",
    receipt,
  };
}

/**
 * @param {{ managedDir?: string, bundledVersion?: string|null, desktopStateHome?: string, homeDir?: string }} [opts]
 */
export async function getClipExtensionStatus(opts = {}) {
  const managedDir =
    opts.managedDir ||
    getClipExtensionManagedDir({
      desktopStateHome: opts.desktopStateHome,
      homeDir: opts.homeDir,
    });
  const manifestPath = path.join(managedDir, "manifest.json");
  const prepared = await pathExists(manifestPath);
  let version = null;
  if (prepared) {
    try {
      const j = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      version = j.version ? String(j.version) : null;
    } catch {
      /* */
    }
  }
  return {
    prepared,
    path: prepared ? managedDir : null,
    managedDir,
    version,
    bundledVersion: opts.bundledVersion ?? null,
    guidedInstall: true,
  };
}

// ─── Obsidian plugin ────────────────────────────────────────────────────────

/**
 * Resolve Obsidian plugin package root (dir with manifest.json).
 * @param {{ sourceDir?: string|null, zipPath?: string|null, engineRoot?: string|null }} [opts]
 */
export function resolveObsidianPluginSource(opts = {}) {
  if (opts.sourceDir && existsSync(path.join(opts.sourceDir, "manifest.json"))) {
    return { kind: "dir", path: path.resolve(opts.sourceDir) };
  }
  if (opts.zipPath && existsSync(opts.zipPath)) {
    return { kind: "zip", path: path.resolve(opts.zipPath) };
  }
  const dirCandidates = [];
  if (opts.engineRoot) {
    dirCandidates.push(path.join(opts.engineRoot, "obsidian-plugin", "dist"));
    dirCandidates.push(path.join(opts.engineRoot, "obsidian-plugin"));
  }
  dirCandidates.push(path.join(DESKTOP_DIR, "..", "obsidian-plugin", "dist"));
  dirCandidates.push(path.join(DESKTOP_DIR, "..", "obsidian-plugin"));
  dirCandidates.push(path.join(DESKTOP_DIR, "resources", "topmind-engine", "obsidian-plugin"));
  try {
    const { app } = require("electron");
    if (app?.isPackaged && process.resourcesPath) {
      dirCandidates.unshift(path.join(process.resourcesPath, "topmind-engine", "obsidian-plugin"));
    }
  } catch {
    /* */
  }
  for (const d of dirCandidates) {
    if (existsSync(path.join(d, "manifest.json"))) return { kind: "dir", path: d };
  }
  // release zips
  const releaseDir = path.join(DESKTOP_DIR, "..", "obsidian-plugin", "release");
  if (existsSync(releaseDir)) {
    try {
      const files = require("node:fs")
        .readdirSync(releaseDir)
        .filter((f) => /^topmind-obsidian-.*\.zip$/i.test(f))
        .sort();
      if (files.length) {
        return { kind: "zip", path: path.join(releaseDir, files[files.length - 1]) };
      }
    } catch {
      /* */
    }
  }
  return null;
}

/**
 * Install Obsidian plugin into a vault.
 * Plugin folder id comes from manifest.json (shipped: topmind-stream).
 *
 * @param {{
 *   sourceDir?: string|null,
 *   zipPath?: string|null,
 *   vaultRoot?: string|null,
 *   pluginsRoot?: string|null,
 *   engineRoot?: string|null,
 * }} opts
 */
export async function installObsidianPlugin(opts = {}) {
  let pluginsRoot = opts.pluginsRoot ? path.resolve(opts.pluginsRoot) : null;
  if (!pluginsRoot && opts.vaultRoot) {
    pluginsRoot = path.join(path.resolve(opts.vaultRoot), ".obsidian", "plugins");
  }
  if (!pluginsRoot) {
    return {
      ok: false,
      guided: true,
      error: "no vault known — open a workspace with .obsidian or pass vaultPath",
    };
  }

  const source = resolveObsidianPluginSource({
    sourceDir: opts.sourceDir,
    zipPath: opts.zipPath,
    engineRoot: opts.engineRoot,
  });
  if (!source) {
    return { ok: false, error: "obsidian plugin source not found", guided: true };
  }

  let pkgDir = source.path;
  let work = null;
  if (source.kind === "zip") {
    work = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-obsidian-"));
    const unpack = path.join(work, "unpack");
    const ex = await extractZip(source.path, unpack);
    if (!ex.ok) {
      await fs.rm(work, { recursive: true, force: true }).catch(() => {});
      return ex;
    }
    // find manifest
    async function findManifest(dir, depth = 0) {
      if (depth > 3) return null;
      if (await pathExists(path.join(dir, "manifest.json"))) return dir;
      const ents = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of ents) {
        if (!e.isDirectory() || e.name.startsWith(".")) continue;
        const hit = await findManifest(path.join(dir, e.name), depth + 1);
        if (hit) return hit;
      }
      return null;
    }
    pkgDir = await findManifest(unpack);
    if (!pkgDir) {
      await fs.rm(work, { recursive: true, force: true }).catch(() => {});
      return { ok: false, error: "manifest.json not found in plugin zip" };
    }
  }

  try {
    let manifest;
    try {
      manifest = JSON.parse(await fs.readFile(path.join(pkgDir, "manifest.json"), "utf8"));
    } catch (e) {
      return { ok: false, error: `invalid manifest.json: ${e instanceof Error ? e.message : e}` };
    }
    const pluginId = String(manifest.id || OBSIDIAN_PLUGIN_IDS[0]).trim();
    if (!pluginId) return { ok: false, error: "manifest.id required" };

    await fs.mkdir(pluginsRoot, { recursive: true });
    const dest = path.join(pluginsRoot, pluginId);
    if (await pathExists(dest)) {
      await fs.rm(dest, { recursive: true, force: true });
    }
    await copyDirRecursive(pkgDir, dest);

    // Ensure community-plugins enabled list includes id when community-plugins.json exists
    const communityPath = path.join(path.dirname(pluginsRoot), "community-plugins.json");
    if (await pathExists(communityPath)) {
      try {
        const list = JSON.parse(await fs.readFile(communityPath, "utf8"));
        if (Array.isArray(list) && !list.includes(pluginId)) {
          list.push(pluginId);
          await fs.writeFile(communityPath, `${JSON.stringify(list, null, 2)}\n`, "utf8");
        }
      } catch {
        /* ignore — user can enable in Obsidian */
      }
    }

    return {
      ok: true,
      pluginId,
      version: manifest.version ? String(manifest.version) : null,
      path: dest,
      pluginsRoot,
      vaultRoot: opts.vaultRoot || path.dirname(path.dirname(pluginsRoot)),
    };
  } finally {
    if (work) await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Remove only the topmind Obsidian plugin folder(s).
 * @param {{ vaultRoot?: string|null, pluginsRoot?: string|null }} opts
 */
export async function uninstallObsidianPlugin(opts = {}) {
  let pluginsRoot = opts.pluginsRoot ? path.resolve(opts.pluginsRoot) : null;
  if (!pluginsRoot && opts.vaultRoot) {
    pluginsRoot = path.join(path.resolve(opts.vaultRoot), ".obsidian", "plugins");
  }
  if (!pluginsRoot || !(await pathExists(pluginsRoot))) {
    return { ok: false, error: "plugins root not found", guided: !opts.vaultRoot && !opts.pluginsRoot };
  }

  /** @type {string[]} */
  const removed = [];
  for (const id of OBSIDIAN_PLUGIN_IDS) {
    const dir = path.join(pluginsRoot, id);
    if (await pathExists(dir)) {
      await fs.rm(dir, { recursive: true, force: true });
      removed.push(id);
    }
  }
  // Also remove any topmind* with our author marker
  try {
    const ents = await fs.readdir(pluginsRoot, { withFileTypes: true });
    for (const e of ents) {
      if (!e.isDirectory() || !e.name.startsWith("topmind")) continue;
      if (removed.includes(e.name)) continue;
      const dir = path.join(pluginsRoot, e.name);
      const mp = path.join(dir, "manifest.json");
      if (!(await pathExists(mp))) continue;
      try {
        const m = JSON.parse(await fs.readFile(mp, "utf8"));
        // Only remove if name/id looks like our plugin
        if (String(m.id || "").startsWith("topmind") || String(m.name || "").toLowerCase().includes("topmind")) {
          await fs.rm(dir, { recursive: true, force: true });
          removed.push(e.name);
        }
      } catch {
        /* */
      }
    }
  } catch {
    /* */
  }

  if (!removed.length) {
    return { ok: true, removed: [], note: "no topmind plugin folder found" };
  }
  return { ok: true, removed, pluginsRoot };
}

/**
 * Convenience: full detect + managed clip status.
 * @param {Parameters<typeof import('./companion-detect.mjs').detectCompanions>[0] & {
 *   desktopStateHome?: string,
 *   engineRoot?: string|null,
 * }} [opts]
 */
export async function getCompanionStatus(opts = {}) {
  const { detectCompanions } = await import("./companion-detect.mjs");
  const base = detectCompanions(opts);
  const clip = await getClipExtensionStatus({
    desktopStateHome: opts.desktopStateHome,
    homeDir: opts.homeDir,
  });
  // Bundled versions for UI compare
  let skillsBundledVersion = null;
  const skillsRoot = resolveEngineSkillsRoot({ engineRoot: opts.engineRoot });
  if (skillsRoot && existsSync(path.join(skillsRoot, "topmind-pack.json"))) {
    try {
      const j = JSON.parse(readFileSync(path.join(skillsRoot, "topmind-pack.json"), "utf8"));
      skillsBundledVersion = j.version ? String(j.version) : null;
    } catch {
      /* */
    }
  }
  let obsidianBundledVersion = null;
  const obsSrc = resolveObsidianPluginSource({ engineRoot: opts.engineRoot });
  if (obsSrc?.kind === "dir") {
    try {
      const j = JSON.parse(readFileSync(path.join(obsSrc.path, "manifest.json"), "utf8"));
      obsidianBundledVersion = j.version ? String(j.version) : null;
    } catch {
      /* */
    }
  }

  return {
    ...base,
    clip,
    bundled: {
      skillsVersion: skillsBundledVersion,
      obsidianPluginVersion: obsidianBundledVersion,
    },
    skillsSourceRoot: skillsRoot,
  };
}

// Re-export detect for single import surface
export { detectCompanions, resolveAgentHosts } from "./companion-detect.mjs";
