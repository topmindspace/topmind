#!/usr/bin/env node
/**
 * topmind Skill Pack — Build & Pack (v4.3+)
 *
 * Reads `skills/topmind-pack.json` (single source of truth) and assembles
 * a portable distributable bundle under `dist/`.
 *
 * Outputs (per build) — surface prefix "skills" so users never confuse with Desktop:
 *   - dist/topmind-skills-<version>.tar.gz
 *   - dist/topmind-skills-<version>.zip
 *   - dist/topmind-skills-<version>-manifest.json
 *   - dist/topmind-skills-<version>.SHA256SUMS
 *
 * Bundle layout (top-level prefix is the bundle root):
 *
 *   topmind-skills-<version>/
 *   ├── SKILL.md                            (router entry — Agent Skills root convention)
 *   ├── skills.md · LICENSE · README.md · topmind-pack.json
 *   ├── topmind/SKILL.md + references/      (router — daily entry, full copy)
 *   ├── topmind-capture|organize|…/SKILL.md (actions + optional connectors)
 *   ├── topmind-loop/DESIGN.md + references/ (when present)
 *   ├── install-targets/*.json
 *   ├── evals/evals.json
 *   └── shared/*.md                         (degradation, receipts, disambiguation, …)
 *
 * Why root SKILL.md? Many hosts unzip a pack and look for `SKILL.md` at the
 * archive root (Agent Skills single-skill convention). topmind is multi-skill;
 * root SKILL.md is the **router** (same as topmind/SKILL.md) so zip-as-one-skill
 * loaders work. Full multi-skill install still uses subdirs + shared/.
 *
 * Excluded (dev-only): tests/
 *
 * Cross-platform: tar.gz uses `tar -czf` (GNU tar + bsdtar). zip tries `zip`
 * first, then falls back to `tar -a -cf` (bsdtar on Windows 10+/macOS) so the
 * build works on macOS / Linux / Windows without extra toolchain.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const skillsRoot = path.join(repoRoot, "skills");
const distRoot = path.join(repoRoot, "dist");

// ---- helpers --------------------------------------------------------------

function log(msg) {
  process.stdout.write(`[build-pack] ${msg}\n`);
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

function sha256File(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString("utf8")));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}\n${stderr}`));
    });
  });
}

/**
 * Like `run` but resolves to {ok} instead of rejecting. Used to probe
 * whether an external command exists before falling back to alternatives
 * (cross-platform: `zip` is absent on stock Windows, but `tar -a` works there).
 */
function tryRun(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString("utf8")));
    child.on("error", () => resolve({ ok: false, error: `ENOENT: ${cmd}` }));
    child.on("exit", (code) =>
      resolve({ ok: code === 0, error: code === 0 ? null : `${cmd} exited ${code}\n${stderr}` }),
    );
  });
}

// ---- pack.json loader -----------------------------------------------------

async function loadPack() {
  const raw = await fs.readFile(path.join(skillsRoot, "topmind-pack.json"), "utf8");
  return JSON.parse(raw);
}

// ---- file enumeration -----------------------------------------------------

/**
 * Walk `skills/` and return the relative paths to include in the bundle.
 *
 * Include:
 *   - skills/topmind-pack.json
 *   - skills/README.md
 *   - skills/LICENSE
 *   - skills/<skill>/SKILL.md
 *   - skills/<skill>/DESIGN.md  (only if present — topmind-loop has one)
 *   - skills/<skill>/references/ tree (all .md; progressive disclosure resources)
 *   - skills/install-targets/*.json
 *   - skills/evals/evals.json
 *   - skills/shared/*.md
 *
 * Exclude:
 *   - skills/tests/**
 *   - any dotfile
 */
