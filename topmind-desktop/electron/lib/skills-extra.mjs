/**
 * Desktop user-extra skills roots: install local packs + managed extras dir.
 *
 * Layout:
 *   {topmind_DESKTOP_HOME}/skills-extra/   ← default managed install target
 *     my-skill/SKILL.md
 *     shared/…                            ← optional pack support files
 *
 * Settings ai.extraSkillsRoots lists absolute dirs merged with
 * topmind_SKILLS_EXTRA (see skills-runtime).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { replacePathAtomic, unpackArchive } from "./install-swap.mjs";

const require = createRequire(import.meta.url);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "tests",
  "evals",
  "install-targets",
  ".trash",
]);

const RECEIPT_NAME = ".topmind-skills-extra-install.json";

export function getSkillsExtraRoot() {
  try {
    const { resolveDesktopStateHome } = require("./workspace-home.mjs");
    return path.join(resolveDesktopStateHome(), "skills-extra");
  } catch {
    const os = require("node:os");
    return path.join(os.homedir(), "topmind", "topmind-desktop", "skills-extra");
  }
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function ensureSkillsExtraRoot() {
  const root = getSkillsExtraRoot();
  await fs.mkdir(root, { recursive: true });
  return root;
}

/**
 * Detect a skills pack root (topmind-pack.json or dirs with SKILL.md).
 */
export async function isSkillsPackRoot(dir) {
  if (!(await pathExists(dir))) return false;
  if (await pathExists(path.join(dir, "topmind-pack.json"))) return true;
  if (await pathExists(path.join(dir, "topmind", "SKILL.md"))) return true;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && (await pathExists(path.join(dir, e.name, "SKILL.md")))) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

export async function resolveSkillsPackRoot(dir) {
  const abs = path.resolve(dir);
  if (await isSkillsPackRoot(abs)) return abs;
  const nested = path.join(abs, "skills");
  if (await isSkillsPackRoot(nested)) return nested;
  // Unzipped release assets often nest under topmind-skills-<ver>/
  try {
    const ents = await fs.readdir(abs, { withFileTypes: true });
    for (const e of ents) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      const child = path.join(abs, e.name);
      if (await isSkillsPackRoot(child)) return child;
    }
  } catch {
    /* */
  }
  return abs;
}

async function copyDirFiltered(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const ent of entries) {
    if (SKIP_DIRS.has(ent.name) || ent.name.startsWith(".")) continue;
    if (ent.isSymbolicLink()) continue;
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      await copyDirFiltered(from, to);
    } else if (ent.isFile()) {
      await fs.copyFile(from, to);
    }
  }
}

/**
 * Move dest path under skills-extra/.trash/<name>-<ts> before overwrite.
 * @param {string} dir absolute path of skill or shared dir
 * @param {string} skillsExtraRoot managed root
 */
/**
 * Install a local skills pack into dest (default managed skills-extra).
 * Accepts a pack directory **or** a `topmind-skills-*.zip` release asset
 * (auto-extracted) so companion-download can hand its zipPath straight through.
 * Copies skill dirs + shared/ + topmind-pack.json when present.
 *
 * @param {string} source pack root, monorepo skills/, or .zip release asset
 * @param {{ dest?: string, skillIds?: string[]|null }} [opts]
 */
