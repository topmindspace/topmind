// ── Kernel Loader: loads the topmind Kernel engines ────────────────────────
//
// In the bundled Obsidian plugin, the Kernel .mjs files are inlined by
// esbuild. We import from the relative path to the engine root's lib/
// directory. esbuild resolves and bundles these into main.js.
//
// Types below must match lib/kernel-api.mjs (+ model-stream / stream-period)
// — wrong shapes here hide real call bugs from tsc.

import type { AiProvider } from "./ai-provider";
import { getVaultBasePath, getEngineRoot } from "./vault-bridge";

// Import Kernel API — esbuild bundles this from ../../lib/kernel-api.mjs
// We use @ts-expect-error because kernel-api.mjs is a plain ESM .mjs file
// without .d.ts type declarations. esbuild resolves and bundles the actual
// implementation at build time. The KernelApi interface below manually declares
// the type surface and must be kept in sync with lib/kernel-api.mjs exports.
// Future improvement: generate .d.ts from lib/ JSDoc to eliminate this escape hatch.
// @ts-expect-error — kernel-api.mjs is a plain ESM file without .d.ts types;
// esbuild bundles the actual implementation at build time.
import * as kernelApi from "../../../lib/kernel-api.mjs";

// ── Kernel result shapes (aligned with lib/) ───────────────────────────────

/** lib/model-stream.mjs resolveStreamTarget */
export interface StreamTargetResult {
  packing: string;
  appendHeading: string;
  yearDir?: boolean;
  streamCategory: { directory: string; role: string; path?: string; [key: string]: unknown } | null;
  periodStem: string | null;
  periodFileName: string | null;
  periodAbsPath: string | null;
  periodRelPath: string | null;
  title: string | null;
}

/** lib/model-stream.mjs listStreamPeriods item */
export interface ListedStreamPeriod {
  relPath: string;
  fileName: string;
  mtime: string | null;
  title: string | null;
  reconciled: boolean;
}

/** lib/stream-period.mjs reconcilePeriodBody return */
export interface ReconcilePeriodResult {
  body: string;
  changed: boolean;
  changes: string[];
  candidates: { core: string[]; topics: string[] };
}

/** lib/suggest-engine.mjs applySuggestion return (subset) */
export interface ApplySuggestionResult {
  ok?: boolean;
  operation?: string;
  wroteFiles?: boolean;
  targetPath?: string;
  note?: string;
  reason?: string;
  pending?: boolean;
  needsConfirm?: boolean;
  [key: string]: unknown;
}

export interface KernelContext {
  workspaceRoot: string;
  engineRoot?: string;
  contract: unknown;
  aiProvider: unknown;
  localeOverride?: string | null;
  generateSuggestions(opts?: Record<string, unknown>): unknown[] | Promise<unknown[]>;
  applySuggestion(
    suggestion: unknown,
    opts?: Record<string, unknown>,
  ): ApplySuggestionResult | Promise<ApplySuggestionResult>;
  runOperation(opts?: Record<string, unknown>): Promise<{
    ok: boolean;
    summary?: string;
    suggestions?: unknown[];
    reason?: string;
  }>;
}

export interface PreciseEditSpec {
  oldText: string;
  newText: string;
  replaceAll?: boolean;
  startLine?: number;
  endLine?: number;
  heading?: string;
  path?: string;
}

export interface PreciseEditOk {
  ok: true;
  next: string;
  replacements: number;
  mode: "exact" | "normalized";
  spans: { start: number; end: number }[];
}

export interface PreciseEditFail {
  ok: false;
  reason: string;
  count: number;
  diagnostic: string;
  next: string;
}

export interface ReadWindowOpts {
  relativePath?: string;
  offset?: number;
  limit?: number;
  around?: string;
  heading?: string;
  contextLines?: number;
  maxLimit?: number;
  maxChars?: number;
}

export interface ReadWindowResult {
  relativePath: string;
  content: string;
  numbered: string;
  offset: number;
  limit: number;
  startLine: number;
  endLine: number;
  totalLines: number;
  totalChars: number;
  truncated: boolean;
  empty: boolean;
  locate?: string;
  note: string;
}

