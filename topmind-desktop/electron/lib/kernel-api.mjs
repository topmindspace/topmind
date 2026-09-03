/**
 * Desktop facade for engine Kernel API (lib/kernel-api.mjs).
 * Dynamic import from engine root — works packaged (topmind-engine) and monorepo dev.
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { getEngineRoot } from "./workspace-home.mjs";
import { defaultEngineCandidate } from "./engine-root.mjs";
import { resolveDataRoot, isWorkspaceContext } from "./path-model.mjs";
import { loadAppSettings } from "../settings.mjs";
import { createKernelAiProvider } from "../ai-provider-adapter.mjs";

let cache = { root: null, mod: null, promise: null };

function engineRootNow() {
  return path.resolve(getEngineRoot() || defaultEngineCandidate());
}

export function resetKernelApiCache() {
  cache = { root: null, mod: null, promise: null };
}

/**
 * Load engine Kernel module from resolved engine root (`{engine}/lib/kernel-api.mjs`).
 * Never static-import monorepo-relative `../../lib` (breaks packaged asar).
 * @returns {Promise<object>}
 */
export async function loadKernelApi() {
  const root = engineRootNow();
  if (cache.mod && cache.root === root) return cache.mod;
  if (cache.promise && cache.root === root) return cache.promise;
  cache.root = root;
  const href = pathToFileURL(path.join(root, "lib", "kernel-api.mjs")).href;
  cache.promise = import(href).then((mod) => {
    cache.mod = mod;
    cache.promise = null;
    return mod;
  });
  return cache.promise;
}

export function workspaceRootOf(wsOrCtx) {
  if (isWorkspaceContext(wsOrCtx)) return wsOrCtx.userWorkspaceRoot;
  return typeof wsOrCtx === "string" ? wsOrCtx : resolveDataRoot(wsOrCtx);
}

/**
 * Durable markdown write via Kernel writeback-engine.
 * @param {object} p
 * @param {string} p.relativePath
 * @param {string} p.content
 * @param {object} ctx - { workspaceRoot, ... }
 * @param {object} [opts]
 */
/**
 * Effective writeback mode for Desktop durable writes.
 * Workspace truth is topmind.yaml `writeback.mode` (Kernel default when undefined).
 * Only explicit per-call opts (AI panel badge / tool) may override — never app-settings.
 */
function desktopWritebackMode(_ctx, opts = {}) {
  if (opts.writebackMode === "confirm" || opts.writebackMode === "auto") return opts.writebackMode;
  return undefined; // let Kernel use topmind.yaml
}

/**
 * Resolve writeback mode for AI tools / UI that need the effective value.
 * Order: explicit opts → workspace topmind.yaml → "auto". Never app-settings alone.
 * @param {object} ctx
 * @param {{ writebackMode?: string }} [opts]
 * @returns {Promise<"auto"|"confirm">}
 */
export async function resolveWorkspaceWritebackMode(ctx, opts = {}) {
  if (opts.writebackMode === "confirm" || opts.writebackMode === "auto") {
    return opts.writebackMode;
  }
  // Explicit per-call passed via ctx flag (AI service sets only when user/session chose)
  if (ctx?.explicitWritebackMode === "confirm" || ctx?.explicitWritebackMode === "auto") {
    return ctx.explicitWritebackMode;
  }
  try {
    const kernel = await loadKernelApi();
    const root = workspaceRootOf(ctx?.workspaceRoot);
    if (root) {
      const contract = kernel.loadContract(root);
      const mode = contract?.writeback?.mode;
      if (mode === "confirm" || mode === "auto") return mode;
    }
  } catch {
    /* fall through */
  }
  return "auto";
}

