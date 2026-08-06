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
 * Effective writeback mode for Desktop: explicit opts > app settings > contract (engine).
 */
function desktopWritebackMode(ctx, opts = {}) {
  if (opts.writebackMode === "confirm" || opts.writebackMode === "auto") return opts.writebackMode;
  const s = ctx?.appSettings?.writebackMode;
  if (s === "confirm" || s === "auto") return s;
  return undefined; // let Kernel use topmind.yaml
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

export async function kernelLoadContract(workspaceRoot) {
  const kernel = await loadKernelApi();
  return kernel.loadContract(workspaceRootOf(workspaceRoot));
}

export async function kernelGenerateSuggestions(workspaceRoot, engineRoot, aiProvider, opts = {}) {
  const kernel = await loadKernelApi();
  const root = workspaceRootOf(workspaceRoot);
  return kernel.generateSuggestions({
    workspaceRoot: root,
    engineRoot: engineRoot || engineRootNow(),
    aiProvider,
    force: opts.force === true,
  });
}

export async function kernelApplySuggestion(workspaceRoot, suggestion, engineRoot, aiProvider) {
  const kernel = await loadKernelApi();
  const root = workspaceRootOf(workspaceRoot);
  return kernel.applySuggestion({
    workspaceRoot: root,
    suggestion,
    engineRoot: engineRoot || engineRootNow(),
    aiProvider,
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
  if (!abs.startsWith(path.resolve(workspaceRoot))) {
    throw new Error("kernelDurableWriteAbs: path outside workspace");
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
    options: p?.options ?? p ?? {},
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
    options: p?.options ?? p ?? {},
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
    options: p.options || {},
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
