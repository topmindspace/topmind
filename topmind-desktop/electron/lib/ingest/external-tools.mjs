/**
 * Probe optional host tools: pandoc, markitdown.
 * Never auto-install — only report status + install hints.
 *
 * Detection and execution share host-bin resolution so Windows GUI PATH
 * starvation and py/python/python3 variants stay consistent.
 */
import path from "node:path";
import {
  clearHostBinCache,
  getAugmentedPath,
  resolveMarkitdown,
  resolveSimpleBinary,
  tryExec,
} from "../host-bin.mjs";
import { isDarwin, isWin32 } from "../platform.mjs";

/**
 * Install hints shown in Settings → 知识加工 (copyable).
 * Always recommend markitdown[all] — base package lacks pptx/docx extras.
 *
 * @returns {{
 *   pandoc: { commands: string[], docsUrl: string, label: string, preferredIndex: number, hint?: string },
 *   markitdown: { commands: string[], docsUrl: string, label: string, preferredIndex: number, hint?: string },
 * }}
 */
function platformHints() {
  const mdDocs = "https://github.com/microsoft/markitdown";
  const pdDocs = "https://pandoc.org/installing.html";
  // Shared copy: PPTX needs [all] (python-pptx etc.)
  const mdHint =
    "请装 markitdown[all]（含 PPTX/Office）。装完后点「重新检测」；仍未检出请完全退出再开 Desktop。";

  if (isDarwin()) {
    return {
      pandoc: {
        commands: ["brew install pandoc"],
        docsUrl: pdDocs,
        label: "Homebrew",
        preferredIndex: 0,
        hint: "通用文档转换增强；非必须。",
      },
      markitdown: {
        commands: [
          "pipx install 'markitdown[all]'",
          "pip3 install --user 'markitdown[all]'",
          "python3 -m pip install --user 'markitdown[all]'",
        ],
        docsUrl: mdDocs,
        label: "pipx / pip",
        preferredIndex: 0,
        hint: mdHint,
      },
    };
  }
  if (isWin32()) {
    return {
      pandoc: {
        commands: [
          "winget install --id JohnMacFarlane.Pandoc -e",
          "choco install pandoc",
        ],
        docsUrl: pdDocs,
        label: "winget / chocolatey",
        preferredIndex: 0,
        hint: "通用文档转换增强；非必须。",
      },
      // py -3 -m pip is most reliable on Windows (avoids wrong pip / Store stubs)
      markitdown: {
        commands: [
          'py -3 -m pip install "markitdown[all]"',
          'python -m pip install "markitdown[all]"',
          'pip install "markitdown[all]"',
        ],
        docsUrl: mdDocs,
        label: "Python pip",
        preferredIndex: 0,
        hint: `${mdHint} 需已安装 Python 3；GUI 会自动查找 Scripts 目录。`,
      },
    };
  }
  return {
    pandoc: {
      commands: ["sudo apt install pandoc", "sudo dnf install pandoc"],
      docsUrl: pdDocs,
      label: "apt / dnf",
      preferredIndex: 0,
      hint: "通用文档转换增强；非必须。",
    },
    markitdown: {
      commands: [
        "pipx install 'markitdown[all]'",
        "python3 -m pip install --user 'markitdown[all]'",
        "pip install --user 'markitdown[all]'",
      ],
      docsUrl: mdDocs,
      label: "pipx / pip",
      preferredIndex: 0,
      hint: mdHint,
    },
  };
}

/**
 * @typedef {{
 *   available: boolean,
 *   version: string|null,
 *   path: string,
 *   argvPrefix?: string[],
 *   viaModule?: boolean,
 *   source?: string,
 *   install: object,
 * }} ToolInfo
 */

/** @type {{ pandoc: ToolInfo, markitdown: ToolInfo, checkedAt: string, pathAugmented?: boolean } | null} */
let cache = null;
const CACHE_MS = 60_000;

/** @type {{ cmd: string, argsPrefix: string[] } | null} */
let pandocInvocation = null;
/** @type {{ cmd: string, argsPrefix: string[] } | null} */
let markitdownInvocation = null;

/**
 * @param {{ force?: boolean }} [opts]
 */
