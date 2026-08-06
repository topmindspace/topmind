/**
 * Host binary resolution for GUI Electron processes.
 *
 * Packaged / Start-menu launches often miss user PATH (Python Scripts, pipx,
 * Homebrew, Pandoc install dirs). Probe and convert share this module so
 * detection and execution stay consistent across win32 / darwin / linux.
 */
import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { isDarwin, isWin32 } from "./platform.mjs";

const execFileAsync = promisify(execFile);

/** @type {string | null} */
let augmentedPathCache = null;

/**
 * Extra directories commonly missing from GUI app PATH.
 * @param {string} [platform]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
export function extraBinDirs(platform = process.platform, env = process.env) {
  const home = os.homedir();
  const dirs = [];

  if (isWin32(platform)) {
    const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    const roaming = env.APPDATA || path.join(home, "AppData", "Roaming");
    const pf = env["ProgramFiles"] || "C:\\Program Files";
    const pf86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

    dirs.push(
      path.join(home, ".local", "bin"),
      path.join(local, "Microsoft", "WindowsApps"),
      path.join(pf, "Pandoc"),
      path.join(pf86, "Pandoc"),
      path.join(local, "Pandoc"),
    );

    // Python.org / Store installs: .../Python3x and .../Python3x/Scripts
    for (const root of [
      path.join(local, "Programs", "Python"),
      path.join(roaming, "Python"),
      path.join(pf, "Python"),
    ]) {
      if (!existsSync(root)) continue;
      try {
        for (const name of readdirSync(root)) {
          const base = path.join(root, name);
          dirs.push(base, path.join(base, "Scripts"));
          // Roaming layout: Python311/site-packages not needed; Scripts under Python311
        }
      } catch {
        /* ignore */
      }
    }

    // pyenv-win, scoop, chocolatey
    dirs.push(
      path.join(home, ".pyenv", "pyenv-win", "shims"),
      path.join(home, "scoop", "shims"),
      path.join(env.ChocolateyInstall || "C:\\ProgramData\\chocolatey", "bin"),
    );
  } else if (isDarwin(platform)) {
    dirs.push(
      "/opt/homebrew/bin",
      "/usr/local/bin",
      path.join(home, ".local", "bin"),
      path.join(home, "Library", "Python", "3.12", "bin"),
      path.join(home, "Library", "Python", "3.11", "bin"),
      path.join(home, "Library", "Python", "3.10", "bin"),
      "/opt/homebrew/opt/python@3.12/bin",
      "/opt/homebrew/opt/python@3.11/bin",
    );
  } else {
    // linux
    dirs.push(
      path.join(home, ".local", "bin"),
      "/usr/local/bin",
      "/usr/bin",
      path.join(home, ".pyenv", "shims"),
    );
  }

  return dirs.filter((d) => d && existsSync(d));
}

/**
 * Merge process PATH with extraBinDirs (deduped, extras first so user tools win).
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [platform]
 */
export function buildAugmentedPath(env = process.env, platform = process.platform) {
  const sep = isWin32(platform) ? ";" : ":";
  const current = String(env.PATH || env.Path || "");
  const parts = current.split(sep).filter(Boolean);
  const seen = new Set(parts.map((p) => p.toLowerCase()));
  const prefix = [];
  for (const d of extraBinDirs(platform, env)) {
    const key = d.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    prefix.push(d);
  }
  return [...prefix, ...parts].join(sep);
}

/** Cached augmented PATH for this process. */
export function getAugmentedPath() {
  if (augmentedPathCache == null) {
    augmentedPathCache = buildAugmentedPath();
  }
  return augmentedPathCache;
}

export function clearHostBinCache() {
  augmentedPathCache = null;
}

/**
 * Quote one arg for Windows cmd.exe when shell is required (.cmd/.bat shims).
 * @param {string} value
 */
