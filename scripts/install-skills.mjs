#!/usr/bin/env node
/**
 * topmind skills install / update — same mental model as open skill registries:
 *
 *   "Point at a repo (or local path) + optional skills subdir → install into a host skills root → update later."
 *
 * Compatible with the community CLI (installs individual SKILL.md trees):
 *
 *   npx skills add topmindspace/topmind -g -y
 *   npx skills update -g -y
 *
 * This script is pack-aware: it also copies shared/, topmind-pack.json, INSTALL.md, etc.
 * so progressive-disclosure links like ../shared/*.md keep working.
 *
 * Commands:
 *   add <source>     Install or reinstall from a source
 *   update           Re-install from the receipt written at dest
 *   list             Show what a source would install (no write)
 *
 * Source forms for `add`:
 *   topmindspace/topmind                         GitHub owner/repo (default branch)
 *   topmindspace/topmind@main                    owner/repo@ref
 *   https://github.com/topmindspace/topmind.git  git URL
 *   ./skills                                     local pack root or monorepo skills/
 *   release:latest | release:v4.3.0              GitHub Release zip (topmind-skills-*)
 *
 * Options:
 *   --path <subdir>     Subdir inside the repo that holds the pack (default: skills)
 *   --dest <dir>        Host skills root to install into
 *   --host <name>       Default dest: claude-code|codex|hermes|opencode|generic
 *   --mode copy|symlink copy (default) or symlink (local sources only)
 *   --skill <id>        Only install these skill ids (repeatable / comma-separated)
 *   --global / -g       Alias: --host claude-code (user-level ~/.claude/skills)
 *   --dry-run           Print plan only
 *   --force             Replace non-symlink destinations when using symlink mode
 *
 * Examples:
 *   # Like `npx skills add topmindspace/topmind -g`
 *   node scripts/install-skills.mjs add topmindspace/topmind -g
 *
 *   # Custom monorepo path: only the skills/ tree
 *   node scripts/install-skills.mjs add topmindspace/topmind --path skills --dest ~/.claude/skills
 *
 *   # Install into a project-local skills dir
 *   node scripts/install-skills.mjs add topmindspace/topmind --dest ./.claude/skills
 *
 *   # Upgrade later (reads .topmind-skills-install.json at dest)
 *   node scripts/install-skills.mjs update --dest ~/.claude/skills
 *
 *   # Local checkout, live symlink while developing
 *   node scripts/install-skills.mjs add ./skills --mode symlink --dest ~/.claude/skills
 *
 * Private GitHub: export GH_TOKEN or GITHUB_TOKEN.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_OWNER_REPO = "topmindspace/topmind";
const DEFAULT_GIT = `https://github.com/${DEFAULT_OWNER_REPO}.git`;
const DEFAULT_PATH = "skills";
const RECEIPT_NAME = ".topmind-skills-install.json";

const HOST_DEFAULTS = {
  "claude-code": () => path.join(os.homedir(), ".claude", "skills"),
  codex: () => path.join(os.homedir(), ".codex", "skills"),
  hermes: () => path.join(os.homedir(), ".hermes", "skills"),
  opencode: () => path.join(process.cwd(), ".opencode", "skills"),
  generic: () => path.join(process.cwd(), "topmind-skills"),
};

function log(msg) {
  process.stdout.write(`[install-skills] ${msg}\n`);
}

function fail(msg, code = 1) {
  process.stderr.write(`[install-skills] ERROR: ${msg}\n`);
  process.exit(code);
}

function printHelp() {
  process.stdout.write(`Usage:
  node scripts/install-skills.mjs add <source> [options]
  node scripts/install-skills.mjs update [--dest <dir>]
  node scripts/install-skills.mjs list <source> [options]

Source: owner/repo | owner/repo@ref | git-url | local-path | release:<tag>

Same idea as:  npx skills add <owner/repo> -g
Pack-aware:    also installs shared/ + topmind-pack.json so relative links work.

Options:
  --locale <code>   Install locale overlay (e.g. en-US); falls back to topmind_LOCALE env
  --dest <dir>      Host skills root to install into
  --host <name>     Default dest: claude-code|codex|hermes|opencode|generic
  --mode copy|symlink  copy (default) or symlink (local sources only)
  --skill <id>      Only install these skill ids (repeatable / comma-separated)
  --global / -g     Alias: --host claude-code (user-level ~/.claude/skills)
  --dry-run         Print plan only
  --force           Replace non-symlink destinations when using symlink mode

See skills/INSTALL.md for full docs.
`);
}

// ─── args ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    command: null,
    source: null,
    dest: null,
    repoPath: DEFAULT_PATH,
    mode: "copy",
    host: "claude-code",
    skillsFilter: null, // null = all, else Set of ids
    dryRun: false,
    force: false,
    locale: null,
  };

  if (argv.length === 0) {
    printHelp();
    process.exit(0);
  }

  // Legacy flag-only form (no subcommand) → treat as add with flags
  const first = argv[0];
  if (first === "add" || first === "install" || first === "a") {
    out.command = "add";
    argv = argv.slice(1);
  } else if (first === "update" || first === "upgrade" || first === "u") {
    out.command = "update";
    argv = argv.slice(1);
  } else if (first === "list" || first === "ls") {
    out.command = "list";
    argv = argv.slice(1);
  } else if (first === "--help" || first === "-h") {
    printHelp();
    process.exit(0);
  } else if (first.startsWith("-")) {
    // npm run skills:install -- --from-git  (legacy)
    out.command = "add";
  } else {
    // bare source: install-skills.mjs topmindspace/topmind
    out.command = "add";
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v == null || (v.startsWith("-") && v !== "-")) fail(`missing value for ${a}`);
      return v;
    };

    if (a === "--dest" || a === "-d") out.dest = next();
    else if (a === "--path" || a === "--subdir") out.repoPath = next().replace(/^\/+|\/+$/g, "") || ".";
    else if (a === "--source" || a === "-s") out.source = next();
    else if (a === "--from-git") {
      // legacy: --from-git [url]
      const peek = argv[i + 1];
      if (peek && !peek.startsWith("-")) out.source = next();
      else out.source = DEFAULT_OWNER_REPO;
    } else if (a === "--from-release") {
      const peek = argv[i + 1];
      out.source = peek && !peek.startsWith("-") ? `release:${next()}` : "release:latest";
    } else if (a === "--mode" || a === "-m") out.mode = next();
    else if (a === "--host") out.host = next();
    else if (a === "--global" || a === "-g") {
      out.host = "claude-code";
      if (!out.dest) out.dest = HOST_DEFAULTS["claude-code"]();
    } else if (a === "--skill") {
      const raw = next();
      out.skillsFilter = out.skillsFilter || new Set();
      for (const part of raw.split(",")) {
        const id = part.trim();
        if (id) out.skillsFilter.add(id);
      }
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--locale") out.locale = next();
    else if (a === "--force" || a === "-f") out.force = true;
    else if (a === "--update" || a === "-u") {
      // npm run skills:update compatibility
      out.command = "update";
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (a.startsWith("-")) fail(`unknown option: ${a}`);
    else if (!out.source) out.source = a;
    else fail(`unexpected argument: ${a}`);
  }

  if (!["copy", "symlink"].includes(out.mode)) fail(`--mode must be copy|symlink`);
  if (!out.dest) {
    if (!HOST_DEFAULTS[out.host]) {
      fail(`unknown --host ${out.host}; pass --dest or use: ${Object.keys(HOST_DEFAULTS).join("|")}`);
    }
    out.dest = HOST_DEFAULTS[out.host]();
  }
  out.dest = path.resolve(out.dest.replace(/^~(?=\/|$)/, os.homedir()));
  // Resolve locale: --locale flag → topmind_LOCALE env → null (no overlay)
  if (!out.locale) {
    out.locale = process.env.topmind_LOCALE || null;
  }
  return out;
}

// ─── fs helpers ─────────────────────────────────────────────────────────────

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function isSkillsRoot(dir) {
  if (!(await pathExists(dir))) return false;
  const hasPack = await pathExists(path.join(dir, "topmind-pack.json"));
  const hasRouter = await pathExists(path.join(dir, "topmind", "SKILL.md"));
  if (hasPack && hasRouter) return true;
  // Accept a bare Agent-Skills layout (dirs with SKILL.md) without pack json
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    let n = 0;
    for (const e of entries) {
      if (e.isDirectory() && (await pathExists(path.join(dir, e.name, "SKILL.md")))) n++;
    }
    return n > 0;
  } catch {
    return false;
  }
}

async function resolveSkillsRoot(dir) {
  if (await isSkillsRoot(dir)) return dir;
  if (await isSkillsRoot(path.join(dir, "skills"))) return path.join(dir, "skills");
  return dir;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: opts.silent ? "pipe" : "inherit",
    env: { ...process.env, ...opts.env },
  });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").toString().slice(0, 500);
    fail(`${cmd} ${args.join(" ")} failed (${r.status}): ${err}`);
  }
  return r;
}

function githubHeaders() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
  const h = {
    Accept: "application/vnd.github+json",
    "User-Agent": "topmind-install-skills",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) fail(`GET ${url} → ${res.status} ${res.statusText} (private repo needs GH_TOKEN)`);
  return res.json();
}

async function downloadTo(url, destFile) {
  const res = await fetch(url, { headers: githubHeaders(), redirect: "follow" });
  if (!res.ok) fail(`download ${url} → ${res.status}`);
  await fs.mkdir(path.dirname(destFile), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destFile));
}

// ─── source resolution ──────────────────────────────────────────────────────

/**
 * Normalize user source string into a descriptor.
 * @returns {{ kind: 'local'|'git'|'release', value: string, ref?: string, label: string }}
 */
