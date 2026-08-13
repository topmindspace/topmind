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
import { promises as fs, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

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
 * Ensure obsidian-plugin/dist/ exists **and matches source manifest version**.
 * A leftover dist/ from the previous stamp would otherwise ship a stale plugin
 * after a version bump (pack:verify version-parity-obsidian).
 * Installs obsidian-plugin deps first if node_modules is missing (CI pack-desktop job).
 * Returns true if dist is ready, false on failure.
 */
function ensureObsidianDist() {
  const distDir = path.join(repoRoot, "obsidian-plugin", "dist");
  const manifest = path.join(distDir, "manifest.json");
  const sourceManifest = path.join(repoRoot, "obsidian-plugin", "manifest.json");
  const sourceVer = readManifestVersion(sourceManifest);
  const distVer = existsSync(manifest) ? readManifestVersion(manifest) : "";
  if (existsSync(manifest) && sourceVer && distVer === sourceVer) return true;

  const obsidianPkgDir = path.join(repoRoot, "obsidian-plugin");

  // Install obsidian-plugin deps if missing (release.yml pack-desktop job only installs desktop deps)
  const obsidianNodeModules = path.join(obsidianPkgDir, "node_modules");
  if (!existsSync(obsidianNodeModules)) {
    process.stdout.write("[prepare-engine] obsidian-plugin/node_modules not found — installing deps...\n");
    const installResult = spawnSync("npm", ["ci"], {
      cwd: obsidianPkgDir,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (installResult.status !== 0) {
      process.stderr.write(
        "[prepare-engine] ERROR: obsidian-plugin npm ci failed — cannot build\n",
      );
      return false;
    }
  }

  const reason = !existsSync(manifest)
    ? "obsidian-plugin/dist not found"
    : `obsidian-plugin/dist v${distVer || "unknown"} != source v${sourceVer}`;
  process.stdout.write(`[prepare-engine] ${reason} — building...\n`);
  const result = spawnSync("npm", ["run", "build"], {
    cwd: obsidianPkgDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0 || !existsSync(manifest)) {
    process.stderr.write(
      "[prepare-engine] ERROR: obsidian-plugin build failed — 'Install to vault' will not work in packaged builds\n",
    );
    return false;
  }
  return true;
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
  // Skills pack: Desktop AI skill-first + update check (always stage)
  await copyDir(path.join(repoRoot, "skills"), path.join(outRoot, "skills"));
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

  // Obsidian plugin: copy pre-built dist/ (manifest.json + main.js + styles.css + templates/)
  // so Desktop "Install to vault" works in packaged builds (not just dev monorepo).
  // Build dist first if missing — this is a hard requirement for packaged builds.
  const obsidianSrc = path.join(repoRoot, "obsidian-plugin", "dist");
  const obsidianDest = path.join(outRoot, "obsidian-plugin");
  if (!ensureObsidianDist()) {
    process.exit(1);
  }
  await fs.mkdir(obsidianDest, { recursive: true });
  // Copy dist contents directly (not nested under dist/) — resolveObsidianPluginSource
  // checks {engineRoot}/obsidian-plugin/manifest.json
  const obsEntries = await fs.readdir(obsidianSrc, { withFileTypes: true });
  for (const entry of obsEntries) {
    if (entry.name.startsWith(".")) continue;
    const from = path.join(obsidianSrc, entry.name);
    const to = path.join(obsidianDest, entry.name);
    if (entry.isDirectory()) {
      await fs.cp(from, to, { recursive: true, force: true });
    } else {
      await fs.copyFile(from, to);
    }
  }
  // Verify the copy succeeded
  if (!existsSync(path.join(obsidianDest, "manifest.json"))) {
    process.stderr.write("[prepare-engine] ERROR: obsidian-plugin copy failed\n");
    process.exit(1);
  }
  process.stdout.write("[prepare-engine] obsidian-plugin staged successfully\n");

  // Version stamp for multi-surface update check
  let skillsVer = null;
  let extensionVer = null;
  let desktopVer = null;
  let utrVer = null;
  let obsidianVer = null;
  try {
    const pack = JSON.parse(
      await fs.readFile(path.join(repoRoot, "skills", "topmind-pack.json"), "utf8"),
    );
    skillsVer = pack.version || null;
  } catch {
    /* */
  }
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
  try {
    const obsMan = JSON.parse(
      await fs.readFile(path.join(repoRoot, "obsidian-plugin", "manifest.json"), "utf8"),
    );
    obsidianVer = obsMan.version || null;
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
        note: "Desktop bundles templates + lib + skills + utr + browser-extension + obsidian-plugin. All companions installable from local bundled source.",
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
      "Contains templates/, lib/, skills/, utr/, browser-extension/, obsidian-plugin/, and versions.json.",
      "",
      "Product boundary:",
      "- Skills: **bundled** (AI skill-first + offline catalog)",
      "- UTR: **bundled** under utr/ for Tools console + doctor (CLI/MCP also use same tree in monorepo)",
      "- Clip Extension: **bundled** under browser-extension/ for guided load-unpacked install",
      "- Obsidian Plugin: **bundled** under obsidian-plugin/ for vault install",
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
      `  skills + lib + utr + browser-extension + obsidian-plugin copied (utr core: ${utrOk ? "ok" : "MISSING"})\n` +
      `  versions: desktop=${desktopVer} skills=${skillsVer} extension=${extensionVer} utr=${utrVer} obsidian=${obsidianVer}\n`,
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
