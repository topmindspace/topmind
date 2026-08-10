/**
 * State + behavior hook for the editor selection AI bar (see SelectionAiBar.tsx).
 *
 * Owns the full AI request lifecycle (single-flight run / preview / error /
 * cancel), selection + menu target tracking, drag position, and the inline-AI
 * busy registry session. Presentation lives in SelectionAiBar + subcomponents.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { api } from "../../services/api";
import { useAiStore } from "../../stores/ai-store";
import { useViewStore } from "../../stores/view-store";
import {
  getEditorMarkdown,
  insertMarkdown,
  insertMarkdownAt,
  replaceSelectionWithMarkdown,
} from "../../lib/editor-markdown";
import { sanitizeInlineAiResult } from "../../lib/inline-ai-result";
import { useInlineAiStore } from "../../lib/inline-ai-busy";

/** Max custom instruction history entries kept in-memory. */
const INSTR_HISTORY_MAX = 8;
/** Debounce for selection-triggered bar appearance (ms).
 * 220ms balances responsiveness with avoiding noise during quick edits/drags. */
const SELECTION_DEBOUNCE_MS = 220;

export type EditorAiAction =
  | "polish"
  | "shorter"
  | "expand"
  | "bullets"
  | "fix"
  | "format"
  | "continue"
  | "summarize"
  | "translate"
  | "custom";

export type Scope = "selection" | "menu";

export type Target = {
  scope: Scope;
  text: string;
  from: number;
  to: number;
  top: number;
  left: number;
  bottom: number;
};

export type Phase = "idle" | "running" | "preview" | "error";

function friendlyAiError(err: unknown, ready: boolean, t: TFunction): string {
  const raw = err instanceof Error ? err.message : String(err || t("selectionAi.errorNoText"));
  if (!ready || /No AI provider|not configured|API key|密钥/iu.test(raw)) {
    return t("selectionAi.errorAiNotReady");
  }
  if (/abort|cancel|中止|取消/iu.test(raw)) return t("selectionAi.errorCancelled");
  if (/timeout|超时|ETIMEDOUT|network|Failed to fetch|ECONN/iu.test(raw)) {
    return t("selectionAi.errorNetwork", { raw });
  }
  if (/empty selection|请先选中/iu.test(raw)) return t("selectionAi.errorSelectFirst");
  if (/过长|too long|32_000|20000/iu.test(raw)) return raw;
  if (/空结果|模型返回为空/iu.test(raw)) return t("selectionAi.errorModelEmpty");
  return raw;
}

