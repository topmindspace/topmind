#!/usr/bin/env node
/**
 * Cross-platform syntax check for all electron .mjs and preload.cjs files.
 * Replaces the Unix-only `find ... | while read` pipeline.
 */
import { readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");

function findFiles(dir, exts) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      results.push(...findFiles(fullPath, exts));
    } else if (exts.some((ext) => entry.name === ext || entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

const electronDir = join(desktopRoot, "electron");
const files = findFiles(electronDir, [".mjs", "preload.cjs"]);
let failed = false;
for (const file of files) {
  try {
    execFileSync("node", ["--check", file], { stdio: "pipe" });
  } catch (err) {
    console.error(`✗ Syntax error in ${file}`);
    console.error(err.stderr?.toString() || err.message);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(`✓ All ${files.length} electron files passed syntax check.`);
