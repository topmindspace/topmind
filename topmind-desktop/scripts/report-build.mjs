#!/usr/bin/env node
/**
 * Summarize topmind-desktop/dist asset sizes after vite build.
 * Fails if dist is missing or empty (so `npm run build:report` is a real gate).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(desktopRoot, "dist");
const assetsDir = path.join(distRoot, "assets");

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

async function collectFiles(dir, base = dir) {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(full, base)));
    } else if (entry.isFile()) {
      const st = await fs.stat(full);
      out.push({
        path: path.relative(base, full).split(path.sep).join("/"),
        size: st.size,
      });
    }
  }
  return out;
}

async function main() {
  try {
    await fs.access(path.join(distRoot, "index.html"));
  } catch {
    process.stderr.write("[report-build] dist/index.html missing — run `npm run build` first\n");
    process.exit(1);
  }

  const files = await collectFiles(distRoot);
  if (files.length === 0) {
    process.stderr.write("[report-build] dist is empty\n");
    process.exit(1);
  }

  files.sort((a, b) => b.size - a.size);
  const total = files.reduce((s, f) => s + f.size, 0);
  const js = files.filter((f) => f.path.endsWith(".js"));
  const css = files.filter((f) => f.path.endsWith(".css"));
  const jsTotal = js.reduce((s, f) => s + f.size, 0);
  const cssTotal = css.reduce((s, f) => s + f.size, 0);

  const lines = [
    "[report-build] topmind-desktop dist summary",
    `  files: ${files.length}  total: ${formatBytes(total)}`,
    `  js:    ${js.length} files · ${formatBytes(jsTotal)}`,
    `  css:   ${css.length} files · ${formatBytes(cssTotal)}`,
    "  top assets:",
  ];
  for (const f of files.slice(0, 12)) {
    lines.push(`    ${formatBytes(f.size).padStart(10)}  ${f.path}`);
  }

  // Soft budget signals (not hard fail — editor chunk is large by design)
  const tiptap = js.find((f) => f.path.includes("tiptap"));
  if (tiptap && tiptap.size > 600 * 1024) {
    lines.push(`  note: tiptap chunk ${formatBytes(tiptap.size)} is large; keep FileEditor lazy-loaded`);
  }

  process.stdout.write(`${lines.join("\n")}\n`);

  // Ensure assets dir exists for production electron load
  try {
    await fs.access(assetsDir);
  } catch {
    process.stderr.write("[report-build] dist/assets missing\n");
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`[report-build] ${err.stack || err.message || err}\n`);
  process.exit(1);
});
