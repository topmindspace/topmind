/**
 * anydoc sidecar — PATH / userData / optional bundled extraResource.
 *
 * N-API `@firecrawl/anydoc` is NOT imported in-process: a .node inside asar
 * cannot be swapped without a Desktop re-pack. The CLI (`cli.js` + platform
 * addon) lives under userData so install/upgrade is in-app.
 */
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveSimpleBinary, tryExec } from "../host-bin.mjs";
import { classifyAnydocFailure, anydocFormatForKind } from "./convert-policy.mjs";
import {
  getBundledAnydocDir,
  getIngestUserDataDir,
  isOutsideAsar,
} from "./runtime-paths.mjs";

export const ANYDOC_NPM_SPEC = "@firecrawl/anydoc";
export const ANYDOC_DOCS_URL = "https://github.com/firecrawl/anydoc";

/** Source priority: user-data sidecar wins, then PATH, then bundled fallback. */
export const ANYDOC_SOURCE_RANK = Object.freeze(["user-data", "path", "bundled"]);

/** @type {{ cmd: string, argsPrefix: string[], display: string, source: string } | null} */
let currentInvocation = null;

export function sidecarRelDir() {
  return path.join("converters", "anydoc");
}

/**
 * @param {string} userDataDir
 */
export function sidecarLayout(userDataDir) {
  const root = path.join(userDataDir, sidecarRelDir());
  return {
    root,
    cliJs: path.join(root, "node_modules", "@firecrawl", "anydoc", "cli.js"),
    pkgJson: path.join(root, "node_modules", "@firecrawl", "anydoc", "package.json"),
  };
}

/**
 * @param {Array<{ source: string, exists?: boolean, cmd?: string, argsPrefix?: string[], display?: string, version?: string|null }>} candidates
 */
export function pickAnydocCandidate(candidates) {
  const rank = new Map(ANYDOC_SOURCE_RANK.map((s, i) => [s, i]));
  const ready = (candidates || []).filter((c) => c && c.exists && c.cmd);
  ready.sort((a, b) => (rank.get(a.source) ?? 99) - (rank.get(b.source) ?? 99));
  return ready[0] || null;
}

/**
 * @param {string} [userDataDir]
 * @param {string} [bundledDir]
 * @returns {Array<{ source: string, path: string, kind: "cli-js"|"bin" }>}
 */
export function listAnydocSidecarPaths(userDataDir, bundledDir) {
  const out = [];
  if (userDataDir) {
    const layout = sidecarLayout(userDataDir);
    out.push({ source: "user-data", path: layout.cliJs, kind: "cli-js", pkgJson: layout.pkgJson });
  }
  if (bundledDir) {
    out.push({
      source: "bundled",
      path: path.join(bundledDir, "cli.js"),
      kind: "cli-js",
      pkgJson: path.join(bundledDir, "package.json"),
    });
    out.push({
      source: "bundled",
      path: path.join(bundledDir, "node_modules", "@firecrawl", "anydoc", "cli.js"),
      kind: "cli-js",
      pkgJson: path.join(bundledDir, "node_modules", "@firecrawl", "anydoc", "package.json"),
    });
    const exe = process.platform === "win32" ? "anydoc.exe" : "anydoc";
    out.push({ source: "bundled", path: path.join(bundledDir, exe), kind: "bin" });
  }
  return out;
}

/**
 * @param {{ prefix: string, spec?: string }} opts
 */
export function buildNpmInstallArgs(opts) {
  const spec = opts.spec || `${ANYDOC_NPM_SPEC}@latest`;
  return ["install", spec, "--prefix", opts.prefix, "--omit=dev", "--no-fund", "--no-audit"];
}

export function anydocInstallHints() {
  return {
    commands: [
      `npm install -g ${ANYDOC_NPM_SPEC}`,
      `npx --yes ${ANYDOC_NPM_SPEC} --version`,
    ],
    docsUrl: ANYDOC_DOCS_URL,
    label: "npm",
    preferredIndex: 0,
    hint:
      "默认转换器（无需 Python）。可点「安装到应用」写入用户数据目录；anydoc 升级不必重装 Desktop。asar 内应用代码升级仍需安装新版 Desktop。",
    canSidecarInstall: true,
  };
}

