#!/usr/bin/env node
/**
 * Build a private, relocatable UTR + Kernel runtime directory.
 *
 * This is a versioned runtime snapshot for an eventual host adapter, not a DSH
 * bundle or a second Kernel. Release builds require a checked-out Git ref and
 * a clean tree. Release copies tracked source only and installs yaml from the
 * pinned lock archive with npm ci. --allow-dirty copies the local installation
 * only for smoke tests; its dependency bytes are not lock-verified.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDirs = [
  "lib",
  "templates",
  "utr/bin",
  "utr/contracts",
  "utr/core",
  "utr/server",
  "utr/tools",
];
const runtimeFiles = ["utr/VERSION"];
const requiredDirs = ["skills"];
const nodeBuiltins = new Set(builtinModules.map((name) => name.replace(/^node:/u, "")));
const importSpecifier = /\b(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)["']([^"']+)["']/gu;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function git(...args) {
  return execFileSync("git", ["-c", "core.fsmonitor=false", ...args], {
    cwd: sourceRoot,
    encoding: "utf8",
  }).trim();
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function copyTree(source, destination, trackedFiles = null) {
  await fs.mkdir(destination, { recursive: true });
  const entries = (await fs.readdir(source, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name.endsWith(".map")) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    const relative = path.relative(sourceRoot, from).split(path.sep).join("/");
    if (trackedFiles && !trackedFiles.has(relative) && ![...trackedFiles].some((file) => file.startsWith(`${relative}/`))) continue;
    if (entry.isSymbolicLink()) throw new Error(`Snapshot source contains a symlink: ${from}`);
    if (entry.isDirectory()) await copyTree(from, to, trackedFiles);
    else if (entry.isFile()) await fs.copyFile(from, to);
    else throw new Error(`Unsupported snapshot source entry: ${from}`);
  }
}

async function canonicalizePotentialPath(candidate) {
  const missing = [];
  let current = path.resolve(candidate);
  while (true) {
    try {
      return path.resolve(await fs.realpath(current), ...missing.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      missing.push(path.basename(current));
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

async function listFiles(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Snapshot contains a symlink: ${absolute}`);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        const relativePath = path.relative(root, absolute).split(path.sep).join("/");
        if (relativePath !== "runtime-manifest.json") {
          const bytes = await fs.readFile(absolute);
          files.push({ path: relativePath, size: bytes.length, sha256: sha256(bytes) });
        }
      } else throw new Error(`Unsupported snapshot entry: ${absolute}`);
    }
  }
  await walk(root);
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

async function checkImportClosure(root) {
  const files = await listFiles(root);
  for (const file of files) {
    if (!file.path.startsWith("lib/") && !file.path.startsWith("utr/")) continue;
    if (!/\.(?:mjs|cjs|js)$/u.test(file.path)) continue;
    const absolute = path.join(root, file.path);
    const source = await fs.readFile(absolute, "utf8");
    for (const match of source.matchAll(importSpecifier)) {
      const specifier = match[1];
      if (specifier === "yaml" || nodeBuiltins.has(specifier.replace(/^node:/u, ""))) continue;
      if (!specifier.startsWith(".")) {
        throw new Error(`Unpackaged runtime dependency ${specifier} in ${file.path}`);
      }
      const resolved = path.resolve(path.dirname(absolute), specifier);
      if (!isInside(root, resolved)) throw new Error(`Runtime import escapes snapshot: ${file.path} -> ${specifier}`);
      try {
        await fs.access(resolved);
      } catch {
        throw new Error(`Runtime import missing from snapshot: ${file.path} -> ${specifier}`);
      }
    }
  }
}

async function dependencyFacts({ allowDirty }) {
  const lock = JSON.parse(await fs.readFile(path.join(sourceRoot, "package-lock.json"), "utf8"));
  const locked = lock.packages?.["node_modules/yaml"];
  if (!locked?.version || !locked.integrity || !locked.resolved) {
    throw new Error("package-lock.json must pin yaml version, resolved archive, and integrity");
  }
  if (Object.keys(locked.dependencies || {}).length > 0) {
    throw new Error("yaml gained transitive dependencies; update the runtime closure before packing");
  }
  if (allowDirty) {
    const installed = JSON.parse(await fs.readFile(path.join(sourceRoot, "node_modules", "yaml", "package.json"), "utf8"));
    if (installed.version !== locked.version || Object.keys(installed.dependencies || {}).length > 0) {
      throw new Error("Local yaml installation does not match the locked runtime dependency");
    }
  }
  return { yaml: { version: locked.version, lockIntegrity: locked.integrity, installMode: allowDirty ? "local-installed" : "npm-ci-locked", lockEntry: locked } };
}

async function installLockedDependency(stage, utrVersion, dependencies) {
  const packageName = "topmind-utr-runtime-snapshot";
  const packageJson = { name: packageName, version: utrVersion, private: true, type: "module", dependencies: { yaml: dependencies.yaml.version } };
  await fs.writeFile(path.join(stage, "package.json"), JSON.stringify(packageJson, null, 2) + "\n");
  await fs.writeFile(path.join(stage, "package-lock.json"), JSON.stringify({
    name: packageName,
    version: utrVersion,
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { name: packageName, version: utrVersion, dependencies: packageJson.dependencies },
      "node_modules/yaml": dependencies.yaml.lockEntry,
    },
  }, null, 2) + "\n");
  execFileSync("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--no-bin-links"], {
    cwd: stage,
    encoding: "utf8",
    stdio: "pipe",
  });
  const installed = JSON.parse(await fs.readFile(path.join(stage, "node_modules", "yaml", "package.json"), "utf8"));
  if (installed.version !== dependencies.yaml.version || Object.keys(installed.dependencies || {}).length > 0) {
    throw new Error("Locked yaml installation differs from package-lock.json");
  }
  await fs.rm(path.join(stage, "package-lock.json"));
  await fs.rm(path.join(stage, "node_modules", ".package-lock.json"), { force: true });
}

async function verifySnapshot(root) {
  const manifestPath = path.join(root, "runtime-manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (manifest.formatVersion !== 1 || !Array.isArray(manifest.files)) {
    throw new Error("Unsupported runtime manifest");
  }
  for (const directory of requiredDirs) {
    if (!(await fs.stat(path.join(root, directory))).isDirectory()) {
      throw new Error(`Missing required runtime directory: ${directory}`);
    }
  }
  const files = await listFiles(root);
  if (JSON.stringify(files) !== JSON.stringify(manifest.files)) {
    throw new Error("Runtime file inventory or SHA256 mismatch");
  }
  if (manifest.treeSha256 !== sha256(JSON.stringify(files))) {
    throw new Error("Runtime tree SHA256 mismatch");
  }
  await checkImportClosure(root);
  return manifest;
}

async function buildSnapshot(output, options) {
  const outputRoot = path.resolve(output);
  const canonicalOutputRoot = await canonicalizePotentialPath(outputRoot);
  for (const relative of [...runtimeDirs, ...runtimeFiles, ...requiredDirs]) {
    const sourcePath = path.join(sourceRoot, relative);
    if (isInside(sourcePath, outputRoot) || isInside(await fs.realpath(sourcePath), canonicalOutputRoot)) {
      throw new Error(`Output cannot be inside runtime source: ${relative}`);
    }
  }
  const dependencyRoot = path.join(sourceRoot, "node_modules", "yaml");
  if (isInside(dependencyRoot, outputRoot) || isInside(await canonicalizePotentialPath(dependencyRoot), canonicalOutputRoot)) {
    throw new Error("Output cannot be inside runtime dependency: node_modules/yaml");
  }
  if (options.allowDirty && options.ref) throw new Error("--allow-dirty and --ref are mutually exclusive");
  if (!options.allowDirty && !options.ref) throw new Error("Release snapshot requires --ref; use --allow-dirty only for local testing");
  const head = git("rev-parse", "HEAD");
  const dirty = git("status", "--porcelain", "--untracked-files=all").length > 0;
  if (options.ref) {
    const selected = git("rev-parse", "--verify", `${options.ref}^{commit}`);
    if (selected !== head) throw new Error(`Checked-out HEAD does not match --ref ${options.ref}`);
    if (dirty) throw new Error("Release snapshot requires a clean Git worktree");
  }
  const dependencies = await dependencyFacts({ allowDirty: options.allowDirty });
  const trackedFiles = options.ref ? new Set(git("ls-files", "--cached", "-z").split("\0").filter(Boolean)) : null;
  try {
    await fs.access(outputRoot);
    throw new Error(`Output already exists: ${outputRoot}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await fs.mkdir(path.dirname(outputRoot), { recursive: true });
  const stage = await fs.mkdtemp(path.join(path.dirname(outputRoot), ".topmind-utr-stage-"));
  try {
    for (const relative of runtimeDirs) {
      await copyTree(path.join(sourceRoot, relative), path.join(stage, relative), trackedFiles);
    }
    for (const relative of runtimeFiles) {
      await fs.mkdir(path.dirname(path.join(stage, relative)), { recursive: true });
      await fs.copyFile(path.join(sourceRoot, relative), path.join(stage, relative));
    }
    for (const relative of requiredDirs) await fs.mkdir(path.join(stage, relative), { recursive: true });
    const utrVersion = (await fs.readFile(path.join(stage, "utr", "VERSION"), "utf8")).trim();
    if (options.ref) await installLockedDependency(stage, utrVersion, dependencies);
    else {
      await copyTree(path.join(sourceRoot, "node_modules", "yaml"), path.join(stage, "node_modules", "yaml"));
      await fs.writeFile(path.join(stage, "package.json"), JSON.stringify({
        name: "topmind-utr-runtime-snapshot",
        version: utrVersion,
        private: true,
        type: "module",
        dependencies: { yaml: dependencies.yaml.version },
      }, null, 2) + "\n");
    }
    await checkImportClosure(stage);
    const files = await listFiles(stage);
    const manifest = {
      formatVersion: 1,
      source: { commit: head, dirty, ref: options.ref || null },
      utrVersion,
      nodeEngine: ">=20.11",
      dependencies: { yaml: { version: dependencies.yaml.version, lockIntegrity: dependencies.yaml.lockIntegrity, installMode: dependencies.yaml.installMode } },
      treeSha256: sha256(JSON.stringify(files)),
      files,
    };
    await fs.writeFile(path.join(stage, "runtime-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    await verifySnapshot(stage);
    await fs.rename(stage, outputRoot);
    return { output: outputRoot, source: manifest.source, utrVersion, treeSha256: manifest.treeSha256, fileCount: files.length };
  } catch (error) {
    await fs.rm(stage, { recursive: true, force: true });
    throw error;
  }
}

async function main(argv) {
  if (argv[0] === "--verify" && argv.length === 2) {
    const root = path.resolve(argv[1]);
    const manifest = await verifySnapshot(root);
    return { verified: true, output: root, treeSha256: manifest.treeSha256, fileCount: manifest.files.length };
  }
  let output;
  let ref;
  let allowDirty = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out" && argv[i + 1]) output = argv[++i];
    else if (arg === "--ref" && argv[i + 1]) ref = argv[++i];
    else if (arg === "--allow-dirty") allowDirty = true;
    else throw new Error(`Unknown or incomplete option: ${arg}`);
  }
  if (!output) throw new Error("Usage: pack-utr-runtime.mjs --out <new-directory> (--ref <checked-out-tag-or-commit> | --allow-dirty); verify with --verify <directory>");
  return buildSnapshot(output, { ref, allowDirty });
}

main(process.argv.slice(2)).then(
  (result) => process.stdout.write(JSON.stringify(result, null, 2) + "\n"),
  (error) => {
    process.stderr.write(`[pack-utr-runtime] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
