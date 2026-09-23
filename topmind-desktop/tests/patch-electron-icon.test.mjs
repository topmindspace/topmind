/**
 * Dev Dock branding: patch stock Electron.app icon (macOS).
 * Windows: unsigned pack keeps icon edit; never rcedit NSIS installers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("patch-electron-icon script exists and targets electron.icns", () => {
  const src = readFileSync(path.join(root, "scripts/patch-electron-icon.mjs"), "utf8");
  assert.match(src, /electron\.icns/);
  assert.match(src, /icon\.icns/);
  assert.match(src, /topmind-original/);
  assert.match(src, /CFBundleName/);
});

test("dev-electron patches icon before spawn on darwin", () => {
  const src = readFileSync(path.join(root, "scripts/dev-electron.mjs"), "utf8");
  assert.match(src, /patch-electron-icon/);
  assert.match(src, /darwin/);
});

test("main applies branding icon after ready and after window load", () => {
  const src = readFileSync(path.join(root, "electron/main.mjs"), "utf8");
  assert.match(src, /applyBrandingIcon/);
  assert.match(src, /applyWindowIcon/);
  assert.match(src, /app-icon/);
  const helper = readFileSync(path.join(root, "electron/lib/app-icon.mjs"), "utf8");
  assert.match(helper, /dock\.setIcon/);
  assert.match(helper, /win32/);
  assert.match(helper, /icon\.ico/);
});

test("branding masters exist for patch source", () => {
  assert.ok(existsSync(path.join(root, "build/icon.icns")), "build/icon.icns required");
  assert.ok(existsSync(path.join(root, "build/icon.png")), "build/icon.png required");
  assert.ok(existsSync(path.join(root, "build/icon-mac.png")), "build/icon-mac.png white plate required");
  assert.ok(existsSync(path.join(root, "build/icon.ico")), "build/icon.ico required for Windows");
  assert.ok(existsSync(path.join(root, "electron/assets/icon.png")), "asar runtime icon.png");
  assert.ok(existsSync(path.join(root, "electron/assets/icon-mac.png")), "asar runtime icon-mac.png for Dock");
  assert.ok(existsSync(path.join(root, "electron/assets/icon.ico")), "asar runtime icon.ico for Windows");
  // Full Retina icns should be substantially larger than a 5-slot stub (~250KB)
  const icnsBytes = readFileSync(path.join(root, "build/icon.icns")).byteLength;
  assert.ok(icnsBytes > 400_000, `icon.icns too small (${icnsBytes}); likely missing @2x layers`);
});

test("generate-icons builds mac iconset names with @2x (not email-mangled)", () => {
  const src = readFileSync(path.join(root, "scripts/generate-icons.py"), "utf8");
  assert.match(src, /_mac_iconset_entries/);
  assert.match(src, /@2x\.png/);
  assert.match(src, /format=\"PNG\"|format='PNG'/);
  // Regression: corrupted keys looked like diana.k@example.org
  assert.doesNotMatch(src, /diana\.k@example\.org|ivan\.p@example\.net|wendy\.h@example\.net/);
});

test("mac dock branding uses PNG plate only (never .icns for setIcon)", () => {
  const helper = readFileSync(path.join(root, "electron/lib/app-icon.mjs"), "utf8");
  assert.match(helper, /icon-mac\.png/);
  assert.match(helper, /forDock/);
  assert.match(helper, /MUST use a PNG plate/);
  // forDock candidates must not include .icns as first choice for setIcon
  assert.match(helper, /Never list \.icns when forDock|forDock.*icns|never load \.icns/i);
  assert.match(helper, /app\.dock\.setIcon\(/);
  assert.match(helper, /forDock && \/\\\.icns/);
});

test("patch-electron-icon verifies hash and touches bundle", () => {
  const src = readFileSync(path.join(root, "scripts/patch-electron-icon.mjs"), "utf8");
  assert.match(src, /createHash|sha256/);
  assert.match(src, /utimesSync/);
  assert.match(src, /CFBundleIconFile/);
});

test("win pack pipeline skips signing but keeps icon edit path", () => {
  const ci = readFileSync(path.join(root, "scripts/electron-builder-ci.mjs"), "utf8");
  // Actual CLI flag (not merely a comment)
  assert.match(ci, /-c\.win\.signExecutable=false/);
  assert.doesNotMatch(ci, /-c\.win\.signAndEditExecutable=false/);
  assert.match(ci, /patch-win-exe-icon/);

  const patch = readFileSync(path.join(root, "scripts/patch-win-exe-icon.mjs"), "utf8");
  // Product app binary only — never versioned NSIS topmind-*-win-*.exe
  assert.match(patch, /topmind\\.exe/);
  assert.match(patch, /win-unpacked|unpacked/);
  assert.match(patch, /corrupts the installer|NSIS/);
  assert.ok(existsSync(path.join(root, "scripts/patch-win-exe-icon.mjs")));
});
