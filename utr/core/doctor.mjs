import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { t } from "./i18n-strings.mjs";
import { loadContractRegistry } from "./contract-registry.mjs";
import {
  archiveRoot,
  userWorkspaceCategoriesRoot,
  inboxRoot,
  resolveUtrWorkspaceContext,
} from "./workspace-context.mjs";
import { buildMcpToolList } from "../server/tool-mapper.mjs";
import { parseToolOutput, unwrapToolData } from "./result-envelope.mjs";
import { nodeExecFileOptions } from "./node-runtime.mjs";

const execFileAsync = promisify(execFile);

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function checkOk(items) {
  return items.every((item) => item.ok === true);
}

function mapWorkspaceIssueCode(code) {
  // v3.2 issue code mapping: rename v2.x codes to v3.1 ones, keep new v3.x codes
  const known = {
    "forbidden-workspace-entry": "workspace-forbidden-entry",
    "runtime-state-in-user-workspace": "workspace-runtime-state",
    "unsupported-workspace-root": "workspace-unsupported-root",
    "deprecated-note-field": "workspace-deprecated-note-field",
    "unsupported-note-status": "workspace-unsupported-note-status",
    "topic-placeholder-dir": "workspace-topic-placeholder-dir",
    "missing-topic-structure": "workspace-missing-topic-structure",
    "missing-path": "workspace-missing-path",
    "v2-legacy-projects-root": "workspace-v2-legacy-projects-root",
    "v2-deprecated-workspace-root": "workspace-v2-deprecated-workspace-root",
    "reserved-slot-activated": "workspace-reserved-slot-activated",
    "v2-default-anchor-drift": "workspace-v2-default-anchor-drift",
    "unknown-category": "workspace-unknown-category",
  };
  return known[code] || `workspace-${code}`;
}

