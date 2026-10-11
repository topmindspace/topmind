#!/usr/bin/env node
/**
 * Embed build/icon.ico into the **unpacked app** topmind.exe after pack.
 *
 * Why: when signing is skipped, electron-builder may leave stock Electron icons
 * on the app executable. We rcedit --set-icon only (no signing).
 *
 * CRITICAL: only touch the product binary `topmind.exe` (usually under
 * release/win-unpacked/). Never rcedit the NSIS installer
 * `topmind-<ver>-win-x64.exe` — that corrupts the installer (~90KB garbage).
 *
 * Usage:
 *   node scripts/patch-win-exe-icon.mjs
 *   node scripts/patch-win-exe-icon.mjs /path/to/win-unpacked/topmind.exe
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");

function log(msg) {
  process.stdout.write(`[patch-win-exe-icon] ${msg}\n`);
}

function findRcedit() {
  const candidates = [
    path.join(desktopRoot, "node_modules", "electron-winstaller", "vendor", "rcedit.exe"),
    path.join(desktopRoot, "node_modules", "@electron", "rcedit", "bin", "rcedit.exe"),
    path.join(desktopRoot, "node_modules", "app-builder-bin", "win", "x64", "rcedit.exe"),
  ];
  // app-builder-lib may nest @electron/rcedit
  try {
    const nested = path.join(
      desktopRoot,
      "node_modules",
      "app-builder-lib",
      "node_modules",
      "@electron",
      "rcedit",
      "bin",
      "rcedit-x64.exe",
    );
    candidates.unshift(nested);
    candidates.unshift(
      path.join(
        desktopRoot,
        "node_modules",
        "app-builder-lib",
        "node_modules",
        "@electron",
        "rcedit",
        "bin",
        "rcedit.exe",
      ),
    );
  } catch {
    /* ignore */
  }
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Only the packaged app binary — never NSIS/setup installers.
 * Accept:  .../win-unpacked/topmind.exe  or explicit topmind.exe
 * Reject:  topmind-4.11.0-win-x64.exe, *uninstaller*, *Setup*
 */
function isProductAppExe(filePath) {
  const base = path.basename(filePath);
  if (!/^topmind\.exe$/i.test(base)) return false;
  if (/uninstall|setup/i.test(filePath)) return false;
  // Prefer unpacked output; still allow explicit path to topmind.exe
  const norm = filePath.replace(/\\/g, "/");
  if (/\/win-unpacked\//i.test(norm) || /\/unpacked\//i.test(norm)) return true;
  // Explicit CLI arg may point anywhere named topmind.exe
  return true;
}

async function findExes(explicit) {
  if (explicit) {
    const p = path.resolve(explicit);
    if (!isProductAppExe(p)) {
      log(`skip non-product exe: ${p}`);
      return [];
    }
    return [p];
  }
  const release = path.join(desktopRoot, "release");
  const out = [];
  async function walk(dir, depth = 0) {
    if (depth > 6) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git") continue;
        // Only descend into unpacked app trees (not arbitrary release junk)
        if (depth === 0 && !/unpacked/i.test(e.name) && e.name !== "win-unpacked") {
          // still walk win-unpacked and *unpacked*; also walk top-level dirs that might nest it
          if (!/win|ia32|x64|arm/i.test(e.name) && e.name !== "release") {
            // allow generic subdirs under release/
          }
        }
        await walk(full, depth + 1);
      } else if (e.isFile() && isProductAppExe(full)) {
        // Require unpacked parent to avoid accidental NSIS-adjacent names
        const parent = path.basename(path.dirname(full));
        if (/unpacked/i.test(parent) || /unpacked/i.test(full)) {
          out.push(full);
        }
      }
    }
  }
  await walk(release);
  return out;
}

async function main() {
  if (process.platform !== "win32" && process.env.topmind_FORCE_WIN_ICON_PATCH !== "1") {
    log(`skip (host=${process.platform}; set topmind_FORCE_WIN_ICON_PATCH=1 to force)`);
    return;
  }

  const ico =
    [
      path.join(desktopRoot, "build", "icon.ico"),
      path.join(desktopRoot, "electron", "assets", "icon.ico"),
    ].find((p) => existsSync(p)) || null;

  if (!ico) {
    log("ERROR: no build/icon.ico — run npm run icons:generate first");
    process.exit(1);
  }

  const rcedit = findRcedit();
  if (!rcedit) {
    log("ERROR: rcedit.exe not found under node_modules (install electron-builder deps)");
    process.exit(1);
  }

  const exes = await findExes(process.argv[2]);
  if (!exes.length) {
    log("no topmind*.exe under release/ — nothing to patch");
    return;
  }

  let failed = 0;
  for (const exe of exes) {
    log(`rcedit --set-icon → ${path.relative(desktopRoot, exe)}`);
    const r = spawnSync(rcedit, [exe, "--set-icon", ico], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (r.status !== 0) {
      failed += 1;
      process.stderr.write(
        `[patch-win-exe-icon] failed ${exe}: ${(r.stderr || r.stdout || "").slice(0, 400)}\n`,
      );
    } else {
      log(`ok ${path.basename(exe)}`);
    }
  }
  if (failed) process.exit(1);
}

main().catch((e) => {
  process.stderr.write(`[patch-win-exe-icon] ${e.stack || e}\n`);
  process.exit(1);
});
