// ── Pure Kernel write-path operations (no Obsidian imports) ────────────────
//
// KernelService UI layer calls these. Unit/integration tests call them with a
// real Kernel API + temp workspace — no App/Notice required.

import fs from "node:fs";
import path from "node:path";
import type { KernelApi } from "../bridge/kernel-loader.ts";
import {
  stripFrontmatter,
  extractFrontmatter,
  seedPeriodFrontmatter,
  sanitizeFileName,
  normalizeCaptureText,
  mergeCaptureTags,
  mapKernelTodoItem,
} from "../utils.ts";
import type { StreamPeriod, TodoItem } from "../types.ts";

export interface CaptureOpts {
  target?: "stream" | "inbox";
  tags?: string[];
  writebackMode?: "auto" | "confirm";
}

/**
 * Capture text to stream period note or inbox via Kernel writeback.
 * Uses resolveStreamTarget.periodRelPath / periodAbsPath (not invented `relPath`).
 */
export function captureToWorkspace(
  kernel: KernelApi,
  workspaceRoot: string,
  engineRoot: string,
  text: string,
  opts: CaptureOpts = {},
): { ok: boolean; path?: string; error?: string } {
  if (!fs.existsSync(path.join(workspaceRoot, "topmind.yaml"))) {
    return { ok: false, error: "workspace-not-ready" };
  }

  const normalized = normalizeCaptureText(text);
  if (!normalized.ok || !normalized.text) {
    return { ok: false, error: normalized.error || "empty-text" };
  }
  const safeText = normalized.text;
  const captureContent = mergeCaptureTags(safeText, opts.tags);

  try {
    const contract = kernel.loadContract(workspaceRoot);
    const model = kernel.resolveWorkspaceModel({
      workspaceRoot,
      engineRoot,
      config: contract,
    });
    const target = opts.target || "stream";

    let relPath: string;
    let content: string;
    let targetPath: string;

    if (target === "stream") {
      const streamCat = kernel.findStreamCategory(model);
      if (!streamCat) {
        return { ok: false, error: "no-stream-category" };
      }

      const streamTarget = kernel.resolveStreamTarget({
        workspaceRoot,
        engineRoot,
        config: contract,
      });
      if (!streamTarget.periodRelPath || !streamTarget.periodAbsPath) {
        return {
          ok: false,
          error:
            streamTarget.packing === "atom"
              ? "atom-packing"
              : "no-period-path",
        };
      }
      relPath = streamTarget.periodRelPath;
      targetPath = streamTarget.periodAbsPath;
      const packing = streamTarget.packing || "weekly";
      const appendHeading = streamTarget.appendHeading || "day";

      const raw = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf-8") : "";
      const body = stripFrontmatter(raw);
      const newBody = kernel.appendToPeriodBody(body, {
        content: captureContent,
        packing,
        appendHeading,
      });
      const fm = extractFrontmatter(raw) || seedPeriodFrontmatter(relPath);
      content = `${fm}${newBody}`;
    } else {
      const buffer = model.categories.find((c) => c.role === "buffer" && c.directory);
      let inboxDir = buffer?.directory;
      if (!inboxDir) {
        try {
          inboxDir = fs.readdirSync(workspaceRoot, { withFileTypes: true })
            .find((e) => e.isDirectory() && /^00[ -]/.test(e.name))?.name;
        } catch {
          inboxDir = undefined;
        }
      }
      inboxDir = inboxDir || "00-Inbox";
      relPath = `${inboxDir}/${Date.now()}-${sanitizeFileName(safeText.slice(0, 30))}.md`;
      targetPath = path.join(workspaceRoot, relPath);
      content = `---\nsource_type: external-capture\ncreated: ${new Date().toISOString()}\ntags: [${(opts.tags || []).join(", ")}]\n---\n\n# ${safeText.slice(0, 80)}\n\n${captureContent}\n`;
    }

    const isUpdate = fs.existsSync(targetPath);
    const result = kernel.executeWrite({
      targetPath,
      content,
      workspaceRoot,
      contract,
      operation: isUpdate ? "update" : "create",
      actor: "user",
      confirmed: true,
      skipShadow: true,
      writebackModeOverride: opts.writebackMode,
    });

    if (result.pending) {
      return { ok: false, error: "pending-confirmation" };
    }
    return { ok: true, path: relPath.replace(/\\/g, "/") };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * List stream periods via Kernel async listStreamPeriods(options object).
 */
export async function listStreamPeriodsForWorkspace(
  kernel: KernelApi,
  workspaceRoot: string,
  engineRoot: string,
): Promise<{ periods: StreamPeriod[]; current: StreamPeriod | null }> {
  try {
    const contract = kernel.loadContract(workspaceRoot);
    const model = kernel.resolveWorkspaceModel({
      workspaceRoot,
      engineRoot,
      config: contract,
    });
    if (!kernel.findStreamCategory(model)) {
      return { periods: [], current: null };
    }

    const listed = await kernel.listStreamPeriods({
      workspaceRoot,
      engineRoot,
      config: contract,
      limit: 50,
    });

    const periods: StreamPeriod[] = listed.map((p) => {
      const fileName = p.fileName || path.basename(p.relPath || "");
      const period = fileName.replace(/\.md$/iu, "");
      const mtimeMs = p.mtime ? Date.parse(p.mtime) : 0;
      return {
        period,
        relPath: p.relPath,
        title: p.title || period,
        entryCount: 0,
        mtime: Number.isFinite(mtimeMs) ? mtimeMs : 0,
      };
    });
    return { periods, current: periods[0] || null };
  } catch {
    return { periods: [], current: null };
  }
}

/**
 * Reconcile period note via Kernel reconcilePeriodBody(body, opts) → { changed }.
 */
export function reconcilePeriodNote(
  kernel: KernelApi,
  workspaceRoot: string,
  engineRoot: string,
  relPath: string,
  opts: { writebackMode?: "auto" | "confirm" } = {},
): { ok: boolean; reconciled: boolean; error?: string } {
  try {
    const contract = kernel.loadContract(workspaceRoot);
    const absPath = path.join(workspaceRoot, relPath);
    if (!fs.existsSync(absPath)) {
      return { ok: false, reconciled: false, error: "period note not found" };
    }

    const raw = fs.readFileSync(absPath, "utf-8");
    const fm = extractFrontmatter(raw) || seedPeriodFrontmatter(relPath);
    const body = stripFrontmatter(raw);

    const streamTarget = kernel.resolveStreamTarget({
      workspaceRoot,
      engineRoot,
      config: contract,
    });
    const packing = streamTarget.packing || "weekly";
    const appendHeading = streamTarget.appendHeading || "day";

    const result = kernel.reconcilePeriodBody(body, { packing, appendHeading });
    if (!result.changed) {
      return { ok: true, reconciled: false };
    }

    const content = `${fm}${result.body}`;
    kernel.executeWrite({
      targetPath: absPath,
      content,
      workspaceRoot,
      contract,
      operation: "update",
      actor: "user",
      confirmed: true,
      skipShadow: true,
      writebackModeOverride: opts.writebackMode,
    });
    return { ok: true, reconciled: true };
  } catch (err) {
    return {
      ok: false,
      reconciled: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Read todos with Kernel `done` field mapping. */
export function readTodosFromWorkspace(
  kernel: KernelApi,
  workspaceRoot: string,
): TodoItem[] {
  try {
    const list = kernel.readTodoList(workspaceRoot);
    if (!list) return [];
    return ((list.items || []) as Record<string, unknown>[]).map(mapKernelTodoItem);
  } catch {
    return [];
  }
}

/**
 * First-time template seed: create all NN- dirs from templates/{id}.json
 * when vault has none (Desktop parity).
 */
export function seedFullTemplateIfEmpty(
  workspaceRoot: string,
  engineRoot: string,
  templateId: string,
): string[] {
  let discovered: string[] = [];
  try {
    discovered = fs
      .readdirSync(workspaceRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d{2}[ -].+/u.test(e.name))
      .map((e) => e.name);
  } catch {
    discovered = [];
  }
  if (discovered.length > 0) return [];

  const sep = "-";
  let categories: Record<string, { name: string }> | null = null;
  const tplPath = path.join(engineRoot, "templates", `${templateId}.json`);
  try {
    if (fs.existsSync(tplPath)) {
      const raw = JSON.parse(fs.readFileSync(tplPath, "utf-8")) as {
        categories?: Record<string, { name: string }>;
      };
      if (raw.categories) categories = raw.categories;
    }
  } catch {
    categories = null;
  }
  if (!categories) {
    categories = {
      "00": { name: "收件箱" },
      "10": { name: "动态" },
      "20": { name: "专题" },
      "88": { name: "输出" },
      "99": { name: "归档" },
    };
  }
  const created: string[] = [];
  for (const [slot, def] of Object.entries(categories)) {
    const dirName = `${slot}${sep}${def.name}`;
    const abs = path.join(workspaceRoot, dirName);
    if (!fs.existsSync(abs)) {
      fs.mkdirSync(abs, { recursive: true });
      created.push(dirName);
    }
  }
  return created;
}

/**
 * Initialize workspace: full template seed if empty + Kernel ensureRequiredStructure
 * (which runs ensureContract). Same contract path as Desktop/UTR — no private seed YAML.
 */
export function initWorkspaceStructure(
  kernel: KernelApi,
  workspaceRoot: string,
  engineRoot: string,
  templateId: string = "stream",
): {
  ok: boolean;
  error?: string;
  created?: string[];
  contractStatus?: string;
  contractOnDiskValid?: boolean;
  contractErrors?: string[];
  recovery?: string;
} {
  try {
    const created = seedFullTemplateIfEmpty(workspaceRoot, engineRoot, templateId);
    const ensured = kernel.ensureRequiredStructure(workspaceRoot, {
      engineRoot,
      templateId,
    });
    const onDiskValid = ensured.contractOnDiskValid !== false;
    if (!onDiskValid) {
      return {
        ok: false,
        created,
        contractStatus: ensured.contractStatus,
        contractOnDiskValid: false,
        contractErrors: ensured.contractErrors || [],
        recovery:
          "Contract unrepairable — use Kernel reseedContract (backs up bad topmind.yaml; content dirs kept) or repair manually.",
        error:
          (ensured.contractErrors && ensured.contractErrors[0]) ||
          "topmind.yaml is unrepairable",
      };
    }
    return {
      ok: true,
      created,
      contractStatus: ensured.contractStatus,
      contractOnDiskValid: true,
      contractErrors: ensured.contractErrors || [],
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** User-triggered recovery: backup bad contract + write fresh v4 defaults. */
export function reseedWorkspaceContract(
  kernel: KernelApi,
  workspaceRoot: string,
  opts: { templateId?: string; locale?: string } = {},
): { ok: boolean; error?: string; backupPath?: string | null; status?: string } {
  try {
    if (typeof kernel.reseedContract !== "function") {
      return { ok: false, error: "Kernel reseedContract not available" };
    }
    const result = kernel.reseedContract(workspaceRoot, opts);
    return {
      ok: result.onDiskValid === true,
      backupPath: result.backupPath ?? null,
      status: result.status,
      error: result.onDiskValid ? undefined : "reseed failed",
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Read operational writeback.mode from topmind.yaml (not plugin data.json). */
export function resolveContractWritebackMode(
  kernel: KernelApi,
  workspaceRoot: string,
): "auto" | "confirm" | null {
  try {
    const contract = kernel.loadContract(workspaceRoot) as {
      writeback?: { mode?: string };
    };
    const mode = contract?.writeback?.mode;
    if (mode === "auto" || mode === "confirm") return mode;
  } catch {
    /* missing or unreadable contract */
  }
  return null;
}

/**
 * Mirror Settings writeback dropdown into workspace topmind.yaml.
 * Plugin data.json stays a display cache only.
 */
export function mirrorWritebackModeToContract(
  kernel: KernelApi,
  workspaceRoot: string,
  mode: "auto" | "confirm",
): { ok: boolean; error?: string } {
  if (mode !== "auto" && mode !== "confirm") {
    return { ok: false, error: "invalid-mode" };
  }
  if (typeof kernel.writeContract !== "function") {
    return { ok: false, error: "Kernel writeContract not available" };
  }
  if (!fs.existsSync(path.join(workspaceRoot, "topmind.yaml"))) {
    return { ok: false, error: "workspace-not-ready" };
  }
  try {
    const current = kernel.loadContract(workspaceRoot) as {
      writeback?: Record<string, unknown>;
    };
    kernel.writeContract(workspaceRoot, {
      ...current,
      writeback: { ...(current.writeback || {}), mode },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
