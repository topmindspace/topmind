/**
 * v4 Typed API — single gateway replacing 306-line ipc.ts.
 * Each method maps 1:1 to a backend service method via RPC bridge.
 */
import { invoke } from "./rpc";
import type {
  Category, Topic, TopicFile, LooseNote, InboxData, OutputFile, ArchiveItem,
  SearchResponse, WritebackEvidence, AiSession, AiMessage, AiToolCall, AiRuntimeStatus,
  AppSettings, AllNotesResult, FileMetaResult, XTweet,
  WereadLastSyncSummary, WereadNotebookBook, WereadStatsCache, WereadSyncResult,
  IngestJob, ProviderInfo, LaunchStatus,
} from "../types";

export type SurfaceUpdateInfo = {
  ok?: boolean;
  surface?: string;
  updateAvailable: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  tagName: string | null;
  releaseUrl: string | null;
  notes?: string | null;
  publishedAt?: string | null;
  assets: { name: string; size: number; url: string; contentType?: string }[];
  reason?: string;
  error?: string;
  /** Version shipped with Desktop (from versions.json / engine). */
  bundledVersion?: string | null;
};

export type CompanionAgentHost = {
  id: string;
  name: string;
  present: boolean;
  skillsRoot: string | null;
  hostPath?: string | null;
  installed: boolean;
  installedVersion: string | null;
  receiptPath?: string | null;
};

export type CompanionBrowser = {
  id: string;
  name: string;
  present: boolean;
  path: string | null;
};

export type CompanionObsidian = {
  appPresent: boolean;
  appPath: string | null;
  vaultPluginsRoot: string | null;
  pluginInstalled: boolean;
  pluginVersion: string | null;
  pluginPath: string | null;
  pluginId?: string | null;
  workspaceRoot?: string | null;
};

export type CompanionStatusResult = {
  ok: true;
  agents: CompanionAgentHost[];
  browsers: CompanionBrowser[];
  obsidian: CompanionObsidian;
  clip?: {
    prepared: boolean;
    path: string | null;
    managedDir: string;
    version: string | null;
    bundledVersion?: string | null;
    guidedInstall: boolean;
  };
  bundled?: {
    skillsVersion: string | null;
    obsidianPluginVersion: string | null;
    extensionVersion: string | null;
  };
  skillsSourceRoot?: string | null;
  checkedAt?: string;
};

export type CompanionSkillsResult = {
  ok: true;
  hostId: string;
  dest: string;
  mode?: string;
  version?: string | null;
  installed?: string[];
  skillIds?: string[];
};

export type ExternalPluginInfo = {
  id: string;
  dir: string;
  status: string;
  error?: string | null;
  manifest: {
    id: string;
    name: string;
    version: string;
    description?: string;
    author?: string;
    main?: string;
    homepage?: string;
    permissions?: string[];
    slots?: string[];
    enabled?: boolean;
  } | null;
  entryPath?: string | null;
  entryUrl?: string | null;
};

/** Pre-install review payload (folder / zip). */
export type PluginInstallPreview = {
  ok: true;
  manifest: {
    id: string;
    name: string;
    version: string;
    description?: string;
    author?: string;
    permissions?: string[];
    slots?: string[];
  };
  sourceDir?: string;
  permissions: string[];
  slots: string[];
  risk: "low" | "medium" | "high";
  riskReasons: string[];
  alreadyInstalled: boolean;
  existingVersion?: string | null;
  existingStatus?: string | null;
  replaces: boolean;
};

export type SkillsExtraReceipt = {
  installedAt: string | null;
  source: string | null;
  dest: string;
  entries: string[];
  path?: string;
  version?: string | null;
  name?: string | null;
};

export type SkillsPackSummary = {
  ok: true;
  path: string;
  version: string | null;
  name: string | null;
  skillCount: number;
  skillIds: string[];
  hasShared: boolean;
  receipt?: SkillsExtraReceipt | null;
};