async function probeRuntime(runtime) {
  try {
    if (runtime === "node") {
      const { executable, opts } = nodeExecFileOptions({
        timeout: 5000,
        maxBuffer: 1024 * 128,
      });
      const { stdout, stderr } = await execFileAsync(executable, ["--version"], opts);
      return {
        runtime,
        ok: true,
        version: String(stdout || stderr).trim(),
      };
    }
    const { stdout, stderr } = await execFileAsync(runtime, ["--version"], {
      timeout: 5000,
      maxBuffer: 1024 * 128,
    });
    return {
      runtime,
      ok: true,
      version: String(stdout || stderr).trim(),
    };
  } catch (error) {
    return {
      runtime,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function pushIssue(issues, severity, code, message, extra = {}) {
  issues.push({ severity, code, message, ...extra });
}

export async function doctorUtr(options = {}) {
  const generatedAt = new Date().toISOString();
  const issues = [];
  let context;
  let pluginCheck = { ok: true, skipped: true, pluginCount: 0, declaredToolCount: 0, plugins: [] };
  let workspaceCheck = { ok: true, skipped: true, summary: { topicCount: 0, errorCount: 0, warningCount: 0 } };

  try {
    context = await resolveUtrWorkspaceContext(options.candidatePath || process.cwd(), {
      engineRoot: options.engineRoot,
      userWorkspaceRoot: options.userWorkspaceRoot || options.workspaceRoot,
    });
  } catch (error) {
    return {
      ok: false,
      generatedAt,
      paths: null,
      registry: { toolCount: 0, commandCount: 0, skills: [] },
      checks: {
        paths: { ok: false, items: [] },
        contracts: { ok: false, error: error instanceof Error ? error.message : String(error) },
        scripts: { ok: false, checkedCount: 0, missing: [] },
        workspace: { ok: false, skipped: true, summary: { topicCount: 0, errorCount: 0, warningCount: 0 } },
        runtimes: { ok: false, items: [] },
        mcp: { ok: false, skipped: true },
      },
      issues: [{
        severity: "error",
        code: "workspace-context",
        message: error instanceof Error ? error.message : String(error),
      }],
    };
  }

  const paths = {
    engineRoot: context.engineRoot,
    userWorkspaceRoot: context.userWorkspaceRoot,
    categoriesRoot: userWorkspaceCategoriesRoot(context),
    inboxRoot: inboxRoot(context),
    archiveRoot: archiveRoot(context),
  };

  const pathItems = await Promise.all(
    Object.entries(paths).map(async ([label, targetPath]) => ({
      label,
      path: targetPath,
      ok: await pathExists(targetPath),
    })),
  );
  for (const item of pathItems) {
    if (!item.ok) {
      pushIssue(issues, "error", "missing-path", t("error.pathMissing", { label: item.label, path: item.path }), { path: item.path });
    }
  }

  let registry;
  let contractCheck = { ok: false, error: null };
  try {
    registry = await loadContractRegistry({ engineRoot: context.engineRoot });
    pluginCheck = registry.pluginValidation
      ? { ok: registry.pluginValidation.ok, skipped: false, ...registry.pluginValidation }
      : pluginCheck;
    contractCheck = {
      ok: true,
      toolCount: registry.toolCount,
      commandCount: registry.commandCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pushIssue(issues, "error", "contract-registry", message);
    registry = { byKind: new Map(), byCommand: new Map(), toolCount: 0, commandCount: 0 };
    contractCheck = { ok: false, error: message };
    pluginCheck = { ok: false, skipped: false, pluginCount: 0, declaredToolCount: 0, plugins: [], error: message };
  }

  const scriptItems = [];
  const runtimes = new Set();
  for (const contract of registry.byKind.values()) {
    const runtime = contract.execution?.runtime || "node";
    const script = contract.execution?.script || "";
    runtimes.add(runtime);
    if (!script) {
      scriptItems.push({ kind: contract.kind, script, path: "", ok: false });
      continue;
    }
    const scriptPath = path.resolve(context.engineRoot, script);
    scriptItems.push({
      kind: contract.kind,
      script,
      path: scriptPath,
      ok: await pathExists(scriptPath),
    });
  }
  const missingScripts = scriptItems.filter((item) => !item.ok);
  for (const item of missingScripts) {
    pushIssue(issues, "error", "missing-script", t("error.scriptMissing", { kind: item.kind, script: item.script }), { path: item.path });
  }

  const runtimeItems = await Promise.all(Array.from(runtimes).map(probeRuntime));
  for (const item of runtimeItems) {
    if (!item.ok) {
      pushIssue(issues, "error", "missing-runtime", t("error.runtimeUnavailable", { runtime: item.runtime }), { runtime: item.runtime });
    }
  }

  let mcpCheck = { ok: true, skipped: true };
  if (options.includeMcp) {
    try {
      const tools = buildMcpToolList(registry);
      // Default MCP surface = primary + danger (advanced hidden unless topmind_MCP_ALL=1)
      const expectedToolCount = tools.length; // self-consistent with same filter
      // Also verify against registry exposure counts
      let primaryOrDanger = 0;
      for (const [, entry] of registry.byCommand) {
        const exp = entry.command?.exposure || "advanced";
        if (process.env.topmind_MCP_ALL === "1" || process.env.topmind_MCP_ALL === "true") {
          primaryOrDanger += 1;
        } else if (exp === "primary" || exp === "danger") {
          primaryOrDanger += 1;
        }
      }
      mcpCheck = {
        ok: tools.length === primaryOrDanger,
        skipped: false,
        mode: "schema",
        toolCount: tools.length,
        expectedToolCount: primaryOrDanger,
        registryCommandCount: registry.commandCount,
        surface: process.env.topmind_MCP_ALL ? "all" : "primary+danger",
      };
      if (!mcpCheck.ok) {
        pushIssue(issues, "error", "mcp-tool-count", t("error.mcpToolCountMismatch", { actual: tools.length, expected: primaryOrDanger, total: registry.commandCount }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      mcpCheck = { ok: false, skipped: false, error: message };
      pushIssue(issues, "error", "mcp-schema", message);
    }
  }

  try {
    // Use shared node-runtime so Electron never spawns a second app/Dock icon
    const { executable: nodeRuntime, opts: runOpts } = nodeExecFileOptions({
      cwd: context.engineRoot,
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
    const workspaceDoctorScript = path.resolve(context.engineRoot, "utr/tools/workspace-maintain.mjs");
    const { stdout } = await execFileAsync(
      nodeRuntime,
      [
        workspaceDoctorScript,
        "--categories-root",
        paths.categoriesRoot,
        "--inbox-root",
        paths.inboxRoot,
        "--archive-root",
        paths.archiveRoot,
        "--format",
        "json",
        "doctor-workspace",
      ],
      runOpts,
    );
    const parsed = parseToolOutput(stdout).parsed;
    const workspaceReport = unwrapToolData(parsed);
    workspaceCheck = {
      ok: workspaceReport.ok === true,
      skipped: false,
      summary: workspaceReport.summary || { topicCount: 0, errorCount: 0, warningCount: 0 },
      topicCount: workspaceReport.summary?.topicCount ?? 0,
      metadataFilesChecked: workspaceReport.summary?.metadataFilesChecked ?? 0,
    };
    for (const issue of workspaceReport.issues || []) {
      pushIssue(
        issues,
        issue.severity || "error",
        mapWorkspaceIssueCode(issue.code),
        issue.message,
        issue.path ? { path: issue.path } : {},
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    workspaceCheck = { ok: false, skipped: false, error: message, summary: { topicCount: 0, errorCount: 1, warningCount: 0 } };
    pushIssue(issues, "error", "workspace-doctor", t("error.workspaceDoctorFailed"), { detail: message });
  }

  const skills = Array.from(new Set(
    Array.from(registry.byKind.values()).map((contract) => contract.skill).filter(Boolean),
  )).sort();

  const checks = {
    paths: { ok: checkOk(pathItems), items: pathItems },
    contracts: contractCheck,
    plugins: pluginCheck,
    scripts: {
      ok: missingScripts.length === 0,
      checkedCount: scriptItems.length,
      missing: missingScripts,
    },
    workspace: workspaceCheck,
    runtimes: {
      ok: checkOk(runtimeItems),
      items: runtimeItems,
    },
    mcp: mcpCheck,
  };

  return {
    ok: issues.filter((issue) => issue.severity === "error").length === 0,
    generatedAt,
    paths,
    registry: {
      toolCount: registry.toolCount,
      commandCount: registry.commandCount,
      skills,
    },
    checks,
    issues,
  };
}

export function formatDoctorText(report) {
  const lines = [
    "topmind UTR Doctor (categories + topics)",
    `status: ${report.ok ? "ok" : "needs-attention"}`,
  ];

  if (report.paths) {
    lines.push(`engineRoot: ${report.paths.engineRoot}`);
    lines.push(`userWorkspaceRoot: ${report.paths.userWorkspaceRoot}`);
  }

  lines.push(`contracts: ${report.checks.contracts.ok ? "ok" : "failed"} (${report.registry.toolCount} tools / ${report.registry.commandCount} commands)`);
  if (!report.checks.plugins.skipped) {
    lines.push(`plugins: ${report.checks.plugins.ok ? "ok" : "failed"} (${report.checks.plugins.pluginCount ?? 0} manifests / ${report.checks.plugins.declaredToolCount ?? 0} declared tools)`);
  }
  lines.push(`scripts: ${report.checks.scripts.ok ? "ok" : "failed"} (${report.checks.scripts.checkedCount} checked)`);
  if (!report.checks.workspace.skipped) {
    lines.push(`workspace: ${report.checks.workspace.ok ? "ok" : "needs-attention"} (${report.checks.workspace.summary.topicCount} topics, ${report.checks.workspace.summary.errorCount} errors, ${report.checks.workspace.summary.warningCount} warnings)`);
  }
  lines.push(`runtimes: ${report.checks.runtimes.ok ? "ok" : "failed"}`);
  if (!report.checks.mcp.skipped) {
    lines.push(`mcp: ${report.checks.mcp.ok ? "ok" : "failed"} (${report.checks.mcp.toolCount ?? 0}/${report.checks.mcp.expectedToolCount ?? 0} tools)`);
  }

  if (report.issues.length > 0) {
    lines.push("issues:");
    for (const issue of report.issues) {
      lines.push(`- [${issue.severity}] ${issue.code}: ${issue.message}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
