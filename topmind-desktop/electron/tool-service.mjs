/**
 * ToolService — UTR adapter (bundled with Desktop engine) + Desktop AI tools.
 *
 * Product boundary:
 * - Desktop core work (save / capture / AI writeback) uses WorkspaceService.
 * - UTR is bundled under topmind-engine/utr for doctor + Tools console + agent CLI parity.
 * - Subprocess always uses utr/core/node-runtime.mjs (never raw Electron as Node).
 * - Modules load from engineRoot/utr (packaged + monorepo), not monorepo-relative ../../utr.
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { engineRootOf } from "./lib/path-model.mjs";
import { logError, logInfo } from "./lib/writeback.mjs";
import { buildDesktopAiTools } from "./ai-tools.mjs";
import { t as ei18n } from "./lib/electron-i18n.mjs";

function resolveEngineRoot(ctx) {
  if (ctx.engineRoot) return path.resolve(ctx.engineRoot);
  if (ctx.workspaceRoot) {
    try {
      return engineRootOf(ctx.workspaceRoot);
    } catch {
      /* fallthrough */
    }
  }
  return null;
}

/** Active user content root (truth). */
function resolveUserWorkspaceRoot(ctx) {
  const w = ctx.workspaceRoot;
  if (!w) return null;
  if (typeof w === "string") return path.resolve(w);
  if (typeof w === "object" && w.userWorkspaceRoot) return path.resolve(w.userWorkspaceRoot);
  return null;
}

function utrRoot(ctx) {
  const engineRoot = resolveEngineRoot(ctx);
  if (!engineRoot) return null;
  const root = path.join(engineRoot, "utr");
  // Minimum viable UTR: contracts + core
  if (!existsSync(root) || !existsSync(path.join(root, "core"))) return null;
  return { engineRoot, root };
}

/** Dynamic import of UTR modules from engine-rooted path (works packaged + dev). */
async function importUtrModule(found, relFromUtrRoot) {
  const abs = path.join(found.root, relFromUtrRoot);
  if (!existsSync(abs)) {
    throw new Error(`UTR module missing: ${relFromUtrRoot} (engine=${found.engineRoot})`);
  }
  return import(pathToFileURL(abs).href);
}

async function tryLoadUtr(ctx) {
  const found = utrRoot(ctx);
  if (!found) return { ok: false, reason: "utr-not-installed" };
  try {
    const { loadContractRegistry, listTools } = await importUtrModule(
      found,
      "core/contract-registry.mjs",
    );
    const registry = await loadContractRegistry({ engineRoot: found.engineRoot });
    return { ok: true, engineRoot: found.engineRoot, root: found.root, registry, listTools };
  } catch (err) {
    logError("tool", "UTR load failed", { error: err.message });
    return { ok: false, reason: "utr-load-failed", error: err.message };
  }
}

function pathContextFrom(ctx, engineRoot) {
  return {
    engineRoot,
    userWorkspaceRoot: resolveUserWorkspaceRoot(ctx),
  };
}

function unavailable(action, detail = {}) {
  return {
    ok: false,
    available: false,
    source: "utr",
    action,
    message: ei18n("utr.unavailable"),
    ...detail,
  };
}

export const ToolService = {
  /** Desktop-native AI tools (no UTR). */
  async buildAiTools(_p, ctx) {
    return buildDesktopAiTools(ctx);
  },

  async catalog(_p, ctx) {
    const loaded = await tryLoadUtr(ctx);
    if (!loaded.ok) return [];
    try {
      return loaded.listTools(loaded.registry);
    } catch (err) {
      logError("tool", "catalog failed", { error: err.message });
      return [];
    }
  },

  async preview({ kind, command, input }, ctx) {
    if (!kind || !command) throw new Error("kind and command required.");
    const loaded = await tryLoadUtr(ctx);
    if (!loaded.ok) return unavailable("preview", { kind, command, reason: loaded.reason });
    const { previewTool } = await importUtrModule(loaded, "core/tool-executor.mjs");
    return previewTool(loaded.registry, kind, command, input || {}, pathContextFrom(ctx, loaded.engineRoot));
  },

  async run({ kind, command, input, reviewed }, ctx) {
    if (!kind || !command) throw new Error("kind and command required.");
    const loaded = await tryLoadUtr(ctx);
    if (!loaded.ok) return unavailable("run", { kind, command, reason: loaded.reason });
    const { executeTool } = await importUtrModule(loaded, "core/tool-executor.mjs");
    return executeTool({
      registry: loaded.registry,
      kind,
      command,
      payload: input || {},
      pathContext: pathContextFrom(ctx, loaded.engineRoot),
      reviewed: Boolean(reviewed),
    });
  },

  /**
   * Prefer Desktop-native health; attach bundled UTR doctor when present.
   * includeMcp default false — schema-only MCP check; avoids extra work.
   */
  async doctor({ includeMcp }, ctx) {
    const { WorkspaceService } = await import("./workspace-service.mjs");
    const native = await WorkspaceService.workspaceHealth({}, ctx);
    const loaded = await tryLoadUtr(ctx);
    if (!loaded.ok) {
      logInfo("tool", "doctor: UTR unavailable, native health only", { reason: loaded.reason });
      return {
        ...native,
        utr: { available: false, reason: loaded.reason },
        message: ei18n("utr.nativeHealth"),
      };
    }
    try {
      const { doctorUtr } = await importUtrModule(loaded, "core/doctor.mjs");
      const userWs = resolveUserWorkspaceRoot(ctx);
      const utrResult = await doctorUtr({
        candidatePath: loaded.engineRoot,
        engineRoot: loaded.engineRoot,
        userWorkspaceRoot: userWs,
        includeMcp: Boolean(includeMcp),
      });
      return {
        ok: native.ok && utrResult.ok !== false,
        source: "desktop+utr",
        native,
        utr: { available: true, ...utrResult },
        issues: [
          ...(native.issues || []),
          ...((utrResult.issues || []).map((i) => ({ ...i, source: "utr" }))),
        ],
        pathContext: {
          engineRoot: loaded.engineRoot,
          userWorkspaceRoot: userWs,
        },
      };
    } catch (err) {
      logError("tool", "UTR doctor failed", { error: err.message });
      return {
        ...native,
        utr: { available: false, reason: "utr-doctor-failed", error: err.message },
      };
    }
  },

  /** Probe whether UTR is present (bundled engine or monorepo). */
  async status(_p, ctx) {
    const found = utrRoot(ctx);
    return {
      utrAvailable: Boolean(found),
      engineRoot: resolveEngineRoot(ctx),
      utrRoot: found?.root || null,
      userWorkspaceRoot: resolveUserWorkspaceRoot(ctx),
      bundled: Boolean(found),
    };
  },
};