function parseSource(raw, repoPath) {
  if (!raw || raw === ".") {
    return { kind: "local", value: path.join(REPO_ROOT, "skills"), label: `local:${path.join(REPO_ROOT, "skills")}` };
  }

  // release:tag
  if (raw.startsWith("release:")) {
    return { kind: "release", value: raw.slice("release:".length) || "latest", label: raw };
  }

  // absolute / relative filesystem path
  if (
    raw.startsWith("/") ||
    raw.startsWith("./") ||
    raw.startsWith("../") ||
    raw.startsWith("~") ||
    raw === "skills"
  ) {
    const p = path.resolve(raw.replace(/^~(?=\/|$)/, os.homedir()));
    return { kind: "local", value: p, label: `local:${p}` };
  }

  // git URL
  if (/^(https?:\/\/|git@)/i.test(raw) || raw.endsWith(".git")) {
    return { kind: "git", value: raw, ref: "HEAD", path: repoPath, label: `git:${raw}` };
  }

  // owner/repo or owner/repo@ref  (skills-add style)
  const m = raw.match(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:@([A-Za-z0-9_./-]+))?$/);
  if (m) {
    const repo = m[1];
    const ref = m[2] || "HEAD";
    const url = `https://github.com/${repo}.git`;
    return { kind: "git", value: url, ref, path: repoPath, label: `github:${repo}${m[2] ? "@" + m[2] : ""}` };
  }

  fail(
    `unrecognized source "${raw}". Use owner/repo, git URL, local path, or release:<tag>.\n` +
      `  examples: topmindspace/topmind  ./skills  release:latest`,
  );
}

