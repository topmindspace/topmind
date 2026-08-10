/**
 * Pure FS companion detection — agent hosts, browsers, Obsidian.
 * No Electron imports; fixture-testable via homeDir / platform / workspaceRoot opts.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";

/** Install receipt written by install-skills.mjs and companion-lifecycle.mjs */
export const SKILLS_RECEIPT_NAME = ".topmind-skills-install.json";

/**
 * Canonical agent host definitions (global user-level roots preferred).
 * opencode / codebuddy use best-effort multi-path probes.
 */
export const AGENT_HOST_DEFS = Object.freeze([
  {
    id: "claude-code",
    name: "Claude Code",
    hostRel: ".claude",
    skillsRel: path.join(".claude", "skills"),
  },
  {
    id: "codex",
    name: "Codex",
    hostRel: ".codex",
    skillsRel: path.join(".codex", "skills"),
  },
  {
    id: "hermes",
    name: "Hermes",
    hostRel: ".hermes",
    skillsRel: path.join(".hermes", "skills"),
  },
  {
    id: "opencode",
    name: "OpenCode",
    // skillsRel resolved dynamically
  },
  {
    id: "codebuddy",
    name: "CodeBuddy",
    // best-effort — may report present:false when paths unknown
  },
  {
    id: "workbuddy",
    name: "WorkBuddy",
    // best-effort — may report present:false when paths unknown
  },
]);

/**
 * @param {string} p
 * @returns {boolean}
 */
