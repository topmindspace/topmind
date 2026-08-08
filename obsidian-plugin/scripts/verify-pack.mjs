#!/usr/bin/env node
// ── Verify plugin package integrity ────────────────────────────────────────
//
// Checks: main.js exists, manifest.json valid, no monorepo ../../lib imports
// in the bundled output, templates present, KERNEL_API_VERSION embedded.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "..", "dist");

let errors = 0;

function check(label, ok, detail = "") {
  const status = ok ? "✓" : "✗";
  console.log(`  ${status} ${label}${detail ? " — " + detail : ""}`);
  if (!ok) errors++;
}

/** Proper semver comparison (returns -1, 0, or 1). */
function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

console.log("topmind Obsidian Plugin — pack:verify\n");

// ── main.js ──
check("dist/main.js exists", existsSync(path.join(distDir, "main.js")));

// ── manifest.json ──
const manifestPath = path.join(distDir, "manifest.json");
check("dist/manifest.json exists", existsSync(manifestPath));

if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  check("manifest.id is 'topmind-stream'", manifest.id === "topmind-stream");
  check("manifest.version is set", typeof manifest.version === "string" && manifest.version.length > 0);
  check("manifest.isDesktopOnly is true", manifest.isDesktopOnly === true);
  check(
    "manifest.minAppVersion >= 1.5.0",
    compareVersions(manifest.minAppVersion || "0.0.0", "1.5.0") >= 0,
    `got ${manifest.minAppVersion}`,
  );
}

// ── styles.css ──
check("dist/styles.css exists", existsSync(path.join(distDir, "styles.css")));

// ── templates ──
const templatesDir = path.join(distDir, "templates");
check("dist/templates/ exists", existsSync(templatesDir));
if (existsSync(templatesDir)) {
  const files = readdirSync(templatesDir).filter((f) => f.endsWith(".json"));
  check("templates has stream.json", files.includes("stream.json"));
  check("templates has balanced.json", files.includes("balanced.json"));
  check("templates count >= 4", files.length >= 4, `got ${files.length}`);
}

// ── No monorepo imports + no import.meta.url + no createRequire in main.js ──
const mainPath = path.join(distDir, "main.js");
if (existsSync(mainPath)) {
  const mainContent = readFileSync(mainPath, "utf-8");
  check("no ../../lib imports", !mainContent.includes("../../lib"), "bundled correctly");
  check("no import.meta.url", !mainContent.includes("import.meta.url"), "shimmed to CJS");
  check("no createRequire", !mainContent.includes("createRequire"), "shimmed to static imports");

  // Check that Kernel API is embedded
  check(
    "Kernel API embedded (createKernelContext)",
    mainContent.includes("createKernelContext") || mainContent.includes("KERNEL_API_VERSION"),
    "Kernel engine bundled",
  );
}

// ── Summary ──
if (errors > 0) {
  console.log(`\n✗ ${errors} error(s) found`);
  process.exit(1);
} else {
  console.log("\n✓ All checks passed");
}
