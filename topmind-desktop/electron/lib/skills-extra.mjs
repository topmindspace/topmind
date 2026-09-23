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
async function parkSkillsDir(dir, skillsExtraRoot) {
  if (!(await pathExists(dir))) return null;
  const trash = path.join(skillsExtraRoot, ".trash");
  await fs.mkdir(trash, { recursive: true });
  const base = path.basename(dir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(trash, `${base}-${stamp}`);
  await fs.rename(dir, dest);
  return dest;
}

/**
 * Install a local skills pack into dest (default managed skills-extra).
 * Copies skill dirs + shared/ + topmind-pack.json when present.
 *
 * @param {string} sourceDir pack root or monorepo skills/
 * @param {{ dest?: string, skillIds?: string[]|null }} [opts]
 */
export async function installSkillsPackLocal(sourceDir, opts = {}) {
  const packRoot = await resolveSkillsPackRoot(sourceDir);
  if (!(await isSkillsPackRoot(packRoot))) {
    return { ok: false, error: `not a skills pack: ${packRoot}` };
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
        if (await pathExists(to)) {
          await parkSkillsDir(to, dest);
        }
        await copyDirFiltered(from, to);
        installed.push(ent.name);
      } else if (isShared) {
        if (await pathExists(to)) {
          await parkSkillsDir(to, dest);
        }
        await copyDirFiltered(from, to);
        installed.push("shared");
      }
    } else if (ent.isFile() && (ent.name === "topmind-pack.json" || ent.name === "INSTALL.md")) {
      await fs.copyFile(from, to);
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
    source: packRoot,
    version: packVersion,
    name: packName,
    receipt,
  };
}

/**
 * Read install receipt from a skills-extra (or any pack) directory.
 * @param {string} [dest]
 */
export async function readSkillsExtraReceipt(dest) {
  const root = path.resolve(dest || getSkillsExtraRoot());
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