function isDir(p) {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * @param {string} p
 * @returns {boolean}
 */
function isFile(p) {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Detect whether topmind skills are installed under a skills root.
 * Looks for topmind-pack.json, topmind/SKILL.md, or .topmind-skills-install.json.
 *
 * @param {string} skillsRoot
 * @returns {{ installed: boolean, installedVersion: string|null, receiptPath: string|null, hasPack: boolean, hasRouter: boolean }}
 */
export function detectSkillsInstall(skillsRoot) {
  if (!skillsRoot || !isDir(skillsRoot)) {
    return {
      installed: false,
      installedVersion: null,
      receiptPath: null,
      hasPack: false,
      hasRouter: false,
    };
  }
  const receiptPath = path.join(skillsRoot, SKILLS_RECEIPT_NAME);
  const packPath = path.join(skillsRoot, "topmind-pack.json");
  const routerPath = path.join(skillsRoot, "topmind", "SKILL.md");
  const hasPack = isFile(packPath);
  const hasRouter = isFile(routerPath);
  let installedVersion = null;
  let hasReceipt = false;

  if (isFile(receiptPath)) {
    hasReceipt = true;
    try {
      const j = JSON.parse(readFileSync(receiptPath, "utf8"));
      if (j && typeof j === "object") {
        installedVersion =
          (typeof j.version === "string" && j.version) ||
          (typeof j.package_version === "string" && j.package_version) ||
          null;
      }
    } catch {
      /* corrupt receipt — still count as installed if pack/router present */
    }
  }
  if (!installedVersion && hasPack) {
    try {
      const j = JSON.parse(readFileSync(packPath, "utf8"));
      if (j?.version) installedVersion = String(j.version);
    } catch {
      /* */
    }
  }

  const installed = hasReceipt || hasPack || hasRouter;
  return {
    installed,
    installedVersion: installed ? installedVersion : null,
    receiptPath: hasReceipt ? receiptPath : null,
    hasPack,
    hasRouter,
  };
}

/**
 * Resolve OpenCode skills root (first hit wins).
 * @param {string} homeDir
 * @param {string} [cwd]
 */
export function resolveOpencodeSkillsRoot(homeDir, cwd = process.cwd()) {
  const candidates = [
    path.join(homeDir, ".config", "opencode", "skills"),
    path.join(homeDir, ".opencode", "skills"),
    path.join(cwd, ".opencode", "skills"),
  ];
  for (const c of candidates) {
    if (isDir(c) || isDir(path.dirname(c))) return c;
  }
  // Prefer XDG-style default even when absent (install target)
  return candidates[0];
}

/**
 * OpenCode host present if any conventional config dir exists.
 * @param {string} homeDir
 * @param {string} [cwd]
 */
export function isOpencodePresent(homeDir, cwd = process.cwd()) {
  return (
    isDir(path.join(homeDir, ".config", "opencode")) ||
    isDir(path.join(homeDir, ".opencode")) ||
    isDir(path.join(cwd, ".opencode")) ||
    isFile(path.join(homeDir, ".config", "opencode", "config.json")) ||
    isFile(path.join(homeDir, ".opencode", "config.json"))
  );
}

/**
 * Best-effort WorkBuddy probe (mirrors CodeBuddy pattern).
 * @param {string} homeDir
 * @param {string} [platform]
 */
export function resolveWorkbuddy(homeDir, platform = process.platform) {
  /** @type {string[]} */
  const hostCandidates = [path.join(homeDir, ".workbuddy")];
  /** @type {string[]} */
  const skillsCandidates = [path.join(homeDir, ".workbuddy", "skills")];

  if (platform === "darwin") {
    hostCandidates.push(
      "/Applications/WorkBuddy.app",
      path.join(homeDir, "Applications", "WorkBuddy.app"),
    );
  } else if (platform === "win32") {
    const pf = process.env.PROGRAMFILES || "C:\\Program Files";
    const pf86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const local = process.env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
    hostCandidates.push(
      path.join(pf, "WorkBuddy"),
      path.join(pf86, "WorkBuddy"),
      path.join(local, "WorkBuddy"),
      path.join(homeDir, ".workbuddy"),
    );
    skillsCandidates.push(path.join(local, "WorkBuddy", "skills"));
  } else {
    hostCandidates.push(
      path.join(homeDir, ".local", "share", "workbuddy"),
      "/opt/workbuddy",
    );
  }

  let hostPath = null;
  for (const c of hostCandidates) {
    if (isDir(c) || isFile(c)) {
      hostPath = c;
      break;
    }
  }
  let skillsRoot = null;
  for (const c of skillsCandidates) {
    if (isDir(c) || isDir(path.dirname(c))) {
      skillsRoot = c;
      break;
    }
  }
  if (hostPath && !skillsRoot) {
    skillsRoot = path.join(homeDir, ".workbuddy", "skills");
  }

  return {
    present: Boolean(hostPath),
    hostPath,
    skillsRoot: skillsRoot || path.join(homeDir, ".workbuddy", "skills"),
  };
}

/**
 * Best-effort CodeBuddy probe.
 * Intentional limit: product paths are not fully documented; report present only when a path is found.
 * @param {string} homeDir
 * @param {string} [platform]
 */
export function resolveCodebuddy(homeDir, platform = process.platform) {
  /** @type {string[]} */
  const hostCandidates = [path.join(homeDir, ".codebuddy")];
  /** @type {string[]} */
  const skillsCandidates = [path.join(homeDir, ".codebuddy", "skills")];

  if (platform === "darwin") {
    hostCandidates.push(
      "/Applications/CodeBuddy.app",
      path.join(homeDir, "Applications", "CodeBuddy.app"),
    );
  } else if (platform === "win32") {
    const pf = process.env.PROGRAMFILES || "C:\\Program Files";
    const pf86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const local = process.env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
    hostCandidates.push(
      path.join(pf, "CodeBuddy"),
      path.join(pf86, "CodeBuddy"),
      path.join(local, "CodeBuddy"),
      path.join(homeDir, ".codebuddy"),
    );
    skillsCandidates.push(path.join(local, "CodeBuddy", "skills"));
  } else {
    hostCandidates.push(
      path.join(homeDir, ".local", "share", "codebuddy"),
      "/opt/codebuddy",
    );
  }

  let hostPath = null;
  for (const c of hostCandidates) {
    if (isDir(c) || isFile(c)) {
      hostPath = c;
      break;
    }
  }
  let skillsRoot = null;
  for (const c of skillsCandidates) {
    if (isDir(c) || isDir(path.dirname(c))) {
      skillsRoot = c;
      break;
    }
  }
  // Default install target when host found but skills dir missing
  if (hostPath && !skillsRoot) {
    skillsRoot = path.join(homeDir, ".codebuddy", "skills");
  }

  return {
    present: Boolean(hostPath),
    hostPath,
    skillsRoot: skillsRoot || path.join(homeDir, ".codebuddy", "skills"),
  };
}

/**
 * @param {string} [homeDir]
 * @param {{ cwd?: string, platform?: string }} [opts]
 * @returns {Array<{
 *   id: string,
 *   name: string,
 *   present: boolean,
 *   skillsRoot: string|null,
 *   hostPath: string|null,
 *   installed: boolean,
 *   installedVersion: string|null,
 *   receiptPath?: string|null,
 * }>}
 */
export function resolveAgentHosts(homeDir = os.homedir(), opts = {}) {
  const home = path.resolve(homeDir || os.homedir());
  const cwd = opts.cwd || process.cwd();
  const platform = opts.platform || process.platform;
  /** @type {ReturnType<typeof resolveAgentHosts>} */
  const out = [];

  for (const def of AGENT_HOST_DEFS) {
    if (def.id === "opencode") {
      const present = isOpencodePresent(home, cwd);
      const skillsRoot = resolveOpencodeSkillsRoot(home, cwd);
      const det = detectSkillsInstall(skillsRoot);
      out.push({
        id: def.id,
        name: def.name,
        present,
        skillsRoot,
        hostPath: present
          ? isDir(path.join(home, ".config", "opencode"))
            ? path.join(home, ".config", "opencode")
            : isDir(path.join(home, ".opencode"))
              ? path.join(home, ".opencode")
              : path.join(cwd, ".opencode")
          : null,
        installed: det.installed,
        installedVersion: det.installedVersion,
        receiptPath: det.receiptPath,
      });
      continue;
    }
    if (def.id === "codebuddy") {
      const cb = resolveCodebuddy(home, platform);
      const det = detectSkillsInstall(cb.skillsRoot);
      out.push({
        id: def.id,
        name: def.name,
        present: cb.present,
        skillsRoot: cb.skillsRoot,
        hostPath: cb.hostPath,
        installed: det.installed,
        installedVersion: det.installedVersion,
        receiptPath: det.receiptPath,
      });
      continue;
    }
    if (def.id === "workbuddy") {
      const wb = resolveWorkbuddy(home, platform);
      const det = detectSkillsInstall(wb.skillsRoot);
      out.push({
        id: def.id,
        name: def.name,
        present: wb.present,
        skillsRoot: wb.skillsRoot,
        hostPath: wb.hostPath,
        installed: det.installed,
        installedVersion: det.installedVersion,
        receiptPath: det.receiptPath,
      });
      continue;
    }

    const hostPath = path.join(home, def.hostRel);
    const skillsRoot = path.join(home, def.skillsRel);
    const present = isDir(hostPath);
    const det = detectSkillsInstall(skillsRoot);
    out.push({
      id: def.id,
      name: def.name,
      present,
      skillsRoot,
      hostPath: present ? hostPath : null,
      installed: det.installed,
      installedVersion: det.installedVersion,
      receiptPath: det.receiptPath,
    });
  }

  // Generic: any extra skills roots with a topmind receipt (caller may pass extra roots later)
  return out;
}

/**
 * Browser app probes — present + path only (no silent install).
 * @param {string} [homeDir]
 * @param {string} [platform]
 * @returns {Array<{ id: 'chrome'|'edge'|'brave'|'chromium', name: string, present: boolean, path: string|null }>}
 */
export function resolveBrowsers(homeDir = os.homedir(), platform = process.platform) {
  const home = path.resolve(homeDir || os.homedir());
  /** @type {Array<{ id: 'chrome'|'edge'|'brave'|'chromium', name: string, candidates: string[] }>} */
  const defs = [];

  if (platform === "darwin") {
    const apps = (name) => [
      path.join("/Applications", name),
      path.join(home, "Applications", name),
    ];
    defs.push(
      { id: "chrome", name: "Google Chrome", candidates: apps("Google Chrome.app") },
      { id: "edge", name: "Microsoft Edge", candidates: apps("Microsoft Edge.app") },
      { id: "brave", name: "Brave", candidates: apps("Brave Browser.app") },
      { id: "chromium", name: "Chromium", candidates: apps("Chromium.app") },
    );
  } else if (platform === "win32") {
    const pf = process.env.PROGRAMFILES || "C:\\Program Files";
    const pf86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    defs.push(
      {
        id: "chrome",
        name: "Google Chrome",
        candidates: [
          path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
          path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
          path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
        ],
      },
      {
        id: "edge",
        name: "Microsoft Edge",
        candidates: [
          path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
          path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
        ],
      },
      {
        id: "brave",
        name: "Brave",
        candidates: [
          path.join(pf, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
          path.join(local, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        ],
      },
      {
        id: "chromium",
        name: "Chromium",
        candidates: [
          path.join(pf, "Chromium", "Application", "chrome.exe"),
          path.join(local, "Chromium", "Application", "chrome.exe"),
        ],
      },
    );
  } else {
    // Linux / other: common which paths
    defs.push(
      {
        id: "chrome",
        name: "Google Chrome",
        candidates: [
          "/usr/bin/google-chrome",
          "/usr/bin/google-chrome-stable",
          "/opt/google/chrome/chrome",
          "/snap/bin/chromium",
        ],
      },
      {
        id: "edge",
        name: "Microsoft Edge",
        candidates: ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable", "/opt/microsoft/msedge/msedge"],
      },
      {
        id: "brave",
        name: "Brave",
        candidates: ["/usr/bin/brave-browser", "/usr/bin/brave", "/opt/brave.com/brave/brave"],
      },
      {
        id: "chromium",
        name: "Chromium",
        candidates: ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"],
      },
    );
  }

  return defs.map((d) => {
    let found = null;
    for (const c of d.candidates) {
      if (existsSync(c)) {
        found = c;
        break;
      }
    }
    return { id: d.id, name: d.name, present: Boolean(found), path: found };
  });
}

/**
 * Known Obsidian plugin folder ids used by topmind.
 * Actual shipped id is `topmind-stream` (obsidian-plugin/manifest.json).
 */
export const OBSIDIAN_PLUGIN_IDS = Object.freeze(["topmind-stream", "topmind"]);

/**
 * @param {string} pluginsRoot
 * @returns {{ pluginInstalled: boolean, pluginVersion: string|null, pluginPath: string|null, pluginId: string|null }}
 */
export function detectObsidianPlugin(pluginsRoot) {
  if (!pluginsRoot || !isDir(pluginsRoot)) {
    return {
      pluginInstalled: false,
      pluginVersion: null,
      pluginPath: null,
      pluginId: null,
    };
  }
  for (const id of OBSIDIAN_PLUGIN_IDS) {
    const dir = path.join(pluginsRoot, id);
    if (!isDir(dir)) continue;
    let version = null;
    const manifestPath = path.join(dir, "manifest.json");
    if (isFile(manifestPath)) {
      try {
        const j = JSON.parse(readFileSync(manifestPath, "utf8"));
        version = j?.version ? String(j.version) : null;
      } catch {
        /* */
      }
    }
    return {
      pluginInstalled: true,
      pluginVersion: version,
      pluginPath: dir,
      pluginId: id,
    };
  }
  // Fallback: any folder starting with topmind that has manifest.json
  try {
    for (const name of readdirSync(pluginsRoot)) {
      if (!name.startsWith("topmind")) continue;
      const dir = path.join(pluginsRoot, name);
      if (!isDir(dir)) continue;
      const manifestPath = path.join(dir, "manifest.json");
      if (!isFile(manifestPath)) continue;
      let version = null;
      try {
        const j = JSON.parse(readFileSync(manifestPath, "utf8"));
        version = j?.version ? String(j.version) : null;
      } catch {
        /* */
      }
      return {
        pluginInstalled: true,
        pluginVersion: version,
        pluginPath: dir,
        pluginId: name,
      };
    }
  } catch {
    /* */
  }
  return {
    pluginInstalled: false,
    pluginVersion: null,
    pluginPath: null,
    pluginId: null,
  };
}

/**
 * Resolve Obsidian app + vault plugin state.
 * @param {{ homeDir?: string, workspaceRoot?: string|null, platform?: string }} [opts]
 */
export function resolveObsidian(opts = {}) {
  const homeDir = path.resolve(opts.homeDir || os.homedir());
  const platform = opts.platform || process.platform;
  const workspaceRoot = opts.workspaceRoot ? path.resolve(opts.workspaceRoot) : null;

  /** @type {string[]} */
  const appCandidates = [];
  if (platform === "darwin") {
    appCandidates.push(
      "/Applications/Obsidian.app",
      path.join(homeDir, "Applications", "Obsidian.app"),
    );
  } else if (platform === "win32") {
    const local = process.env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
    const pf = process.env.PROGRAMFILES || "C:\\Program Files";
    appCandidates.push(
      path.join(local, "Obsidian", "Obsidian.exe"),
      path.join(pf, "Obsidian", "Obsidian.exe"),
    );
  } else {
    appCandidates.push(
      "/usr/bin/obsidian",
      "/opt/Obsidian/obsidian",
      "/snap/bin/obsidian",
      path.join(homeDir, ".local", "bin", "obsidian"),
      path.join(homeDir, "AppImages", "Obsidian.AppImage"),
    );
  }

  let appPath = null;
  for (const c of appCandidates) {
    if (existsSync(c)) {
      appPath = c;
      break;
    }
  }

  let vaultPluginsRoot = null;
  if (workspaceRoot) {
    const plugins = path.join(workspaceRoot, ".obsidian", "plugins");
    // Report path when .obsidian exists (even if plugins/ not yet created)
    if (isDir(path.join(workspaceRoot, ".obsidian")) || isDir(plugins)) {
      vaultPluginsRoot = plugins;
    }
  }

  const plugin = detectObsidianPlugin(vaultPluginsRoot);

  return {
    appPresent: Boolean(appPath),
    appPath,
    vaultPluginsRoot,
    pluginInstalled: plugin.pluginInstalled,
    pluginVersion: plugin.pluginVersion,
    pluginPath: plugin.pluginPath,
    pluginId: plugin.pluginId,
    workspaceRoot,
  };
}

/**
 * Combined companion status snapshot.
 * @param {{
 *   homeDir?: string,
 *   workspaceRoot?: string|null,
 *   platform?: string,
 *   cwd?: string,
 * }} [opts]
 */
export function detectCompanions(opts = {}) {
  const homeDir = opts.homeDir || os.homedir();
  const platform = opts.platform || process.platform;
  const agents = resolveAgentHosts(homeDir, { cwd: opts.cwd, platform });
  const browsers = resolveBrowsers(homeDir, platform);
  const obsidian = resolveObsidian({
    homeDir,
    workspaceRoot: opts.workspaceRoot,
    platform,
  });
  return {
    agents,
    browsers,
    obsidian,
    checkedAt: new Date().toISOString(),
  };
}