async function collectBundleFiles() {
  const include = new Set();

  include.add("topmind-pack.json");
  include.add("README.md");
  include.add("LICENSE");
  include.add("INSTALL.md");
  // Package landing page (canonical lowercase — many agent platforms look for this)
  include.add("skills.md");

  for (const entry of await fs.readdir(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (["tests", "dist"].includes(entry.name)) continue;
    if (["install-targets", "evals", "shared"].includes(entry.name)) continue;

    const skillMd = path.join(skillsRoot, entry.name, "SKILL.md");
    if (await fileExists(skillMd)) include.add(path.join(entry.name, "SKILL.md"));
    const designMd = path.join(skillsRoot, entry.name, "DESIGN.md");
    if (await fileExists(designMd)) include.add(path.join(entry.name, "DESIGN.md"));
    // Progressive disclosure: skill-local references/
    const refsDir = path.join(skillsRoot, entry.name, "references");
    for (const rel of await listMarkdownFiles(refsDir, path.join(entry.name, "references"))) {
      include.add(rel);
    }
  }

  for (const f of await fs.readdir(path.join(skillsRoot, "install-targets"))) {
    if (f.endsWith(".json")) include.add(path.join("install-targets", f));
  }

  include.add(path.join("evals", "evals.json"));

  for (const f of await fs.readdir(path.join(skillsRoot, "shared"))) {
    if (f.endsWith(".md")) include.add(path.join("shared", f));
  }

  return [...include].sort();
}

/** Recursively list *.md under dir as paths relative to skillsRoot. */
async function listMarkdownFiles(absDir, relPrefix) {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const abs = path.join(absDir, e.name);
    const rel = path.join(relPrefix, e.name);
    if (e.isDirectory()) {
      out.push(...(await listMarkdownFiles(abs, rel)));
    } else if (e.isFile() && e.name.endsWith(".md")) {
      out.push(rel);
    }
  }
  return out;
}

async function fileExists(p) {
  try {
    const stat = await fs.stat(p);
    return stat.isFile();
  } catch {
    return false;
  }
}

// ---- staging --------------------------------------------------------------

/**
 * Copy the selected files into a staging directory with a top-level prefix
 * (`topmind-<version>/`). The system tar/zip will archive this directory
 * verbatim to get the bundle layout.
 *
 * mtime is normalized to epoch (1970-01-01) so the resulting tar archive
 * is byte-stable across rebuilds. zip includes file mtimes in its own
 * structure, so we set them on the staged files via utimes() too.
 */
