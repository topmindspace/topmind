// ── esbuild config for topmind Obsidian Plugin ───────────────────────────
//
// Bundles src/main.ts + Kernel lib/*.mjs into a single main.js that Obsidian
// loads as a CommonJS module.
//
// Key decisions:
// 1. platform: 'node' — keeps node:fs, node:path, node:crypto as external
//    require() calls (works in Obsidian's Electron renderer).
// 2. obsidian + electron marked external — provided by Obsidian runtime.
// 3. yaml-bridge-shim plugin — replaces lib/yaml-bridge.mjs (which uses
//    dynamic createRequire) with a static import version that esbuild can
//    bundle.
// 4. Templates are copied as separate files alongside main.js — the plugin
//    directory acts as engineRoot for template-loader.mjs.

import esbuild from "esbuild";
import { existsSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isWatch = process.argv.includes("--watch");

const root = path.resolve(__dirname);
const repoRoot = path.resolve(__dirname, "..");
const libDir = path.join(repoRoot, "lib");
const templatesDir = path.join(repoRoot, "templates");
const outDir = path.join(root, "dist");

// ── esbuild plugin: Kernel shims for bundled CJS ──────────────────────────
// The Kernel .mjs files use dynamic createRequire(import.meta.url) to load
// modules lazily. In a bundled CJS context, import.meta.url is empty and
// the dynamically-required modules are already inlined. These shims replace
// those dynamic patterns with static imports that esbuild can resolve.

const kernelShims = {
  name: "kernel-shims",
  setup(build) {
    // ── Shim 1: yaml-bridge.mjs → static import ──
    build.onResolve({ filter: /yaml-bridge\.mjs$/ }, (args) => {
      if (args.path.includes("yaml-bridge")) {
        return { path: "yaml-bridge-shim", namespace: "kernel-shim" };
      }
    });

    // ── Shim 2: contract-engine.mjs → remove createRequire + fix dynamic require ──
    // contract-engine.mjs uses createRequire to require("./workspace-model.mjs").
    // In the bundle, workspace-model is already imported via kernel-api.mjs.
    // We intercept the file, remove the createRequire line, and add a static import.
    build.onLoad({ filter: /contract-engine\.mjs$/, namespace: "file" }, async (args) => {
      const fs = await import("node:fs");
      let contents = fs.readFileSync(args.path, "utf-8");

      // Only transform if it contains createRequire pattern
      if (contents.includes("createRequire(import.meta.url)")) {
        // Remove the createRequire import and variable
        contents = contents.replace(
          /import\s*\{\s*createRequire\s*\}\s*from\s*["']node:module["'];?\n/u,
          "",
        );
        contents = contents.replace(
          /const\s+require\s*=\s*createRequire\(import\.meta\.url\);?\n/u,
          "",
        );
        // Remove the dynamic require line (will add static import at top)
        contents = contents.replace(
          /const\s*\{\s*resolveWorkspaceModel\s*\}\s*=\s*require\(["']\.\/workspace-model\.mjs["']\);?\n/u,
          "",
        );
        // Add static import at the top, after the last existing import
        const lines = contents.split("\n");
        let lastImportIdx = 0;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].match(/^import\s/u)) lastImportIdx = i;
        }
        lines.splice(lastImportIdx + 1, 0, 'import { resolveWorkspaceModel } from "./workspace-model.mjs";');
        contents = lines.join("\n");
      }

      return { contents, loader: "js", resolveDir: path.dirname(args.path) };
    });

    // ── Shim 3: yaml-bridge shim content ──
    build.onLoad({ filter: /^yaml-bridge-shim$/, namespace: "kernel-shim" }, () => ({
      contents: `
        // Shim: replaces lib/yaml-bridge.mjs for bundled Obsidian plugin.
        // Uses static import so esbuild can bundle the 'yaml' package.
        import { parse, stringify } from "yaml";
        export { parse, stringify };
        export default { parse, stringify };
      `,
      loader: "js",
      resolveDir: root,
    }));

    // ── Shim 4: Replace import.meta.url in all remaining .mjs files ──
    // For CJS output, import.meta.url is not available. Replace it with
    // a runtime expression that resolves to the current file URL.
    build.onLoad({ filter: /\.mjs$/, namespace: "file" }, async (args) => {
      const fs = await import("node:fs");
      let contents = fs.readFileSync(args.path, "utf-8");

      // Skip if no import.meta.url usage
      if (!contents.includes("import.meta.url")) {
        return { contents, loader: "js", resolveDir: path.dirname(args.path) };
      }

      // Replace import.meta.url with a CJS-compatible equivalent
      // __filename is available in CJS context
      contents = contents.replace(
        /import\.meta\.url/gu,
        'require("url").pathToFileURL(__filename).href',
      );

      return { contents, loader: "js", resolveDir: path.dirname(args.path) };
    });
  },
};

// ── Copy templates to dist ────────────────────────────────────────────────
function copyTemplates() {
  const destTemplatesDir = path.join(outDir, "templates");
  if (!existsSync(destTemplatesDir)) mkdirSync(destTemplatesDir, { recursive: true });
  if (existsSync(templatesDir)) {
    for (const file of readdirSync(templatesDir)) {
      if (file.endsWith(".json")) {
        copyFileSync(path.join(templatesDir, file), path.join(destTemplatesDir, file));
      }
    }
  }
}

// ── Build config ──────────────────────────────────────────────────────────
const buildOptions = {
  entryPoints: [path.join(root, "src", "main.ts")],
  bundle: true,
  outfile: path.join(outDir, "main.js"),
  format: "cjs",
  platform: "node",
  target: "es2022",
  sourcemap: isWatch ? "inline" : false,
  minify: !isWatch,
  treeShaking: true,
  banner: {
    js: "// topmind Obsidian Plugin — bundled by esbuild\n// DO NOT EDIT — edit src/ and run npm run build",
  },
  legalComments: "none",
  external: [
    "obsidian",
    "electron",
    "@electron/remote",
  ],
  // node:fs, node:path, node:crypto, node:module are kept as require() calls
  // by platform: 'node' — they work in Obsidian's Electron renderer.
  plugins: [kernelShims],
  loader: {
    ".json": "json",
  },
  logLevel: "info",
};

async function main() {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  // Copy manifest.json and styles.css to dist
  copyFileSync(path.join(root, "manifest.json"), path.join(outDir, "manifest.json"));
  if (existsSync(path.join(root, "styles.css"))) {
    copyFileSync(path.join(root, "styles.css"), path.join(outDir, "styles.css"));
  }

  // Copy templates
  copyTemplates();

  if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log("[topmind-obsidian] watching for changes...");
  } else {
    await esbuild.build(buildOptions);
    console.log("[topmind-obsidian] build complete → dist/main.js");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