export interface KernelApi {
  sanitizeAiContent?(text: string): string;
  splitAssistantVisible?(raw: unknown): { body: string; reasoning: string };
  ingestAssistantTextDelta?(
    acc: { raw?: string; body?: string; reasoning?: string } | null,
    delta: string,
  ): {
    raw: string;
    body: string;
    reasoning: string;
    bodyDelta: string;
    reasoningDelta: string;
    resetBody: boolean;
    resetReasoning: boolean;
  };
  applyUniqueSpan?(haystack: string, spec: PreciseEditSpec): PreciseEditOk | PreciseEditFail;
  formatReadWindow?(fullText: string, opts?: ReadWindowOpts): ReadWindowResult;
  isPathInsideWorkspace?(workspaceRoot: string, absPath: string): boolean;
  isRecoverableLifecycle?(opts: {
    protection?: string;
    relativePath?: string;
    isDirectory?: boolean;
    hasTopicHome?: boolean;
  }): boolean;
  loadContract(workspaceRoot: string): Record<string, unknown>;
  resolveAgentOutputLanguage?(opts: {
    userText?: string;
    sourceText?: string;
    editedSpan?: string;
    contract?: unknown;
  }): "zh" | "en";
  writeContract?(workspaceRoot: string, contract: Record<string, unknown>): string;
  buildDefaultContract(workspaceRoot?: string, template?: unknown): Record<string, unknown>;
  inspectContract?(workspaceRoot: string): {
    state: string;
    onDiskValid: boolean;
    path: string;
    errors: string[];
    warnings: string[];
    needsRewrite?: boolean;
  };
  ensureContract?(
    workspaceRoot: string,
    opts?: {
      reseed?: boolean;
      templateId?: string;
      locale?: string;
      categorySeparator?: string;
    },
  ): {
    status: string;
    onDiskValid: boolean;
    path: string;
    contract: Record<string, unknown> | null;
    errors: string[];
    actions: string[];
    backupPath?: string | null;
  };
  reseedContract?(
    workspaceRoot: string,
    opts?: { templateId?: string; locale?: string },
  ): {
    status: string;
    onDiskValid: boolean;
    path: string;
    contract: Record<string, unknown> | null;
    backupPath?: string | null;
  };
  resolveWorkspaceModel(opts: {
    workspaceRoot: string;
    engineRoot?: string;
    config?: unknown;
  }): {
    categories: {
      role: string;
      directory: string;
      name: string;
      slot?: string;
      ok?: boolean;
      hidden?: boolean;
      specialBehavior?: string;
      path?: string;
    }[];
    contract?: Record<string, unknown>;
    stream?: { packing?: string; appendHeading?: string };
    config?: Record<string, unknown>;
    [key: string]: unknown;
  };
  ensureRequiredStructure(
    workspaceRoot: string,
    opts: {
      engineRoot?: string;
      config?: unknown;
      templateId?: string;
      locale?: string;
      materializeExtensions?: boolean;
      reseed?: boolean;
    },
  ): {
    created: string[];
    model: unknown;
    contractStatus?: string;
    contractOnDiskValid?: boolean;
    contractErrors?: string[];
  };
  /**
   * lib/model-stream.mjs — options object; returns periodRelPath / periodAbsPath
   * (not `relPath`).
   */
  resolveStreamTarget(opts: {
    workspaceRoot: string;
    engineRoot?: string;
    config?: unknown;
    date?: Date;
  }): StreamTargetResult;
  findStreamCategory(model: unknown): {
    directory: string;
    role: string;
    path?: string;
    specialBehavior?: string;
    [key: string]: unknown;
  } | null;
  appendToPeriodBody(
    existingBody: string,
    opts: {
      content: string;
      title?: string;
      packing?: string;
      appendHeading?: string;
      date?: Date;
    },
  ): string;
  /**
   * lib/model-stream.mjs — async; options object (not positional workspaceRoot, categoryDir).
   */
  listStreamPeriods(opts: {
    workspaceRoot: string;
    engineRoot?: string;
    config?: unknown;
    limit?: number;
  }): Promise<ListedStreamPeriod[]>;
  /**
   * lib/model-stream.mjs — async; list year directories in stream category.
   */
  listStreamYears(opts: {
    workspaceRoot: string;
    engineRoot?: string;
    config?: unknown;
  }): Promise<Array<{ year: string; periodCount: number; archived: boolean }>>;
  /**
   * lib/model-stream.mjs — async; archive a complete year of stream period notes.
   */
  archiveStreamYear(opts: {
    workspaceRoot: string;
    engineRoot?: string;
    config?: unknown;
    year: string;
  }): Promise<{
    ok: boolean;
    archived: boolean;
    year: string;
    movedCount: number;
    archivePath: string;
    receiptPath?: string;
    reason?: string;
  }>;
  executeWrite(opts: {
    targetPath: string;
    content: string;
    workspaceRoot: string;
    contract?: unknown;
    role?: string;
    operation?: string;
    actor?: string;
    confirmed?: boolean;
    skipShadow?: boolean;
    skipBackup?: boolean;
    skipReceipt?: boolean;
    writebackModeOverride?: "auto" | "confirm";
  }): {
    pending?: boolean;
    path?: string;
    targetPath?: string;
    affectedFiles?: string[];
    wroteFiles?: boolean;
    [key: string]: unknown;
  };
  /**
   * lib/stream-period.mjs — positional (body, opts); returns `{ changed }` not `{ reconciled }`.
   */
  reconcilePeriodBody(
    body: string,
    opts?: { packing?: string; appendHeading?: string },
  ): ReconcilePeriodResult;
  resolveMemoryDir?(workspaceRoot: string): string;
  resolveMemoryLayerPath?(workspaceRoot: string, layer: string, identifier?: string): string;
  resolveTodoPath?(workspaceRoot: string): string;
  resolveTodoRelPath?(workspaceRoot: string): string;
  ensureTodoFile(workspaceRoot: string): void;
  readTodoList(workspaceRoot: string): { items: unknown[] } | null;
  toggleTodoItem(workspaceRoot: string, id: string, contract?: unknown): {
    ok: boolean;
    items: unknown[];
    targetPath: string;
  };
  deleteTodoItem?(workspaceRoot: string, id: string, contract?: unknown): {
    ok: boolean;
    items: unknown[];
    targetPath: string;
  };
  clearCompleted?(workspaceRoot: string, contract?: unknown): {
    ok: boolean;
    removed: number;
    targetPath: string;
  };
  addCategory?(
    workspaceRoot: string,
    spec: {
      slot: string;
      name: string;
      role?: string;
      specialBehavior?: string;
      engineRoot?: string;
    },
  ): { directory: string; category: unknown; configPath: string };
  createKernelContext(opts: {
    workspaceRoot: string;
    engineRoot?: string;
    contract?: unknown;
    aiProvider?: { generate: (prompt: string, context?: unknown) => Promise<string> } | null;
    localeOverride?: string | null;
  }): KernelContext;
}

const api = kernelApi as unknown as KernelApi;

export type KernelApiType = KernelApi;

/**
 * Load the Kernel API module.
 * In the bundled plugin, this is already inlined — no dynamic import needed.
 */
export function getKernel(): KernelApi {
  return api;
}

/**
 * Create a per-workspace kernel context bound to the Obsidian Vault.
 */
export function createKernelContext(
  vaultPath: string,
  engineRoot: string,
  aiProvider?: AiProvider | null,
  localeOverride?: string | null,
): KernelContext {
  return api.createKernelContext({
    workspaceRoot: vaultPath,
    engineRoot,
    aiProvider: aiProvider || undefined,
    localeOverride: localeOverride || undefined,
  });
}

/**
 * Convenience: create a kernel context from an Obsidian App instance.
 */
export function createKernelContextFromApp(
  app: import("obsidian").App,
  plugin: { manifest: { dir?: string } },
  aiProvider?: AiProvider | null,
  localeOverride?: string | null,
): KernelContext {
  const vaultPath = getVaultBasePath(app);
  const engineRoot = getEngineRoot(plugin);
  return createKernelContext(vaultPath, engineRoot, aiProvider, localeOverride);
}