async function materializeFromGit(gitUrl, ref, subPath, workDir) {
  log(`clone ${gitUrl} (sparse: ${subPath || "."}${ref && ref !== "HEAD" ? ` @ ${ref}` : ""})`);
  await fs.mkdir(workDir, { recursive: true });
  const repoDir = path.join(workDir, "repo");
  if (await pathExists(repoDir)) await fs.rm(repoDir, { recursive: true, force: true });

  // depth-1 sparse clone; checkout ref if not default
  const cloneArgs = ["clone", "--filter=blob:none", "--sparse"];
  if (!ref || ref === "HEAD") cloneArgs.push("--depth", "1");
  cloneArgs.push(gitUrl, repoDir);
  run("git", cloneArgs);

  if (ref && ref !== "HEAD") {
    run("git", ["-C", repoDir, "fetch", "--depth", "1", "origin", ref]);
    run("git", ["-C", repoDir, "checkout", "FETCH_HEAD"]);
  }

  if (subPath && subPath !== ".") {
    run("git", ["-C", repoDir, "sparse-checkout", "set", subPath]);
  } else {
    run("git", ["-C", repoDir, "sparse-checkout", "set", "skills"]);
    // if skills/ missing, fall back to full tree discovery
    if (!(await pathExists(path.join(repoDir, "skills")))) {
      run("git", ["-C", repoDir, "sparse-checkout", "disable"]);
    }
  }

  const candidate = subPath && subPath !== "." ? path.join(repoDir, subPath) : path.join(repoDir, "skills");
  const root = await resolveSkillsRoot(await pathExists(candidate) ? candidate : repoDir);
  if (!(await isSkillsRoot(root))) {
    fail(`no skills pack found under ${candidate} (looked for topmind-pack.json or */SKILL.md)`);
  }
  return root;
}