async function stage(bundleRoot) {
  await ensureDir(bundleRoot);
  const files = await collectBundleFiles();
  const epoch = new Date(0);
  for (const rel of files) {
    const src = path.join(skillsRoot, rel);
    const dest = path.join(bundleRoot, rel);
    await ensureDir(path.dirname(dest));
    await fs.copyFile(src, dest);
    await fs.utimes(dest, epoch, epoch);
  }

  // Emit an uppercase `SKILLS.md` mirror at the bundle root, but only on
  // case-sensitive filesystems. On case-insensitive macOS / Windows the
  // lowercase `skills.md` and uppercase `SKILLS.md` are the same file —
  // creating both is impossible.
  try {
    const lower = path.join(bundleRoot, "skills.md");
    const upper = path.join(bundleRoot, "SKILLS.md");
    const lowerContent = await fs.readFile(lower, "utf8");
    // Probe: write a unique sentinel to `SKILLS.md`. If the FS is
    // case-insensitive, this overwrites `skills.md` too. We detect that by
    // reading `skills.md` and seeing whether it now contains the sentinel.
    const sentinel = `__probe_${Date.now()}__`;
    await fs.writeFile(upper, sentinel);
    const reread = await fs.readFile(lower, "utf8");
    if (reread.trim() === sentinel) {
      // Case-insensitive: cannot have both. Restore the canonical file.
      await fs.writeFile(lower, lowerContent);
      await fs.utimes(lower, epoch, epoch);
    } else {
      // Case-sensitive: write the real content as SKILLS.md.
      await fs.writeFile(upper, lowerContent);
      await fs.utimes(upper, epoch, epoch);
    }
  } catch {
    // Probe failed — bundle has lowercase only, which is the canonical form.
  }

  // Root SKILL.md = router (Agent Skills zip-root convention).
  // Many hosts fail with "SKILL.md not found" when loading multi-skill zips
  // that only nest topmind/SKILL.md. Stage router at pack root as the entry.
  const routerSrc = path.join(skillsRoot, "topmind", "SKILL.md");
  const rootSkill = path.join(bundleRoot, "SKILL.md");
  if (await fileExists(routerSrc)) {
    let body = await fs.readFile(routerSrc, "utf8");
    // Rewrite relative shared links: from topmind/ they are ../shared/;
    // from pack root they must be shared/. Skill-local references/ → topmind/references/.
    body = body.replace(/\(\.\.\/shared\//g, "(shared/");
    body = body.replace(/degradation:\s*\.\.\/shared\//g, "degradation: shared/");
    body = body.replace(/\((?:\.\.\/)?references\//g, "(topmind/references/");
    body = body.replace(/\]\((?:\.\.\/)?references\//g, "](topmind/references/");
    // Prefix a one-line note so hosts know this is a multi-skill pack entry.
    if (!body.includes("<!-- topmind-pack-root-entry -->")) {
      const note =
        "<!-- topmind-pack-root-entry -->\n" +
        "> **Pack root entry**: this `SKILL.md` is the topmind **router** " +
        "(same as `topmind/SKILL.md`). Multi-skill install: load sibling " +
        "`topmind-*/` dirs + `shared/`. See `skills.md` + `INSTALL.md`.\n\n";
      // Insert after frontmatter if present
      if (body.startsWith("---")) {
        const end = body.indexOf("\n---", 3);
        if (end !== -1) {
          const after = end + 4; // past \n---
          body = body.slice(0, after) + "\n" + note + body.slice(after).replace(/^\n*/, "");
        } else {
          body = note + body;
        }
      } else {
        body = note + body;
      }
    }
    await fs.writeFile(rootSkill, body);
    await fs.utimes(rootSkill, epoch, epoch);
    // Staged-only: not in skills/ source tree; archive includes it via bundleRoot walk.
    // Manifest file list stays source-based (collectBundleFiles); SKILL.md is pack-entry glue.
  }

  return files;
}

// ---- archive builders -----------------------------------------------------

async function writeTarGz(tarPath, bundleRoot) {
  // BSD tar on macOS, GNU tar on Linux: both support `tar -czf <out> -C <parent> <name>`.
  // Use the parent dir as cwd so the archive contains exactly the top-level dir.
  // Files have been mtime-normalized to epoch in stage(), so the archive is
  // byte-stable across rebuilds.
  const parent = path.dirname(bundleRoot);
  const name = path.basename(bundleRoot);
  await run("tar", ["-czf", tarPath, "-C", parent, name], parent);
}

async function writeZip(zipPath, bundleRoot) {
  // Cross-platform zip generation.
  //   1. `zip -r -q -X`  — works on macOS / Linux (where `zip` is commonly installed)
  //   2. `tar -a -cf`    — bsdtar auto-format fallback (ships with Windows 10+ and macOS;
  //                        the `-a` flag infers zip from the `.zip` extension)
  // GNU tar on Linux does not create zip archives, so strategy 1 is tried first there.
  const parent = path.dirname(bundleRoot);
  const name = path.basename(bundleRoot);

  const primary = await tryRun("zip", ["-r", "-q", "-X", zipPath, name], parent);
  if (primary.ok) return;

  const fallback = await tryRun("tar", ["-a", "-cf", zipPath, "-C", parent, name], parent);
  if (fallback.ok) return;

  throw new Error(
    `zip generation failed on this platform.\n` +
      `  tried: zip -r -q -X → ${primary.error}\n` +
      `  tried: tar -a -cf   → ${fallback.error}\n` +
      `Install \`zip\` or ensure bsdtar (Windows 10+/macOS) is available on PATH.`,
  );
}

// ---- manifest & checksums -------------------------------------------------

async function writeManifestAndSums(pack, tarPath, zipPath, files) {
  const fileEntries = [];
  for (const rel of files) {
    const data = await fs.readFile(path.join(skillsRoot, rel));
    fileEntries.push({
      path: rel,
      size: data.length,
      sha256: sha256File(data),
    });
  }

  const tarStat = await fs.stat(tarPath);
  const zipStat = await fs.stat(zipPath);
  const tarSha = sha256File(await fs.readFile(tarPath));
  const zipSha = sha256File(await fs.readFile(zipPath));

  const manifest = {
    schema_version: 1,
    name: pack.name,
    label: pack.label,
    version: pack.version,
    updated: pack.updated,
    daily_entry: pack.daily_entry,
    metadata: pack.metadata,
    skills: pack.skills.map((s) => ({ id: s.id, role: s.role, human_facing: s.human_facing })),
    entry_files: pack.entry_files,
    install_targets: pack.install_targets,
    archive: {
      tar_gz: {
        path: path.basename(tarPath),
        size: tarStat.size,
        sha256: tarSha,
      },
      zip: {
        path: path.basename(zipPath),
        size: zipStat.size,
        sha256: zipSha,
      },
    },
    files: fileEntries,
    total_size: fileEntries.reduce((acc, f) => acc + f.size, 0),
    built_at: new Date().toISOString(),
    built_by: "scripts/build-pack.mjs",
  };

  const manifestPath = path.join(distRoot, `topmind-skills-${pack.version}-manifest.json`);
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const sumsPath = path.join(distRoot, `topmind-skills-${pack.version}.SHA256SUMS`);
  const sumsText =
    `${tarSha}  ${path.basename(tarPath)}\n` +
    `${zipSha}  ${path.basename(zipPath)}\n`;
  await fs.writeFile(sumsPath, sumsText);

  return { manifestPath, sumsPath, manifest };
}

// ---- stale artifact cleanup -----------------------------------------------

/**
 * Remove skills-pack artifacts that belong to a different version (or the
 * legacy `topmind-<ver>.*` name without the "skills" surface prefix).
 * Never touch extension (`topmind-clip-extension-*`) or other surfaces.
 */
async function cleanStaleArtifacts(currentVersion) {
  const skillsPrefix = "topmind-skills-";
  const currentPrefix = `${skillsPrefix}${currentVersion}`;
  // Legacy ambiguous name (pre surface-prefix rename)
  const legacyRe = /^topmind-\d+\.\d+\.\d+/u;
  let cleaned = 0;

  try {
    const entries = await fs.readdir(distRoot);
    for (const entry of entries) {
      const isCurrentSkills = entry.startsWith(currentPrefix);
      const isOtherSkills =
        entry.startsWith(skillsPrefix) && !isCurrentSkills;
      const isLegacyAmbiguous =
        legacyRe.test(entry) && !entry.startsWith("topmind-clip-extension-");
      if (!isOtherSkills && !isLegacyAmbiguous) continue;
      if (isCurrentSkills) continue;
      await fs.rm(path.join(distRoot, entry), { force: true, recursive: true });
      cleaned += 1;
    }
  } catch {
    // dist/ might not exist yet — harmless
  }

  if (cleaned > 0) {
    log(`cleaned ${cleaned} stale skills artifact(s) from previous versions`);
  }
}

// ---- main -----------------------------------------------------------------

async function main() {
  const pack = await loadPack();
  const version = pack.version;
  // Surface-prefixed name: never "topmind-<ver>" alone (looks like the whole product)
  const bundleTop = `topmind-skills-${version}`;

  await ensureDir(distRoot);
  const stagingDir = path.join(distRoot, bundleTop);
  // Idempotent rebuild — clean current version artifacts
  await fs.rm(stagingDir, { recursive: true, force: true });
  for (const ext of [".tar.gz", ".zip", "-manifest.json", ".SHA256SUMS"]) {
    await fs.rm(path.join(distRoot, `${bundleTop}${ext}`), { force: true });
  }

  // Clean stale artifacts from previous versions to prevent accumulation
  await cleanStaleArtifacts(version);

  log(`version: ${version}`);
  log(`staging files into ${bundleTop}/ ...`);
  const files = await stage(stagingDir);

  const tarPath = path.join(distRoot, `${bundleTop}.tar.gz`);
  const zipPath = path.join(distRoot, `${bundleTop}.zip`);

  log(`writing tar.gz ...`);
  await writeTarGz(tarPath, stagingDir);
  log(`writing zip ...`);
  await writeZip(zipPath, stagingDir);

  log(`writing manifest + SHA256SUMS ...`);
  const { manifestPath, sumsPath, manifest } = await writeManifestAndSums(pack, tarPath, zipPath, files);

  // Clean up staging
  await fs.rm(stagingDir, { recursive: true, force: true });

  const tarStat = await fs.stat(tarPath);
  const zipStat = await fs.stat(zipPath);
  log(`done.`);
  log(`  ${path.basename(tarPath)}  (${tarStat.size} bytes)`);
  log(`  ${path.basename(zipPath)}  (${zipStat.size} bytes)`);
  log(`  ${path.basename(manifestPath)}  (${manifest.files.length} files, ${manifest.total_size} bytes uncompressed)`);
  log(`  ${path.basename(sumsPath)}`);
}

main().catch((err) => {
  process.stderr.write(`[build-pack] error: ${err.stack || err.message || err}\n`);
  process.exit(1);
});