export async function kernelDurableWrite(p, ctx, opts = {}) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  const relativePath = String(p.relativePath || "").replace(/\\/g, "/");
  const targetPath = path.join(workspaceRoot, relativePath);
  const actor = opts.actor || "user";
  const operation = opts.operation || (opts.isCreate ? "create" : "update");
  // AI writes: confirmed only when explicitly true (confirm mode leaves pending)
  // User writes: always confirmed
  const confirmed =
    actor === "user" ? true : opts.confirmed === true;

  const evidence = kernel.executeWrite({
    targetPath,
    content: p.content,
    workspaceRoot,
    operation,
    actor,
    confirmed,
    skipShadow: opts.skipShadow !== false,
    skipBackup: opts.skipBackup === true,
    skipReceipt: opts.skipReceipt === true,
    role: opts.role,
    frontmatter: opts.frontmatter,
    previewOnly: opts.previewOnly === true,
    writebackModeOverride: desktopWritebackMode(ctx, opts),
  });

  return evidence;
}

/**
 * Durable delete via Kernel writeback-engine.
 */
export async function kernelDurableDelete(p, ctx, opts = {}) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  const relativePath = String(p.relativePath || "").replace(/\\/g, "/");
  const targetPath = path.join(workspaceRoot, relativePath);
  return kernel.executeDelete({
    targetPath,
    workspaceRoot,
    actor: opts.actor || "user",
    confirmed: opts.confirmed === true || opts.actor === "user" || !opts.actor,
    role: opts.role,
    permanent: opts.permanent === true,
  });
}

/**
 * Durable archive (topic/dir move into 99-归档) via Kernel writeback-engine.
 * Single write-gate: protection + confirm + copy-verify + ISO stamp + receipt
 * all come from the Kernel — surfaces must not re-implement their own trash.
 */
export async function kernelDurableArchive(p, ctx, opts = {}) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  const relativePath = String(p.relativePath || "").replace(/\\/g, "/");
  const targetPath = path.join(workspaceRoot, relativePath);
  return kernel.executeArchive({
    targetPath,
    workspaceRoot,
    actor: opts.actor || "user",
    confirmed: opts.confirmed === true || opts.actor === "user" || !opts.actor,
    role: opts.role,
    permanent: opts.permanent === true,
  });
}

export async function kernelLoadContract(workspaceRoot) {
  const kernel = await loadKernelApi();
  return kernel.loadContract(workspaceRootOf(workspaceRoot));
}

/** Ensure/repair on-disk topmind.yaml via Kernel (shared with UTR/Obsidian). */
export async function kernelEnsureContract(workspaceRoot, options = {}) {
  const kernel = await loadKernelApi();
  return kernel.ensureContract(workspaceRootOf(workspaceRoot), options);
}

/** User-triggered recovery: backup bad contract + reseed defaults. */
export async function kernelReseedContract(workspaceRoot, options = {}) {
  const kernel = await loadKernelApi();
  return kernel.reseedContract(workspaceRootOf(workspaceRoot), options);
}

export async function kernelInspectContract(workspaceRoot) {
  const kernel = await loadKernelApi();
  return kernel.inspectContract(workspaceRootOf(workspaceRoot));
}

/** Host UI locale for product AI. `auto` / missing → null (workspace fallback). */
function surfaceUiLocale(settings) {
  const ui = settings?.ui?.locale;
  if (ui && ui !== "auto") return ui;
  return null;
}

export async function kernelGenerateSuggestions(workspaceRoot, engineRoot, aiProvider, opts = {}) {
  const kernel = await loadKernelApi();
  const root = workspaceRootOf(workspaceRoot);
  return kernel.generateSuggestions({
    workspaceRoot: root,
    engineRoot: engineRoot || engineRootNow(),
    aiProvider,
    force: opts.force === true,
    userText: opts.userText,
    localeOverride: opts.localeOverride,
  });
}

export async function kernelApplySuggestion(workspaceRoot, suggestion, engineRoot, aiProvider, opts = {}) {
  const kernel = await loadKernelApi();
  const root = workspaceRootOf(workspaceRoot);
  return kernel.applySuggestion({
    workspaceRoot: root,
    suggestion,
    engineRoot: engineRoot || engineRootNow(),
    aiProvider,
    userText: opts.userText,
    localeOverride: opts.localeOverride,
  });
}