export async function probeExternalTools(opts = {}) {
  const now = Date.now();
  if (!opts.force && cache && now - Date.parse(cache.checkedAt) < CACHE_MS) {
    return cache;
  }

  if (opts.force) {
    clearHostBinCache();
    cache = null;
    pandocInvocation = null;
    markitdownInvocation = null;
  }

  // Ensure PATH is warmed for this process
  getAugmentedPath();

  const hints = platformHints();

  const [pandocResolved, mdResolved] = await Promise.all([
    resolveSimpleBinary("pandoc"),
    resolveMarkitdown(),
  ]);

  /** @type {ToolInfo} */
  let pandocInfo = {
    available: false,
    version: null,
    path: "pandoc",
    argvPrefix: [],
    install: hints.pandoc,
  };

  if (pandocResolved) {
    pandocInvocation = {
      cmd: pandocResolved.cmd,
      argsPrefix: pandocResolved.argsPrefix || [],
    };
    const ver = await tryExec(pandocResolved.cmd, ["--version"], { timeoutMs: 5000 });
    const line = (ver.stdout || ver.stderr || "").split("\n")[0] || "";
    const m = line.match(/pandoc\s+([\d.]+)/iu);
    pandocInfo = {
      available: true,
      version: m ? m[1] : line.slice(0, 40) || "ok",
      path: pandocResolved.display || pandocResolved.cmd,
      argvPrefix: [],
      source: pandocResolved.source,
      install: hints.pandoc,
    };
  } else {
    pandocInvocation = null;
  }

  /** @type {ToolInfo} */
  let markitdownInfo = {
    available: false,
    version: null,
    path: "markitdown",
    argvPrefix: [],
    viaModule: false,
    install: hints.markitdown,
  };

  if (mdResolved) {
    markitdownInvocation = {
      cmd: mdResolved.cmd,
      argsPrefix: mdResolved.argsPrefix || [],
    };
    markitdownInfo = {
      available: true,
      version: mdResolved.version || "ok",
      path: mdResolved.display || mdResolved.cmd,
      argvPrefix: mdResolved.argsPrefix || [],
      viaModule: Boolean(mdResolved.viaModule),
      source: mdResolved.source,
      install: hints.markitdown,
    };
  } else {
    markitdownInvocation = null;
  }

  cache = {
    pandoc: pandocInfo,
    markitdown: markitdownInfo,
    checkedAt: new Date().toISOString(),
    pathAugmented: true,
  };
  return cache;
}

/**
 * Run pandoc file → markdown.
 * @param {string} absPath
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function runPandocToMarkdown(absPath, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  if (!pandocInvocation) {
    await probeExternalTools({ force: false });
  }
  if (!pandocInvocation) {
    throw new Error("pandoc not available");
  }
  const { cmd, argsPrefix } = pandocInvocation;
  const r = await tryExec(
    cmd,
    [...argsPrefix, absPath, "-t", "gfm", "--wrap=none"],
    { timeoutMs },
  );
  if (!r.ok) throw new Error(formatToolFail("pandoc", r.error || r.stderr || "pandoc failed"));
  const md = r.stdout || "";
  if (!md.trim()) throw new Error("pandoc 输出为空");
  return { markdown: md, converter: "pandoc" };
}

/**
 * Run markitdown file → markdown (stdout).
 * @param {string} absPath
 * @param {{ viaModule?: boolean, timeoutMs?: number }} [opts]
 */
export async function runMarkitdownToMarkdown(absPath, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  if (!markitdownInvocation) {
    await probeExternalTools({ force: false });
  }
  if (!markitdownInvocation) {
    throw new Error("markitdown not available");
  }
  const { cmd, argsPrefix } = markitdownInvocation;
  // Hint extension when path is odd (temp names / missing ext after copy)
  const ext = path.extname(absPath).replace(/^\./u, "").toLowerCase();
  const args = [...argsPrefix, absPath];
  if (ext && !argsPrefix.includes("-x") && !argsPrefix.includes("--extension")) {
    // markitdown accepts -x after filename in some versions; safer before file
    args.splice(argsPrefix.length, 0, "-x", ext);
  }
  const r = await tryExec(cmd, args, { timeoutMs });
  if (!r.ok) {
    const detail = r.error || r.stderr || r.stdout || "markitdown failed";
    throw new Error(formatToolFail("markitdown", detail));
  }
  const md = r.stdout || "";
  if (!md.trim()) throw new Error("markitdown 输出为空（可能缺 [pptx]/all] 扩展依赖）");
  return { markdown: md, converter: "markitdown" };
}

/**
 * @param {string} tool
 * @param {string} detail
 */
function formatToolFail(tool, detail) {
  let d = String(detail || "").replace(/\s+/gu, " ").trim();
  // Common markitdown missing-extra on Windows when only base package installed
  if (/PptxConverter|python-pptx|No module named ['"]pptx['"]/iu.test(d)) {
    return `${tool}: 无法转换 PPTX（请安装 markitdown[all] 或 pip install python-pptx）`;
  }
  if (/FileConversionException/iu.test(d)) {
    const m = d.match(/threw\s+(\w+)\s+with\s+message:\s*"?([^"]+)"?/iu);
    if (m) return `${tool}: ${m[1]} — ${m[2].slice(0, 160)}`;
    return `${tool}: 转换失败`;
  }
  if (d.length > 220) d = `${d.slice(0, 217)}…`;
  return `${tool}: ${d}`;
}

export function clearExternalToolsCache() {
  cache = null;
  pandocInvocation = null;
  markitdownInvocation = null;
  clearHostBinCache();
}

/** Preferred install command for clipboard copy. */
export function preferredInstallCommand(tool) {
  const hints = platformHints();
  const key = tool === "markitdown" ? "markitdown" : "pandoc";
  const h = hints[key];
  const idx = typeof h.preferredIndex === "number" ? h.preferredIndex : 0;
  return h.commands[idx] || h.commands[0] || "";
}
