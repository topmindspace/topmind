#!/usr/bin/env node
/**
 * Stage portable engine assets for electron-builder extraResources.
 *
 * Output: topmind-desktop/resources/topmind-engine/
 *   templates/  lib/  skills/  utr/  versions.json  README
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
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "..");
const outRoot = path.join(desktopRoot, "resources", "topmind-engine");

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

  // Version stamp for multi-surface update check
  let skillsVer = null;
  let extensionVer = null;
  let desktopVer = null;
  let utrVer = null;
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

  await fs.writeFile(
    path.join(outRoot, "versions.json"),
    `${JSON.stringify(
      {
        skills: skillsVer,
        extension: extensionVer,
        desktop: desktopVer,
        utr: utrVer,
        note: "Desktop bundles templates + lib + skills + utr. Extension is browser-only.",
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
      "Contains templates/, lib/, skills/, utr/, and versions.json.",
      "",
      "Product boundary:",
      "- Skills: **bundled** (AI skill-first + offline catalog)",
      "- UTR: **bundled** under utr/ for Tools console + doctor (CLI/MCP also use same tree in monorepo)",
      "- AI writeback / editor save: still WorkspaceService — not executeTool",
      "- Clip Extension: browser-only; version in versions.json only",
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
      `  skills + lib + utr copied (utr core: ${utrOk ? "ok" : "MISSING"})\n` +
      `  versions: desktop=${desktopVer} skills=${skillsVer} extension=${extensionVer} utr=${utrVer}\n`,
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
