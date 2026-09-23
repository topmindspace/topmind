/**
 * WechatService — skill-script export bypass for 公众号创作.
 *
 * When skills/topmind-wechat/scripts/md2wechat.py + Python are available,
 * export uses the skill truth source. Renderer TS path remains the fallback
 * (and the only path when scripts/Python are missing).
 *
 * Writes stay under the workspace package dir via absolute paths derived from
 * ctx.workspaceRoot (no bare fs from renderer).
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { tryExec, pythonRunners } from "./lib/host-bin.mjs";
import { defaultEngineCandidate, desktopAppRoot } from "./lib/engine-root.mjs";
import { sp } from "./lib/workspace-helpers.mjs";

const THEME_FILES = new Set(["minimal-ink", "tech-blue", "newsprint", "graphite"]);

function skillScriptsDir() {
  const candidates = [
    path.join(defaultEngineCandidate(), "skills", "topmind-wechat", "scripts"),
    path.join(desktopAppRoot(), "..", "skills", "topmind-wechat", "scripts"),
  ];
  for (const dir of candidates) {
    const abs = path.resolve(dir);
    if (existsSync(path.join(abs, "md2wechat.py"))) return abs;
  }
  return null;
}

function skillThemePath(themeId) {
  const id = THEME_FILES.has(themeId) ? themeId : "minimal-ink";
  const candidates = [
    path.join(defaultEngineCandidate(), "skills", "topmind-wechat", "assets", "themes", `${id}.json`),
    path.join(desktopAppRoot(), "..", "skills", "topmind-wechat", "assets", "themes", `${id}.json`),
  ];
  for (const p of candidates) {
    const abs = path.resolve(p);
    if (existsSync(abs)) return abs;
  }
  return null;
}

async function resolvePython() {
  for (const runner of pythonRunners()) {
    const probe = await tryExec(runner.cmd, [...runner.prefix, "--version"], { timeoutMs: 4000 });
    if (probe.ok || /Python\s+3\./i.test(`${probe.stdout} ${probe.stderr}`)) {
      return { cmd: runner.cmd, prefix: runner.prefix, label: runner.label };
    }
  }
  return null;
}

export const WechatService = {
  /**
   * Probe skill scripts + Python. Never throws — UI shows tool chips.
   * @returns {Promise<{ scripts: boolean, python: boolean, scriptsDir: string|null, pythonLabel: string|null, md2wechat: string|null }>}
   */
  async probeScripts() {
    const scriptsDir = skillScriptsDir();
    const md2wechat = scriptsDir ? path.join(scriptsDir, "md2wechat.py") : null;
    const scripts = Boolean(md2wechat && existsSync(md2wechat));
    const py = scripts ? await resolvePython() : null;
    return {
      scripts,
      python: Boolean(py),
      scriptsDir,
      pythonLabel: py?.label || null,
      md2wechat,
    };
  },

  /**
   * Export package draft via skill md2wechat.py --embed-images.
   * @param {{ packageRel: string, draftRel?: string, slug: string, title?: string, theme?: string, embedImages?: boolean, assetRoot?: string }} p
   */
  async exportViaScript(p, ctx) {
    const packageRel = String(p?.packageRel || "").replace(/\\/gu, "/");
    const slug = String(p?.slug || "article").replace(/[^\w一-鿿-]/gu, "-");
    if (!packageRel || packageRel.includes("..")) {
      throw new Error("wechat.exportViaScript: invalid packageRel");
    }
    const probe = await WechatService.probeScripts();
    if (!probe.scripts || !probe.python || !probe.md2wechat) {
      return {
        ok: false,
        reason: "scripts-unavailable",
        scripts: probe.scripts,
        python: probe.python,
      };
    }
    const packageAbs = await sp(ctx.workspaceRoot, packageRel);
    const draftRel = p?.draftRel || `${packageRel}/公众号稿.md`;
    const draftAbs = await sp(ctx.workspaceRoot, draftRel);
    if (!existsSync(draftAbs)) {
      throw new Error("wechat.exportViaScript: draft not found");
    }
    const py = await resolvePython();
    if (!py) {
      return { ok: false, reason: "python-unavailable" };
    }
    const themeAbs = skillThemePath(p?.theme || "minimal-ink");
    const args = [
      ...py.prefix,
      probe.md2wechat,
      "--input",
      draftAbs,
      "--out-dir",
      packageAbs,
      "--slug",
      slug,
    ];
    if (p?.title) args.push("--title", String(p.title));
    if (themeAbs) args.push("--theme", themeAbs);
    if (p?.assetRoot) args.push("--asset-root", String(p.assetRoot));
    if (p?.embedImages !== false) args.push("--embed-images");

    const run = await tryExec(py.cmd, args, { timeoutMs: 60_000 });
    const htmlRel = `${packageRel}/${slug}-公众号版.html`;
    const listRel = `${packageRel}/图片上传清单.md`;
    const stdout = (run.stdout || "").slice(0, 4000);
    const compliance = parseCompliance(stdout);
    return {
      ok: run.ok,
      reason: run.ok ? undefined : run.error || "script-failed",
      via: "skill-script",
      pythonLabel: py.label,
      htmlRel,
      listRel,
      compliance: compliance.ok ? "ok" : compliance.warned ? "warn" : null,
      complianceNote: compliance.note,
      embedCount: compliance.embedCount,
      stdout,
      stderr: (run.stderr || "").slice(0, 2000),
    };
  },
};

/** Parse md2wechat.py stdout compliance / embed lines (skill truth wording). */
export function parseCompliance(stdout) {
  const text = String(stdout || "");
  const note = (text.match(/合规自检\s*:\s*(.+)/) || [])[1] || "";
  const embed = (text.match(/图片内嵌\s*:\s*(.+)/) || [])[1] || "";
  const embedCount = Number((embed.match(/(\d+)\s*张/) || [])[1] || 0) || null;
  return {
    ok: /合规自检\s*:\s*✓/.test(text),
    warned: /合规自检\s*:\s*✗/.test(text),
    note: note.trim() || null,
    embedNote: embed.trim() || null,
    embedCount,
  };
}