export function useSelectionAi({
  editor,
  readOnly,
  /** Note path — abort UI when user switches documents */
  notePath,
  /** YAML frontmatter block from the file (for AI context injection) */
  frontmatter,
}: {
  editor: Editor | null;
  readOnly?: boolean;
  notePath?: string;
  frontmatter?: string | null;
}) {
  const { t } = useTranslation("editor");
  const ready = useAiStore((s) => s.runtimeStatus?.ready ?? false);

  // Inline AI auto-popup preference (from editor settings, default true)
  const inlineAiAutoPopup = useViewStore(
    (s) => s.editorSettings.inlineAiAutoPopup ?? true,
  );
  const setInlineAiAutoPopup = useCallback((v: boolean) => {
    const prev = useViewStore.getState().editorSettings;
    useViewStore.getState().setEditorSettings({ ...prev, inlineAiAutoPopup: v });
  }, []);
  const autoPopupRef = useRef(inlineAiAutoPopup);
  autoPopupRef.current = inlineAiAutoPopup;
  const runtimeMessage = useAiStore((s) => s.runtimeStatus?.message ?? "");
  const providerCount = useAiStore((s) => s.runtimeStatus?.providers?.length ?? 0);
  const runtimeLabel = ready
    ? providerCount > 0
      ? t("selectionAi.readyProviders", { count: providerCount })
      : t("selectionAi.ready")
    : runtimeMessage || t("selectionAi.notConfigured");

  const [target, setTarget] = useState<Target | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customInstr, setCustomInstr] = useState("");
  /** Recent custom instruction history (in-memory, most-recent-first). */
  const [instrHistory, setInstrHistory] = useState<string[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  /** Toolbar / context forced open */
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [previewMaxH, setPreviewMaxH] = useState(160);
  const [statusHint, setStatusHint] = useState<string | null>(null);
  /** User-dragged position override (null = auto-position near selection) */
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);

  const reqIdRef = useRef(0);
  const abortRef = useRef(false);
  /** Active main-process complete requestId for true abort */
  const completeReqIdRef = useRef<string | null>(null);
  /** Session id in useInlineAiStore (status bar + nav guard) */
  const sessionIdRef = useRef<string | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const pinnedRef = useRef(false);
  /** Snapshot of selected text at run start — detect drift before apply */
  const originalAtRunRef = useRef<string>("");
  /** Debounce timer for selection-triggered bar appearance (avoid showing during active drag) */
  const selectionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Drag state: starting pointer + element origin */
  const dragStartRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  phaseRef.current = phase;
  pinnedRef.current = pinnedOpen;
  const panelId = useId();

  const cancelServerRequest = useCallback((requestId: string | null) => {
    if (!requestId) return;
    void api.ai.cancelComplete(requestId).catch(() => {
      /* not found / already finished */
    });
  }, []);

  const endSession = useCallback(() => {
    if (sessionIdRef.current) {
      useInlineAiStore.getState().end(sessionIdRef.current);
      sessionIdRef.current = null;
    }
  }, []);

  const clearUi = useCallback(() => {
    abortRef.current = true;
    reqIdRef.current += 1;
    cancelServerRequest(completeReqIdRef.current);
    completeReqIdRef.current = null;
    endSession();
    if (selectionDebounceRef.current) {
      clearTimeout(selectionDebounceRef.current);
      selectionDebounceRef.current = null;
    }
    setTarget(null);
    setPreview(null);
    setCustomOpen(false);
    setPinnedOpen(false);
    setError(null);
    setPhase("idle");
    setStatusHint(null);
    setShowDiff(false);
    setDragPos(null);
    originalAtRunRef.current = "";
  }, [cancelServerRequest, endSession]);

  // Document switch — view-store already confirmed leave when blocking;
  // always drop in-flight UI + abort server for the previous note.
  useEffect(() => {
    clearUi();
    // Only depend on notePath — clearUi is a stable dispatch, no need to re-run on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notePath]);

  // If nav guard cleared the global store (user confirmed leave), mirror locally
  useEffect(() => {
    return useInlineAiStore.subscribe((state) => {
      if (sessionIdRef.current && !state.sessions.some((s) => s.id === sessionIdRef.current)) {
        // External clear — abort without re-writing store
        abortRef.current = true;
        reqIdRef.current += 1;
        cancelServerRequest(completeReqIdRef.current);
        completeReqIdRef.current = null;
        sessionIdRef.current = null;
        setPhase("idle");
        setPreview(null);
        setStatusHint(null);
      }
    });
  }, [cancelServerRequest]);

  const coordsFor = useCallback((ed: Editor, from: number, to: number) => {
    try {
      if (ed.isDestroyed) return { left: 24, top: 80, bottom: 100 };
      const start = ed.view.coordsAtPos(from);
      const end = ed.view.coordsAtPos(Math.max(from, to));
      return {
        left: Math.min(start.left, end.left),
        top: Math.min(start.top, end.top) - 8,
        bottom: Math.max(start.bottom, end.bottom),
      };
    } catch {
      return { left: 24, top: 80, bottom: 100 };
    }
  }, []);

  const buildSelectionTarget = useCallback((): Target | null => {
    if (!editor || readOnly || editor.isDestroyed || !editor.isEditable) return null;
    const { from, to, empty } = editor.state.selection;
    if (empty || to - from < 2) return null; // Min 2 chars to avoid noise
    const text = editor.state.doc.textBetween(from, to, "\n");
    if (!text.trim() || text.length > 32_000) return null;
    const { left, top, bottom } = coordsFor(editor, from, to);
    return { scope: "selection", text, from, to, top, left, bottom };
  }, [editor, readOnly, coordsFor]);

  const buildMenuTarget = useCallback((): Target | null => {
    if (!editor || readOnly || editor.isDestroyed) return null;
    try {
      const { from } = editor.state.selection;
      const { left, top, bottom } = coordsFor(editor, from, from);
      const full = getEditorMarkdown(editor).trim();
      return {
        scope: "menu",
        text: full.slice(0, 28_000),
        from,
        to: from,
        top,
        left,
        bottom,
      };
    } catch {
      return null;
    }
  }, [editor, readOnly, coordsFor]);

  const syncSelection = useCallback(() => {
    if (!editor || readOnly || editor.isDestroyed || !editor.isEditable) {
      if (!pinnedRef.current && phaseRef.current !== "running") setTarget(null);
      return;
    }
    const ph = phaseRef.current;
    // While running/preview pinned: only update coords of existing target
    if (ph === "running" || (ph === "preview" && pinnedRef.current)) {
      setTarget((t) => {
        if (!t) return t;
        try {
          const { left, top, bottom } = coordsFor(editor, t.from, t.to);
          if (t.left === left && t.top === top && t.bottom === bottom) return t;
          return { ...t, left, top, bottom };
        } catch {
          return t;
        }
      });
      return;
    }
    if (pinnedRef.current) {
      const menu = buildMenuTarget();
      if (menu) setTarget(menu);
      return;
    }
    const sel = buildSelectionTarget();
    setTarget(sel);
    setDragPos(null); // Reset drag override when selection changes
    if (!sel) {
      setPreview(null);
      setError(null);
      setPhase("idle");
    }
  }, [editor, readOnly, coordsFor, buildMenuTarget, buildSelectionTarget]);

  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      // Immediate for pinned/running/preview states — no debounce needed
      if (pinnedRef.current || phaseRef.current === "running" || phaseRef.current === "preview") {
        syncSelection();
        return;
      }
      // Empty selection: clear immediately (no debounce on hide)
      if (!editor.isDestroyed) {
        const { empty } = editor.state.selection;
        if (empty) {
          if (selectionDebounceRef.current) {
            clearTimeout(selectionDebounceRef.current);
            selectionDebounceRef.current = null;
          }
          syncSelection();
          return;
        }
      }
      // Non-empty: debounce to avoid showing during active text drag.
      // 220ms balances responsiveness with avoiding noise during quick edits.
      // Skipped when auto-popup is off — user must trigger via toolbar/context menu.
      if (!autoPopupRef.current) return;
      if (selectionDebounceRef.current) clearTimeout(selectionDebounceRef.current);
      selectionDebounceRef.current = setTimeout(() => {
        selectionDebounceRef.current = null;
        syncSelection();
      }, SELECTION_DEBOUNCE_MS);
    };
    editor.on("selectionUpdate", onUpdate);
    const onBlur = () => {
      window.setTimeout(() => {
        if (document.activeElement?.closest?.("[data-selection-ai]")) return;
        const ph = phaseRef.current;
        if (ph === "running" || ph === "preview") return;
        if (!pinnedRef.current) {
          setTarget(null);
          setPreview(null);
          setCustomOpen(false);
          setError(null);
          setPhase("idle");
        }
      }, 200);
    };
    editor.on("blur", onBlur);

    const scrollRoots: Array<EventTarget> = [window];
    try {
      let el: HTMLElement | null = null;
      try {
        el = editor.view?.dom?.parentElement ?? null;
      } catch {
        el = null;
      }
      while (el) {
        const oy = getComputedStyle(el).overflowY;
        if (oy === "auto" || oy === "scroll" || oy === "overlay") scrollRoots.push(el);
        el = el.parentElement;
      }
    } catch {
      /* ignore */
    }
    // Soft scroll: update coords instead of instant vanish
    let scrollHideTimer: number | null = null;
    const onScroll = () => {
      const ph = phaseRef.current;
      if (ph === "running" || ph === "preview" || pinnedRef.current) {
        syncSelection();
        return;
      }
      // Keep bar while updating position; only dismiss if selection is gone
      syncSelection();
      if (scrollHideTimer != null) window.clearTimeout(scrollHideTimer);
      scrollHideTimer = window.setTimeout(() => {
        if (phaseRef.current === "running" || phaseRef.current === "preview" || pinnedRef.current) {
          return;
        }
        // If selection still exists, coords were updated; no hard hide.
        // Only clear when selection is empty (syncSelection already nulls).
      }, 80);
    };
    for (const t of scrollRoots) {
      t.addEventListener("scroll", onScroll, { passive: true });
    }
    window.addEventListener("resize", onScroll);

    const onKey = (e: KeyboardEvent) => {
      if (!document.querySelector("[data-selection-ai]")) return;
      // ⌘↵ / Ctrl+Enter — accept preview
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        if (phaseRef.current === "preview") {
          e.preventDefault();
          e.stopPropagation();
          // apply via custom event so we always use latest closure
          window.dispatchEvent(new Event("topmind:selection-ai-apply"));
        }
        return;
      }
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (phaseRef.current === "running") {
        abortRef.current = true;
        reqIdRef.current += 1;
        cancelServerRequest(completeReqIdRef.current);
        completeReqIdRef.current = null;
        setPhase("idle");
        setStatusHint(t("selectionAi.statusHintCancelled"));
        setError(null);
        return;
      }
      clearUi();
    };
    window.addEventListener("keydown", onKey, true);

    const onForce = () => {
      const sel = buildSelectionTarget();
      if (!sel) {
        setStatusHint(t("selectionAi.statusHintSelectFirst"));
        window.setTimeout(() => setStatusHint(null), 2400);
        return;
      }
      setPinnedOpen(false);
      setTarget(sel);
      setPhase("idle");
      setError(null);
    };
    const onMenu = () => {
      const menu = buildMenuTarget();
      if (!menu) return;
      setPinnedOpen(true);
      setTarget(menu);
      setPhase("idle");
      setError(null);
      setPreview(null);
    };
    window.addEventListener("topmind:selection-ai", onForce);
    window.addEventListener("topmind:editor-ai-menu", onMenu);

    return () => {
      editor.off("selectionUpdate", onUpdate);
      editor.off("blur", onBlur);
      for (const t of scrollRoots) t.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("topmind:selection-ai", onForce);
      window.removeEventListener("topmind:editor-ai-menu", onMenu);
      if (scrollHideTimer != null) window.clearTimeout(scrollHideTimer);
      if (selectionDebounceRef.current) {
        clearTimeout(selectionDebounceRef.current);
        selectionDebounceRef.current = null;
      }
      // Unmount mid-flight: abort server work
      abortRef.current = true;
      reqIdRef.current += 1;
      cancelServerRequest(completeReqIdRef.current);
      completeReqIdRef.current = null;
    };
  }, [editor, syncSelection, clearUi, buildSelectionTarget, buildMenuTarget, cancelServerRequest, t]);

  const cancelRun = () => {
    abortRef.current = true;
    reqIdRef.current += 1;
    cancelServerRequest(completeReqIdRef.current);
    completeReqIdRef.current = null;
    endSession();
    setPhase(preview ? "preview" : "idle");
    setStatusHint(t("selectionAi.statusHintCancelled"));
    window.setTimeout(() => setStatusHint(null), 2000);
  };

  const run = async (action: EditorAiAction, instruction?: string) => {
    if (!editor || !target || editor.isDestroyed) return;
    if (phase === "running") return; // single-flight
    if (readOnly) {
      setError(t("selectionAi.errorReadOnly"));
      setPhase("error");
      return;
    }
    if (!ready) {
      setError(t("selectionAi.errorNotReady"));
      setPhase("error");
      return;
    }
    const myId = ++reqIdRef.current;
    abortRef.current = false;
    const requestId = `inline-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    completeReqIdRef.current = requestId;
    const sessionId = `sel-${requestId}`;
    sessionIdRef.current = sessionId;
    const runningLabel =
      action === "continue"
        ? t("selectionAi.statusHintContinue")
        : action === "summarize"
          ? t("selectionAi.statusHintSummarize")
          : action === "polish"
            ? t("selectionAi.statusHintPolish", { defaultValue: "正在润色…" })
            : t("selectionAi.statusHintRewrite");
    useInlineAiStore.getState().begin({
      id: sessionId,
      kind: "selection",
      label: runningLabel,
      anchor: notePath?.trim()
        ? { type: "file", path: notePath.trim() }
        : { type: "any" },
      blocksNavigation: true,
    });
    setPhase("running");
    setError(null);
    setPreview(null);
    setShowDiff(false);
    setStatusHint(runningLabel);

    try {
      let mode: "rewrite" | "continue" | "summarize" | "generate" = "rewrite";
      let text = target.text;
      if (action === "continue") {
        mode = "continue";
        if (target.scope === "menu") {
          text = getEditorMarkdown(editor).trim().slice(-4000);
        }
      } else if (action === "summarize") {
        mode = "summarize";
        if (target.scope === "menu") {
          text = getEditorMarkdown(editor).trim().slice(0, 28_000);
        }
      } else if (action === "custom") {
        mode = "generate";
        if (target.scope === "menu") {
          text = getEditorMarkdown(editor).trim().slice(0, 12_000);
        }
      } else if (target.scope === "menu") {
        text = getEditorMarkdown(editor).trim().slice(0, 28_000);
        mode = "rewrite";
      }

      if (!text.trim() && action !== "continue" && action !== "custom") {
        throw new Error(t("selectionAi.errorNoText"));
      }

      originalAtRunRef.current = text;
      // Freeze selection snapshot on target for later apply safety
      setTarget((t) => (t ? { ...t, text } : t));

      // Whole-document Markdown so polish/format match file structure (not selection-only).
      // Prepend frontmatter so AI knows document metadata (topic, status, tags…).
      let documentText: string | undefined;
      try {
        if (target.scope === "selection" && !editor.isDestroyed) {
          const full = getEditorMarkdown(editor).trim();
          if (full && full !== text.trim()) {
            const fm = frontmatter?.trim();
            documentText = fm
              ? `---\n${fm.replace(/^---\n?/m, "").replace(/\n?---$/m, "").trim()}\n---\n${full}`.slice(0, 28_000)
              : full.slice(0, 28_000);
          }
        }
      } catch {
        documentText = undefined;
      }

      const res = await api.ai.complete({
        text: text || t("selectionAi.docStart"),
        action: action === "custom" ? undefined : action,
        instruction: action === "custom" ? instruction : undefined,
        mode,
        requestId,
        documentText,
      });

      if (abortRef.current || myId !== reqIdRef.current) {
        endSession();
        return; // cancelled or superseded — ignore late success
      }
      // Main process already sanitizes; re-strip thinking tags / meta for apply safety.
      const next = sanitizeInlineAiResult(res.text || "");
      if (!next) throw new Error(t("selectionAi.errorEmptyResult"));
      setPreview(next);
      setPhase("preview");
      setStatusHint(t("selectionAi.statusHintPreviewReady"));
      // Keep blocking nav until user applies or discards preview
      useInlineAiStore.getState().update(sessionId, {
        label: t("selectionAi.statusHintPreviewReady"),
        blocksNavigation: true,
      });
    } catch (e) {
      if (abortRef.current || myId !== reqIdRef.current) {
        endSession();
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      if (/已取消|abort/iu.test(msg)) {
        endSession();
        setPhase("idle");
        setStatusHint(t("selectionAi.statusHintCancelledShort"));
        setError(null);
        return;
      }
      endSession();
      setError(friendlyAiError(e, ready, t));
      setPhase("error");
      setStatusHint(null);
    } finally {
      if (completeReqIdRef.current === requestId) {
        completeReqIdRef.current = null;
      }
    }
  };

  const applyPreview = useCallback(() => {
    if (!editor || !target || !preview || editor.isDestroyed || readOnly) return;
    if (phase === "running") return;

    // Selection: detect if user edited the range while waiting
    if (target.scope === "selection") {
      const docSize = editor.state.doc.content.size;
      const from = Math.max(0, Math.min(target.from, docSize));
      const to = Math.max(from, Math.min(target.to, docSize));
      if (to <= from) {
        setError(t("selectionAi.errorSelectionInvalid"));
        setPhase("error");
        return;
      }
      let live = "";
      try {
        live = editor.state.doc.textBetween(from, to, "\n");
      } catch {
        setError(t("selectionAi.errorCannotReadSelection"));
        setPhase("error");
        return;
      }
      const snap = originalAtRunRef.current || target.text;
      if (live !== snap) {
        setError(t("selectionAi.errorSelectionChanged"));
        setPhase("error");
        setStatusHint(t("selectionAi.errorBlockReplace"));
        return;
      }
      const ok = replaceSelectionWithMarkdown(editor, from, to, preview);
      if (!ok) {
        editor.chain().focus().insertContentAt({ from, to }, preview).run();
      }
    } else {
      insertMarkdown(editor, preview);
    }
    clearUi();
  }, [editor, target, preview, readOnly, phase, clearUi, t]);

  /** Insert the preview text below the selection (keeps original, appends AI result). */
  const insertBelowPreview = useCallback(() => {
    if (!editor || !target || !preview || editor.isDestroyed || readOnly) return;
    if (phase === "running") return;

    if (target.scope === "selection") {
      // Selection drift check (same as applyPreview)
      const docSize = editor.state.doc.content.size;
      const from = Math.max(0, Math.min(target.from, docSize));
      const to = Math.max(from, Math.min(target.to, docSize));
      if (to <= from) {
        setError(t("selectionAi.errorSelectionInvalid"));
        setPhase("error");
        return;
      }
      let live = "";
      try {
        live = editor.state.doc.textBetween(from, to, "\n");
      } catch {
        setError(t("selectionAi.errorCannotReadSelection"));
        setPhase("error");
        return;
      }
      const snap = originalAtRunRef.current || target.text;
      if (live !== snap) {
        setError(t("selectionAi.errorSelectionChanged"));
        setPhase("error");
        setStatusHint(t("selectionAi.errorBlockReplace"));
        return;
      }
      // Insert after the selection end, with a blank line separator
      insertMarkdownAt(editor, `\n\n${preview}`, to);
    } else {
      insertMarkdown(editor, `\n\n${preview}`);
    }
    clearUi();
  }, [editor, target, preview, readOnly, phase, clearUi, t]);

  /** Allow user to edit the preview text before applying. */
  const editPreview = useCallback((newText: string) => {
    setPreview(newText);
  }, []);

  useEffect(() => {
    const onApply = () => applyPreview();
    window.addEventListener("topmind:selection-ai-apply", onApply);
    return () => window.removeEventListener("topmind:selection-ai-apply", onApply);
  }, [applyPreview]);

  // ── Drag handlers ──
  const onDragStart = useCallback((e: React.MouseEvent) => {
    if (!panelId) return;
    const el = document.getElementById(panelId);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragStartRef.current = {
      px: e.clientX,
      py: e.clientY,
      ox: rect.left,
      oy: rect.top,
    };
    e.preventDefault();
  }, [panelId]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const ds = dragStartRef.current;
      if (!ds) return;
      const dx = e.clientX - ds.px;
      const dy = e.clientY - ds.py;
      setDragPos({ x: ds.ox + dx, y: ds.oy + dy });
    };
    const onUp = () => {
      dragStartRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const discardPreview = useCallback(() => {
    setPreview(null);
    setPhase("idle");
    setShowDiff(false);
    setStatusHint(null);
  }, []);

  const dismissError = useCallback(() => {
    setError(null);
    setPhase("idle");
  }, []);

  const toggleCustomOpen = useCallback(() => setCustomOpen((v) => !v), []);
  const toggleShowDiff = useCallback(() => setShowDiff((v) => !v), []);

  /** Record a custom instruction into history (deduplicated, most-recent-first). */
  const recordInstruction = useCallback((instr: string) => {
    const trimmed = instr.trim();
    if (!trimmed) return;
    setInstrHistory((prev) => {
      const filtered = prev.filter((s) => s !== trimmed);
      return [trimmed, ...filtered].slice(0, INSTR_HISTORY_MAX);
    });
  }, []);

  const busy = phase === "running";
  const visible = Boolean(target) || pinnedOpen || phase === "running" || phase === "preview";

  return {
    t,
    ready,
    runtimeLabel,
    target,
    phase,
    error,
    customOpen,
    customInstr,
    instrHistory,
    preview,
    showDiff,
    pinnedOpen,
    previewMaxH,
    statusHint,
    dragPos,
    panelId,
    busy,
    visible,
    inlineAiAutoPopup,
    setInlineAiAutoPopup,
    setCustomInstr,
    setPreviewMaxH,
    run,
    cancelRun,
    applyPreview,
    insertBelowPreview,
    editPreview,
    clearUi,
    discardPreview,
    dismissError,
    toggleCustomOpen,
    toggleShowDiff,
    recordInstruction,
    onDragStart,
  };
}