export function quoteWinCmdArg(value) {
  const s = String(value ?? "");
  if (!s) return '""';
  if (!/[\s"&<>|^%!]/u.test(s)) return s;
  return `"${s.replace(/"/gu, '""')}"`;
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ timeoutMs?: number, env?: NodeJS.ProcessEnv }} [opts]
 */
export async function tryExec(cmd, args, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 4000;
  const env = {
    ...process.env,
    ...(opts.env || {}),
    PATH: opts.env?.PATH || getAugmentedPath(),
    // Windows console often uses GBK/cp936; force UTF-8 for Python CLIs (markitdown).
    PYTHONUTF8: process.env.PYTHONUTF8 || "1",
    PYTHONIOENCODING: process.env.PYTHONIOENCODING || "utf-8",
  };
  // Windows may use Path key
  if (isWin32()) env.Path = env.PATH;

  // pip/npm on Windows often install .cmd shims — run via cmd.exe with quoted args
  // (execFile shell:true mangles paths with spaces / non-ASCII on win32).
  const needsWinCmdShim = isWin32() && /\.(cmd|bat)$/iu.test(String(cmd));

  try {
    let stdout;
    let stderr;
    if (needsWinCmdShim) {
      const comspec = process.env.ComSpec || "cmd.exe";
      const line = [quoteWinCmdArg(cmd), ...(args || []).map(quoteWinCmdArg)].join(" ");
      ({ stdout, stderr } = await execFileAsync(comspec, ["/d", "/s", "/c", line], {
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        env,
        shell: false,
      }));
    } else {
      ({ stdout, stderr } = await execFileAsync(cmd, args, {
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        env,
        shell: false,
      }));
    }
    return {
      ok: true,
      stdout: String(stdout || "").trim(),
      stderr: String(stderr || "").trim(),
    };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const stdout = typeof e?.stdout === "string" ? e.stdout.trim() : "";
    const stderr = typeof e?.stderr === "string" ? e.stderr.trim() : "";
    // Prefer useful stderr over Node's "Command failed: …" wrapper (UI-friendly).
    const detail = pickExecErrorDetail(err.message, stderr, stdout);
    return {
      ok: false,
      error: detail,
      stdout,
      stderr,
      code: typeof e?.code === "number" ? e.code : undefined,
    };
  }
}

/**
 * Compact CLI failure text for job.error / warnings (drop huge tracebacks).
 * @param {string} message
 * @param {string} stderr
 * @param {string} stdout
 */
export function pickExecErrorDetail(message, stderr, stdout) {
  const raw = [stderr, stdout, message].filter(Boolean).join("\n");
  const lines = raw
    .split(/\r?\n/u)
    .map((l) => l.trim())
    .filter(Boolean);
  // Prefer Python / tool exception lines over Node's "Command failed: …" wrapper
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (/^Command failed:/iu.test(l)) continue;
    if (/^Traceback\b/iu.test(l)) continue;
    if (/^File "/iu.test(l) || /^\s*File "/u.test(l)) continue;
    if (
      /Error|Exception|找不到|拒绝|denied|not found|No module|threw /iu.test(l) &&
      l.length < 400
    ) {
      return l.slice(0, 280);
    }
  }
  // Fall back: last non-wrapper line
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!/^Command failed:/iu.test(l) && l.length < 400) return l.slice(0, 280);
  }
  return String(message || "command failed").slice(0, 280);
}

/**
 * Resolve absolute path of a binary via where/which using augmented PATH.
 * @param {string} name
 * @returns {Promise<string | null>}
 */