async function materializeFromRelease(tag, workDir) {
  log(`fetch release assets (tag=${tag}) from ${DEFAULT_OWNER_REPO}`);
  let release;
  if (tag === "latest") {
    try {
      release = await fetchJson(`https://api.github.com/repos/${DEFAULT_OWNER_REPO}/releases/latest`);
    } catch {
      const list = await fetchJson(`https://api.github.com/repos/${DEFAULT_OWNER_REPO}/releases?per_page=10`);
      release = Array.isArray(list) ? list.find((r) => !r.draft) || list[0] : null;
    }
  } else {
    release = await fetchJson(`https://api.github.com/repos/${DEFAULT_OWNER_REPO}/releases/tags/${tag}`);
  }
  if (!release) fail("no GitHub release found — use owner/repo source or publish pack:skills");
  const assets = release.assets || [];
  const zip =
    assets.find((a) => /^topmind-skills-.*\.zip$/i.test(a.name)) ||
    assets.find((a) => /skills.*\.zip$/i.test(a.name));
  if (!zip) {
    fail(`release ${release.tag_name || tag} has no topmind-skills-*.zip — use owner/repo instead`);
  }
  const zipPath = path.join(workDir, zip.name);
  log(`download ${zip.name}`);
  await downloadTo(zip.browser_download_url, zipPath);
  const unpack = path.join(workDir, "unpack");
  await fs.mkdir(unpack, { recursive: true });
  const tar = spawnSync("tar", ["-xf", zipPath, "-C", unpack], { encoding: "utf8" });
  if (tar.status !== 0) run("unzip", ["-q", zipPath, "-d", unpack]);

  async function walk(dir, depth = 0) {
    if (depth > 4) return null;
    if (await isSkillsRoot(dir)) return resolveSkillsRoot(dir);
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const hit = await walk(path.join(dir, e.name), depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const root = await walk(unpack);
  if (!root) fail(`could not find skills pack root inside ${zip.name}`);
  return root;
}

async function materialize(sourceDesc, opts, workDir) {
  if (sourceDesc.kind === "local") {
    const root = await resolveSkillsRoot(sourceDesc.value);
    if (!(await isSkillsRoot(root))) fail(`not a skills pack: ${root}`);
    return root;
  }
  if (sourceDesc.kind === "git") {
    return materializeFromGit(sourceDesc.value, sourceDesc.ref || "HEAD", sourceDesc.path || opts.repoPath, workDir);
  }
  if (sourceDesc.kind === "release") {
    return materializeFromRelease(sourceDesc.value, workDir);
  }
  fail(`unknown source kind ${sourceDesc.kind}`);
}

// ─── install plan ───────────────────────────────────────────────────────────

async function listInstallEntries(skillsRoot, skillsFilter) {
  const packPath = path.join(skillsRoot, "topmind-pack.json");
  let version = "unknown";
  let name = "skills";
  let ids = [];

  if (await pathExists(packPath)) {
    const pack = JSON.parse(await fs.readFile(packPath, "utf8"));
    version = pack.version || version;
    name = pack.name || name;
    ids = (pack.skills || []).map((s) => s.id || s.path).filter(Boolean);
  } else {
    // bare Agent Skills layout
    const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && (await pathExists(path.join(skillsRoot, e.name, "SKILL.md")))) {
        ids.push(e.name);
      }
    }
  }

  if (skillsFilter && skillsFilter.size) {
    ids = ids.filter((id) => skillsFilter.has(id));
    if (!ids.length) fail(`--skill filter matched nothing. available: ${(await listInstallEntries(skillsRoot, null)).entries.filter((e) => !e.includes(".")).join(", ")}`);
  }

  const entries = new Set(ids);
  // Pack support files (needed for progressive disclosure)
  if (!skillsFilter) {
    for (const e of ["shared", "install-targets", "evals"]) {
      if (await pathExists(path.join(skillsRoot, e))) entries.add(e);
    }
    for (const f of ["topmind-pack.json", "skills.md", "LICENSE", "README.md", "INSTALL.md"]) {
      if (await pathExists(path.join(skillsRoot, f))) entries.add(f);
    }
  } else {
    // still bring shared/ when filtering — SKILL.md links to it
    if (await pathExists(path.join(skillsRoot, "shared"))) entries.add("shared");
    if (await pathExists(path.join(skillsRoot, "topmind-pack.json"))) entries.add("topmind-pack.json");
  }

  return { version, name, entries: [...entries], skillIds: ids };
}

