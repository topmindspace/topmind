#!/usr/bin/env node
/**
 * CI-safe electron-builder wrapper.
 *
 * GitHub Actions injects secrets as empty strings when unset. electron-builder
 * still treats empty CSC_LINK as "set" and tries to code-sign, which fails with:
 *   empty password will be used for code signing
 *   ⨯ …/topmind-desktop not a file
 *
 * This script:
 *  1. Unsets empty signing env vars
 *  2. Forces CSC_IDENTITY_AUTO_DISCOVERY=false
 *  3. On mac, forces -c.mac.identity=null unless a real CSC_LINK is present
 *  4. Always --publish never
 *  5. Optional arch pin: mac|linux|win [x64|arm64|host]
 *
 * Usage:
 *   node scripts/electron-builder-ci.mjs mac
 *   node scripts/electron-builder-ci.mjs linux arm64
 *   node scripts/electron-builder-ci.mjs linux host   # default: host arch
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");

const platform = String(process.argv[2] || "").toLowerCase();
const archArg = String(process.argv[3] || "host").toLowerCase();

// `dir` = unpacked app only (fast local / CI smoke; no installer).
if (!["mac", "linux", "win", "dir"].includes(platform)) {
  process.stderr.write(
    "usage: node scripts/electron-builder-ci.mjs mac|linux|win|dir [x64|arm64|host]\n",
  );
  process.exit(2);
}

const ALLOWED_ARCH = new Set(["host", "x64", "arm64", "ia32"]);
if (!ALLOWED_ARCH.has(archArg)) {
  process.stderr.write(
    `invalid arch "${archArg}". use: host | x64 | arm64 | ia32\n`,
  );
  process.exit(2);
}

// Cross-arch without docker is fragile; refuse common footguns unless forced.
if (archArg !== "host" && archArg !== process.arch) {
  if (process.env.ELECTRON_BUILDER_ALLOW_CROSS_ARCH !== "1") {
    process.stderr.write(
      `[electron-builder-ci] refusing cross-arch pack: host=${process.arch} requested=${archArg}\n` +
        `  Build on a matching runner (e.g. ubuntu-24.04-arm for linux arm64),\n` +
        `  or set ELECTRON_BUILDER_ALLOW_CROSS_ARCH=1 if you use electron-builder Docker.\n`,
    );
    process.exit(2);
  }
  process.stderr.write(
    `[electron-builder-ci] cross-arch allowed via ELECTRON_BUILDER_ALLOW_CROSS_ARCH=1\n`,
  );
}

const SIGN_KEYS = [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "WIN_CSC_LINK",
  "WIN_CSC_KEY_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
];

for (const key of SIGN_KEYS) {
  const v = process.env[key];
  if (v == null || String(v).trim() === "") {
    delete process.env[key];
  }
}

process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";

const hasMacCert = Boolean(process.env.CSC_LINK?.trim());
const hasWinCert = Boolean(process.env.WIN_CSC_LINK?.trim());

const args = ["--publish", "never"];

if (platform === "dir") {
  args.push("--dir");
} else if (platform === "mac") {
  args.push("--mac");
} else if (platform === "win") {
  args.push("--win");
} else {
  args.push("--linux");
}

if (archArg !== "host") {
  args.push(`--${archArg}`);
}

// Force unsigned mac when no cert — avoids empty-CSC_LINK signing path
if (platform === "mac" && !hasMacCert) {
  args.push("-c.mac.identity=null");
}

// Unsigned Windows: skip *code signing* only — keep rcedit icon/metadata
// (signAndEditExecutable=false also skips icon embed → stock Electron icon).
// electron-builder: use signExecutable=false, not signAndEditExecutable=false.
if ((platform === "win" || platform === "dir") && !hasWinCert) {
  args.push("-c.win.signExecutable=false");
  // Do NOT set signAndEditExecutable=false — we want icon applied by builder.
}

process.stdout.write(
  `[electron-builder-ci] platform=${platform} arch=${archArg} hostArch=${process.arch} ` +
    `macCert=${hasMacCert} winCert=${hasWinCert}\n` +
    `[electron-builder-ci] electron-builder ${args.join(" ")}\n`,
);

const child = spawn("npx", ["electron-builder", ...args], {
  cwd: desktopRoot,
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.stderr.write(`[electron-builder-ci] killed by ${signal}\n`);
    process.exit(1);
  }
  if (code !== 0 && code != null) {
    process.exit(code);
  }

  // Belt-and-suspenders: patch *only* win-unpacked/topmind.exe icon if builder
  // still left the default (never touch NSIS topmind-<ver>-win-*.exe).
  if (platform === "win" || (platform === "dir" && process.platform === "win32")) {
    const patch = spawn(
      process.execPath,
      [path.join(desktopRoot, "scripts", "patch-win-exe-icon.mjs")],
      { cwd: desktopRoot, stdio: "inherit", env: process.env },
    );
    patch.on("exit", (patchCode, patchSignal) => {
      if (patchSignal) {
        process.stderr.write(`[electron-builder-ci] icon patch killed by ${patchSignal}\n`);
        process.exit(1);
      }
      // Icon patch failure is non-fatal if builder already applied icons
      // (signExecutable=false path). Log and continue.
      if (patchCode) {
        process.stderr.write(
          `[electron-builder-ci] icon patch exit ${patchCode} (continuing; NSIS must stay intact)\n`,
        );
      }
      process.exit(0);
    });
    return;
  }
  process.exit(code ?? 0);
});
