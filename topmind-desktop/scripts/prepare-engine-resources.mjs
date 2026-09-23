#!/usr/bin/env node
/**
 * Stage portable engine assets for electron-builder extraResources.
 *
 * Output: topmind-desktop/resources/topmind-engine/
 *   templates/  lib/  skills/  utr/  browser-extension/  obsidian-plugin/  versions.json  README
 *
 * UTR is bundled so Desktop Tools console / doctor share the same contracts
 * and workspace path as monorepo CLI (extraResources = real files, not asar).
 *
 * Engine lib/ bare imports (e.g. `import { stringify } from "yaml"`) are
 * resolved at runtime via lib/yaml-bridge.mjs, which uses createRequire to
 * fall back to the asar's node_modules/ in packaged mode.  We do NOT stage
 * a local node_modules/ here because electron-builder strips node_modules/
 * from extraResources during packaging.
 */
import { promises as fs, existsSync, readFileSync, readdirSync, mkdirSync, copyFileSync, cpSync } from "node:fs";
import * as fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "..");
const outRoot = path.join(desktopRoot, "resources", "topmind-engine");

function readManifestVersion(file) {
  try {
    return String(JSON.parse(readFileSync(file, "utf8")).version || "");
  } catch {
    return "";
  }
}

/**
 * Optional sister-surface roots after the three-repo split.
 * Skills: topmind-skills (pack at root). Obsidian: topmind-obsidian (dist/ or buildable).
 * Resolution: TOPMIND_SKILLS_SRC / TOPMIND_OBSIDIAN_SRC → sibling → stub only.
 */
function resolveOptionalSource(envKey, siblingName) {
  const candidates = [
    process.env[envKey],
    // monorepo parent: {parent}/topmind-skills next to topmind/
    path.resolve(repoRoot, "..", siblingName),
    // solutions container: {parent}/topmind-solutions/topmind-skills
    path.resolve(repoRoot, "..", "..", siblingName),
    // CI sister checkout under workspace (.sister/*)
    path.resolve(repoRoot, ".sister", siblingName),
    path.resolve(repoRoot, siblingName),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (existsSync(dir) && existsSync(path.join(dir, "README.md"))) {
      // stubs only have README; real sources have more
      const entries = safeReaddir(dir);
      if (entries.length > 2) return dir;
    }
  }
  return null;
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Stage Obsidian plugin from sibling checkout if present.
 * Never hard-fails the Desktop pack: sister surfaces are optional.
 */
function stageObsidianFromSibling(obsidianDest) {
  const srcRoot = resolveOptionalSource("TOPMIND_OBSIDIAN_SRC", "topmind-obsidian");
  if (!srcRoot) {
    process.stdout.write("[prepare-engine] obsidian-plugin: no sibling checkout — skip (optional)\n");
    return null;
  }
  // Prefer built dist/ (has main.js). A source root with only manifest.json
  // would install an incomplete plugin that does nothing when enabled.
  const distDir = path.join(srcRoot, "dist");
  const manifest = path.join(distDir, "manifest.json");
  const mainJs = path.join(distDir, "main.js");
  if (!existsSync(manifest) || !existsSync(mainJs)) {
    process.stdout.write(
      `[prepare-engine] obsidian-plugin: ${srcRoot} has no dist/manifest.json+main.js — skip (optional; run npm run build in topmind-obsidian)\n`,
    );
    return null;
  }
  fsSync.mkdirSync(obsidianDest, { recursive: true });
  for (const entry of readdirSync(distDir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const from = path.join(distDir, entry.name);
    const to = path.join(obsidianDest, entry.name);
    if (entry.isDirectory()) fsSync.cpSync(from, to, { recursive: true, force: true });
    else fsSync.copyFileSync(from, to);
  }
  if (!existsSync(path.join(obsidianDest, "manifest.json"))) {
    process.stdout.write("[prepare-engine] obsidian-plugin: copy failed — skip (optional)\n");
    return null;
  }
  process.stdout.write("[prepare-engine] obsidian-plugin staged from sibling\n");
  return readManifestVersion(path.join(obsidianDest, "manifest.json")) || null;
}

/**
 * Stage Skills pack from sibling checkout if present.
 * Desktop skill-first + update check use it when available.
 */
function stageSkillsFromSibling(skillsDest) {
  const srcRoot = resolveOptionalSource("TOPMIND_SKILLS_SRC", "topmind-skills");
  if (!srcRoot) {
    process.stdout.write("[prepare-engine] skills: no sibling checkout — skip (optional)\n");
    return null;
  }
  // Pack-at-root layout (topmind-skills)
  const packPath = existsSync(path.join(srcRoot, "topmind-pack.json"))
    ? srcRoot
    : path.join(srcRoot, "skills");
  if (!existsSync(path.join(packPath, "topmind-pack.json"))) {
    process.stdout.write("[prepare-engine] skills: no topmind-pack.json — skip (optional)\n");
    return null;
  }
  fsSync.mkdirSync(skillsDest, { recursive: true });
  for (const entry of readdirSync(packPath, { withFileTypes: true })) {
    // Only stage the installable pack surface — skip repo tooling (bin/scripts/tests/…)
    // so packaged engine skills/ stays lean and matches install-skills entries.
    if (
      entry.name.startsWith(".") ||
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === "bin" ||
      entry.name === "scripts" ||
      entry.name === "tests" ||
      entry.name === "evals" ||
      entry.name === "integrations" ||
      entry.name === "install-targets" ||
      entry.name === "package.json" ||
      entry.name === "package-lock.json"
    ) {
      continue;
    }
    const from = path.join(packPath, entry.name);
    const to = path.join(skillsDest, entry.name);
    if (entry.isDirectory()) fsSync.cpSync(from, to, { recursive: true, force: true });
    else fsSync.copyFileSync(from, to);
  }
  process.stdout.write("[prepare-engine] skills staged from sibling\n");
  try {
    return JSON.parse(readFileSync(path.join(skillsDest, "topmind-pack.json"), "utf8")).version || null;
  } catch {
    return null;
  }
}

/** Skip dev / VCS / secrets when staging portable engine. */
const SKIP_NAMES = new Set([
  "node_modules",
  "tests",
  "dist",
  "coverage",
  ".git",
  ".github",
  ".env",
  ".env.local",
]);

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_NAMES.has(entry.name) || entry.name.startsWith(".")) continue;
    if (entry.name.endsWith(".map")) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(from, to);
    else await fs.copyFile(from, to);
  }
}

