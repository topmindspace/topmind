// ── Kernel Loader: loads the topmind Kernel engines ────────────────────────
//
// In the bundled Obsidian plugin, the Kernel .mjs files are inlined by
// esbuild. We import from the relative path to the engine root's lib/
// directory. esbuild resolves and bundles these into main.js.
//
// The yaml-bridge.mjs is shimmed by an esbuild plugin (see esbuild.config.mjs)
// to use static import instead of dynamic createRequire, so the 'yaml' npm
// package is properly bundled.

import type { TopmindSettings } from "../types";
import type { AiProvider } from "./ai-provider";
import { getVaultBasePath, getEngineRoot } from "./vault-bridge";

// Import Kernel API — esbuild bundles this from ../../lib/kernel-api.mjs
// All transitive imports (contract-engine, writeback-engine, etc.) are bundled.
// node:fs, node:path, node:crypto are kept as external require() calls.
// @ts-expect-error — kernel-api.mjs is a plain ESM file without .d.ts types;
// esbuild bundles the actual implementation at build time.
import * as kernelApi from "../../../lib/kernel-api.mjs";

// ── Kernel API type surface ────────────────────────────────────────────────
// Manually typed to match lib/kernel-api.mjs exports.

export interface KernelContext {
  workspaceRoot: string;
  engineRoot?: string;
  contract: unknown;
  aiProvider: unknown;
  /**
   * Generate suggestion cards (safe to call on open / manual).
   * Returns an array of Suggestion objects directly (not wrapped).
   * The Kernel's suggest-engine is synchronous; the return is awaitable
   * for forward compatibility.
   */
  generateSuggestions(opts?: Record<string, unknown>): unknown[] | Promise<unknown[]>;
  /** Apply (accept) a suggestion after user confirm. */
  applySuggestion(suggestion: unknown, opts?: Record<string, unknown>): unknown | Promise<unknown>;
  /** Run an AI operation (todo_maintain, memory_organize, topic_classify). */
  runOperation(opts?: Record<string, unknown>): Promise<{ ok: boolean; summary?: string; suggestions?: unknown[]; reason?: string }>;
}

interface KernelApi {
  loadContract(workspaceRoot: string): Record<string, unknown>;
  buildDefaultContract(workspaceRoot?: string, template?: unknown): Record<string, unknown>;
  resolveWorkspaceModel(opts: {
    workspaceRoot: string;
    engineRoot?: string;
    config?: unknown;
  }): {
    categories: { role: string; directory: string; name: string }[];
    contract?: Record<string, unknown>;
    [key: string]: unknown;
  };
  ensureRequiredStructure(workspaceRoot: string, opts: {
    engineRoot?: string;
    config?: unknown;
    templateId?: string;
  }): void;
  resolveStreamTarget(opts: {
    workspaceRoot: string;
    categoryDir: string;
    packing?: string;
  }): { relPath: string; [key: string]: unknown };
  findStreamCategory(model: unknown): { directory: string; role: string; [key: string]: unknown } | null;
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
  listStreamPeriods(workspaceRoot: string, categoryDir: string): {
    period: string;
    relPath: string;
    title: string;
    entryCount: number;
    mtime: number;
  }[];
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
  }): { pending?: boolean; path?: string; affectedFiles?: string[]; wroteFiles?: boolean; [key: string]: unknown };
  reconcilePeriodBody(opts: {
    body: string;
    packing?: string;
    appendHeading?: string;
  }): { body: string; reconciled: boolean; [key: string]: unknown };
  ensureTodoFile(workspaceRoot: string): void;
  readTodoList(workspaceRoot: string): { items: unknown[] } | null;
  toggleTodoItem(workspaceRoot: string, id: string, contract?: unknown): void;
  createKernelContext(opts: {
    workspaceRoot: string;
    engineRoot?: string;
    contract?: unknown;
    aiProvider?: { generate: (prompt: string, context?: unknown) => Promise<string> } | null;
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
 *
 * @param vaultPath — absolute path to Obsidian Vault (= workspace root)
 * @param engineRoot — plugin directory (for template loading)
 * @param aiProvider — optional AI provider for AI-powered features
 */
export function createKernelContext(
  vaultPath: string,
  engineRoot: string,
  aiProvider?: AiProvider | null,
): KernelContext {
  return api.createKernelContext({
    workspaceRoot: vaultPath,
    engineRoot,
    aiProvider: aiProvider || undefined,
  });
}

/**
 * Convenience: create a kernel context from an Obsidian App instance.
 */
export function createKernelContextFromApp(
  app: import("obsidian").App,
  plugin: { manifest: { dir?: string } },
  aiProvider?: AiProvider | null,
): KernelContext {
  const vaultPath = getVaultBasePath(app);
  const engineRoot = getEngineRoot(plugin);
  return createKernelContext(vaultPath, engineRoot, aiProvider);
}
