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

function resolveInsideWorkspace(
  kernel: KernelApi,
  workspaceRoot: string,
  relativePath: string,
): { ok: true; abs: string; rel: string } | { ok: false; error: string } {
  const rel = String(relativePath || "").replace(/\\/gu, "/").replace(/^\/+/u, "");
  if (!rel || rel.includes("..")) {
    return { ok: false, error: "invalid-relative-path" };
  }
  const abs = path.resolve(workspaceRoot, rel);
  if (typeof kernel.isPathInsideWorkspace === "function") {
    if (!kernel.isPathInsideWorkspace(workspaceRoot, abs)) {
      return { ok: false, error: "path-outside-workspace" };
    }
  } else {
    const root = path.resolve(workspaceRoot);
    const inside = abs === root ? false : !path.relative(root, abs).startsWith("..");
    if (!inside) return { ok: false, error: "path-outside-workspace" };
  }
  return { ok: true, abs, rel };
}

export interface WorkspaceReadOpts {
  relativePath: string;
  offset?: number;
  limit?: number;
  around?: string;
  heading?: string;
  contextLines?: number;
}

/**
 * Kernel-backed windowed read (numbered lines + around/heading).
 * Same contract as Desktop `read_file` / `readPathWindow`.
 */
export function readWorkspaceWindow(
  kernel: KernelApi,
  workspaceRoot: string,
  opts: WorkspaceReadOpts,
): {
  ok: boolean;
  error?: string;
  window?: ReturnType<NonNullable<KernelApi["formatReadWindow"]>>;
} {
  const loc = resolveInsideWorkspace(kernel, workspaceRoot, opts.relativePath);
  if (!loc.ok) return { ok: false, error: loc.error };
  if (!fs.existsSync(loc.abs) || !fs.statSync(loc.abs).isFile()) {
    return { ok: false, error: "file-not-found" };
  }
  if (typeof kernel.formatReadWindow !== "function") {
    return { ok: false, error: "kernel-formatReadWindow-missing" };
  }
  const full = fs.readFileSync(loc.abs, "utf-8");
  const win = kernel.formatReadWindow(full, {
    relativePath: loc.rel,
    offset: opts.offset,
    limit: opts.limit,
    around: opts.around,
    heading: opts.heading,
    contextLines: opts.contextLines,
    maxLimit: 5000,
    maxChars: 80_000,
  });
  return { ok: true, window: win };
}

export interface WorkspaceEditOpts {
  relativePath: string;
  oldText: string;
  newText: string;
  replaceAll?: boolean;
  startLine?: number;
  endLine?: number;
  heading?: string;
  actor?: "user" | "ai";
  confirmed?: boolean;
  writebackMode?: "auto" | "confirm";
}

/**
 * Kernel-backed unique-span edit + writeback-engine.
 * Same match/refuse/diagnostic contract as Desktop `pathOps.editPath`.
 */
export function preciseEditWorkspace(
  kernel: KernelApi,
  workspaceRoot: string,
  opts: WorkspaceEditOpts,
): {
  ok: boolean;
  error?: string;
  diagnostic?: string;
  reason?: string;
  count?: number;
  pending?: boolean;
  needsConfirm?: boolean;
  targetPath?: string;
  replacements?: number;
  matchMode?: string;
  wroteFiles?: boolean;
} {
  if (!opts.relativePath?.endsWith(".md")) {
    return { ok: false, error: "md-only", reason: "md-only" };
  }
  const loc = resolveInsideWorkspace(kernel, workspaceRoot, opts.relativePath);
  if (!loc.ok) return { ok: false, error: loc.error, reason: loc.error };
  if (!fs.existsSync(loc.abs)) {
    return { ok: false, error: "file-not-found", reason: "file-not-found" };
  }
  if (typeof kernel.applyUniqueSpan !== "function") {
    return { ok: false, error: "kernel-applyUniqueSpan-missing", reason: "missing-matcher" };
  }
  const old = fs.readFileSync(loc.abs, "utf-8");
  const applied = kernel.applyUniqueSpan(old, {
    oldText: opts.oldText,
    newText: opts.newText,
    replaceAll: Boolean(opts.replaceAll),
    startLine: opts.startLine,
    endLine: opts.endLine,
    heading: opts.heading,
    path: loc.rel,
  });
  if (!applied.ok) {
    return {
      ok: false,
      error: applied.reason,
      reason: applied.reason,
      count: applied.count,
      diagnostic: applied.diagnostic,
      targetPath: loc.rel,
      replacements: 0,
      wroteFiles: false,
    };
  }
  if (applied.next === old) {
    return {
      ok: true,
      targetPath: loc.rel,
      replacements: 0,
      matchMode: applied.mode,
      wroteFiles: false,
    };
  }
  try {
    const contract = kernel.loadContract(workspaceRoot);
    const result = kernel.executeWrite({
      targetPath: loc.abs,
      content: applied.next,
      workspaceRoot,
      contract,
      operation: "edit",
      actor: opts.actor || "ai",
      confirmed: opts.confirmed === true,
      skipShadow: true,
      writebackModeOverride: opts.writebackMode,
    });
    if (result.pending) {
      return {
        ok: false,
        pending: true,
        needsConfirm: true,
        targetPath: loc.rel,
        replacements: 0,
        matchMode: applied.mode,
        wroteFiles: false,
        error: "pending-confirmation",
        reason: "pending",
      };
    }
    return {
      ok: true,
      targetPath: loc.rel,
      replacements: applied.replacements,
      matchMode: applied.mode,
      wroteFiles: result.wroteFiles !== false,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      reason: "write-failed",
      targetPath: loc.rel,
      wroteFiles: false,
    };
  }
}

