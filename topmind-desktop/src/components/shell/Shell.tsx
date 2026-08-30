import { useEffect, useState, useRef, useCallback, lazy } from "react";
import { Lightbulb, ListTodo } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TitleBar } from "./TitleBar";
import { StatusBar } from "./StatusBar";
import { Sidebar } from "./Sidebar";
import { EditorArea } from "./EditorArea";
import { AiPanel } from "../ai/AiPanel";
import { OverlayHost } from "./OverlayHost";
import { FileDropZone } from "./FileDropZone";
import { IngestStagingSheet } from "../overlays/IngestStagingSheet";
import { Splitter } from "../ui/Splitter";
import { LazyBoundary } from "../ui/LazyBoundary";
import { useViewStore } from "../../stores/view-store";
import { useActionStore } from "../../stores/action-store";
import { useTodoStore } from "../../stores/todo-store";
import { useAiStore } from "../../stores/ai-store";
import { onLocal, emitLocal } from "../../plugins/host";
import { api } from "../../services/api";
import type { AppSettings, WritebackEvidence } from "../../types";
import { cn } from "../../lib/cn";
import { TooltipProvider } from "../ui/tooltip";
import { setCachedSettings } from "../../lib/settings-cache";
import { applyLocale } from "../../locales";
import { TaskPanel } from "../ai/TaskPanel";
import { SuggestPopover } from "../ai/SuggestPopover";
import { InlineAiLeaveHost } from "./InlineAiLeaveHost";
import { useWorkspaceHealth } from "./useWorkspaceHealth";
import { usePluginInit } from "./usePluginInit";
import { useShellSettingsSync } from "./useShellSettingsSync";
import { useShellShortcuts } from "./useShellShortcuts";
import { useAutoTodoMaintain } from "./useAutoTodoMaintain";
import { openSuggestSurface } from "../../lib/suggest-surface";
import { ICON } from "../../lib/icons";
import type { ToastPayload } from "../../lib/local-events";

/** @dnd-kit is code-split — loaded with the shell chrome after React mounts. */
const DndShell = lazy(() => import("./DndShell").then((m) => ({ default: m.DndShell })));

interface ShellProps {
  settings: AppSettings;
}