async function applyLocaleOverlay(overlayDir, targetDir) {
  const entries = await fs.readdir(overlayDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(overlayDir, entry.name);
    const dstPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await fs.mkdir(dstPath, { recursive: true });
      await applyLocaleOverlay(srcPath, dstPath);
    } else {
      await fs.copyFile(srcPath, dstPath);
      log(`    ~ locale overlay: ${entry.name}`);
    }
  }
}

async function installCopy(skillsRoot, dest, entries, locale) {
  await fs.mkdir(dest, { recursive: true });
  for (const name of entries) {
    const src = path.join(skillsRoot, name);
    const dst = path.join(dest, name);
    if (!(await pathExists(src))) continue;
    const st = await fs.lstat(src);
    if (await pathExists(dst)) await fs.rm(dst, { recursive: true, force: true });
    if (st.isDirectory()) {
      await fs.cp(src, dst, { recursive: true });
      // Apply locale overlay if exists
      if (locale) {
        const overlayDir = path.join(src, "locales", locale);
        if (await pathExists(overlayDir)) {
          await applyLocaleOverlay(overlayDir, dst);
          log(`    locale: ${locale}`);
        }
        // Clean up locales/ directory from installed copy (not needed at runtime)
        const localesInstalledDir = path.join(dst, "locales");
        if (await pathExists(localesInstalledDir)) {
          await fs.rm(localesInstalledDir, { recursive: true, force: true });
        }
      }
    } else {
      await fs.copyFile(src, dst);
    }
    log(`  + ${name}`);
  }
}

async function installSymlink(skillsRoot, dest, entries, { force }) {
  await fs.mkdir(dest, { recursive: true });
  for (const name of entries) {
    const src = path.join(skillsRoot, name);
    const dst = path.join(dest, name);
    if (!(await pathExists(src))) continue;
    if (await pathExists(dst)) {
      const st = await fs.lstat(dst);
      if (st.isSymbolicLink() || force) await fs.rm(dst, { recursive: true, force: true });
      else fail(`${dst} exists and is not a symlink (pass --force)`);
    }
    await fs.symlink(src, dst, "junction");
    log(`  ~ ${name} → ${src}`);
  }
}

async function writeInstallReceipt(dest, meta) {
  const receipt = {
    schema: 1,
    package: meta.name || "topmind",
    version: meta.version,
    installed_at: new Date().toISOString(),
    source: meta.sourceLabel,
    source_raw: meta.sourceRaw,
    repo_path: meta.repoPath,
    mode: meta.mode,
    host: meta.host,
    skill_ids: meta.skillIds,
    locale: meta.locale || null,
    repository: `https://github.com/${DEFAULT_OWNER_REPO}`,
    // Enough to re-run update without remembering flags
    update: {
      command: "add",
      source: meta.sourceRaw,
      path: meta.repoPath,
      mode: meta.mode,
      host: meta.host,
    },
  };
  await fs.writeFile(path.join(dest, RECEIPT_NAME), JSON.stringify(receipt, null, 2) + "\n", "utf8");
}

