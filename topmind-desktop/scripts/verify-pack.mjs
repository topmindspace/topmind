#!/usr/bin/env node
/**
 * Post-pack integrity gate for Desktop installers / unpacked dirs.
 *
 * Catches regressions that unit tests miss:
 * - missing topmind-engine templates (extraResources)
 * - broken monorepo-relative imports inside asar (main process won't load)
 * - missing zod / AI deps in asar
 * - missing dist/index.html or electron/main.mjs
 *
 * Usage:
 *   node scripts/verify-pack.mjs              # auto-discover under release/
 *   node scripts/verify-pack.mjs --dir path   # explicit unpacked app root
 *   node scripts/verify-pack.mjs --require-artifacts  # fail if no installer/dir found
 *
 * Exit 0 = OK, 1 = integrity failure, 2 = usage / nothing to verify (unless --require-artifacts)
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const releaseRoot = path.join(desktopRoot, "release");
const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const requireArtifacts = args.includes("--require-artifacts");
const dirIdx = args.indexOf("--dir");
const explicitDir = dirIdx >= 0 ? args[dirIdx + 1] : null;

const errors = [];
const warnings = [];
const report = { checks: [], artifacts: [] };

function ok(id, detail) {
  report.checks.push({ id, ok: true, detail });
}
function fail(id, detail) {
  report.checks.push({ id, ok: false, detail });
  errors.push(`${id}: ${detail}`);
}
function warn(id, detail) {
  report.checks.push({ id, ok: null, detail });
  warnings.push(`${id}: ${detail}`);
}

/** Walk release/ for asar paths and installer files. */
function discover() {
  const asars = [];
  const installers = [];
  const engines = [];

  function walk(dir, depth = 0) {
    if (depth > 8 || !existsSync(dir)) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "topmind-engine") engines.push(full);
        else if (e.name !== "node_modules") walk(full, depth + 1);
      } else if (e.isFile()) {
        if (e.name === "app.asar") asars.push(full);
        if (/\.(dmg|exe|AppImage|deb|zip|tar\.gz)$/i.test(e.name) && /topmind/i.test(e.name)) {
          installers.push(full);
        }
      }
    }
  }

  if (explicitDir) {
    const root = path.resolve(explicitDir);
    // Accept: …/topmind.app, …/win-unpacked, …/linux-unpacked, or Resources parent
    const candidates = [
      path.join(root, "Contents", "Resources", "app.asar"),
      path.join(root, "resources", "app.asar"),
      path.join(root, "app.asar"),
      root.endsWith("app.asar") ? root : null,
    ].filter(Boolean);
    for (const c of candidates) {
      if (existsSync(c)) asars.push(c);
    }
    const engCandidates = [
      path.join(root, "Contents", "Resources", "topmind-engine"),
      path.join(root, "resources", "topmind-engine"),
      path.join(path.dirname(candidates[0] || root), "topmind-engine"),
    ];
    for (const e of engCandidates) {
      if (existsSync(e)) engines.push(e);
    }
  } else if (existsSync(releaseRoot)) {
    walk(releaseRoot);
  }

  return { asars: [...new Set(asars)], installers: [...new Set(installers)], engines: [...new Set(engines)] };
}

function extractAsarList(asarPath) {
  // Prefer @electron/asar from electron-builder tree
  const tryBins = [
    () => {
      const asar = require("asar");
      return asar.listPackage(asarPath);
    },
    () => {
      const asar = require("@electron/asar");
      return asar.listPackage(asarPath);
    },
  ];
  for (const fn of tryBins) {
    try {
      const list = fn();
      if (Array.isArray(list)) return list.map((p) => String(p).replace(/\\/g, "/"));
    } catch {
      /* next */
    }
  }
  // CLI fallback
  const npx = spawnSync(
    "npx",
    ["--yes", "@electron/asar", "list", asarPath],
    { encoding: "utf8", cwd: desktopRoot, shell: process.platform === "win32", timeout: 60_000 },
  );
  if (npx.status === 0 && npx.stdout) {
    return npx.stdout
      .split("\n")
      .map((l) => l.trim().replace(/\\/g, "/"))
      .filter(Boolean);
  }
  return null;
}

