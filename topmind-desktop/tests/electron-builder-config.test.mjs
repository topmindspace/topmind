/**
 * Guard electron-builder.yml against schema drift (e.g. linux.desktop shape in v26).
 * Failures here reproduce GitHub Release pack matrix crashes early.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ymlPath = path.join(root, "electron-builder.yml");

function loadYaml(text) {
  // Prefer js-yaml from electron-builder tree (already installed as transitive dep)
  const candidates = [
    "js-yaml",
    "app-builder-lib/node_modules/js-yaml",
    "electron-builder/node_modules/js-yaml",
  ];
  for (const id of candidates) {
    try {
      const yaml = require(id);
      return yaml.load(text);
    } catch {
      /* try next */
    }
  }
  throw new Error("js-yaml not found; install electron-builder first");
}

test("electron-builder.yml exists and loads", () => {
  assert.ok(existsSync(ymlPath), "electron-builder.yml missing");
  const cfg = loadYaml(readFileSync(ymlPath, "utf8"));
  assert.equal(typeof cfg, "object");
  assert.equal(cfg.productName, "topmind");
  assert.ok(cfg.linux, "linux section required");
  assert.ok(Array.isArray(cfg.linux.target) || typeof cfg.linux.target === "string");
});

test("electron-builder.yml matches app-builder-lib scheme (linux.desktop entry shape)", async () => {
  const schemePath = path.join(root, "node_modules/app-builder-lib/scheme.json");
  if (!existsSync(schemePath)) {
    // Fresh clone without npm ci — skip rather than false-fail local smoke
    return;
  }
  const scheme = require(schemePath);
  const { validateSchema } = require(
    path.join(root, "node_modules/app-builder-lib/out/util/config/schemaValidator.js"),
  );
  const cfg = loadYaml(readFileSync(ymlPath, "utf8"));
  await validateSchema(scheme, cfg, "configuration");

  // Explicit contract for v26 LinuxDesktopFile
  if (cfg.linux.desktop != null) {
    assert.equal(typeof cfg.linux.desktop, "object");
    assert.ok(
      cfg.linux.desktop.entry || cfg.linux.desktop.desktopActions,
      "linux.desktop must use entry/desktopActions (not flat Name/Comment keys)",
    );
    assert.equal(
      cfg.linux.desktop.Name,
      undefined,
      "flat desktop.Name is invalid under electron-builder 26",
    );
  }
});

test("linux targets include portable and installable formats", () => {
  const cfg = loadYaml(readFileSync(ymlPath, "utf8"));
  const targets = (Array.isArray(cfg.linux.target) ? cfg.linux.target : [cfg.linux.target]).map(
    (t) => (typeof t === "string" ? t : t?.target),
  );
  assert.ok(targets.includes("AppImage"), "AppImage required");
  assert.ok(targets.includes("deb"), "deb required");
  assert.ok(targets.includes("tar.gz"), "tar.gz required for no-FUSE installs");
  assert.match(String(cfg.artifactName || ""), /\$\{arch\}/, "artifactName should include arch");
  assert.match(
    String(cfg.artifactName || ""),
    /\$\{productName\}-\$\{version\}-\$\{os\}-\$\{arch\}/,
    "artifactName must be topmind-<ver>-<os>-<arch>.<ext>",
  );
});

test("windows NSIS is the only win target (clear single installer)", () => {
  const cfg = loadYaml(readFileSync(ymlPath, "utf8"));
  const targets = (Array.isArray(cfg.win?.target) ? cfg.win.target : [cfg.win?.target]).map(
    (t) => (typeof t === "string" ? t : t?.target),
  );
  assert.deepEqual(targets, ["nsis"]);
});

test("app icons exist for mac / win / linux packaging", () => {
  const buildDir = path.join(root, "build");
  for (const rel of ["icon.png", "icon.ico", "icon.icns", "icon-mac.png", "icons/512x512.png", "icon-win.png"]) {
    assert.ok(existsSync(path.join(buildDir, rel)), `missing build/${rel} — run npm run icons:generate`);
  }
  assert.ok(
    existsSync(path.join(root, "electron/assets/icon.png")),
    "missing electron/assets/icon.png (BrowserWindow runtime icon)",
  );
  assert.ok(
    existsSync(path.join(root, "electron/assets/icon-mac.png")),
    "missing electron/assets/icon-mac.png (macOS Dock plate runtime)",
  );
  assert.ok(
    existsSync(path.join(root, "electron/assets/icon.ico")),
    "missing electron/assets/icon.ico (Windows runtime multi-size ICO)",
  );
  const cfg = loadYaml(readFileSync(ymlPath, "utf8"));
  assert.equal(cfg.mac?.icon, "icon.icns");
  assert.equal(cfg.win?.icon, "icon.ico");
  assert.equal(cfg.linux?.icon, "icons");
});
