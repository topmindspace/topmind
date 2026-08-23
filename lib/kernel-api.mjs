// ── topmind Kernel API (single domain surface) ─────────────────────────────
// Desktop loads this via dynamic import from engine root; UTR may static-import.
// Surfaces must not re-implement business semantics outside these modules.

export {
  loadContract,
  validateContract,
  resolveProtection,
  buildDefaultContract,
  migrateV3ToV4,
  sanitizeContract,
  deepMergeContract,
  stringifyContract,
  writeContract,
  inspectContract,
  ensureContract,
  reseedContract,
  backupContractFile,
  tryParseContractContent,
  hasRecognizedContractKeys,
  CONTRACT_VERSION,
  CONTRACT_FILE_NAME,
  LEGACY_CONFIG_FILE_NAME,
} from "./contract-engine.mjs";

export {
  resolveWorkspaceModel,
  normalizeConfig,
  ensureRequiredStructure,
  resolveStreamTarget,
  shouldAppendToPeriodNote,
  listStreamPeriods,
  listStreamYears,
  archiveStreamYear,
  resolveMemoryPaths,
  ensureCoreProfile,
  normalizeMemoryConfig,
  isMemoryPlaneRelPath,
  findCategoryByRole,
  resolveSystemRoot,
  findStreamCategory,
  addCategory,
  renameCategory,
  writeWorkspaceMap,
  sanitizeTopicPlacement,
  sanitizeCategorySegment,
  isPathInsideWorkspace,
  evaluateOutsideRead,
  resolveArchivePlaneRel,
  isValidCategoryName,
  isReservedTopicCategory,
  isDisallowedTopicCategoryRole,
  resolveCategoryRoleForTopic,
  inferTopicDisallowedRoleFromCategoryName,
  TOPIC_DISALLOWED_ROLES,
} from "./workspace-model.mjs";

export {
  appendToPeriodBody,
  packingLabel,
  periodFileStem,
  reconcilePeriodBody,
} from "./stream-period.mjs";

export {
  resolveActivityWindow,
  resolveActivitySkipRootNames,
  buildActivityCorpus,
  appendToStreamEntry,
  formatAppendBlock,
  parseAppendMarkers,
  periodItemsFromWindow,
  isPeriodNoteFileName,
  isSafePeriodStem,
  periodStemFromFileName,
  periodStemFromCandidate,
  classifyActivityPath,
  DEFAULT_WINDOW_DAYS,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_PERIODS,
  SUGGEST_CORPUS_MAX_CHARS,
} from "./activity-window.mjs";

export {
  evaluateWritePermission,
  executeWrite,
  executeDelete,
  executeArchive,
  cleanupShadow,
  peekFrontmatter,
  toSurfaceEvidence,
  resolveWritebackMode,
  isHighImpactContentWrite,
  isRecoverableLifecycle,
} from "./writeback-engine.mjs";

export {
  resolveMemoryDir,
  memoryDirRel,
  globalProfileRelPath,
  resolveMemoryLayerPath,
  resolvePeriodMemoryPath,
  periodMemoryRelPath,
  ensureMemoryPlane,
  readGlobalMemory,
  readMemoryLayer,
  readProfileActiveBody,
  resolveProfileSectionTitle,
  appendProfileEntry,
  retireProfileEntry,
  updateProfileEntry,
  appendTopicEntry,
  writePeriodDigest,
  promoteStreamItem,
  MEMORY_DIR_NAME,
} from "./memory-engine.mjs";

export { scanLifecycle } from "./lifecycle-engine.mjs";

export { rebuildAllDerived, setAiProvider, getAiProvider } from "./derived-builder.mjs";

export { resolveIngestRoute } from "./ingest-pipeline.mjs";

export { generateSuggestions, applySuggestion } from "./suggest-engine.mjs";

export {
  sanitizeAiContent,
  isPlaceholderOrPolluted,
  usableAiBody,
  validateAiOutput,
  extractCleanLines,
  normalizeProfileFactKey,
  profileSectionHasFact,
  looksLikeJsonDump,
  looksLikeThinkingDump,
  splitAssistantVisible,
  ingestAssistantTextDelta,
  resolveAiLocale,
  resolveOutputLanguage,
  detectSourceScript,
  extractExplicitLanguageRequest,
  pickDocumentSourceForOutputLanguage,
  resolveAgentOutputLanguage,
  resolveProductAiLanguage,
  normalizeSurfaceUiLocale,
} from "./ai-content-sanitize.mjs";