export const api = {
  ws: {
    categories: () => invoke<{ categories: Category[]; rootPath: string }>("workspace.listCategories"),
    allNotes: (limit?: number) =>
      invoke<AllNotesResult>("workspace.listAllNotes", { limit }),
    topics: (category: string) =>
      invoke<{ category: string; topics: Topic[]; looseNotes: LooseNote[] }>("workspace.listTopics", { category }),
    topicFiles: (
      topicId: string,
      opts?: { subPath?: string; filter?: string },
    ) =>
      invoke<{
        files: TopicFile[];
        entries?: import("../types").DirEntry[];
        filter?: string;
      }>("workspace.listTopicFiles", { topicId, ...opts }),
    listDir: (relativePath: string, filter?: string) =>
      invoke<{
        relativePath: string;
        filter: string;
        entries: import("../types").DirEntry[];
      }>("workspace.listWorkspaceDir", { relativePath, filter }),
    getTopic: (topicId: string) =>
      invoke<{ topicId: string; topicName: string; category?: string; files: TopicFile[] }>(
        "workspace.getTopic",
        { topicId },
      ),
    copyPath: (relativePath: string) =>
      invoke<{ ok: true }>("workspace.copyPath", { relativePath }),
    duplicate: (relativePath: string) =>
      invoke<{ ok: true; path: string }>("workspace.duplicatePath", { relativePath }),
    fileMeta: (relativePath: string) =>
      invoke<FileMetaResult>("workspace.getFileMeta", { relativePath }),
    /** Patch frontmatter keys; null/"" removes a key. Body unchanged. */
    updateFrontmatter: (p: { relativePath: string; fields: Record<string, unknown> }) =>
      invoke<WritebackEvidence>("workspace.updateFrontmatter", p),
    // Path-based file primitives — every file addressed by workspace-relative path.
    read: (relativePath: string) =>
      invoke<string>("workspace.readPath", { relativePath }),
    save: (p: { relativePath: string; content: string }) =>
      invoke<WritebackEvidence>("workspace.savePath", p),
    /** Binary asset under workspace (e.g. images/{slug}/img-….png). base64 payload. */
    saveBinary: (p: { relativePath: string; base64: string; contentType?: string }) =>
      invoke<WritebackEvidence>("workspace.saveBinary", p),
    saveNote: (p: { topicId: string; filename: string; content: string; sourceType?: string }) =>
      invoke<WritebackEvidence>("workspace.saveNote", p),
    del: (relativePath: string, opts?: { permanent?: boolean }) =>
      invoke<WritebackEvidence>("workspace.deletePath", { relativePath, permanent: opts?.permanent === true }),
    rename: (p: { relativePath: string; newName: string }) =>
      invoke<WritebackEvidence>("workspace.renamePath", p),
    renameTopic: (p: { topicId: string; newName: string }) =>
      invoke<WritebackEvidence & { topicId?: string }>("workspace.renameTopic", p),
    reveal: (relativePath: string) =>
      invoke<{ ok: true }>("workspace.revealFile", { relativePath }),
    open: (relativePath: string) =>
      invoke<{ ok: true }>("workspace.openFile", { relativePath }),
    inbox: () => invoke<InboxData>("workspace.listInbox"),
    ingest: (p: {
      content: string;
      title?: string;
      sourceType?: string;
      source?: string;
      frontmatter?: Record<string, unknown>;
      dest?: {
        mode?: "inbox" | "topic" | "category" | "stream";
        topicId?: string;
        category?: string;
        forceAtom?: boolean;
      };
    }) =>
      invoke<WritebackEvidence & {
        path?: string;
        dest?: string;
        appended?: boolean;
        streamPacking?: string;
        userMessage?: string;
      }>("workspace.ingestInbox", p),
    importFile: (p: { absolutePath: string; targetTopicId?: string }) =>
      invoke<{
        ok: true;
        path?: string;
        jobId?: string;
        converter?: string;
        fallback?: boolean;
        warnings?: string[];
      }>("workspace.importFile", p),
    /**
     * Move note into a topic (media-aware). Prefer relativePath; inboxRelativePath kept for compatibility.
     */
    move: (p: {
      relativePath?: string;
      inboxRelativePath?: string;
      targetTopicId: string;
    }) => invoke<WritebackEvidence & { newPath?: string; mediaMoved?: number; note?: string }>(
      "workspace.moveToTopic",
      p,
    ),
    batchMove: (p: { paths: string[]; targetTopicId: string }) =>
      invoke<{ ok: boolean; moved: number; failed: number; results: { path: string; ok: boolean; newPath?: string; error?: string }[] }>(
        "workspace.batchMoveToTopic",
        p,
      ),
    outputs: (opts?: {
      subPath?: string;
      filter?: string;
      recursiveFlat?: boolean;
      limit?: number;
    }) =>
      invoke<{
        files: OutputFile[];
        outputsName: string;
        entries?: import("../types").DirEntry[];
        filter?: string;
      }>("workspace.listOutputs", opts || {}),
    publish: (relativePath: string) =>
      invoke<WritebackEvidence>("workspace.publishPath", { relativePath }),
    archive: (opts?: {
      subPath?: string;
      filter?: string;
      recursiveFlat?: boolean;
      limit?: number;
    }) =>
      invoke<{
        items: ArchiveItem[];
        archiveName: string;
        entries?: import("../types").DirEntry[];
      }>("workspace.listArchive", opts || {}),
    receipts: (topicRelativePath: string, limit?: number) =>
      invoke<{ receipts: { name: string; size: number; mtime: string }[] }>(
        "workspace.listTopicReceipts", { topicRelativePath, limit },
      ),
    readReceipt: (archiveRelativePath: string) =>
      invoke<string>("workspace.readTopicReceipt", { archiveRelativePath }),
    restoreReceipt: (p: { archiveRelativePath: string; targetRelativePath: string }) =>
      invoke<WritebackEvidence>("workspace.restoreTopicReceipt", p),
    search: (query: string) =>
      invoke<SearchResponse>("workspace.search", { query }),
    fetchUrl: (url: string, maxLen?: number, opts?: { render?: boolean }) =>
      invoke<{
        title: string;
        text: string;
        url: string;
        description?: string;
        author?: string;
        siteName?: string;
        image?: string;
        method?: "readability" | "heuristic" | "render";
        wordCount?: number;
        canonical?: string;
        truncated?: boolean;
        extractedChars?: number;
        maxLen?: number;
        likelySpa?: boolean;
        rawBytes?: number;
        warning?: string;
        enhanced?: boolean;
        canEnhance?: boolean;
      }>("workspace.fetchUrl", { url, maxLen, render: opts?.render }),
    createTopic: (category: string, name: string) =>
      invoke<{ ok: true; topicId: string }>("workspace.createTopic", { category, name }),
    deleteTopic: (topicId: string) =>
      invoke<WritebackEvidence>("workspace.deleteTopic", { topicId }),
    appendMemory: (p: { topicId: string; entry: string; source?: string }) =>
      invoke<WritebackEvidence>("workspace.appendTopicMemory", p),
    appendCoreMemory: (p: { entry: string; section?: string; source?: string }) =>
      invoke<WritebackEvidence & { userMessage?: string; section?: string }>(
        "workspace.appendCoreMemory",
        p,
      ),
    getStreamContext: () =>
      invoke<{
        packing: string;
        appendHeading?: string;
        streamCategory: { directory: string; role: string; name: string } | null;
        periodRelPath: string | null;
        periodFileName: string | null;
        periodTitle: string | null;
        memory: {
          dir: string | null;
          profileFile: string;
          profileRelPath: string | null;
          files: string[];
        };
      }>("workspace.getStreamContext"),
    /** List all period notes in stream category (for "整理过往" UI). Optional year filter. */
    listStreamPeriods: (year?: string) =>
      invoke<
        Array<{
          relPath: string;
          fileName: string;
          mtime: string | null;
          title: string | null;
          reconciled: boolean;
        }>
      >("workspace.listStreamPeriods", { year }),
    /** List all year directories in the stream category for year navigation. */
    listStreamYears: () =>
      invoke<
        Array<{
          year: string;
          periodCount: number;
          archived: boolean;
        }>
      >("workspace.listStreamYears"),
    /** Archive a complete year of stream period notes to 99-归档/stream-archive/{year}/. */
    archiveStreamYear: (year: string) =>
      invoke<{
        ok: boolean;
        archived: boolean;
        year: string;
        movedCount: number;
        archivePath: string;
        receiptPath?: string;
        reason?: string;
        failedFiles?: string[];
        userMessage?: string;
      }>("workspace.archiveStreamYear", { year }),
    /**
     * Comment-like append under a stream entry (same Markdown file).
     * Optional parentRel anchors related original for activity window.
     */
    appendStreamEntry: (p: {
      relativePath: string;
      content: string;
      heading?: string;
      parentRel?: string;
      /** 0-based inclusive line in the period note (including frontmatter). */
      startLine?: number;
      /** 0-based exclusive end line. */
      endLine?: number;
      /** First-line fingerprint to verify the window still matches. */
      anchorText?: string;
    }) =>
      invoke<
        WritebackEvidence & {
          userMessage?: string;
          appendLocation?: {
            appendedAt: "heading" | "end";
            matchedHeading?: string;
            asNestedList?: boolean;
          };
        }
      >("workspace.appendStreamEntry", p),
    ensureCoreProfile: () =>
      invoke<{
        ok: boolean;
        created?: boolean;
        profileRelPath?: string | null;
        memoryDirRel?: string | null;
        profileFile?: string;
        files?: string[];
        reason?: string;
      }>("workspace.ensureCoreProfile"),
    generateSuggestions: (p?: { force?: boolean }) =>
      invoke<{
        ok: boolean;
        suggestions: Array<{
          id: string;
          kind: string;
          title: string;
          summary: string;
          targetPath?: string;
          impact: "low" | "medium" | "high";
          payload?: Record<string, unknown>;
        }>;
      }>("workspace.generateSuggestions", p || {}),
    applySuggestion: (p: { suggestion: Record<string, unknown>; confirmed?: boolean }) =>
      invoke<{
        ok: boolean;
        needsConfirm?: boolean;
        pending?: boolean;
        wroteFiles?: boolean;
        targetPath?: string;
        note?: string;
      }>("workspace.applySuggestion", p),
    listPendingWrites: () =>
      invoke<{
        ok: boolean;
        pending: Array<{
          id: string;
          relativePath: string;
          content: string;
          toolName?: string;
          createdAt: string;
        }>;
      }>("workspace.listPendingWrites"),
    confirmPendingWrite: (id: string) =>
      invoke<WritebackEvidence & { ok?: boolean }>("workspace.confirmPendingWrite", { id }),
    rejectPendingWrite: (id: string) =>
      invoke<{ ok: boolean }>("workspace.rejectPendingWrite", { id }),
    /** Deterministic 整理本周. apply=false → dry-run preview only. */
    reconcileStreamPeriod: (p?: { relativePath?: string; dryRun?: boolean; apply?: boolean }) =>
      invoke<{
        ok: boolean;
        path?: string;
        packing?: string;
        changed?: boolean;
        changes?: string[];
        candidates?: { core: string[]; topics: string[] };
        dryRun?: boolean;
        applied?: boolean;
        userMessage?: string;
        message?: string;
        reason?: string;
        targetPath?: string;
        backupPath?: string;
      }>("workspace.reconcileStreamPeriod", p || {}),
    health: () =>
      invoke<{
        ok: boolean;
        source?: string;
        summary?: {
          categoryCount: number;
          topicCount: number;
          looseNoteCount: number;
          errorCount: number;
          warningCount: number;
        };
        issues?: { severity: string; code: string; message: string; path?: string }[];
      }>("workspace.workspaceHealth"),
  },

  ai: {
    status: () => invoke<AiRuntimeStatus>("ai.getRuntimeStatus"),
    sessions: () => invoke<AiSession[]>("ai.listSessions"),
    loadMsgs: (sessionId: string) =>
      invoke<AiMessage[]>("ai.loadMessages", { sessionId }),
    saveMsgs: (p: { sessionId: string; messages: AiMessage[] }) =>
      invoke<{ ok: true }>("ai.saveMessages", p),
    clear: (sessionId: string) =>
      invoke<{ ok: true }>("ai.clearSession", { sessionId }),
    cancel: (sessionId: string) =>
      invoke<{ ok: boolean }>("ai.cancelStream", { sessionId }),
    /** Mid-turn steer: applied on next agent step while streaming. */
    steer: (sessionId: string, text: string) =>
      invoke<{ ok: boolean; mode: string }>("ai.steerStream", { sessionId, text }),
    /** Queue message to auto-send after current turn ends. */
    followUp: (sessionId: string, text: string) =>
      invoke<{ ok: boolean; mode: string }>("ai.queueFollowUp", { sessionId, text }),
    updateSession: (p: { sessionId: string; patch: Record<string, unknown> }) =>
      invoke<AiSession>("ai.updateSession", p),
    invoke: (p: {
      messages: Array<{
        role: string;
        content: string;
        toolCalls?: AiToolCall[];
      }>;
      topicId?: string;
      mountedFiles?: string[];
      /** Open file path — included this turn without sticky mount UI */
      focusPath?: string;
      focusHint?: string;
      model?: string;
      sessionId: string;
      useTools?: boolean;
      writebackMode?: string;
      /** Pin a skill for this turn (skill-first); server injects into system prompt */
      activeSkillId?: string;
    }) => invoke<{
      ok: boolean;
      text: string;
      error: string;
      batchEvidence?: import("../types").BatchEvidenceSummary | null;
      followUps?: string[];
      steerApplyCount?: number;
    }>("ai.invoke", p),
    /**
     * One-shot inline edit (no tools / no chat session).
     * For Notion-style selection rewrite in the editor.
     */
    complete: (p: {
      text?: string;
      action?:
        | "polish"
        | "shorter"
        | "expand"
        | "bullets"
        | "formal"
        | "casual"
        | "fix"
        | "format"
        | "continue"
        | "summarize"
        | "generate"
        | string;
      mode?: "rewrite" | "continue" | "summarize" | "generate";
      instruction?: string;
      model?: string;
      /** Correlate with cancelComplete for true in-flight abort */
      requestId?: string;
      /**
       * Whole-file / surrounding Markdown so polish·format match document structure
       * (headings, list markers, density) — not selection-only isolation.
       */
      documentText?: string;
    }) =>
      invoke<{ ok: boolean; text: string; model?: { modelId: string }; requestId?: string }>(
        "ai.complete",
        p,
      ),
    /** Abort in-flight ai.complete (AbortSignal into generateText). */
    cancelComplete: (requestId: string) =>
      invoke<{ ok: boolean; reason?: string }>("ai.cancelComplete", { requestId }),
  },

  sys: {
    settings: () => invoke<AppSettings>("system.getSettings"),
    /** UI zoom step — "in" | "out" | "reset" (Ctrl +/-/0 on Win/Linux). */
    zoom: (mode: "in" | "out" | "reset") =>
      invoke<{ ok: boolean; factor?: number }>("system.zoom", { mode }),
    update: (patch: Record<string, unknown>) =>
      invoke<AppSettings>("system.updateSettings", { patch }),
    clipBridgeStatus: () =>
      invoke<{
        running: boolean;
        enabled: boolean;
        port: number | null;
        configuredPort: number;
        hasToken: boolean;
        endpoint: string | null;
      }>("system.clipBridgeStatus"),
    clipBridgeRotateToken: () =>
      invoke<{ ok: true; token: string; settings: AppSettings }>("system.clipBridgeRotateToken"),
    openPath: (targetPath: string) =>
      invoke<{ ok: true }>("system.openPath", { targetPath }),
    reveal: (targetPath: string) =>
      invoke<{ ok: true }>("system.revealPath", { targetPath }),
    openUrl: (url: string) =>
      invoke<{ ok: true }>("system.openExternal", { url }),
    openCaptureSurface: (p?: { mode?: "float" | "overlay" }) =>
      invoke<{ ok: true; mode: string }>("system.openCaptureSurface", p ?? {}),
    /** Focus main window + open Knowledge Ingest hub (from float capture). */
    openIngestHub: () => invoke<{ ok: boolean }>("system.openIngestHub"),
    closeQuickCapture: () =>
      invoke<{ ok: true }>("system.closeQuickCapture"),
    appInfo: () =>
      invoke<{
        name: string;
        version: string;
        platform: string;
        packaged: boolean;
        electron: string | null;
        chrome: string | null;
        node: string | null;
      }>("system.getAppInfo"),
    checkForUpdates: () =>
      invoke<{
        ok: boolean;
        updateAvailable: boolean;
        currentVersion: string;
        latestVersion: string | null;
        tagName: string | null;
        releaseUrl: string | null;
        notes: string | null;
        publishedAt: string | null;
        assets: { name: string; size: number; url: string; contentType?: string }[];
        error?: string;
        errorCode?: string;
        reason?: string;
        checkedAt?: string;
        repo?: string;
        releasesUrl?: string;
        desktop?: SurfaceUpdateInfo;
        skills?: SurfaceUpdateInfo;
        extension?: SurfaceUpdateInfo;
        obsidian?: SurfaceUpdateInfo;
        model?: {
          desktopBundlesSkills?: boolean;
          desktopBundlesUtr?: boolean;
          extensionIsBrowser?: boolean;
          obsidianIsVaultPlugin?: boolean;
        };
      }>("system.checkForUpdates"),
    openUpdateDownload: (url?: string, surface?: "desktop" | "skills" | "extension" | "obsidian") =>
      invoke<{ ok: true }>("system.openUpdateDownload", {
        ...(url ? { url } : {}),
        ...(surface ? { surface } : {}),
      }),
    downloadAndInstallCompanion: (
      surface: "skills" | "obsidian" | "extension",
      version: string,
      tag: string,
      opts?: { hostId?: string; vaultPath?: string },
    ) =>
      invoke<{
        ok: true;
        surface: string;
        version: string;
        dest?: string;
        path?: string;
        pluginId?: string;
        installed?: unknown[];
      }>("system.downloadAndInstallCompanion", {
        surface,
        version,
        tag,
        hostId: opts?.hostId,
        vaultPath: opts?.vaultPath,
      }),
    exportKeysForObsidian: () =>
      invoke<{ ok: true; path: string; keyCount: number }>("system.exportKeysForObsidian"),
    listExternalPlugins: () =>
      invoke<{
        ok: true;
        root: string;
        plugins: ExternalPluginInfo[];
      }>("system.listExternalPlugins"),
    openPluginsDir: () =>
      invoke<{ ok: true; path: string }>("system.openPluginsDir"),
    pickPluginFolder: () =>
      invoke<{ path: string | null }>("system.pickPluginFolder"),
    pickPluginZip: () =>
      invoke<{ path: string | null }>("system.pickPluginZip"),
    installExternalPluginFromFolder: (sourcePath: string, force?: boolean) =>
      invoke<{
        ok: true;
        id: string;
        dir: string;
        version?: string;
        status?: string;
      }>("system.installExternalPluginFromFolder", { sourcePath, force }),
    installExternalPluginFromZip: (zipPath: string, force?: boolean) =>
      invoke<{
        ok: true;
        id: string;
        dir: string;
        version?: string;
        status?: string;
      }>("system.installExternalPluginFromZip", { zipPath, force }),
    uninstallExternalPlugin: (pluginId: string, hard?: boolean) =>
      invoke<{
        ok: true;
        id: string;
        removed?: string;
        trashPath?: string | null;
      }>("system.uninstallExternalPlugin", { pluginId, hard }),
    scaffoldExamplePlugin: () =>
      invoke<{ ok: true; id: string; dir: string }>("system.scaffoldExamplePlugin"),
    previewExternalPluginFromFolder: (sourcePath: string) =>
      invoke<PluginInstallPreview>("system.previewExternalPluginFromFolder", { sourcePath }),
    previewExternalPluginFromZip: (zipPath: string) =>
      invoke<PluginInstallPreview>("system.previewExternalPluginFromZip", { zipPath }),
    health: () =>
      invoke<{ ok: boolean; engineRoot: string | null; workspaceRoot: string | null }>(
        "system.getEngineHealth"
      ),
    discoverModels: (opts?: { forceCommunity?: boolean; forceLive?: boolean; skipCommunity?: boolean }) =>
      invoke<ProviderInfo[]>("system.discoverModels", opts || {}),
    fetchLiveModels: () =>
      invoke<ProviderInfo[]>("system.fetchLiveModels"),
    fetchModelsDevCatalog: (opts?: { forceLive?: boolean }) =>
      invoke<ProviderInfo[]>("system.fetchModelsDevCatalog", opts || {}),
    pickWorkspaceFolder: () =>
      invoke<{ path: string | null }>("system.pickWorkspaceFolder"),
    createWorkspace: (targetPath: string, templateId?: string) =>
      invoke<{ ok: true; path: string }>("system.createWorkspace", { targetPath, templateId }),
    /** Open recent / known path — missing paths fail and are pruned from recents. */
    switchWorkspace: (targetPath: string, opts?: { createIfMissing?: boolean }) =>
      invoke<{
        ok: boolean;
        workspaceRoot: string;
        settings: AppSettings;
        launchStatus?: LaunchStatus | null;
        contractOnDiskValid?: boolean;
        recovery?: string | null;
      }>("system.switchWorkspace", {
        targetPath,
        createIfMissing: opts?.createIfMissing === true,
      }),
    /** Pick folder then init + open (Landing / 新建). */
    openOrCreateWorkspace: (targetPath: string, templateId?: string) =>
      invoke<{
        ok: boolean;
        workspaceRoot: string;
        settings: AppSettings;
        launchStatus?: LaunchStatus | null;
        contractOnDiskValid?: boolean;
      }>("system.openOrCreateWorkspace", {
        targetPath,
        templateId,
      }),
    /** Close active workspace → landing (keeps recents, clears active root). */
    closeWorkspace: () =>
      invoke<{ ok: true; settings?: AppSettings }>("system.closeWorkspace"),
    /** Remove a path from the recent list. */
    removeRecentWorkspace: (targetPath: string) =>
      invoke<{ ok: true; settings: AppSettings }>("system.removeRecentWorkspace", { targetPath }),
    /** Probe path health for landing / switcher (no open). */
    classifyWorkspace: (targetPath: string) =>
      invoke<{
        ok: boolean;
        status: string;
        kind?: string;
        suitable?: boolean;
        path: string;
        message?: string;
        hasCategoryShape?: boolean;
        hasContract?: boolean;
      }>("system.classifyWorkspace", { targetPath }),
    /** Dedupe + prune missing/forbidden recents on disk. */
    refreshWorkspaceHistory: () =>
      invoke<{
        ok: true;
        changed: boolean;
        removed: Array<{ rootPath: string; status?: string }>;
        settings: AppSettings;
        recent: Array<{ rootPath: string; lastOpenedAt?: string }>;
      }>("system.refreshWorkspaceHistory"),
    getSkillsStatus: () =>
      invoke<{
        packVersion: string | null;
        skillCount: number;
        hasShared: boolean;
        skillsEnabled: boolean;
        enabledSkillIds: string[] | null;
        catalog: Array<{
          id: string;
          description: string;
          actionCategory?: string;
          entrypoint?: boolean;
          source?: string;
        }>;
        enabledCatalog: Array<{
          id: string;
          description: string;
          actionCategory?: string;
          entrypoint?: boolean;
        }>;
        slash: Array<{ command: string; skillId: string; prompt: string }>;
        skillsRoot?: string;
        extraRoots?: string[];
        extraSkillsRoots?: string[];
        managedExtraRoot?: string;
        extraReceipt?: SkillsExtraReceipt | null;
        extraSummaries?: SkillsPackSummary[];
      }>("system.getSkillsStatus"),
    getSkillBody: (skillId: string) =>
      invoke<{
        id: string;
        description?: string;
        raw?: string;
        body?: string;
        truncated?: boolean;
      }>("system.getSkillBody", { skillId }),
    pickSkillsFolder: () =>
      invoke<{ path: string | null }>("system.pickSkillsFolder"),
    installSkillsPackLocal: (sourcePath: string, dest?: string) =>
      invoke<{
        ok: true;
        dest: string;
        installed: string[];
        source: string;
        version?: string | null;
        receipt?: SkillsExtraReceipt;
      }>("system.installSkillsPackLocal", { sourcePath, dest }),
    ensureSkillsExtraDir: () =>
      invoke<{ ok: true; path: string }>("system.ensureSkillsExtraDir"),
    openSkillsExtraDir: () =>
      invoke<{ ok: true; path: string }>("system.openSkillsExtraDir"),
    probeSkillsPack: (sourcePath: string) =>
      invoke<{
        ok: boolean;
        path: string;
        summary?: SkillsPackSummary | null;
      }>("system.probeSkillsPack", { sourcePath }),

    /** Detect agent hosts · browsers · Obsidian + managed companion status. */
    detectCompanions: () => invoke<CompanionStatusResult>("system.detectCompanions"),
    getCompanionStatus: () => invoke<CompanionStatusResult>("system.getCompanionStatus"),
    getSystemInfo: () =>
      invoke<{
        platform: string;
        arch: string;
        home: string;
        brewAvailable: boolean;
        nodeVersion: string | null;
        electronVersion: string | null;
        platformLabel: string;
        archLabel: string;
      }>("system.getSystemInfo"),
    installCompanionSkills: (hostId: string, opts?: { mode?: "copy" | "symlink"; dest?: string }) =>
      invoke<CompanionSkillsResult>("system.installCompanionSkills", {
        hostId,
        mode: opts?.mode,
        dest: opts?.dest,
      }),
    uninstallCompanionSkills: (hostId: string, dest?: string) =>
      invoke<{ ok: true; hostId: string; dest: string; removed: string[] }>(
        "system.uninstallCompanionSkills",
        { hostId, dest },
      ),
    upgradeCompanionSkills: (hostId: string, opts?: { mode?: "copy" | "symlink"; dest?: string }) =>
      invoke<CompanionSkillsResult>("system.upgradeCompanionSkills", {
        hostId,
        mode: opts?.mode,
        dest: opts?.dest,
      }),
    prepareClipExtension: () =>
      invoke<{
        ok: true;
        path: string;
        version: string | null;
        guidedInstall: true;
        instructionsKey?: string;
        source?: "bundled" | "downloaded";
        downloadedVersion?: string;
      }>("system.prepareClipExtension"),
    uninstallClipExtension: () =>
      invoke<{ ok: true; removed: string[]; managedDir: string }>(
        "system.uninstallClipExtension",
      ),
    openClipExtensionFolder: () =>
      invoke<{ ok: true; path: string }>("system.openClipExtensionFolder"),
    installObsidianPlugin: (vaultPath?: string) =>
      invoke<{
        ok: boolean;
        guided?: boolean;
        pluginId?: string;
        version?: string | null;
        path?: string;
        error?: string;
      }>("system.installObsidianPlugin", vaultPath ? { vaultPath } : {}),
    uninstallObsidianPlugin: (vaultPath?: string) =>
      invoke<{ ok: true; removed: string[] }>(
        "system.uninstallObsidianPlugin",
        vaultPath ? { vaultPath } : {},
      ),

    getWorkspaceConfig: () =>
      invoke<{
        contract_version?: number;
        categorySeparator: string;
        template: string;
        stream?: { packing: string; appendHeading?: string; yearDir?: boolean; year_dir?: boolean };
        memory?: { dir: string | null; profileFile: string; files?: string[] };
        writebackMode?: string;
        views: { default: string; enabled: string[] };
        connectorDefaults: Record<string, unknown>;
        categoryExtensions?: Record<string, unknown>;
        categoryOverrides?: Record<string, unknown>;
        categories?: Array<{
          slot: string;
          name: string;
          directory: string;
          role: string;
          specialBehavior?: string;
          source?: string;
          hidden?: boolean;
          ok?: boolean;
        }>;
      }>("system.getWorkspaceConfig"),
    updateWorkspaceConfig: (p: {
      categorySeparator?: string;
      template?: string;
      stream?: { packing?: string; appendHeading?: string; yearDir?: boolean };
      memory?: { dir: string | null; profileFile: string; files?: string[] };
      writebackMode?: string;
      views?: { default: string; enabled: string[] };
      connectorDefaults?: Record<string, unknown>;
    }) =>
      invoke<{ ok: boolean; onDiskValid?: boolean; state?: string; writebackMode?: string }>(
        "system.updateWorkspaceConfig",
        p,
      ),
    /** Backup corrupt topmind.yaml + reseed valid v4 (content dirs kept). */
    reseedWorkspaceContract: (p?: { templateId?: string; locale?: string }) =>
      invoke<{
        ok: boolean;
        status?: string;
        backupPath?: string | null;
        onDiskValid?: boolean;
        errors?: string[];
      }>("system.reseedWorkspaceContract", p || {}),
    createCategory: (p: {
      slot?: string;
      name: string;
      role?: string;
      specialBehavior?: string;
      catchAll?: boolean;
      referenceOnly?: boolean;
    }) =>
      invoke<{ ok: true; directory: string; category: unknown }>("system.createCategory", p),
    updateCategory: (p: {
      slot: string;
      role?: string;
      specialBehavior?: string | null;
      hidden?: boolean;
      catchAll?: boolean;
      referenceOnly?: boolean;
    }) => invoke<{ ok: true; category: unknown }>("system.updateCategory", p),
    renameCategory: (p: { slot: string; newName: string; updateFrontmatter?: boolean }) =>
      invoke<{ ok: true; from: string; to: string; frontmatterUpdated: number; category: unknown }>(
        "system.renameCategory",
        p,
      ),
    rebuildWorkspaceMap: () =>
      invoke<{ ok: true; path: string }>("system.rebuildWorkspaceMap"),
    suggestCategorySlot: () => invoke<{ slot: string }>("system.suggestCategorySlot"),
    listTemplates: () =>
      invoke<{ id: string; name: string; description: string }[]>("system.listTemplates"),
  },

  /** Optional UTR soft adapter + combined doctor (native always; UTR if present). */
  tool: {
    catalog: () => invoke<unknown[]>("tool.catalog"),
    preview: (p: { kind: string; command: string; input?: unknown }) =>
      invoke<unknown>("tool.preview", p),
    run: (p: { kind: string; command: string; input?: unknown; reviewed?: boolean }) =>
      invoke<unknown>("tool.run", p),
    doctor: (includeMcp?: boolean) =>
      invoke<{
        ok: boolean;
        error?: string;
        issues?: Array<{ severity?: string; message?: string; code?: string; path?: string }>;
      }>("tool.doctor", { includeMcp }),
    status: () =>
      invoke<{
        utrAvailable: boolean;
        engineRoot: string | null;
        utrRoot: string | null;
        userWorkspaceRoot?: string | null;
        bundled?: boolean;
      }>("tool.status"),
  },

  /** Knowledge ingest pipeline (Office/PDF/email → Markdown → Inbox/topic). */
  ingest: {
    enqueue: (p: {
      items?: { absolutePath: string }[];
      absolutePath?: string;
      dest?: { mode?: "inbox" | "topic"; topicId?: string };
    }) =>
      invoke<{ ok: true; jobIds: string[]; jobs: IngestJob[] }>("ingest.enqueue", p),
    list: () => invoke<{ jobs: IngestJob[] }>("ingest.list"),
    get: (jobId: string) => invoke<IngestJob>("ingest.get", { jobId }),
    cancel: (jobId: string) =>
      invoke<{ ok: boolean; job: IngestJob | null }>("ingest.cancel", { jobId }),
    retry: (jobId: string) =>
      invoke<{ ok: boolean; job: IngestJob | null }>("ingest.retry", { jobId }),
    pickFiles: () => invoke<{ paths: string[] }>("ingest.pickFiles"),
    pickFolder: () => invoke<{ path: string | null }>("ingest.pickFolder"),
    /** Preview paths for staging (kind/size) without enqueue. */
    previewItems: (p: { paths?: string[]; absolutePath?: string }) =>
      invoke<{
        items: import("../types").IngestBatchItem[];
        capped?: boolean;
        maxFolderFiles?: number;
        maxFileBytes?: number;
        settings?: import("../types").IngestSettings;
      }>("ingest.previewItems", p),
    toolsStatus: (force?: boolean) =>
      invoke<{
        anydoc: {
          available: boolean;
          version: string | null;
          path?: string;
          source?: string;
          upgradable?: boolean;
          install?: {
            commands: string[];
            docsUrl: string;
            label: string;
            preferredIndex?: number;
            hint?: string;
            canSidecarInstall?: boolean;
          };
        };
        pandoc: {
          available: boolean;
          version: string | null;
          path?: string;
          source?: string;
          install?: {
            commands: string[];
            docsUrl: string;
            label: string;
            preferredIndex?: number;
            hint?: string;
          };
        };
        markitdown: {
          available: boolean;
          version: string | null;
          path?: string;
          viaModule?: boolean;
          source?: string;
          install?: {
            commands: string[];
            docsUrl: string;
            label: string;
            preferredIndex?: number;
            hint?: string;
          };
        };
        checkedAt: string;
        fromCache?: boolean;
        settings?: import("../types").IngestSettings;
        defaults?: import("../types").IngestSettings;
      }>("ingest.toolsStatus", { force: Boolean(force) }),
    openInstallHelp: (tool: "pandoc" | "markitdown" | "anydoc") =>
      invoke<{ ok: boolean; opened?: string }>("ingest.openInstallHelp", { tool }),
    copyInstallCommand: (tool: "pandoc" | "markitdown" | "anydoc", index?: number) =>
      invoke<{ ok: boolean; command: string; commands?: string[]; index?: number }>(
        "ingest.copyInstallCommand",
        { tool, index },
      ),
    /** User-triggered sidecar install / upgrade (writes under userData, not asar). */
    installAnydoc: (spec?: string) =>
      invoke<{
        ok: boolean;
        error?: string;
        version?: string | null;
        path?: string;
        source?: string;
        outsideAsar?: boolean;
      }>("ingest.installAnydoc", spec ? { spec } : {}),
    readClipboard: () =>
      invoke<{
        text: string;
        html: string;
        filePaths: string[];
        formats: string[];
        kind: "empty" | "text" | "html" | "files" | "mixed";
      }>("ingest.readClipboard"),
    enqueueFromClipboard: (p?: { dest?: { mode?: "inbox" | "topic"; topicId?: string } }) =>
      invoke<{ ok: true; jobIds: string[]; enqueued: number; clipboard: unknown }>(
        "ingest.enqueueFromClipboard",
        p ?? {},
      ),
  },

  weread: {
    status: () =>
      invoke<{
        ready: boolean;
        enabled?: boolean;
        lastSyncAt: string | null;
        lastSyncSummary?: WereadLastSyncSummary | null;
        syncCategory: string;
        syncCategoryPreference?: string;
        includeThoughts?: boolean;
        syncBudgetMinutes?: number;
        skillVersion?: string;
        statsCache?: WereadStatsCache | null;
      }>("weread.getStatus"),
    testConnection: () => invoke<{ ok: boolean; skillVersion?: string; data: unknown; upgradeInfo?: { message?: string } | null }>("weread.testConnection"),
    bookshelf: () => invoke<unknown>("weread.getBookshelf"),
    listNotebooks: () =>
      invoke<{ books: WereadNotebookBook[]; total: number; totalBookCount?: number }>("weread.listNotebooks"),
    highlights: (bookId: string) => invoke<unknown>("weread.getHighlights", { bookId }),
    thoughts: (bookId: string) => invoke<unknown[]>("weread.getThoughts", { bookId }),
    stats: (p?: { mode?: string; force?: boolean; baseTime?: number }) =>
      invoke<WereadStatsCache & { fromCache?: boolean }>("weread.getStats", p ?? {}),
    search: (keyword: string, count?: number) => invoke<unknown>("weread.searchBooks", { keyword, count }),
    bookDetail: (bookId: string) => invoke<unknown>("weread.getBookDetail", { bookId }),
    sync: (p?: { bookIds?: string[]; force?: boolean }) =>
      invoke<WereadSyncResult>("weread.syncHighlights", p ?? {}),
  },

  x: {
    status: () =>
      invoke<{
        ready: boolean;
        enabled?: boolean;
        accessLayer: string | null;
        readLayer?: string | null;
        writeLayer?: string | null;
        hasMcp: boolean;
        hasApi: boolean;
        hasCli?: boolean;
        canPost?: boolean;
        canRead?: boolean;
        syncCategory: string;
        autoArchive: boolean;
        officialMcpUrl?: string;
        agentMcpHint?: string;
        xurlVersion?: string | null;
        xurlCmd?: string | null;
        installHints?: {
          brew?: string;
          npm?: string;
          auth?: string;
          mcp?: string;
          docs?: string;
        };
      }>("x.getStatus"),
    probeTools: () =>
      invoke<{
        xurl: { ok: boolean; version?: string | null; cmd?: string | null };
        canPost: boolean;
        installHints: {
          brew?: string;
          npm?: string;
          auth?: string;
          mcp?: string;
          docs?: string;
        };
        message: string;
      }>("x.probeTools"),
    testConnection: () =>
      invoke<{ ok: boolean; message: string; results?: unknown }>("x.testConnection"),
    post: (text: string, replyToId?: string) =>
      invoke<{ ok: boolean; tweetId?: string; text: string; via?: string }>("x.postTweet", { text, replyToId }),
    search: (query: string, maxResults?: number) =>
      invoke<{ data: XTweet[]; via?: string }>("x.searchTweets", { query, maxResults }),
    timeline: (username: string, maxResults?: number) =>
      invoke<{ data: XTweet[]; via?: string }>("x.getTimeline", { username, maxResults }),
    syncToNotes: (p: { tweets: unknown[]; topicName?: string; title?: string; append?: boolean }) =>
      invoke<{
        ok: boolean;
        path: string;
        count?: number;
        totalCount?: number;
        appended?: boolean;
        category?: string;
        topic?: string;
      }>("x.syncToNotes", p),
  },

  // ── Todo ───────────────────────────────────────────────────────────────
  todo: {
    list: () =>
      invoke<{
        items: import("../types").TodoItem[];
        rawContent: string;
        relPath: string;
      } | null>("workspace.getTodoList"),
    add: (text: string, opts?: { source?: string; sourcePeriod?: string }) =>
      invoke<{
        ok: boolean;
        item: import("../types").TodoItem | null;
        items: import("../types").TodoItem[];
        targetPath: string;
        reason?: string;
      }>("workspace.addTodoItem", { text, ...opts }),
    toggle: (id: string) =>
      invoke<{
        ok: boolean;
        items: import("../types").TodoItem[];
        targetPath: string;
      }>("workspace.toggleTodoItem", { id }),
    update: (id: string, text: string, opts?: { dueDate?: string | null }) =>
      invoke<{
        ok: boolean;
        items: import("../types").TodoItem[];
        targetPath: string;
      }>("workspace.updateTodoItem", { id, text, ...opts }),
    setDueDate: (id: string, dueDate: string | null) =>
      invoke<{
        ok: boolean;
        items: import("../types").TodoItem[];
        targetPath: string;
      }>("workspace.setTodoDueDate", { id, dueDate }),
    delete: (id: string) =>
      invoke<{
        ok: boolean;
        items: import("../types").TodoItem[];
        targetPath: string;
      }>("workspace.deleteTodoItem", { id }),
    clearCompleted: () =>
      invoke<{
        ok: boolean;
        items: import("../types").TodoItem[];
        cleared: number;
        targetPath: string;
      }>("workspace.clearCompletedTodos"),
    extractFromStream: (opts?: { force?: boolean }) =>
      invoke<{
        ok: boolean;
        added: import("../types").TodoItem[];
        skipped: number;
        period: string | null;
        targetPath: string;
        reason?: string;
      }>("workspace.extractTodosFromStream", opts || {}),
    maintain: (opts?: { force?: boolean; depth?: number }) =>
      invoke<{
        ok: boolean;
        added: import("../types").TodoItem[];
        completed: import("../types").TodoItem[];
        updated: import("../types").TodoItem[];
        period: string | null;
        targetPath: string;
        reason?: string;
        processedPeriods?: string[];
      }>("workspace.maintainTodos", opts || {}),
    getHealth: () =>
      invoke<import("../types").TodoHealth | null>("workspace.getTodoHealth"),
    cleanupStale: () =>
      invoke<{
        ok: boolean;
        items: import("../types").TodoItem[];
        cleared: number;
        targetPath: string;
        reason?: string;
      }>("workspace.cleanupStaleTodos"),
    archiveStale: () =>
      invoke<{
        ok: boolean;
        items: import("../types").TodoItem[];
        archived: import("../types").TodoItem[];
        targetPath: string;
        reason?: string;
      }>("workspace.archiveStaleTodos"),
  },

  // ── Ledger (memory-plane books, optional 记账 mini-app) ─────────────────
  ledger: {
    list: () =>
      invoke<{
        books: import("../types").LedgerBook[];
        summary?: import("../lib/ledger-summary").LedgerSummary;
        categories?: string[];
      }>("workspace.listLedgers"),
    read: (roleId: string) =>
      invoke<import("../types").LedgerBook | null>("workspace.readLedger", { roleId }),
    append: (roleId: string, entry: {
      direction: "收入" | "支出";
      amount: number;
      category?: string;
      subcategory?: string;
      note?: string;
      timestamp?: string;
    }) =>
      invoke<{
        ok: boolean;
        targetPath: string;
        book: import("../types").LedgerBook | null;
        writebackEvidence?: { targetPath?: string; affectedFiles?: string[]; wroteFiles?: boolean };
        reason?: string;
      }>("workspace.appendLedgerEntry", { roleId, ...entry }),
    addRole: (spec: { id?: string; name?: string }) =>
      invoke<{
        ok: boolean;
        targetPath: string;
        book: import("../types").LedgerBook | null;
        reason?: string;
      }>("workspace.addLedgerRole", spec),
    categories: () =>
      invoke<{ categories: string[] }>("workspace.listLedgerCategories"),
    addCategory: (name: string) =>
      invoke<{ ok: boolean; categories: string[]; reason?: string }>("workspace.addLedgerCategory", { name }),
    removeCategory: (name: string) =>
      invoke<{ ok: boolean; categories: string[]; reason?: string }>("workspace.removeLedgerCategory", { name }),
    capture: (text: string, opts?: { persist?: boolean; defaultRoleId?: string; skipAi?: boolean }) =>
      invoke<{
        ok: boolean;
        intent: "capture" | "list" | "balance" | null;
        complete: boolean;
        roleId: string;
        accountName?: string;
        direction: "收入" | "支出" | null;
        amount: number | null;
        category?: string;
        subcategory?: string;
        note?: string;
        persisted?: boolean;
        targetPath?: string;
        book?: import("../types").LedgerBook | null;
        reason?: string;
        writebackEvidence?: {
          targetPath?: string;
          affectedFiles?: string[];
          wroteFiles?: boolean;
        };
      }>("workspace.captureLedgerPhrase", { text, ...opts }),
  },

  // ── AI Operations (unified engine) ───────────────────────────────────────
  aiOps: {
    list: () =>
      invoke<Array<{
        id: string;
        label: string;
        domain: string;
        description: string;
        requiresConfirm: boolean;
      }>>("workspace.listOperationTypes"),
    run: (id: string, opts?: { force?: boolean, depth?: number, confirmed?: boolean }) =>
      invoke<{
        ok: boolean;
        reason?: string;
        changes: unknown[];
        summary: string;
        scope?: { periods?: string[], paths?: string[] };
        targetPath?: string;
        period?: string;
        suggestions?: unknown[];
      }>("workspace.runOperation", { id, options: opts || {} }),
    getState: (id: string) =>
      invoke<{
        ok: boolean;
        state: object;
      }>("workspace.getOperationState", { id }),
    clearState: (id: string, scope?: { periods?: string[], paths?: string[] }) =>
      invoke<{
        ok: boolean;
      }>("workspace.clearOperationState", { id, scope }),
  },
};