/**
 * Durable write by absolute path under workspace (connectors / legacy callers).
 * @param {{ absPath: string, content: string }} p
 * @param {object} ctx
 * @param {object} [opts]
 */
export async function kernelDurableWriteAbs(p, ctx, opts = {}) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  const abs = path.resolve(String(p.absPath || ""));
  if (typeof kernel.isPathInsideWorkspace === "function") {
    if (!kernel.isPathInsideWorkspace(workspaceRoot, abs)) {
      throw new Error("kernelDurableWriteAbs: path outside workspace");
    }
  } else {
    const rel = path.relative(path.resolve(workspaceRoot), abs);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error("kernelDurableWriteAbs: path outside workspace");
    }
  }
  const actor = opts.actor || "user";
  return kernel.executeWrite({
    targetPath: abs,
    content: p.content,
    workspaceRoot,
    operation: opts.operation || "update",
    actor,
    confirmed: actor === "user" ? true : opts.confirmed === true,
    skipShadow: opts.skipShadow !== false,
    skipBackup: opts.skipBackup === true,
    skipReceipt: opts.skipReceipt === true,
    role: opts.role,
    frontmatter: opts.frontmatter,
    writebackModeOverride: desktopWritebackMode(ctx, opts),
  });
}

/**
 * Resolve ingest destination via Kernel (inbox | stream | topic).
 */
export async function kernelResolveIngestRoute(p, ctx) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  return kernel.resolveIngestRoute({
    target: p?.target || "inbox",
    metadata: p?.metadata || {},
    workspaceRoot,
    engineRoot: ctx.engineRoot || engineRootNow(),
  });
}

// ── Todo Engine wrappers ──────────────────────────────────────────────────

export async function kernelReadTodoList(ctx) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  kernel.ensureTodoFile(workspaceRoot);
  return kernel.readTodoList(workspaceRoot);
}

export async function kernelAddTodoItem(p, ctx) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  return kernel.addTodoItem(workspaceRoot, p.text, {
    source: p.source,
    sourcePeriod: p.sourcePeriod,
    actor: p.actor || "user",
  });
}

export async function kernelToggleTodoItem(p, ctx) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  return kernel.toggleTodoItem(workspaceRoot, p.id);
}

export async function kernelUpdateTodoItem(p, ctx) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  return kernel.updateTodoItem(workspaceRoot, p.id, p.text, undefined, {
    dueDate: p.dueDate,
  });
}

export async function kernelSetTodoDueDate(p, ctx) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  return kernel.setTodoDueDate(workspaceRoot, p.id, p.dueDate);
}

export async function kernelDeleteTodoItem(p, ctx) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  return kernel.deleteTodoItem(workspaceRoot, p.id);
}

export async function kernelClearCompletedTodos(ctx) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  return kernel.clearCompleted(workspaceRoot);
}

export async function kernelExtractTodosFromStream(p, ctx) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  const settings = await loadAppSettings(
    ctx.workspaceStatePaths.settingsFilePath,
    workspaceRoot,
    { secretAdapter: ctx.secretAdapter },
  );
  const aiProvider = createKernelAiProvider(settings);
  return kernel.extractTodosFromStream({
    workspaceRoot,
    engineRoot: ctx.engineRoot || engineRootNow(),
    aiProvider,
    options: { ...(p?.options ?? p ?? {}), localeOverride: surfaceUiLocale(settings) },
  });
}

export async function kernelMaintainTodos(p, ctx) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  const settings = await loadAppSettings(
    ctx.workspaceStatePaths.settingsFilePath,
    workspaceRoot,
    { secretAdapter: ctx.secretAdapter },
  );
  const aiProvider = createKernelAiProvider(settings);
  return kernel.maintainTodos({
    workspaceRoot,
    engineRoot: ctx.engineRoot || engineRootNow(),
    aiProvider,
    options: { ...(p?.options ?? p ?? {}), localeOverride: surfaceUiLocale(settings) },
  });
}

