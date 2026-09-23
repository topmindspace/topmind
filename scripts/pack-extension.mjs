#!/usr/bin/env node
/**
 * Pack browser-extension/ into dist/topmind-clip-extension-<version>.zip
 * Independent of Desktop / Skills pack.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const extRoot = path.join(repoRoot, "browser-extension");
const distRoot = path.join(repoRoot, "dist");

function log(msg) {
  process.stdout.write(`[pack-extension] ${msg}\n`);
}

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString("utf8")));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}\n${stderr}`));
    });
  });
}

async function tryZip(outZip, stageDir) {
  try {
    await run("zip", ["-r", "-q", outZip, "."], stageDir);
    return true;
  } catch {
    try {
      await run("tar", ["-a", "-cf", outZip, "."], stageDir);
      return true;
    } catch (e) {
      throw new Error(`zip/tar failed: ${e.message}`);
    }
  }
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(path.join(extRoot, "manifest.json"), "utf8"));
  const version = manifest.version || "0.0.0";
  const name = `topmind-clip-extension-${version}`;
  await fs.mkdir(distRoot, { recursive: true });

  const stage = path.join(distRoot, `.stage-${name}`);
  await fs.rm(stage, { recursive: true, force: true });
  await fs.mkdir(stage, { recursive: true });

  // Refresh Mozilla Readability vendor from Desktop dep when available
  const readabilitySrc = path.join(
    repoRoot,
    "topmind-desktop/node_modules/@mozilla/readability/Readability.js",
  );
  const readabilityDest = path.join(extRoot, "lib/vendor/Readability.js");
  try {
    let srcText = await fs.readFile(readabilitySrc, "utf8");
    if (!srcText.includes("globalThis.Readability")) {
      srcText += `

/* topmind: expose for chrome.scripting.executeScript isolated world */
if (typeof globalThis !== "undefined") {
  globalThis.Readability = Readability;
}
`;
    }
    await fs.mkdir(path.dirname(readabilityDest), { recursive: true });
    await fs.writeFile(readabilityDest, srcText, "utf8");
    log("vendored @mozilla/readability → browser-extension/lib/vendor/Readability.js");
  } catch {
    log("warn: Desktop @mozilla/readability not found; packing existing vendor copy");
  }

  // Keep Clip HTML→MD identical to Desktop (single algorithm).
  const mdSrc = path.join(repoRoot, "topmind-desktop/electron/lib/html-to-markdown.mjs");
  const mdDest = path.join(extRoot, "lib/html-to-markdown.mjs");
  try {
    await fs.copyFile(mdSrc, mdDest);
    log("synced Desktop html-to-markdown → browser-extension/lib/html-to-markdown.mjs");
  } catch (e) {
    throw new Error(`refusing to pack: could not sync html-to-markdown from Desktop (${e.message})`);
  }

  // Copy extension files (no node_modules / .git)
  async function walk(src, dest) {
    await fs.mkdir(dest, { recursive: true });
    for (const entry of await fs.readdir(src, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const from = path.join(src, entry.name);
      const to = path.join(dest, entry.name);
      if (entry.isDirectory()) await walk(from, to);
      else await fs.copyFile(from, to);
    }
  }
  await walk(extRoot, stage);

  // Ensure no accidental secrets in pack
  for (const f of ["options.js", "popup.js", "background.js"]) {
    const p = path.join(stage, f);
    try {
      const t = await fs.readFile(p, "utf8");
      if (/sk-[a-zA-Z0-9]{20,}|wrk-[a-z0-9]{10,}/u.test(t)) {
        throw new Error(`refusing to pack: possible secret in ${f}`);
      }
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }

  const outZip = path.join(distRoot, `${name}.zip`);
  await fs.rm(outZip, { force: true });
  await tryZip(outZip, stage);

  const buf = await fs.readFile(outZip);
  const sha = createHash("sha256").update(buf).digest("hex");
  const sums = path.join(distRoot, `${name}.SHA256SUMS`);
  await fs.writeFile(sums, `${sha}  ${path.basename(outZip)}\n`, "utf8");

  await fs.rm(stage, { recursive: true, force: true });
  log(`done: ${path.basename(outZip)} (${buf.length} bytes)`);
  log(`sha256: ${sha}`);
}

main().catch((e) => {
  process.stderr.write(`[pack-extension] ${e.stack || e}\n`);
  process.exit(1);
});