export async function whichBin(name) {
  if (isWin32()) {
    const r = await tryExec("where.exe", [name], { timeoutMs: 3000 });
    if (!r.ok && !r.stdout) return null;
    const lines = (r.stdout || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    // Prefer .exe over .cmd/.bat (execFile is more reliable)
    const ranked = [
      ...lines.filter((l) => /\.exe$/iu.test(l)),
      ...lines.filter((l) => !/\.exe$/iu.test(l)),
    ];
    for (const line of ranked) {
      if (existsSync(line)) return line;
    }
    return null;
  }
  const r = await tryExec("which", [name], { timeoutMs: 3000 });
  if (!r.ok) return null;
  const line = (r.stdout || "").split("\n").map((s) => s.trim()).find(Boolean);
  if (line && existsSync(line)) return line;
  return null;
}

/**
 * Candidate absolute paths for a well-known tool name.
 * @param {string} name
 * @param {string} [platform]
 */
export function candidatePaths(name, platform = process.platform) {
  const out = [];
  if (isWin32(platform)) {
    for (const dir of extraBinDirs(platform)) {
      out.push(path.join(dir, `${name}.exe`));
      out.push(path.join(dir, `${name}.cmd`));
    }
    if (name === "pandoc") {
      const pf = process.env["ProgramFiles"] || "C:\\Program Files";
      out.push(path.join(pf, "Pandoc", "pandoc.exe"));
    }
  } else {
    for (const dir of extraBinDirs(platform)) {
      out.push(path.join(dir, name));
    }
  }
  return out;
}

/**
 * @typedef {{ cmd: string, argsPrefix: string[], display: string, viaModule: boolean, source: string }} HostInvocation
 */

/**
 * Find how to invoke a simple binary (pandoc).
 * @param {string} name
 * @returns {Promise<HostInvocation | null>}
 */
export async function resolveSimpleBinary(name) {
  const log = [];
  const abs = await whichBin(name);
  if (abs) {
    log.push(`which:${abs}`);
    return { cmd: abs, argsPrefix: [], display: abs, viaModule: false, source: "path" };
  }
  for (const p of candidatePaths(name)) {
    if (existsSync(p)) {
      return { cmd: p, argsPrefix: [], display: p, viaModule: false, source: "candidate" };
    }
  }
  // Bare name last (may work if PATH already good)
  const probe = await tryExec(name, ["--version"], { timeoutMs: 2500 });
  if (probe.ok || /pandoc/iu.test(probe.stdout || probe.stderr || "")) {
    return { cmd: name, argsPrefix: [], display: name, viaModule: false, source: "bare" };
  }
  return null;
}

/**
 * Python interpreters to try (Windows-first order).
 * @returns {Array<{ cmd: string, prefix: string[], label: string }>}
 */
export function pythonRunners(platform = process.platform) {
  if (isWin32(platform)) {
    return [
      { cmd: "py", prefix: ["-3"], label: "py -3" },
      { cmd: "python", prefix: [], label: "python" },
      { cmd: "python3", prefix: [], label: "python3" },
    ];
  }
  return [
    { cmd: "python3", prefix: [], label: "python3" },
    { cmd: "python", prefix: [], label: "python" },
  ];
}

/**
 * Resolve markitdown: bare CLI, then python -m markitdown.
 * @returns {Promise<(HostInvocation & { version?: string }) | null>}
 */
export async function resolveMarkitdown() {
  // 1) bare / path markitdown
  const abs = await whichBin("markitdown");
  if (abs) {
    const ver = await probeMarkitdownVersion(abs, []);
    if (ver) {
      return {
        cmd: abs,
        argsPrefix: [],
        display: abs,
        viaModule: false,
        source: "path",
        version: ver,
      };
    }
  }
  for (const p of candidatePaths("markitdown")) {
    if (!existsSync(p)) continue;
    const ver = await probeMarkitdownVersion(p, []);
    if (ver) {
      return {
        cmd: p,
        argsPrefix: [],
        display: p,
        viaModule: false,
        source: "candidate",
        version: ver,
      };
    }
  }
  // bare name
  {
    const ver = await probeMarkitdownVersion("markitdown", []);
    if (ver) {
      return {
        cmd: "markitdown",
        argsPrefix: [],
        display: "markitdown",
        viaModule: false,
        source: "bare",
        version: ver,
      };
    }
  }

  // 2) python -m markitdown
  for (const runner of pythonRunners()) {
    const modArgs = [...runner.prefix, "-m", "markitdown"];
    const ver = await probeMarkitdownVersion(runner.cmd, modArgs);
    if (ver) {
      return {
        cmd: runner.cmd,
        argsPrefix: modArgs,
        display: `${runner.label} -m markitdown`,
        viaModule: true,
        source: "module",
        version: ver,
      };
    }
    // import-only (CLI entry missing but package installed)
    const imp = await tryExec(
      runner.cmd,
      [...runner.prefix, "-c", "import markitdown; print(getattr(markitdown,'__version__','ok'))"],
      { timeoutMs: 5000 },
    );
    if (imp.ok && imp.stdout) {
      return {
        cmd: runner.cmd,
        argsPrefix: modArgs,
        display: `${runner.label} -m markitdown`,
        viaModule: true,
        source: "import",
        version: imp.stdout.split("\n")[0].slice(0, 40),
      };
    }
  }

  return null;
}

/**
 * @param {string} cmd
 * @param {string[]} argsPrefix  args before --version / file
 * @returns {Promise<string | null>} version or "ok"
 */
async function probeMarkitdownVersion(cmd, argsPrefix) {
  let r = await tryExec(cmd, [...argsPrefix, "--version"], { timeoutMs: 5000 });
  if (r.ok && (r.stdout || r.stderr)) {
    return (r.stdout || r.stderr).split("\n")[0].slice(0, 60);
  }
  // help often exits 0 or non-zero but proves entry exists
  // Prefer -h over bare invoke (bare may hang waiting for stdin)
  r = await tryExec(cmd, [...argsPrefix, "-h"], { timeoutMs: 5000 });
  const text = `${r.stdout || ""}\n${r.stderr || ""}`;
  if (/markitdown|usage:|Convert/iu.test(text) || r.ok) {
    return "ok";
  }
  // Non-zero with recognizable stderr (some builds)
  if (/markitdown|No such option|error:|required/iu.test(text)) {
    return "ok";
  }
  return null;
}