export {
  applyUniqueSpan,
  findExactSpans,
  findNormalizedSpans,
  formatMismatchDiagnostic,
  nearbyContext,
  normalizeForMatch,
  resolveLocatorWindow,
  stripCopiedLineNumbers,
} from "./precise-edit.mjs";

export {
  formatReadWindow,
  numberLines,
  sliceLineWindow,
  findHeadingSpan,
  findQueryAround,
} from "./file-window.mjs";

export {
  ensureTodoFile,
  readTodoList,
  writeTodoList,
  addTodoItem,
  toggleTodoItem,
  updateTodoItem,
  setTodoDueDate,
  deleteTodoItem,
  clearCompleted,
  extractTodosFromStream,
  maintainTodos,
  notePromptCorpus,
  noteCorpusHash,
  budgetTodoPromptCorpus,
  splitPeriodAndExtras,
  getTodoHealth,
  cleanupStaleTodos,
  archiveStaleTodos,
  snapshotTodoList,
  resolveTodoPath,
  resolveTodoRelPath,
  TODO_REL_PATH,
} from "./todo-engine.mjs";

export {
  registerOperationType,
  listOperationTypes,
  getOperationType,
  runOperation,
  getOperationState,
  clearOperationState,
} from "./ai-operation-engine.mjs";

/** Kernel surface id for diagnostics */
export const KERNEL_API_VERSION = 1;

// ── Kernel context (per-workspace, concurrency-safe) ───────────────────────

import { loadContract as _loadContract } from "./contract-engine.mjs";
import { generateSuggestions as _generateSuggestions, applySuggestion as _applySuggestion } from "./suggest-engine.mjs";
import {
  rebuildAllDerived as _rebuildAllDerived,
  buildTopicDerived as _buildTopicDerived,
  buildPeriodDerived as _buildPeriodDerived,
} from "./derived-builder.mjs";
import { runOperation as _runOperation } from "./ai-operation-engine.mjs";

export { buildTopicDerived, buildPeriodDerived } from "./derived-builder.mjs";

/**
 * Create a per-workspace kernel context that binds workspaceRoot / engineRoot /
 * contract / aiProvider once and threads them through the AI-aware engines.
 *
 * This is the concurrency-safe alternative to the module-level
 * `setAiProvider()` singleton: multiple workspaces (or parallel jobs) each get
 * their own context and provider without global mutation.
 *
 * @param {object} options
 * @param {string} options.workspaceRoot
 * @param {string} [options.engineRoot]
 * @param {object} [options.contract] - preloaded v4 contract (loaded lazily otherwise)
 * @param {{ generate: (prompt: string, context?: object) => Promise<string> }} [options.aiProvider]
 */
export function createKernelContext({ workspaceRoot, engineRoot, contract, aiProvider, localeOverride }) {
  if (!workspaceRoot) throw new Error("createKernelContext requires workspaceRoot");
  const getContract = () => contract || (contract = _loadContract(workspaceRoot));

  return {
    workspaceRoot,
    engineRoot,
    get contract() {
      return getContract();
    },
    aiProvider: aiProvider || null,
    localeOverride: localeOverride || null,

    generateSuggestions(opts = {}) {
      return _generateSuggestions({
        workspaceRoot,
        engineRoot,
        contract: getContract(),
        aiProvider,
        localeOverride,
        ...opts,
      });
    },
    applySuggestion(suggestion, opts = {}) {
      return _applySuggestion({
        workspaceRoot,
        engineRoot,
        contract: getContract(),
        aiProvider,
        localeOverride,
        suggestion,
        ...opts,
      });
    },
    rebuildAllDerived(opts = {}) {
      return _rebuildAllDerived({ workspaceRoot, contract: getContract(), aiProvider, localeOverride, ...opts });
    },
    buildTopicDerived(opts = {}) {
      return _buildTopicDerived({ workspaceRoot, contract: getContract(), aiProvider, localeOverride, ...opts });
    },
    buildPeriodDerived(opts = {}) {
      return _buildPeriodDerived({ workspaceRoot, contract: getContract(), aiProvider, localeOverride, ...opts });
    },
    runOperation(opts = {}) {
      return _runOperation({
        workspaceRoot,
        engineRoot,
        contract: getContract(),
        aiProvider,
        ...opts,
        options: { ...(opts.options || {}), localeOverride },
      });
    },
  };
}