export function preferredAnydocInstallCommand() {
  return anydocInstallHints().commands[0];
}

/**
 * @param {string} pkgJsonPath
 * @param {(p: string, enc: string) => Promise<string>} [readFile]
 */
export async function readAnydocPackageVersion(pkgJsonPath, readFile = (p, enc) => fs.readFile(p, enc)) {
  try {
    const raw = await readFile(pkgJsonPath, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed?.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

/**
 * Resolve how to invoke anydoc. Prefer user-data sidecar over PATH over bundled.
 *
 * @param {{
 *   userDataDir?: string|null,
 *   bundledDir?: string|null,
 *   existsSync?: (p: string) => boolean,
 *   resolvePathBinary?: () => Promise<{ cmd: string, argsPrefix?: string[], display?: string, source?: string }|null>,
 *   resolveNode?: () => Promise<{ cmd: string, argsPrefix?: string[], display?: string }|null>,
 *   readVersion?: (p: string) => Promise<string|null>,
 * }} [opts]
 */
export async function resolveAnydocInvocation(opts = {}) {
  const userDataDir = opts.userDataDir !== undefined ? opts.userDataDir : getIngestUserDataDir();
  const bundledDir = opts.bundledDir !== undefined ? opts.bundledDir : getBundledAnydocDir();
  const exists = opts.existsSync || existsSync;
  const resolvePathBinary = opts.resolvePathBinary || (() => resolveSimpleBinary("anydoc"));
  const resolveNode = opts.resolveNode || (() => resolveSimpleBinary("node"));

  /** @type {Array<object>} */
  const candidates = [];

  const nodeInv = await resolveNode();
  const nodeCmd = nodeInv?.cmd;
  const nodePrefix = nodeInv?.argsPrefix || [];

  if (userDataDir) {
    const layout = sidecarLayout(userDataDir);
    const ok = exists(layout.cliJs) && isOutsideAsar(layout.cliJs);
    if (ok && nodeCmd) {
      const version = opts.readVersion
        ? await opts.readVersion(layout.pkgJson)
        : await readAnydocPackageVersion(layout.pkgJson);
      candidates.push({
        source: "user-data",
        exists: true,
        cmd: nodeCmd,
        argsPrefix: [...nodePrefix, layout.cliJs],
        display: layout.cliJs,
        version,
      });
    }
  }

  const pathBin = await resolvePathBinary();
  if (pathBin?.cmd) {
    candidates.push({
      source: "path",
      exists: true,
      cmd: pathBin.cmd,
      argsPrefix: pathBin.argsPrefix || [],
      display: pathBin.display || pathBin.cmd,
      version: null,
    });
  }

  if (bundledDir) {
    for (const item of listAnydocSidecarPaths(null, bundledDir)) {
      if (!exists(item.path)) continue;
      if (item.kind === "cli-js" && nodeCmd) {
        const version = item.pkgJson
          ? opts.readVersion
            ? await opts.readVersion(item.pkgJson)
            : await readAnydocPackageVersion(item.pkgJson)
          : null;
        candidates.push({
          source: "bundled",
          exists: true,
          cmd: nodeCmd,
          argsPrefix: [...nodePrefix, item.path],
          display: item.path,
          version,
        });
      } else if (item.kind === "bin") {
        candidates.push({
          source: "bundled",
          exists: true,
          cmd: item.path,
          argsPrefix: [],
          display: item.path,
          version: null,
        });
      }
    }
  }

  const picked = pickAnydocCandidate(candidates);
  currentInvocation = picked
    ? {
        cmd: picked.cmd,
        argsPrefix: picked.argsPrefix || [],
        display: picked.display || picked.cmd,
        source: picked.source,
        version: picked.version || null,
      }
    : null;
  return currentInvocation;
}

export function getAnydocInvocation() {
  return currentInvocation;
}

export function clearAnydocInvocation() {
  currentInvocation = null;
}

/**
 * User-triggered install / upgrade into userData (never asar).
 * @param {{
 *   userDataDir?: string|null,
 *   spec?: string,
 *   timeoutMs?: number,
 *   exec?: typeof tryExec,
 *   resolveNpm?: () => Promise<{ cmd: string, argsPrefix?: string[] }|null>,
 * }} [opts]
 */
export async function installAnydocSidecar(opts = {}) {
  const userDataDir = opts.userDataDir !== undefined ? opts.userDataDir : getIngestUserDataDir();
  if (!userDataDir) {
    throw new Error("无法定位用户数据目录，不能安装 anydoc sidecar");
  }
  const layout = sidecarLayout(userDataDir);
  if (!isOutsideAsar(layout.root)) {
    throw new Error("anydoc sidecar 路径落在 asar 内，拒绝写入（需重打包才会改 asar）");
  }
  await fs.mkdir(layout.root, { recursive: true });
  const resolveNpm = opts.resolveNpm || (() => resolveSimpleBinary("npm"));
  const npm = await resolveNpm();
  if (!npm?.cmd) {
    throw new Error(
      `未找到 npm。请先安装 Node.js 20+，或在终端执行: ${preferredAnydocInstallCommand()}`,
    );
  }
  const spec = opts.spec || `${ANYDOC_NPM_SPEC}@latest`;
  const args = [...(npm.argsPrefix || []), ...buildNpmInstallArgs({ prefix: layout.root, spec })];
  const exec = opts.exec || tryExec;
  const r = await exec(npm.cmd, args, { timeoutMs: opts.timeoutMs ?? 180_000 });
  if (!r.ok) {
    throw new Error(r.error || r.stderr || r.stdout || "npm install @firecrawl/anydoc failed");
  }
  if (!existsSync(layout.cliJs)) {
    throw new Error("npm install 完成但未找到 anydoc CLI（sidecar 不完整）");
  }
  const version = await readAnydocPackageVersion(layout.pkgJson);
  return {
    ok: true,
    version,
    path: layout.cliJs,
    source: "user-data",
    spec,
    outsideAsar: true,
  };
}

/**
 * @param {string} absPath
 * @param {{ format?: string|null, kind?: string, timeoutMs?: number, invocation?: object, exec?: typeof tryExec }} [opts]
 */
export async function runAnydocToMarkdown(absPath, opts = {}) {
  let inv = opts.invocation || currentInvocation;
  if (!inv) {
    inv = await resolveAnydocInvocation();
  }
  if (!inv) {
    throw new Error("anydoc not available");
  }
  const ext = path.extname(absPath).replace(/^\./u, "").toLowerCase();
  const format =
    opts.format !== undefined ? opts.format : anydocFormatForKind(opts.kind || "", ext);
  const args = [...(inv.argsPrefix || []), absPath];
  // Only pass --format when we have a kind-based (or CSV) hint.
  // Never invent docx/pdf/rtf from a mismatched extension — anydoc sniffs bytes.
  if (format) {
    args.push("--format", format);
  }
  const exec = opts.exec || tryExec;
  const r = await exec(inv.cmd, args, { timeoutMs: opts.timeoutMs ?? 90_000 });
  if (!r.ok) {
    const classified = classifyAnydocFailure(r.error || r.stderr || r.stdout || "conversion failed");
    const err = new Error(classified.message);
    err.code = classified.code;
    throw err;
  }
  const md = r.stdout || "";
  if (!md.trim()) {
    const err = new Error("anydoc: empty — 输出为空");
    err.code = "empty";
    throw err;
  }
  return {
    markdown: md,
    converter: "anydoc",
    version: inv.version || null,
  };
}

/**
 * Probe version via `anydoc --version` / `node cli.js --version`.
 * @param {{ cmd: string, argsPrefix?: string[] }} inv
 * @param {(cmd: string, args: string[], opts?: object) => Promise<{ ok: boolean, stdout?: string, stderr?: string }>} [exec]
 */
export async function probeAnydocVersion(inv, exec = tryExec) {
  if (!inv?.cmd) return null;
  const r = await exec(inv.cmd, [...(inv.argsPrefix || []), "--version"], { timeoutMs: 8000 });
  const text = `${r.stdout || ""}\n${r.stderr || ""}`.trim();
  const m = text.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/u);
  if (m) return m[1];
  const line = (r.stdout || r.stderr || "").split(/\r?\n/u)[0]?.trim();
  return line ? line.slice(0, 40) : null;
}