export async function installSkillsPackLocal(source, opts = {}) {
  let sourceDir = source;
  let tempUnpack = null;
  const archiveLike = /\.(zip|tar\.gz|tgz)$/i.test(String(source || "")) && (await pathExists(source));
  if (archiveLike) {
    const os = require("node:os");
    tempUnpack = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-skills-zip-"));
    const unpacked = await extractZipToDir(source, tempUnpack, opts);
    if (!unpacked) {
      await fs.rm(tempUnpack, { recursive: true, force: true }).catch(() => {});
      return { ok: false, error: `failed to extract skills archive: ${source}`, claimedLatest: false };
    }
    sourceDir = await resolveSkillsPackRoot(unpacked) || unpacked;
  }
  try {
    const packRoot = await resolveSkillsPackRoot(sourceDir);
    if (!(await isSkillsPackRoot(packRoot))) {
      return { ok: false, error: `not a skills pack: ${packRoot}` };
    }
    let manifest = null;
    try { manifest = JSON.parse(await fs.readFile(path.join(packRoot, "topmind-pack.json"), "utf8")); } catch { /* legacy bare skill */ }
    if (opts.expectedVersion && manifest?.version !== opts.expectedVersion) return { ok: false, error: "pack version does not match requested release", claimedLatest: false };
    if (!opts.dest && manifest?.name && /^[a-z0-9][a-z0-9-]*$/u.test(manifest.name)) {
      return await installManagedPack(packRoot, manifest, opts);
    }
    const dest = path.resolve(opts.dest || (await ensureSkillsExtraRoot()));
    await fs.mkdir(dest, { recursive: true });

    const filter = opts.skillIds && opts.skillIds.length
      ? new Set(opts.skillIds.map(String))
      : null;

    const entries = await fs.readdir(packRoot, { withFileTypes: true });
    /** @type {string[]} */
    const installed = [];
    for (const ent of entries) {
      if (SKIP_DIRS.has(ent.name) || ent.name.startsWith(".")) continue;
      const from = path.join(packRoot, ent.name);
      const to = path.join(dest, ent.name);

      if (ent.isDirectory()) {
        const isSkill = await pathExists(path.join(from, "SKILL.md"));
        const isShared = ent.name === "shared";
        if (isSkill) {
          if (filter && !filter.has(ent.name)) continue;
          const swapped = await replacePathAtomic(from, to, {
            trashDir: path.join(dest, ".trash"),
            probeLock: opts.probeLock,
            renameImpl: opts.renameImpl,
            copyImpl: opts.copyImpl || ((src, target) => copyDirFiltered(src, target)),
          });
          if (!swapped.ok) return { ...swapped, claimedLatest: false };
          installed.push(ent.name);
        } else if (isShared) {
          const swapped = await replacePathAtomic(from, to, {
            trashDir: path.join(dest, ".trash"),
            probeLock: opts.probeLock,
            renameImpl: opts.renameImpl,
            copyImpl: opts.copyImpl || ((src, target) => copyDirFiltered(src, target)),
          });
          if (!swapped.ok) return { ...swapped, claimedLatest: false };
          installed.push("shared");
        }
      } else if (ent.isFile() && (ent.name === "topmind-pack.json" || ent.name === "INSTALL.md")) {
        const swapped = await replacePathAtomic(from, to, {
          probeLock: opts.probeLock,
          renameImpl: opts.renameImpl,
          copyImpl: opts.copyImpl || (async (src, target) => { await fs.copyFile(src, target); }),
        });
        if (!swapped.ok) return { ...swapped, claimedLatest: false };
        installed.push(ent.name);
      }
    }

    if (!installed.some((x) => x !== "shared" && x !== "topmind-pack.json" && x !== "INSTALL.md")) {
      return { ok: false, error: "no skill directories with SKILL.md found to install" };
    }

    // Receipt for Desktop extras (+ pack version when available)
    let packVersion = null;
    let packName = null;
    try {
      const packPath = path.join(packRoot, "topmind-pack.json");
      if (await pathExists(packPath)) {
        const pack = JSON.parse(await fs.readFile(packPath, "utf8"));
        packVersion = pack.version || null;
        packName = pack.name || null;
      }
    } catch {
      /* ignore */
    }
    const receipt = {
      installedAt: new Date().toISOString(),
      source: packRoot,
      sourceInput: source,
      dest,
      entries: installed,
      version: packVersion,
      name: packName,
    };
    await fs.writeFile(
      path.join(dest, RECEIPT_NAME),
      `${JSON.stringify(receipt, null, 2)}\n`,
      "utf8",
    );

    return {
      ok: true,
      dest,
      installed,
      version: packVersion,
      name: packName,
      fromZip: Boolean(archiveLike),
    };
  } finally {
    if (tempUnpack) await fs.rm(tempUnpack, { recursive: true, force: true }).catch(() => {});
  }
}