export async function kernelGetTodoHealth(_p, ctx) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  return kernel.getTodoHealth(workspaceRoot);
}

export async function kernelCleanupStaleTodos(_p, ctx) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  return kernel.cleanupStaleTodos(workspaceRoot);
}

export async function kernelArchiveStaleTodos(_p, ctx) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  return kernel.archiveStaleTodos(workspaceRoot);
}

// ── Ledger Engine wrappers ────────────────────────────────────────────────

export async function kernelListLedgers(ctx) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  const books = kernel.listLedgers(workspaceRoot);
  return {
    books,
    summary: kernel.summarizeLedgerBooks(books),
    categories: kernel.listLedgerCategories(workspaceRoot, books),
  };
}

export async function kernelReadLedger(p, ctx) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  return kernel.readLedger(workspaceRoot, p?.roleId);
}

export async function kernelAppendLedgerEntry(p, ctx) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  return kernel.appendLedgerEntry(workspaceRoot, p.roleId, {
    direction: p.direction,
    amount: p.amount,
    category: p.category,
    subcategory: p.subcategory,
    note: p.note,
    timestamp: p.timestamp,
  }, { actor: p.actor || "user" });
}

export async function kernelAddLedgerRole(p, ctx) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  return kernel.addLedgerRole(workspaceRoot, { id: p?.id, name: p?.name }, { actor: p?.actor || "user" });
}

export async function kernelListLedgerCategories(ctx) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  return { categories: kernel.listLedgerCategories(workspaceRoot) };
}

export async function kernelAddLedgerCategory(p, ctx) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  return kernel.addLedgerCategory(workspaceRoot, p?.name, { actor: p?.actor || "user" });
}

export async function kernelRemoveLedgerCategory(p, ctx) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  return kernel.removeLedgerCategory(workspaceRoot, p?.name, { actor: p?.actor || "user" });
}

export async function kernelCaptureLedgerPhrase(p, ctx) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  const settings = await loadAppSettings(
    ctx.workspaceStatePaths.settingsFilePath,
    workspaceRoot,
    { secretAdapter: ctx.secretAdapter },
  );
  const aiProvider = p?.skipAi ? null : createKernelAiProvider(settings);
  return kernel.captureLedgerPhrase(workspaceRoot, p?.text, {
    persist: p?.persist !== false,
    defaultRoleId: p?.defaultRoleId || settings?.ledger?.defaultRoleId,
    aiProvider,
    actor: p?.actor || "user",
  });
}

// ── AI Operations (unified engine) ─────────────────────────────────────────

export async function kernelListOperationTypes(ctx) {
  const kernel = await loadKernelApi();
  // Contract-aware: workspace may disable ops via agent.ai_ops.disabled
  const workspaceRoot = ctx ? workspaceRootOf(ctx.workspaceRoot) : null;
  const contract = workspaceRoot ? kernel.loadContract(workspaceRoot) : undefined;
  return kernel.listOperationTypes(contract);
}

export async function kernelRunOperation(p, ctx) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  const settings = await loadAppSettings(
    ctx.workspaceStatePaths.settingsFilePath,
    workspaceRoot,
    { secretAdapter: ctx.secretAdapter },
  );
  const aiProvider = createKernelAiProvider(settings);
  return kernel.runOperation({
    id: p.id,
    workspaceRoot,
    engineRoot: ctx.engineRoot || engineRootNow(),
    contract: ctx.contract,
    aiProvider,
    options: { ...(p.options || {}), localeOverride: surfaceUiLocale(settings) },
  });
}

export async function kernelGetOperationState({ id }, ctx) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  return { ok: true, state: kernel.getOperationState(workspaceRoot, id) };
}

export async function kernelClearOperationState({ id, scope }, ctx) {
  const kernel = await loadKernelApi();
  const workspaceRoot = workspaceRootOf(ctx.workspaceRoot);
  kernel.clearOperationState(workspaceRoot, id, scope);
  return { ok: true };
}