export function Shell({ settings }: ShellProps) {
  const { t } = useTranslation(["common", "shell"]);
  const sidebarWidth = useViewStore((s) => s.sidebarWidth);
  const sidebarCollapsed = useViewStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useViewStore((s) => s.toggleSidebar);
  const setSidebarWidth = useViewStore((s) => s.setSidebarWidth);
  const aiPanelOpen = useViewStore((s) => s.aiPanelOpen);
  const aiPanelWidth = useViewStore((s) => s.aiPanelWidth);
  const setAiPanelWidth = useViewStore((s) => s.setAiPanelWidth);
  const focusMode = useViewStore((s) => s.focusMode);

  const health = useWorkspaceHealth();

  // Focus-mode fallback (DESIGN §0.0.3): the status bar is hidden in focus
  // mode, so actionable AI state still needs a door — a quiet chip cluster
  // bottom-right appears only when there is something to act on.
  const suggestCount = useActionStore((s) => s.items.length);
  const activeTodoCount = useTodoStore((s) => s.items.filter((i) => !i.done).length);
  usePluginInit(settings);
  useShellSettingsSync(settings);
  useAutoTodoMaintain(settings);

  // Toast queue: stacked (max 3, newest visible), hover pauses the dwell —
  // a capture + docs enqueue + AI polish burst no longer overwrites itself.
  const [toasts, setToasts] = useState<Array<ToastPayload & { key: number; dwell: number }>>([]);
  const toastSeq = useRef(0);
  const toastTimersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const [taskPanelOpen, setTaskPanelOpen] = useState(false);

  useShellShortcuts();

  const dismissToast = useCallback((key: number) => {
    const timer = toastTimersRef.current.get(key);
    if (timer) {
      clearTimeout(timer);
      toastTimersRef.current.delete(key);
    }
    setToasts((prev) => prev.filter((x) => x.key !== key));
  }, []);

  const pauseToast = useCallback((key: number) => {
    const timer = toastTimersRef.current.get(key);
    if (timer) {
      clearTimeout(timer);
      toastTimersRef.current.delete(key);
    }
  }, []);

  const resumeToast = useCallback((key: number, dwell: number) => {
    pauseToast(key);
    toastTimersRef.current.set(key, setTimeout(() => dismissToast(key), dwell));
  }, [pauseToast, dismissToast]);

  const showToast = useCallback((msg: string | ToastPayload) => {
    const payload = typeof msg === "string" ? { text: msg } : msg;
    // Evidence-backed toast gets a longer dwell time for undo interaction
    const dwell = payload.evidence?.backupPath || payload.evidence?.receiptPath ? 6000 : 3000;
    const key = ++toastSeq.current;
    setToasts((prev) => [...prev.slice(-2), { ...payload, key, dwell }]);
    toastTimersRef.current.set(key, setTimeout(() => dismissToast(key), dwell));
  }, [dismissToast]);

  // Listen to global toast events (string or structured payload with evidence)
  useEffect(() => {
    const unsub = onLocal("toast:show", (payload: unknown) => {
      if (typeof payload === "string") {
        showToast({ text: payload });
      } else if (
        payload &&
        typeof payload === "object" &&
        "text" in payload
      ) {
        showToast(payload as ToastPayload);
      }
    });
    return unsub;
  }, [showToast]);

  // Undo a writeback by restoring from backup path
  const handleUndoWriteback = useCallback(
    async (evidence: WritebackEvidence) => {
      const backupPath = evidence.backupPath || evidence.receiptPath;
      if (!backupPath || !evidence.targetPath) return;
      try {
        await api.ws.restoreReceipt({
          archiveRelativePath: backupPath,
          targetRelativePath: evidence.targetPath,
        });
        showToast({ text: `↩ ${t("common:writeback.restoreTip")}`, kind: "success" });
        emitLocal("workspace:file-changed", { relativePath: evidence.targetPath });
      } catch {
        showToast({ text: `✗ ${t("common:writeback.restoreTip")}`, kind: "error" });
      }
    },
    [showToast, t],
  );

  // AI rail / command surface can toggle floating TaskPanel (Wave F thrift)
  useEffect(() => {
    return onLocal("task-panel:toggle", () => {
      setTaskPanelOpen((prev) => !prev);
    });
  }, []);

  useEffect(() => {
    return onLocal("task-panel:open", () => {
      setTaskPanelOpen(true);
    });
  }, []);

  useEffect(() => {
    return onLocal("ai-panel:open", () => {
      useViewStore.getState().setAiPanelOpen(true);
    });
  }, []);

  // Unified 建议 entry (task-store / bus) → SuggestPopover via openSuggestSurface
  useEffect(() => {
    return onLocal("suggest-surface:open", (payload) => {
      void import("../../lib/suggest-surface").then(({ openSuggestSurface }) => {
        const refresh = payload && typeof payload === "object" ? payload.refresh : undefined;
        openSuggestSurface(
          refresh === false ? { refresh: false } : refresh === true ? { refresh: true } : undefined,
        );
      });
    });
  }, []);

  // ⌘K / command: 整理本周 — reconcile as engine task + AI rail for candidates
  useEffect(() => {
    return onLocal("organize:week", () => {
      void import("../../lib/organize-week").then(({ runOrganizeWeek }) => {
        void runOrganizeWeek();
      });
    });
  }, []);

  // Clean up timers on unmount
  useEffect(() => {
    const timers = toastTimersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  // Seed settings cache + warm model catalog so Settings / AI open snappy
  useEffect(() => {
    setCachedSettings(settings);
    // Apply locale from settings on every settings change (handles language switch)
    applyLocale(settings.ui?.locale || "auto");
    void useAiStore.getState().loadModelCatalog({ forceLive: false, silent: true });
    void useAiStore.getState().refreshRuntimeStatus();
  }, [settings]);

  // After AI keys / provider saved: refresh "AI 就绪" without requiring model pick
  useEffect(() => {
    return onLocal("ai:settings-changed", () => {
      void useAiStore.getState().refreshRuntimeStatus();
      useAiStore.getState().invalidateModelCatalog();
      void useAiStore.getState().loadModelCatalog({ forceLive: true, silent: true });
    });
  }, []);

  // Suppress browser/Electron default context menu outside editable fields.
  // Tree/editor/app menus call preventDefault themselves; this blocks empty native chrome.
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (
        t.closest(
          "input, textarea, select, [contenteditable='true'], .ProseMirror, .allow-native-context",
        )
      ) {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener("contextmenu", onCtx);
    return () => window.removeEventListener("contextmenu", onCtx);
  }, []);

  const overlay = useViewStore((s) => s.overlay);
  useEffect(() => {
    if (overlay !== "none") setTaskPanelOpen(false);
  }, [overlay]);

  const showSidebar = !focusMode && !sidebarCollapsed;
  const showAiPanel = !focusMode && aiPanelOpen;
  const gridRows = focusMode
    ? "grid-rows-[var(--density-chrome-y,36px)_minmax(0,1fr)]"
    : "grid-rows-[var(--density-chrome-y,36px)_minmax(0,1fr)_var(--density-status-y,24px)]";

  const chrome = (
    <div className="relative h-screen overflow-hidden bg-chrome text-text-primary">
      <div id="workbench-root" className={cn("grid h-full", gridRows)}>
      <TitleBar
        workspaceRoot={settings.workspaceRoot}
        taskPanelOpen={taskPanelOpen}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
        onToggleTaskPanel={() => setTaskPanelOpen((prev) => !prev)}
      />
      {/* Three-pane workbench: sidebar | canvas | AI — minmax(0) prevents flex blowout */}
      <FileDropZone>
        {showSidebar ? (
          <>
            <div style={{ width: sidebarWidth }} className="v4-side-panel">
              <Sidebar />
            </div>
            <Splitter side="left" value={sidebarWidth} onChange={setSidebarWidth} min={180} max={480} />
          </>
        ) : null}

        <EditorArea />

        {showAiPanel ? (
          <>
            <Splitter side="right" value={aiPanelWidth} onChange={setAiPanelWidth} min={280} max={800} />
            <div style={{ width: aiPanelWidth }} className="v4-side-panel">
              <AiPanel />
            </div>
          </>
        ) : null}
      </FileDropZone>
      {focusMode ? null : (
        <StatusBar
          health={health}
          taskPanelOpen={taskPanelOpen}
          onToggleTaskPanel={() => setTaskPanelOpen((prev) => !prev)}
        />
      )}
      </div>
      <OverlayHost />
      <IngestStagingSheet />
      <TaskPanel
        open={taskPanelOpen}
        onClose={() => setTaskPanelOpen(false)}
      />
      {/* Global 建议 confirm surface — header / strip open this (not Stream-embedded) */}
      <SuggestPopover />
      {/* Inline AI leave guard — ConfirmDialog before navigation (never navigate-then-block) */}
      <InlineAiLeaveHost />

      {focusMode && (suggestCount > 0 || activeTodoCount > 0) ? (
        <div className="pointer-events-none fixed bottom-3 right-3 z-floating flex items-center gap-1.5">
          {suggestCount > 0 ? (
            <button
              type="button"
              onClick={() => openSuggestSurface()}
              className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-elevated/95 px-2.5 py-1 text-3xs font-medium text-text-secondary shadow-[var(--shadow-float)] backdrop-blur-sm transition-colors hover:bg-surface-muted v4-focus-ring"
              aria-label={t("shell:statusBar.suggestCountAria", { count: suggestCount, defaultValue: "AI 建议（{{count}}）" })}
            >
              <Lightbulb size={ICON.xs} className="text-accent-color" aria-hidden />
              <span className="tabular-nums">{suggestCount}</span>
            </button>
          ) : null}
          {activeTodoCount > 0 ? (
            <button
              type="button"
              onClick={() => emitLocal("todo:toggle-popover")}
              className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-elevated/95 px-2.5 py-1 text-3xs font-medium text-text-secondary shadow-[var(--shadow-float)] backdrop-blur-sm transition-colors hover:bg-surface-muted v4-focus-ring"
              aria-label={t("shell:todo.openAria", { count: activeTodoCount, defaultValue: "待办清单（{{count}}）" })}
            >
              <ListTodo size={ICON.xs} className="text-accent-color" aria-hidden />
              <span className="tabular-nums">{activeTodoCount}</span>
            </button>
          ) : null}
        </div>
      ) : null}

      {toasts.length > 0 ? (
        <div className="pointer-events-none fixed bottom-10 left-1/2 z-toast flex -translate-x-1/2 flex-col items-center gap-1.5">
          {toasts.map((toast) => (
            <div
              key={toast.key}
              role="status"
              onMouseEnter={() => pauseToast(toast.key)}
              onMouseLeave={() => resumeToast(toast.key, toast.dwell)}
              className={cn(
                "pointer-events-auto flex max-w-[min(420px,90vw)] items-center gap-2 rounded-[var(--radius-lg)] border px-3.5 py-2 text-3xs font-medium shadow-[var(--shadow-float)] animate-toast-in",
                toast.kind === "error"
                  ? "border-error/30 bg-status-error-bg text-error"
                  : toast.kind === "success"
                    ? "border-success/30 bg-status-success-bg text-success"
                    : "border-border-subtle-dim bg-surface text-text-secondary",
              )}
            >
              <span className="truncate">{toast.text}</span>
              {toast.evidence?.backupPath || toast.evidence?.receiptPath ? (
                <button
                  type="button"
                  className={cn(
                    "shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-3xs font-semibold",
                    "bg-surface-muted/50 transition-colors hover:bg-surface-muted",
                    "v4-focus-ring",
                  )}
                  onClick={() => void handleUndoWriteback(toast.evidence!)}
                  aria-label={t("common:writeback.undo")}
                >
                  {t("common:writeback.undo")}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );

  return (
    <TooltipProvider>
      <LazyBoundary className="h-screen" label={t("shell:lazyBoundary.loadingWorkspace")}>
        <DndShell onToast={showToast}>{chrome}</DndShell>
      </LazyBoundary>
    </TooltipProvider>
  );
}