/** Immutable version directories + an atomic activation record keep in-flight resources stable. */
async function installManagedPack(source, manifest, opts) {
  if (manifest.runtime?.api > 1) return { ok: false, error: "pack requires a newer Desktop runtime", claimedLatest: false };
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(manifest.version || "")) return { ok: false, error: "invalid pack version" };
  const parent = path.join(opts.managedRoot || await ensureSkillsExtraRoot(), "packs");
  await fs.mkdir(parent, { recursive: true });
  const slot = path.join(parent, manifest.name);
  const lockPath = `${slot}.lock`;
  let lock, stage;
  try {
    try { lock = await fs.open(lockPath, "wx"); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      const oldLock = JSON.parse(await fs.readFile(lockPath, "utf8"));
      if (!Number.isInteger(oldLock.pid) || oldLock.pid <= 0) throw new Error("pack install already in progress");
      try { process.kill(oldLock.pid, 0); throw new Error("pack install already in progress"); }
      catch (probe) { if (probe.code !== "ESRCH") throw probe; }
      await fs.rm(lockPath); lock = await fs.open(lockPath, "wx");
    }
    await lock.writeFile(JSON.stringify({ pid: process.pid }));
    stage = await fs.mkdtemp(path.join(parent, ".prepare-"));
    const digest = data => createHash("sha256").update(data).digest("hex");
    const verify = async (root, entries) => {
      const realRoot = await fs.realpath(root);
      for (const [relative, expected] of Object.entries(entries || {})) {
        if (!relative || path.isAbsolute(relative) || /\\|(^|\/)\.\.($|\/)/u.test(relative)) throw new Error("invalid pack resource path");
        const absolute = await fs.realpath(path.join(root, relative));
        if (!absolute.startsWith(`${realRoot}${path.sep}`)) throw new Error("pack resource escapes root");
        if (digest(await fs.readFile(absolute)) !== expected) throw new Error(`modified pack resource: ${relative}`);
      }
    };
    if (manifest.files) await verify(source, manifest.files);
    let active = null;
    try { active = JSON.parse(await fs.readFile(path.join(slot, "active.json"), "utf8")); } catch { /* first install */ }
    if (active?.current) {
      const oldRoot = resolveManagedVersion(slot, active.current);
      const old = JSON.parse(await fs.readFile(path.join(oldRoot, "topmind-pack.json"), "utf8"));
      await verify(oldRoot, old.files);
    }
    if (manifest.files) {
      for (const relative of [...Object.keys(manifest.files), "topmind-pack.json"]) {
        const target = path.join(stage, relative); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(path.join(source, relative), target);
      }
    } else await copyDirFiltered(source, stage);
    const entries = await fs.readdir(stage);
    if (!entries.some(id => manifest.entry_files?.includes(`${id}/SKILL.md`))) throw new Error("pack has no declared skills");
    const relative = `versions/${manifest.version}-${digest(JSON.stringify(manifest)).slice(0, 16)}`;
    const dest = resolveManagedVersion(slot, relative);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(path.join(stage, RECEIPT_NAME), JSON.stringify({ installedAt: new Date().toISOString(), dest, entries, version: manifest.version, name: manifest.name }) + "\n");
    if (opts.copyImpl) { const probe = `${stage}-probe`; try { await opts.copyImpl(stage, probe); } finally { await fs.rm(probe, { recursive: true, force: true }); } }
    if (await pathExists(dest)) await verify(dest, manifest.files);
    else await fs.rename(stage, dest);
    const record = { current: relative, previous: active?.current && active.current !== relative ? active.current : active?.previous || null, version: manifest.version };
    const temp = path.join(slot, `.active-${process.pid}.json`);
    await fs.writeFile(temp, JSON.stringify(record) + "\n");
    await fs.rename(temp, path.join(slot, "active.json"));
    return { ok: true, dest, installed: entries, version: manifest.version, name: manifest.name };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error), claimedLatest: false }; }
  finally { if (stage) await fs.rm(stage, { recursive: true, force: true }); if (lock) { await lock.close(); await fs.rm(lockPath, { force: true }); } }
}

function resolveManagedVersion(slot, relative) {
  if (!/^versions\/[A-Za-z0-9.-]+$/u.test(relative || "")) throw new Error("invalid active pack path");
  return path.join(slot, relative);
}

export async function restoreBundledWriting(opts = {}) {
  const slot = path.join(opts.managedRoot || getSkillsExtraRoot(), "packs", "topmind-writing-skills");
  await fs.mkdir(slot, { recursive: true });
  let lock;
  try {
    lock = await fs.open(`${slot}.lock`, "wx");
    await lock.writeFile(JSON.stringify({ pid: process.pid }));
    const temp = path.join(slot, `.active-${process.pid}.json`);
    await fs.writeFile(temp, JSON.stringify({ current: null, previous: null }) + "\n");
    await fs.rename(temp, path.join(slot, "active.json"));
    return { ok: true };
  } catch { return { ok: false, error: "pack install in progress or activation is not writable" }; }
  finally { if (lock) { await lock.close(); await fs.rm(`${slot}.lock`, { force: true }); } }
}

