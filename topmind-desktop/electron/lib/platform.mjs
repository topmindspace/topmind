/**
 * Cross-platform helpers for Desktop main process + pack tooling.
 * Keep runtime decisions (Linux/ARM flags, path separators, OS probes) here
 * so main.mjs / scripts do not re-implement ad-hoc platform branches.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function isLinux(platform = process.platform) {
  return platform === "linux";
}

export function isDarwin(platform = process.platform) {
  return platform === "darwin";
}

export function isWin32(platform = process.platform) {
  return platform === "win32";
}

/** True for arm64 and 32-bit arm (armv7l etc.). */
export function isArmArch(arch = process.arch) {
  return arch === "arm64" || arch === "arm";
}

/** Workspace-relative paths always use `/` (content truth is OS-agnostic). */
export function toPosixPath(value) {
  return String(value ?? "").replace(/\\/gu, "/");
}

/**
 * Split a workspace-relative path into safe segments.
 * Rejects absolute / drive / empty / `.` / `..` segments so call sites
 * can join under a data root without inheriting host separators.
 */
export function splitRelativeSegments(relativePath) {
  const posix = toPosixPath(relativePath).replace(/^\/+/u, "");
  if (!posix) return [];
  if (/^[a-zA-Z]:/u.test(posix)) {
    throw new Error(`Absolute path not allowed: ${relativePath}`);
  }
  const parts = posix.split("/").filter((p) => p && p !== ".");
  if (parts.some((p) => p === "..")) {
    throw new Error(`Path traversal not allowed: ${relativePath}`);
  }
  return parts;
}

/** Resolve workspace-relative path under base using POSIX segments. */
export function resolveUnderRoot(basePath, relativePath) {
  const parts = splitRelativeSegments(relativePath);
  return path.resolve(basePath, ...parts);
}

/**
 * Linux Chromium sandbox often fails when unprivileged user namespaces are
 * disabled (common on hardened Ubuntu, containers, some cloud images).
 * Env ELECTRON_NO_SANDBOX=1 always wins.
 */
export function shouldDisableSandbox(env = process.env, platform = process.platform) {
  if (env.ELECTRON_NO_SANDBOX === "1" || env.ELECTRON_NO_SANDBOX === "true") {
    return true;
  }
  if (platform !== "linux") return false;
  try {
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      return true;
    }
  } catch {
    /* ignore */
  }
  // 0 = unprivileged userns disabled → Chromium sandbox cannot start
  try {
    const raw = readFileSync("/proc/sys/kernel/unprivileged_userns_clone", "utf8").trim();
    if (raw === "0") return true;
  } catch {
    /* file missing on non-linux or restricted proc — fall through */
  }
  try {
    const raw = readFileSync("/proc/sys/user/max_user_namespaces", "utf8").trim();
    if (raw === "0") return true;
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * GPU is frequently broken on ARM SBCs, VMs, and remote desktops.
 * Env ELECTRON_DISABLE_GPU=1 forces off; ELECTRON_DISABLE_GPU=0 forces on.
 */
export function shouldDisableGpu(env = process.env, arch = process.arch, platform = process.platform) {
  if (env.ELECTRON_DISABLE_GPU === "1" || env.ELECTRON_DISABLE_GPU === "true") {
    return true;
  }
  if (env.ELECTRON_DISABLE_GPU === "0" || env.ELECTRON_DISABLE_GPU === "false") {
    return false;
  }
  // Default off on ARM (all OSes) — matches historical dev-electron behavior
  if (isArmArch(arch)) return true;
  // Optional: disable under explicit headless / remote display heuristics on Linux
  if (platform === "linux" && env.LIBGL_ALWAYS_SOFTWARE === "1") return true;
  return false;
}

/**
 * Apply Chromium/Electron command-line switches before app ready.
 * Safe to call once at module load of main.mjs.
 *
 * @param {object} app Electron app
 * @param {{ env?: NodeJS.ProcessEnv, platform?: string, arch?: string }} [opts]
 * @returns {{ sandbox: boolean, gpu: boolean, ozoneHint: string|null }}
 */
export function applyChromiumCompatibilityFlags(app, opts = {}) {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const arch = opts.arch ?? process.arch;
  const report = { sandbox: true, gpu: true, ozoneHint: null };

  if (!app?.commandLine?.appendSwitch) return report;

  if (shouldDisableSandbox(env, platform)) {
    app.commandLine.appendSwitch("no-sandbox");
    report.sandbox = false;
  }

  if (shouldDisableGpu(env, arch, platform)) {
    app.commandLine.appendSwitch("disable-gpu");
    app.commandLine.appendSwitch("disable-software-rasterizer");
    report.gpu = false;
  }

  // Wayland / hybrid sessions: let Chromium pick X11 vs Wayland unless user pins it
  if (platform === "linux") {
    const hint = env.ELECTRON_OZONE_PLATFORM_HINT || env.OZONE_PLATFORM || "auto";
    if (hint && hint !== "none") {
      app.commandLine.appendSwitch("ozone-platform-hint", hint);
      report.ozoneHint = hint;
    }
  }

  return report;
}

/**
 * Dev/CI: args to pass to the Electron binary (same policy as production flags).
 */
export function electronLaunchArgs(env = process.env, arch = process.arch, platform = process.platform) {
  const args = [];
  if (shouldDisableSandbox(env, platform)) args.push("--no-sandbox");
  if (shouldDisableGpu(env, arch, platform)) {
    args.push("--disable-gpu", "--disable-software-rasterizer");
  }
  if (platform === "linux") {
    const hint = env.ELECTRON_OZONE_PLATFORM_HINT || env.OZONE_PLATFORM || "auto";
    if (hint && hint !== "none") {
      args.push(`--ozone-platform-hint=${hint}`);
    }
  }
  return args;
}

/** True when a path looks like an existing Linux AppImage mount or /tmp/.mount. */
export function looksLikeAppImage(env = process.env) {
  return Boolean(env.APPIMAGE || env.APPDIR);
}

/**
 * Human-readable platform tag for logs / diagnostics.
 * e.g. "linux-arm64", "darwin-arm64", "win32-x64"
 */
export function platformTag(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

/** Soft probe used in tests — does not throw. */
export function readOptionalText(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}
