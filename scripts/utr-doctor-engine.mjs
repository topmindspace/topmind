#!/usr/bin/env node
/**
 * Engine-scoped UTR doctor for monorepo validate.
 *
 * Uses a temporary clean workspace so CI / root `npm run validate` does not
 * fail on user-workspace hygiene (e.g. .DS_Store under topmind-workspace/).
 *
 * For machine+workspace health, use: `npm run utr:doctor`
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "utr", "bin", "topmind-cli.mjs");

async function main() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-doctor-engine-"));
  const workspaceRoot = path.join(base, "workspace");
  try {
    await fs.mkdir(path.join(workspaceRoot, "00-收件箱"), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, "10-动态", "2026-validate"), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, "88-输出"), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, "99-归档"), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, "10-动态", "2026-validate", "topic.md"),
      "# 2026-validate\n",
      "utf8",
    );

    const code = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          cliPath,
          "doctor",
          "--json",
          "--mcp",
          "--engine-root",
          repoRoot,
          "--workspace-root",
          workspaceRoot,
        ],
        { cwd: repoRoot, stdio: "inherit" },
      );
      child.on("error", reject);
      child.on("exit", (exitCode) => resolve(exitCode ?? 1));
    });

    process.exit(code);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
}

main().catch((err) => {
  process.stderr.write(`[utr-doctor-engine] ${err.stack || err.message || err}\n`);
  process.exit(1);
});