/**
 * Extract a zip or tar.gz. Windows uses PowerShell when unzip is not on PATH.
 * @param {string} zipPath
 * @param {string} destDir
 * @param {{ platform?: string, unzipOnPath?: boolean, spawnImpl?: (cmd: string, args: string[]) => boolean|Promise<boolean> }} [opts]
 * @returns {Promise<string|null>} destDir on success
 */
async function extractZipToDir(zipPath, destDir, opts = {}) {
  const result = await unpackArchive(zipPath, destDir, {
    platform: opts.platform,
    unzipOnPath: opts.unzipOnPath,
    spawnImpl: opts.spawnImpl,
  });
  return result.ok ? destDir : null;
}

/**
 * Read install receipt from a skills-extra (or any pack) directory.
 * @param {string} [dest]
 */
export async function readSkillsExtraReceipt(dest) {
  let root = path.resolve(dest || getSkillsExtraRoot());
  try {
  if (await pathExists(path.join(root, "active.json"))) {
    const active = JSON.parse(await fs.readFile(path.join(root, "active.json"), "utf8"));
    if (!active.current) return null;
    root = resolveManagedVersion(root, active.current);
  }
  } catch { return null; }
  const file = path.join(root, RECEIPT_NAME);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      installedAt: typeof parsed.installedAt === "string" ? parsed.installedAt : null,
      source: typeof parsed.source === "string" ? parsed.source : null,
      dest: typeof parsed.dest === "string" ? parsed.dest : root,
      entries: Array.isArray(parsed.entries) ? parsed.entries.map(String) : [],
      version: typeof parsed.version === "string" ? parsed.version : null,
      name: typeof parsed.name === "string" ? parsed.name : null,
      path: file,
    };
  } catch {
    return null;
  }
}

/**
 * Summarize a skills pack root for Settings UI (version + skill count).
 * @param {string} dir
 */
export async function summarizeSkillsPack(dir) {
  const packRoot = await resolveSkillsPackRoot(dir);
  if (!(await isSkillsPackRoot(packRoot))) {
    return { ok: false, path: packRoot, error: "not a skills pack" };
  }
  let version = null;
  let name = null;
  let packFile = null;
  const packPath = path.join(packRoot, "topmind-pack.json");
  if (await pathExists(packPath)) {
    try {
      const pack = JSON.parse(await fs.readFile(packPath, "utf8"));
      version = pack.version || null;
      name = pack.name || null;
      packFile = packPath;
    } catch {
      /* ignore */
    }
  }
  /** @type {string[]} */
  const skillIds = [];
  let hasShared = false;
  try {
    const entries = await fs.readdir(packRoot, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
      if (e.name === "shared") {
        hasShared = true;
        continue;
      }
      if (await pathExists(path.join(packRoot, e.name, "SKILL.md"))) {
        skillIds.push(e.name);
      }
    }
  } catch {
    /* ignore */
  }
  const receipt = await readSkillsExtraReceipt(packRoot);
  return {
    ok: true,
    path: packRoot,
    version,
    name,
    skillCount: skillIds.length,
    skillIds,
    hasShared,
    packFile,
    receipt,
  };
}

/**
 * Normalize absolute extra roots list (unique, existing dirs only when checkExists).
 * @param {unknown} raw
 * @param {{ checkExists?: boolean }} [opts]
 */
export function normalizeExtraSkillsRoots(raw, opts = {}) {
  if (!Array.isArray(raw)) return [];
  const { existsSync } = require("node:fs");
  const check = opts.checkExists !== false;
  /** @type {string[]} */
  const out = [];
  for (const item of raw) {
    if (typeof item !== "string" || !item.trim()) continue;
    let p = item.trim().replace(/^~(?=\/|$)/, require("node:os").homedir());
    p = path.resolve(p);
    if (out.includes(p)) continue;
    if (check && !existsSync(p)) continue;
    out.push(p);
  }
  return out;
}