async function main() {
  await fs.rm(outRoot, { recursive: true, force: true });
  await fs.mkdir(outRoot, { recursive: true });

  await copyDir(path.join(repoRoot, "templates"), path.join(outRoot, "templates"));
  await copyDir(path.join(repoRoot, "lib"), path.join(outRoot, "lib"));
  // UTR substrate: Tools console + doctor + CLI parity (contracts/core/tools/bin/server)
  await copyDir(path.join(repoRoot, "utr"), path.join(outRoot, "utr"));

  // Clip extension: bundle browser-extension/ so Desktop "Install clip extension" works
  // in packaged builds (not just dev monorepo). resolveClipExtensionSource checks
  // {engineRoot}/browser-extension/manifest.json — staged here for offline install.
  const extSrc = path.join(repoRoot, "browser-extension");
  const extDest = path.join(outRoot, "browser-extension");
  await copyDir(extSrc, extDest);
  if (!existsSync(path.join(extDest, "manifest.json"))) {
    process.stderr.write("[prepare-engine] ERROR: browser-extension copy failed\n");
    process.exit(1);
  }
  process.stdout.write("[prepare-engine] browser-extension staged successfully\n");

  // Sister surfaces (skills / obsidian) live in separate repos after the split.
  // Optional: stage from sibling checkouts when present; never block Desktop pack.
  const skillsVer = stageSkillsFromSibling(path.join(outRoot, "skills"));
  const obsidianVer = stageObsidianFromSibling(path.join(outRoot, "obsidian-plugin"));

  // Version stamp for multi-surface update check
  let extensionVer = null;
  let desktopVer = null;
  let utrVer = null;
  try {
    const man = JSON.parse(
      await fs.readFile(path.join(repoRoot, "browser-extension", "manifest.json"), "utf8"),
    );
    extensionVer = man.version || null;
  } catch {
    /* */
  }
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(desktopRoot, "package.json"), "utf8"));
    desktopVer = pkg.version || null;
  } catch {
    /* */
  }
  try {
    utrVer = (await fs.readFile(path.join(repoRoot, "utr", "VERSION"), "utf8")).trim() || null;
  } catch {
    /* */
  }
  await fs.writeFile(
    path.join(outRoot, "versions.json"),
    `${JSON.stringify(
      {
        skills: skillsVer,
        extension: extensionVer,
        desktop: desktopVer,
        utr: utrVer,
        obsidian: obsidianVer,
        note: "Desktop bundles templates + lib + utr + browser-extension. Skills/Obsidian are optional sister surfaces (topmind-skills / topmind-obsidian) staged from sibling checkouts when present.",
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await fs.writeFile(
    path.join(outRoot, "README.md"),
    [
      "# topmind portable engine (bundled with Desktop)",
      "",
      "Contains templates/, lib/, utr/, browser-extension/, and versions.json.",
      "Optional: skills/ and obsidian-plugin/ when sibling checkouts of topmind-skills / topmind-obsidian are present.",
      "",
      "Product boundary:",
      "- Skills: optional sister repo **topmind-skills** (npx skills / pack-aware installer)",
      "- UTR: **bundled** under utr/ for Tools console + doctor",
      "- Clip Extension: **bundled** under browser-extension/ for guided load-unpacked install",
      "- Obsidian Plugin: optional sister repo **topmind-obsidian** (community plugin)",
      "- AI writeback / editor save: still WorkspaceService — not executeTool",
      "",
      "Subprocess node: utr/core/node-runtime.mjs (ELECTRON_RUN_AS_NODE when needed).",
      "",
    ].join("\n"),
    "utf8",
  );

  const templates = await fs.readdir(path.join(outRoot, "templates"));
  const utrOk = await fs
    .access(path.join(outRoot, "utr", "core", "tool-executor.mjs"))
    .then(() => true)
    .catch(() => false);
  process.stdout.write(
    `[prepare-engine] staged ${outRoot}\n` +
      `  templates: ${templates.filter((f) => f.endsWith(".json")).length}\n` +
      `  lib + utr + browser-extension copied (utr core: ${utrOk ? "ok" : "MISSING"})\n` +
      `  optional skills: ${skillsVer || "skipped"}  optional obsidian: ${obsidianVer || "skipped"}\n` +
      `  versions: desktop=${desktopVer} extension=${extensionVer} utr=${utrVer}\n`,
  );
  if (!utrOk) {
    process.stderr.write("[prepare-engine] ERROR: utr/core not staged\n");
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`[prepare-engine] ${err.stack || err.message || err}\n`);
  process.exit(1);
});
