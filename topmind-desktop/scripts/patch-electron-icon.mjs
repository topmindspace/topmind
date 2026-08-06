#!/usr/bin/env node
/**
 * Patch stock Electron.app branding for local `npm run dev`.
 *
 * Why: Dock icon on macOS comes from the *running .app bundle*
 * (node_modules/electron/dist/Electron.app), not from our project
 * build/icon.icns. `app.dock.setIcon()` is best-effort and often does
 * not replace the Dock tile while the process is already registered
 * as "Electron".
 *
 * This script (idempotent, safe across electron upgrades):
 *   1. Backs up electron.icns → electron.icns.topmind-original (once)
 *   2. Copies topmind build/icon.icns → Electron.app Resources/electron.icns
 *   3. Optionally sets CFBundleName / CFBundleDisplayName to topmind
 *
 * On Windows/Linux this is a no-op (BrowserWindow icon is enough).
 *
 * Usage:
 *   node scripts/patch-electron-icon.mjs
 *   node scripts/patch-electron-icon.mjs --restore
 */
import {
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
  utimesSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const require = createRequire(path.join(desktopRoot, "package.json"));

const restore = process.argv.includes("--restore");

function log(msg) {
  process.stdout.write(`[patch-electron-icon] ${msg}\n`);
}

function findElectronApp() {
  // electron package exports absolute path to the binary on require('electron')
  let electronBinary;
  try {
    electronBinary = require("electron");
  } catch {
    return null;
  }
  if (typeof electronBinary !== "string" || !electronBinary) return null;

  // .../Electron.app/Contents/MacOS/Electron  →  .../Electron.app
  if (process.platform === "darwin") {
    const macOs = path.dirname(electronBinary);
    const contents = path.dirname(macOs);
    const app = path.dirname(contents);
    if (app.endsWith(".app") && existsSync(app)) return app;
  }
  return null;
}

function patchPlist(plistPath, { name }) {
  // Minimal text edit of the generated Electron Info.plist (XML).
  // Avoids hard dependency on plist npm package.
  let text = readFileSync(plistPath, "utf8");
  const replacements = [
    [/<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>/u, `<key>CFBundleName</key>\n\t<string>${name}</string>`],
    [
      /<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/u,
      `<key>CFBundleDisplayName</key>\n\t<string>${name}</string>`,
    ],
  ];
  let changed = false;
  for (const [re, rep] of replacements) {
    if (re.test(text)) {
      text = text.replace(re, rep);
      changed = true;
    }
  }
  // Insert DisplayName if missing
  if (!/<key>CFBundleDisplayName<\/key>/u.test(text) && /<key>CFBundleName<\/key>/u.test(text)) {
    text = text.replace(
      /(<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>)/u,
      `$1\n\t<key>CFBundleDisplayName</key>\n\t<string>${name}</string>`,
    );
    changed = true;
  }
  if (changed) writeFileSync(plistPath, text, "utf8");
  return changed;
}

function main() {
  if (process.platform !== "darwin") {
    log("skip (not macOS)");
    return;
  }

  const electronApp = findElectronApp();
  if (!electronApp) {
    log("Electron.app not found — run npm ci in topmind-desktop first");
    process.exitCode = 1;
    return;
  }

  const resources = path.join(electronApp, "Contents", "Resources");
  const targetIcns = path.join(resources, "electron.icns");
  const backupIcns = path.join(resources, "electron.icns.topmind-original");
  const plistPath = path.join(electronApp, "Contents", "Info.plist");
  const ourIcns = path.join(desktopRoot, "build", "icon.icns");

  if (!existsSync(targetIcns)) {
    log(`missing stock icon: ${targetIcns}`);
    process.exitCode = 1;
    return;
  }

  if (restore) {
    if (existsSync(backupIcns)) {
      copyFileSync(backupIcns, targetIcns);
      log(`restored stock electron.icns from backup`);
    } else {
      log("no backup found — nothing to restore");
    }
    if (existsSync(plistPath)) {
      patchPlist(plistPath, { name: "Electron" });
      log("plist name restored toward Electron");
    }
    return;
  }

  if (!existsSync(ourIcns)) {
    log(`missing ${ourIcns} — run: npm run icons:generate`);
    process.exitCode = 1;
    return;
  }

  // One-time backup of the stock Electron icon (survives re-patch, wiped by npm ci)
  if (!existsSync(backupIcns)) {
    copyFileSync(targetIcns, backupIcns);
    log(`backed up stock icon → ${path.basename(backupIcns)}`);
  }

  const hash = (p) => {
    try {
      return createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 12);
    } catch {
      return "";
    }
  };
  const before = hash(targetIcns);
  const want = hash(ourIcns);
  copyFileSync(ourIcns, targetIcns);
  const after = hash(targetIcns);
  log(
    `patched Dock icon: ${ourIcns} → ${targetIcns} (sha ${before || "?"} → ${after || "?"}; src ${want})`,
  );
  if (after && want && after !== want) {
    log("WARN: copy hash mismatch — Dock may still show Electron default");
    process.exitCode = 1;
  }

  if (existsSync(plistPath)) {
    const ok = patchPlist(plistPath, { name: "topmind" });
    if (ok) log("patched CFBundleName/DisplayName → topmind");
    // Ensure CFBundleIconFile points at electron.icns (stock Electron already does)
    try {
      let text = readFileSync(plistPath, "utf8");
      if (!/<key>CFBundleIconFile<\/key>/u.test(text)) {
        text = text.replace(
          /(<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>)/u,
          `$1\n\t<key>CFBundleIconFile</key>\n\t<string>electron.icns</string>`,
        );
        writeFileSync(plistPath, text, "utf8");
        log("inserted CFBundleIconFile → electron.icns");
      }
    } catch {
      /* ignore */
    }
  }

  // Invalidate Finder/Dock icon cache for this bundle (mtime bump)
  try {
    const now = new Date();
    utimesSync(electronApp, now, now);
    utimesSync(targetIcns, now, now);
    if (existsSync(plistPath)) utimesSync(plistPath, now, now);
  } catch {
    /* ignore */
  }

  log("done — relaunch Electron (quit fully first) so Dock picks up topmind plate icon");
}

main();