function verifyAsar(asarPath) {
  const list = extractAsarList(asarPath);
  if (!list) {
    fail("asar-list", `cannot list ${asarPath}`);
    return;
  }
  const set = new Set(list.map((p) => (p.startsWith("/") ? p : `/${p}`)));
  const need = [
    "/package.json",
    "/electron/main.mjs",
    "/electron/preload.cjs",
    "/dist/index.html",
    "/node_modules/zod/package.json",
    "/node_modules/yaml/package.json",
    "/node_modules/ai/package.json",
    "/node_modules/chokidar/package.json",
  ];
  for (const n of need) {
    const hit = set.has(n) || list.some((p) => p.endsWith(n.replace(/^\//, "")) || p === n || p === n.slice(1));
    if (!hit) fail("asar-content", `missing ${n} in ${path.basename(path.dirname(asarPath))}/app.asar`);
    else ok("asar-content", n);
  }

  // Ban monorepo-relative imports that break packaging (historical Windows crash)
  let extractDir = null;
  try {
    extractDir = mkdtempSync(path.join(os.tmpdir(), "topmind-verify-asar-"));
    const extractors = [
      () => {
        const asar = require("@electron/asar");
        asar.extractAll(asarPath, extractDir);
      },
      () => {
        const asar = require("asar");
        asar.extractAll(asarPath, extractDir);
      },
    ];
    let extracted = false;
    for (const ex of extractors) {
      try {
        ex();
        extracted = true;
        break;
      } catch {
        /* try next */
      }
    }
    if (!extracted) {
      const r = spawnSync(
        "npx",
        ["--yes", "@electron/asar", "extract", asarPath, extractDir],
        { cwd: desktopRoot, shell: process.platform === "win32", timeout: 120_000 },
      );
      extracted = r.status === 0;
    }
    if (!extracted) {
      warn("asar-extract", "could not extract asar for import audit");
      return;
    }

    const banRe = /from\s+["'](?:\.\.\/)+lib\/|import\s*\(\s*["'](?:\.\.\/)+lib\//u;
    const electronDir = path.join(extractDir, "electron");
    function walkJs(dir, files = []) {
      if (!existsSync(dir)) return files;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walkJs(full, files);
        else if (/\.(mjs|cjs|js)$/u.test(e.name)) files.push(full);
      }
      return files;
    }
    for (const file of walkJs(electronDir)) {
      const text = readFileSync(file, "utf8");
      if (banRe.test(text)) {
        fail(
          "monorepo-import",
          `${path.relative(extractDir, file)} imports monorepo lib via relative path (breaks packaged asar)`,
        );
      }
    }
    ok("monorepo-import", "no ../../lib static imports in electron/");

    // package.json main/type sanity
    const pkg = JSON.parse(readFileSync(path.join(extractDir, "package.json"), "utf8"));
    if (pkg.main !== "electron/main.mjs") {
      fail("package-main", `expected main=electron/main.mjs got ${pkg.main}`);
    } else {
      ok("package-main", pkg.main);
    }
  } finally {
    if (extractDir) {
      try {
        rmSync(extractDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

function verifyEngine(enginePath) {
  const templates = path.join(enginePath, "templates");
  const libLoader = path.join(enginePath, "lib", "template-loader.mjs");
  if (!existsSync(templates)) {
    fail("engine-templates", `missing ${templates}`);
    return;
  }
  const jsons = readdirSync(templates).filter((f) => f.endsWith(".json"));
  if (jsons.length < 1) fail("engine-templates", "templates/ empty");
  else ok("engine-templates", `${jsons.length} templates`);

  if (!existsSync(libLoader)) {
    fail("engine-lib", `missing ${libLoader}`);
  } else {
    ok("engine-lib", "template-loader.mjs present");
  }
  const wmLib = path.join(enginePath, "lib", "workspace-model.mjs");
  if (!existsSync(wmLib)) {
    fail("engine-lib", `missing ${wmLib}`);
  } else {
    ok("engine-lib-workspace-model", "workspace-model.mjs present");
  }

  // stream is the default template — must ship
  if (!existsSync(path.join(templates, "stream.json"))) {
    fail("engine-default-template", "stream.json missing");
  } else {
    ok("engine-default-template", "stream.json");
  }

  // UTR bundled for Tools console + doctor
  const utrCore = path.join(enginePath, "utr", "core", "tool-executor.mjs");
  const utrContracts = path.join(enginePath, "utr", "contracts");
  if (!existsSync(utrCore) || !existsSync(utrContracts)) {
    fail("engine-utr", "missing topmind-engine/utr (core + contracts required)");
  } else {
    ok("engine-utr", "utr core + contracts present");
  }

  // Engine lib/ uses bare imports (e.g. "yaml") that are resolved at runtime
  // via lib/yaml-bridge.mjs — a createRequire-based bridge that falls back to
  // the asar's node_modules/ in packaged mode.  electron-builder strips
  // node_modules/ from extraResources, so the bridge is the only mechanism
  // that makes bare imports work from extraResources files.
  const yamlBridge = path.join(enginePath, "lib", "yaml-bridge.mjs");
  if (!existsSync(yamlBridge)) {
    fail(
      "engine-yaml-bridge",
      `missing ${yamlBridge} — engine lib/ bare imports (yaml) cannot resolve from extraResources without this bridge module`,
    );
  } else {
    ok("engine-yaml-bridge", "yaml-bridge.mjs present in engine lib/");
  }

  // Clip extension must be staged so "Install clip extension" works in packaged builds
  const clipManifest = path.join(enginePath, "browser-extension", "manifest.json");
  if (!existsSync(clipManifest)) {
    fail(
      "engine-clip-extension",
      `missing ${clipManifest} — 'Install clip extension' will fail in packaged builds (run pack:prepare to stage browser-extension)`,
    );
  } else {
    try {
      const man = JSON.parse(readFileSync(clipManifest, "utf8"));
      ok("engine-clip-extension", `browser-extension v${man.version || "?"}`);
    } catch {
      ok("engine-clip-extension", "browser-extension present");
    }
  }

  // Obsidian plugin must be staged so "Install to vault" works in packaged builds
  const obsidianManifest = path.join(enginePath, "obsidian-plugin", "manifest.json");
  const obsidianMain = path.join(enginePath, "obsidian-plugin", "main.js");
  if (!existsSync(obsidianManifest)) {
    fail(
      "engine-obsidian-plugin",
      `missing ${obsidianManifest} — 'Install to vault' will fail in packaged builds (run pack:prepare to stage obsidian-plugin)`,
    );
  } else if (!existsSync(obsidianMain)) {
    fail(
      "engine-obsidian-plugin",
      `missing ${obsidianMain} — obsidian-plugin incomplete (manifest.json present but main.js missing)`,
    );
  } else {
    try {
      const man = JSON.parse(readFileSync(obsidianManifest, "utf8"));
      ok("engine-obsidian-plugin", `obsidian-plugin v${man.version || "?"} (id: ${man.id || "?"})`);
    } catch {
      ok("engine-obsidian-plugin", "obsidian-plugin present");
    }
  }
}

function verifySourceGuards() {
  // Pre-pack source guard (always useful even without release/)
  const electronDir = path.join(desktopRoot, "electron");
  const banRe = /from\s+["'](?:\.\.\/)+lib\/|import\s*\(\s*["'](?:\.\.\/)+lib\//u;
  function walk(dir, files = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, files);
      else if (/\.(mjs|cjs)$/u.test(e.name)) files.push(full);
    }
    return files;
  }
  for (const file of walk(electronDir)) {
    const text = readFileSync(file, "utf8");
    if (banRe.test(text)) {
      fail("source-monorepo-import", path.relative(desktopRoot, file));
    }
  }
  if (!errors.some((e) => e.startsWith("source-monorepo-import"))) {
    ok("source-monorepo-import", "electron/ free of monorepo ../../lib imports");
  }

  // Staged engine for next pack
  const staged = path.join(desktopRoot, "resources", "topmind-engine");
  if (existsSync(staged)) {
    verifyEngine(staged);
    verifyBundledVersionParity(staged);
  } else {
    warn("staged-engine", "resources/topmind-engine not staged (run pack:prepare before pack)");
  }
}

/**
 * Verify that bundled engine resource versions match source truth files.
 * Catches stale bundled copies caused by forgetting `npm run pack:prepare`
 * after bumping a surface version (e.g. obsidian-plugin manifest.json).
 */
function verifyBundledVersionParity(enginePath) {
  const checks = [
    {
      id: "version-parity-obsidian",
      bundled: path.join(enginePath, "obsidian-plugin", "manifest.json"),
      source: path.join(desktopRoot, "..", "obsidian-plugin", "manifest.json"),
      key: "version",
      label: "obsidian-plugin",
    },
    {
      id: "version-parity-extension",
      bundled: path.join(enginePath, "browser-extension", "manifest.json"),
      source: path.join(desktopRoot, "..", "browser-extension", "manifest.json"),
      key: "version",
      label: "clip-extension",
    },
    {
      id: "version-parity-skills",
      bundled: path.join(enginePath, "skills", "topmind-pack.json"),
      source: path.join(desktopRoot, "..", "skills", "topmind-pack.json"),
      key: "version",
      label: "skills-pack",
    },
  ];
  for (const c of checks) {
    if (!existsSync(c.bundled) || !existsSync(c.source)) continue;
    try {
      const bMan = JSON.parse(readFileSync(c.bundled, "utf8"));
      const sMan = JSON.parse(readFileSync(c.source, "utf8"));
      const bVer = String(bMan[c.key] || "?");
      const sVer = String(sMan[c.key] || "?");
      if (bVer !== sVer) {
        fail(c.id, `${c.label} version drift: bundled=${bVer} source=${sVer} (run: npm run pack:prepare)`);
      } else {
        ok(c.id, `${c.label} v${sVer} (bundled = source)`);
      }
    } catch (e) {
      warn(c.id, `${c.label} version check skipped (${e.message})`);
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
verifySourceGuards();

const { asars, installers, engines } = discover();
report.artifacts = { asars, installers, engines };

if (asars.length === 0 && installers.length === 0 && !explicitDir) {
  if (requireArtifacts) {
    fail("artifacts", "no release/ asar or topmind installers found");
  } else {
    warn("artifacts", "no release artifacts — source guards only (ok for CI validate)");
  }
}

for (const asar of asars) {
  ok("asar-found", asar);
  verifyAsar(asar);
}
for (const eng of engines) {
  verifyEngine(eng);
}
if (installers.length) {
  for (const f of installers) {
    try {
      const st = statSync(f);
      const base = path.basename(f);
      // NSIS / DMG / AppImage ship the full app — must be large.
      // Unpacked topmind.exe is also large. Tiny files usually mean a corrupted
      // NSIS (e.g. rcedit was wrongly applied to the installer).
      const isNsisOrSetup =
        /\.exe$/i.test(base) && /win|setup|nsis/i.test(base) && !/^topmind\.exe$/i.test(base);
      const minBytes = isNsisOrSetup ? 5 * 1024 * 1024 : 100 * 1024;
      if (st.size < minBytes) {
        fail(
          "installer-size",
          `${f} suspiciously small (${st.size} bytes; min ${minBytes}` +
            (isNsisOrSetup ? " — NSIS may have been corrupted by rcedit" : "") +
            ")",
        );
      } else {
        ok("installer", `${base} ${Math.round(st.size / 1024 / 1024)}MB`);
      }
    } catch (e) {
      fail("installer", `${f}: ${e.message}`);
    }
  }
}

process.stdout.write(
  `${JSON.stringify({ ok: errors.length === 0, errors, warnings, report }, null, 2)}\n`,
);

if (errors.length > 0) {
  process.stderr.write(
    `[verify-pack] FAIL (${errors.length}):\n${errors.map((e) => `  - ${e}`).join("\n")}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `[verify-pack] OK — ${report.checks.filter((c) => c.ok).length} checks passed` +
    (warnings.length ? ` (${warnings.length} warnings)` : "") +
    "\n",
);