async function readReceipt(dest) {
  const p = path.join(dest, RECEIPT_NAME);
  if (!(await pathExists(p))) return null;
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    return null;
  }
}

// ─── commands ───────────────────────────────────────────────────────────────

async function cmdAdd(opts, sourceOverride) {
  const sourceRaw = sourceOverride || opts.source || DEFAULT_OWNER_REPO;
  const sourceDesc = parseSource(sourceRaw, opts.repoPath);
  const dest = opts.dest;

  log(`add  source=${sourceDesc.label}`);
  log(`     path=${opts.repoPath}  mode=${opts.mode}  dest=${dest}`);

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-skills-"));
  try {
    const skillsRoot = await materialize(sourceDesc, opts, tmpRoot);
    const plan = await listInstallEntries(skillsRoot, opts.skillsFilter);
    log(`pack ${plan.name}@${plan.version} · ${plan.skillIds.length} skill(s) · ${plan.entries.length} entries`);

    if (opts.command === "list" || opts.dryRun) {
      for (const e of plan.entries) log(`  - ${e}`);
      log(opts.dryRun ? `(dry-run) would install → ${dest}` : `(list only)`);
      return;
    }

    if (opts.mode === "symlink") {
      if (sourceDesc.kind !== "local") {
        fail("symlink mode needs a durable local --source (git/release clones are temporary)");
      }
      await installSymlink(skillsRoot, dest, plan.entries, opts);
    } else {
      await installCopy(skillsRoot, dest, plan.entries, opts.locale);
    }

    await writeInstallReceipt(dest, {
      name: plan.name,
      version: plan.version,
      sourceLabel: sourceDesc.label,
      sourceRaw,
      repoPath: opts.repoPath,
      mode: opts.mode,
      host: opts.host,
      skillIds: plan.skillIds,
      locale: opts.locale,
    });

    log(`done → ${dest}`);
    log(`daily entry: ${path.join(dest, "topmind", "SKILL.md")}`);
    log(`update later: node scripts/install-skills.mjs update --dest ${dest}`);
    log(`community CLI (optional): npx skills add ${sourceRaw.includes("/") && !sourceRaw.includes("://") ? sourceRaw.split("@")[0] : DEFAULT_OWNER_REPO} -g -y`);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function cmdUpdate(opts) {
  const dest = opts.dest;
  const receipt = await readReceipt(dest);
  if (!receipt) {
    fail(
      `no ${RECEIPT_NAME} in ${dest}.\n` +
        `  First install: node scripts/install-skills.mjs add ${DEFAULT_OWNER_REPO} --dest ${dest}\n` +
        `  Or community:  npx skills update -g -y`,
    );
  }
  log(`update from receipt: ${receipt.source} @ ${receipt.version} → ${dest}`);
  const next = {
    ...opts,
    command: "add",
    source: receipt.source_raw || receipt.update?.source || DEFAULT_OWNER_REPO,
    repoPath: receipt.repo_path || receipt.update?.path || DEFAULT_PATH,
    mode: receipt.mode === "symlink" ? "symlink" : "copy",
    host: receipt.host || opts.host,
    locale: receipt.locale || opts.locale,
  };
  // symlink update only works if original local path still exists
  if (next.mode === "symlink") {
    const local = parseSource(next.source, next.repoPath);
    if (local.kind !== "local" || !(await pathExists(local.value))) {
      log("original symlink source gone — falling back to copy from default git source");
      next.mode = "copy";
      next.source = DEFAULT_OWNER_REPO;
    }
  }
  await cmdAdd(next, next.source);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.command === "list") {
    opts.dryRun = true;
    if (!opts.source) opts.source = DEFAULT_OWNER_REPO;
    await cmdAdd({ ...opts, command: "list" });
    return;
  }
  if (opts.command === "update") {
    await cmdUpdate(opts);
    return;
  }
  // add
  if (!opts.source) opts.source = DEFAULT_OWNER_REPO;
  await cmdAdd(opts);
}

main().catch((e) => {
  process.stderr.write(`[install-skills] ${e.stack || e}\n`);
  process.exit(1);
});