export type WorkspaceChatGenerate = (
  prompt: string,
  context?: Record<string, unknown>,
) => Promise<string>;

export interface WorkspaceChatTurnOpts {
  userMessage: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  generate: WorkspaceChatGenerate;
  locale?: string;
  writebackMode?: "auto" | "confirm";
  systemExtra?: string;
  maxSteps?: number;
}

function parseToolCall(text: string): Record<string, unknown> | null {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const obj = JSON.parse(s) as unknown;
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
      const rec = obj as Record<string, unknown>;
      const tool = String(rec.tool || rec.name || "");
      if (tool === "read_file" || tool === "edit_file") return rec;
      return null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(trimmed);
  if (direct) return direct;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/u);
  if (fence) {
    const inner = tryParse(fence[1].trim());
    if (inner) return inner;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return tryParse(trimmed.slice(start, end + 1));
  }
  return null;
}

function toolResultForModel(result: unknown): string {
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

/**
 * Same mapping as Desktop `resolvePromptLocale`: `en*` → English, else Chinese.
 */
export function resolveChatPromptLocale(locale?: string | null): "zh" | "en" {
  if (locale == null || locale === "") return "zh";
  return String(locale).startsWith("en") ? "en" : "zh";
}

/**
 * Chat tool + writeback/protection/edit instructions (shipped; tests drive this).
 */
export function buildObsidianChatToolGuide(
  locale?: string | null,
  writebackMode?: "auto" | "confirm",
): string {
  const lang = resolveChatPromptLocale(locale);
  const confirm = writebackMode === "confirm";
  if (lang === "en") {
    const writeback = confirm
      ? "Writeback: ask before save — you may call edit_file/read_file; results pending until accept; locked notes refuse unconfirmed AI overwrite (protection outranks writeback)."
      : "Writeback: auto-save — you may call edit_file; locked notes refuse unconfirmed AI overwrite (protection outranks writeback).";
    return [
      "You can call workspace tools. To read/edit a file, emit a single JSON object and nothing else:",
      '{"tool":"read_file","relativePath":"10-动态/2026-W33.md","around":"unique phrase","limit":80}',
      '{"tool":"edit_file","relativePath":"…","oldText":"unique span","newText":"replacement","startLine":12,"endLine":20}',
      "read_file returns numbered lines (N|text). edit_file is unique-span (exact, then newline/trailing-space); ambiguous matches refuse — not exact-only.",
      writeback,
      "When done, write only the user-visible answer — no chain-of-thought, <think>, or reasoning fences.",
    ].join("\n");
  }
  const writeback = confirm
    ? "写回: 保存前问我 — 可调用 edit_file/read_file；结果待确认后落盘；锁定笔记拒绝未确认的 AI 覆盖（保护级别优先于写回模式）。"
    : "写回: 自动保存 — 可调用 edit_file；锁定笔记拒绝未确认的 AI 覆盖（保护级别优先于写回模式）。";
  return [
    "你可以调用工作区工具。需要读/改文件时，只输出一个 JSON 对象（不要夹杂其他文字）：",
    '{"tool":"read_file","relativePath":"10-动态/2026-W33.md","around":"唯一短语","limit":80}',
    '{"tool":"edit_file","relativePath":"…","oldText":"原文唯一片段","newText":"替换","startLine":12,"endLine":20}',
    "read_file 返回 numbered 行（N|正文）。edit_file 先精确再容忍换行/行尾空白；多处命中会拒绝（不是只接受逐字节精确匹配）。",
    writeback,
    "完成后只写用户可见结论，不要输出思考过程、<think> 或推理围栏。",
  ].join("\n");
}

/**
 * Bounded read → precise edit loop (Obsidian chat).
 * Same Kernel matcher + writeback as Desktop; generate() is the host provider.
 */
export async function runWorkspaceChatTurn(
  kernel: KernelApi,
  workspaceRoot: string,
  opts: WorkspaceChatTurnOpts,
): Promise<{ body: string; reasoning: string; edits: Array<Record<string, unknown>>; steps: number }> {
  const lang = resolveChatPromptLocale(opts.locale);
  const isZh = lang === "zh";
  const maxSteps = Math.max(1, Math.min(8, Math.floor(Number(opts.maxSteps) || 6)));
  const modeHint = resolveContractWritebackMode(kernel, workspaceRoot) || opts.writebackMode || "auto";
  const toolGuide = buildObsidianChatToolGuide(opts.locale, modeHint);

  const conversation: string[] = [];
  for (const msg of (opts.history || []).slice(-10)) {
    conversation.push(`${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`);
  }
  conversation.push(`User: ${opts.userMessage}`);

  const edits: Array<Record<string, unknown>> = [];
  let lastRaw = "";
  const mode = modeHint;

  for (let step = 0; step < maxSteps; step++) {
    const prompt = conversation.join("\n\n");
    const raw = await opts.generate(prompt, {
      operation: "chat",
      systemPrompt: `${opts.systemExtra || ""}\n\n${toolGuide}`.trim(),
      maxOutputTokens: 4096,
      temperature: 0.4,
    });
    lastRaw = String(raw || "");
    const call = parseToolCall(lastRaw);
    if (!call) break;

    const tool = String(call.tool || call.name || "");
    if (tool === "read_file") {
      const read = readWorkspaceWindow(kernel, workspaceRoot, {
        relativePath: String(call.relativePath || ""),
        offset: typeof call.offset === "number" ? call.offset : undefined,
        limit: typeof call.limit === "number" ? call.limit : 80,
        around: typeof call.around === "string" ? call.around : undefined,
        heading: typeof call.heading === "string" ? call.heading : undefined,
      });
      conversation.push(`Assistant: ${lastRaw}`);
      conversation.push(`Tool result (read_file):\n${toolResultForModel(read.ok ? { ...read.window, content: read.window?.numbered || read.window?.content } : read)}`);
      continue;
    }
    if (tool === "edit_file") {
      const edited = preciseEditWorkspace(kernel, workspaceRoot, {
        relativePath: String(call.relativePath || ""),
        oldText: String(call.oldText || ""),
        newText: String(call.newText ?? ""),
        replaceAll: Boolean(call.replaceAll),
        startLine: typeof call.startLine === "number" ? call.startLine : undefined,
        endLine: typeof call.endLine === "number" ? call.endLine : undefined,
        heading: typeof call.heading === "string" ? call.heading : undefined,
        actor: "ai",
        confirmed: mode !== "confirm",
        writebackMode: mode,
      });
      edits.push({ ...edited, tool: "edit_file", relativePath: call.relativePath });
      conversation.push(`Assistant: ${lastRaw}`);
      conversation.push(`Tool result (edit_file):\n${toolResultForModel(edited)}`);
      continue;
    }
    break;
  }

  const split = typeof kernel.splitAssistantVisible === "function"
    ? kernel.splitAssistantVisible(lastRaw)
    : { body: String(lastRaw || "").trim(), reasoning: "" };
  let body = split.body;
  if (parseToolCall(lastRaw)) {
    const pending = edits.some((e) => e.pending || e.needsConfirm);
    const applied = edits.some((e) => e.ok);
    if (isZh) {
      body = pending
        ? "写入已挂起，请在「待确认写入」中接受或拒绝。"
        : applied
          ? "已完成文件修改。"
          : "未能完成修改，请根据工具返回的 nearby/context 再试。";
    } else {
      body = pending
        ? "Write is pending — accept or reject it in the pending-writes list."
        : applied
          ? "Finished the file edit."
          : "Edit did not apply. Use the nearby/context from the tool result and retry.";
    }
  }
  return { body, reasoning: split.reasoning, edits, steps: conversation.length };
}
