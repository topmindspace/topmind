/**
 * StreamDetailView — 个人动态流主表面（周期本时间线）。
 *
 * - 随便记下 · 按日时间流 · 条目增补（同文件续写）
 * - 建议入口在画布顶 SuggestEntryStrip（统一）→ AI 轨 ActionBar 确认
 * - 本视图不挂第二套建议列表；整理候选合入 ActionBar
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CalendarDays,
  Loader2,
  RefreshCw,
  FileText,
  ChevronRight,
  Clock,
  Wand2,
  ChevronDown,
  Send,
  Sparkles,
  MessageSquarePlus,
  Link,
} from "lucide-react";
import { api } from "../../../services/api";
import { emitLocal, onLocal } from "../../../plugins/host";
import { useViewStore } from "../../../stores/view-store";
import {
  ViewContainer,
  PageHeader,
  EmptyState,
  LoadingState,
  ErrorState,
} from "../../../components/ui/view";
import { Button } from "../../../components/ui/Button";
import { Tooltip } from "../../../components/ui/tooltip";
import { ICON } from "../../../lib/icons";
import { cn } from "../../../lib/cn";
import { toastWriteback, toastWritebackError } from "../../../lib/writeback-toast";
import {
  parsePeriodNote,
  extractBodyTimestamp,
  groupEntriesByDay,
  type StreamEntry,
} from "../../../lib/stream-period-parse";
import {
  streamMarkdownToPreviewHtml,
  splitStreamPreviewParts,
  stripListChromeForDisplay,
} from "../../../lib/stream-md-preview";
import {
  groupDayFeedRows,
  streamEntryNeedsExpand,
  streamArticleTitle,
  streamArticleSummary,
  type StreamFeedRow,
} from "../../../lib/stream-entry-present";
import {
  shouldReplaceStreamBody,
  streamEntryStableKey,
  remapExpandedIndices,
} from "../../../lib/stream-feed-stability";
import { openSuggestSurface } from "../../../lib/suggest-surface";
import { ChromeOverflowActions, type ChromeAction } from "../../../lib/chrome-overflow";
import { runOrganizeWeek } from "../../../lib/organize-week";
import { polishComposerText } from "../../../lib/ai-polish-text";
import { useInlineAiStore } from "../../../lib/inline-ai-busy";
import { useTodoStore } from "../../../stores/todo-store";
import { useAiStore } from "../../../stores/ai-store";
import type { TFunction } from "i18next";

/**
 * One feed row inside a day panel — moment/prose (compact), article (title+summary),
 * with nested appends. Expand only when content is truly long.
 */
function StreamFeedRowView({
  row,
  isToday,
  expanded,
  appendOpen,
  appendText,
  appending,
  activePath,
  onToggleExpand,
  onOpenPeriod,
  onToggleAppend,
  onAppendText,
  onAppendSubmit,
  onAppendCancel,
  t,
}: {
  row: StreamFeedRow;
  isToday: boolean;
  expanded: boolean;
  appendOpen: boolean;
  appendText: string;
  appending: boolean;
  activePath: string | null;
  onToggleExpand: () => void;
  onOpenPeriod: (heading?: string) => void;
  onToggleAppend: () => void;
  onAppendText: (v: string) => void;
  onAppendSubmit: () => void;
  onAppendCancel: () => void;
  t: TFunction;
}) {
  const { entry, kind, appends } = row;
  const bodyTime = extractBodyTimestamp(entry.body);
  const needsExpand = streamEntryNeedsExpand(entry, {
    nestedAppendCount: appends.length,
  });
  // Short content: always full; long content: clamp until expanded
  const showFull = !needsExpand || expanded;

  if (kind === "article") {
    const title = streamArticleTitle(entry);
    const summary = streamArticleSummary(entry);
    return (
      <article
        className="group px-2.5 py-2"
        data-stream-entry-card
        data-stream-entry-kind="article"
      >
        <button
          type="button"
          onClick={() => onOpenPeriod(entry.heading || undefined)}
          className={cn(
            "flex w-full flex-col gap-0.5 rounded-[var(--radius-md)] bg-surface-muted/15 px-2.5 py-2 text-left",
            "transition-colors hover:bg-accent-bg-faint/30",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
          )}
          data-stream-article-open
        >
          <div className="flex items-start gap-2">
            <FileText size={ICON.xs} className="mt-0.5 shrink-0 text-accent-color/80" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold tracking-tight text-text-primary">
                {title}
              </div>
              {summary ? (
                <div className="mt-0.5 line-clamp-2 text-3xs leading-relaxed text-text-tertiary">
                  {summary}
                </div>
              ) : null}
              <div className="mt-1.5 flex items-center gap-1 text-3xs font-medium text-accent-color">
                {t("workspace:streamDetail.openArticle", { defaultValue: "打开笔记" })}
                <ChevronRight size={ICON.nano} aria-hidden />
              </div>
            </div>
          </div>
        </button>
      </article>
    );
  }

  return (
    <article
      className={cn(
        "group relative px-2.5 py-1.5",
        kind === "append" && "bg-surface-muted/10",
      )}
      data-stream-entry-card
      data-stream-entry-kind={kind}
    >
      <div className="flex items-start gap-2">
        {/* Time column — day cohesion */}
        <div className="w-9 shrink-0 pt-0.5 text-right">
          {bodyTime ? (
            <span className="text-3xs font-medium tabular-nums text-text-quaternary">
              {bodyTime}
            </span>
          ) : (
            <span
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                isToday ? "bg-accent-color/70" : "bg-text-quaternary/40",
              )}
              aria-hidden
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1">
            <div className="min-w-0 flex-1">
              <StreamMdBody
                markdown={entry.body || entry.preview || entry.heading || ""}
                expanded={showFull}
                isAppendCard={kind === "append"}
                allowClamp={needsExpand}
                className="text-sm leading-[1.58] text-text-primary"
              />
            </div>
            {/* Explicit actions — not silent whole-card navigation */}
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <Tooltip content={t("workspace:streamDetail.appendTip")}>
                <button
                  type="button"
                  onClick={onToggleAppend}
                  className="flex h-6 w-6 items-center justify-center rounded-sm text-text-quaternary hover:bg-surface-muted hover:text-accent-color"
                  aria-label={t("workspace:streamDetail.append")}
                >
                  <MessageSquarePlus size={ICON.nano} />
                </button>
              </Tooltip>
              <Tooltip content={t("workspace:streamDetail.openInEditorTip", {
                defaultValue: "在周期本中打开此段",
              })}>
                <button
                  type="button"
                  onClick={() => onOpenPeriod(entry.heading || undefined)}
                  className="flex h-6 w-6 items-center justify-center rounded-sm text-text-quaternary hover:bg-surface-muted hover:text-accent-color"
                  aria-label={t("workspace:streamDetail.openInEditor")}
                  data-stream-open-segment
                >
                  <FileText size={ICON.nano} />
                </button>
              </Tooltip>
            </div>
          </div>

          {/* Nested appends under this moment */}
          {appends.length > 0 ? (
            <div className="mt-1.5 space-y-1 border-l-2 border-accent-border-subtle/40 pl-2.5" data-stream-nested-appends>
              {(showFull ? appends : appends.slice(0, 1)).map((a) => (
                <div key={a.index} className="text-3xs text-text-secondary" data-stream-append-card>
                  <StreamMdBody
                    markdown={a.body || a.preview || ""}
                    expanded={showFull}
                    isAppendCard
                    allowClamp={needsExpand}
                    className="text-xs leading-[1.55] text-text-secondary"
                  />
                </div>
              ))}
              {!showFull && appends.length > 1 ? (
                <div className="text-3xs text-text-quaternary">
                  +{appends.length - 1}{" "}
                  {t("workspace:streamDetail.moreAppends", { defaultValue: "条增补" })}
                </div>
              ) : null}
            </div>
          ) : null}

          {needsExpand ? (
            <button
              type="button"
              onClick={onToggleExpand}
              className="mt-1 flex items-center gap-1 text-3xs text-text-quaternary transition-colors hover:text-accent-color"
              data-stream-expand-toggle
            >
              <ChevronDown
                size={ICON.nano}
                className={cn("transition-transform", expanded && "rotate-180")}
              />
              {expanded
                ? t("workspace:streamDetail.collapse")
                : t("workspace:streamDetail.expand")}
            </button>
          ) : null}

          {appendOpen ? (
            <div
              className="mt-2 rounded-[var(--radius-md)] border border-border-subtle-dim bg-surface-muted/25 p-2"
              data-stream-entry-append
            >
              <textarea
                rows={2}
                value={appendText}
                disabled={appending}
                placeholder={t("workspace:streamDetail.appendPlaceholder")}
                onChange={(e) => onAppendText(e.target.value)}
                className={cn(
                  "w-full resize-y min-h-[2.25rem] max-h-28 bg-transparent",
                  "text-sm leading-relaxed text-text-primary placeholder:text-text-quaternary",
                  "outline-none border-0 focus:ring-0",
                )}
                autoFocus
              />
              <div className="mt-1.5 flex items-center justify-end gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-3xs"
                  disabled={appending}
                  onClick={onAppendCancel}
                >
                  {t("workspace:streamDetail.appendCancel")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-7"
                  disabled={appending || !appendText.trim() || !activePath}
                  onClick={onAppendSubmit}
                >
                  {appending ? (
                    <Loader2 size={ICON.nano} className="animate-spin" />
                  ) : (
                    <MessageSquarePlus size={ICON.nano} />
                  )}
                  {t("workspace:streamDetail.appendSubmit")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/**
 * Quiet-paper Markdown body for stream cards.
 * - Single-bullet cards: strip leading `- ` chrome so prose reads clean
 * - Multi-block: real MD (lists · tasks · code · 续 headings)
 * - Appends render as quiet sub-blocks; collapsed shows a short peek
 */
function StreamMdBody({
  markdown,
  expanded,
  isAppendCard,
  /** When false, never clamp — short content always fully visible */
  allowClamp = true,
  className,
}: {
  markdown: string;
  expanded?: boolean;
  /** Whole card is an append follow-up */
  isAppendCard?: boolean;
  allowClamp?: boolean;
  className?: string;
}) {
  const parts = useMemo(() => splitStreamPreviewParts(markdown), [markdown]);
  const mainSource = useMemo(() => {
    if (!parts.main) return "";
    // Single-line list item → drop bullet + time chrome (chip shows time); keep tasks
    const lines = parts.main.split("\n").filter((l) => l.trim());
    if (lines.length === 1 && /^\s*[-*+]\s+/u.test(lines[0])) {
      return stripListChromeForDisplay(parts.main);
    }
    // Single plain line that starts with HH:MM (no bullet)
    if (lines.length === 1 && /^\d{1,2}:\d{2}\s+/u.test(lines[0])) {
      return lines[0].replace(/^\d{1,2}:\d{2}\s+/u, "").trim();
    }
    return parts.main;
  }, [parts.main]);

  const mainHtml = useMemo(
    () => (mainSource ? streamMarkdownToPreviewHtml(mainSource) : ""),
    [mainSource],
  );
  const appendHtmls = useMemo(
    () =>
      parts.appends.map((a) => ({
        title: a.title,
        bodyHtml: a.body ? streamMarkdownToPreviewHtml(a.body) : "",
        fullHtml: streamMarkdownToPreviewHtml(a.markdown),
      })),
    [parts.appends],
  );

  if (!mainHtml && appendHtmls.length === 0) return null;

  const showAllAppends = expanded || isAppendCard || !allowClamp;
  const peekAppends = showAllAppends ? appendHtmls : appendHtmls.slice(0, 1);
  const moreAppends = !showAllAppends && appendHtmls.length > 1 ? appendHtmls.length - 1 : 0;
  const clampMain =
    allowClamp && !expanded && !isAppendCard && parts.appends.length === 0;
  const clampSoft =
    allowClamp && !expanded && parts.appends.length > 0;

  return (
    <div className={cn("v4-stream-md-stack", className)} data-stream-md-preview>
      {mainHtml ? (
        <div
          className={cn(
            "v4-stream-md",
            clampMain && "v4-stream-md-clamp",
            clampSoft && "v4-stream-md-clamp-soft",
          )}
          // Fragment is produced by shipped markdownToHtmlFragment (escapes raw HTML).
          dangerouslySetInnerHTML={{ __html: mainHtml }}
        />
      ) : null}

      {peekAppends.length > 0 ? (
        <div className="v4-stream-appends" data-stream-appends>
          {peekAppends.map((a, i) => (
            <div key={`${a.title}-${i}`} className="v4-stream-append-block">
              <div className="v4-stream-append-title">{a.title}</div>
              {a.bodyHtml ? (
                <div
                  className={cn(
                    "v4-stream-md",
                    !showAllAppends && allowClamp && "v4-stream-md-clamp-soft",
                  )}
                  dangerouslySetInnerHTML={{ __html: a.bodyHtml }}
                />
              ) : null}
            </div>
          ))}
          {moreAppends > 0 ? (
            <div className="v4-stream-append-more">+{moreAppends}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface PeriodInfo {
  relPath: string;
  fileName: string;
  title: string | null;
  reconciled: boolean;
  mtime: string | null;
}

interface StreamContext {
  packing: string;
  periodRelPath: string | null;
  periodTitle: string | null;
}

export function StreamDetailView() {
  const { t } = useTranslation(["workspace", "shell", "common"]);
  const [entries, setEntries] = useState<StreamEntry[]>([]);
  const [ctx, setCtx] = useState<StreamContext | null>(null);
  /** Viewing path — may differ from current packing period when user switches chips */
  const [viewPeriodPath, setViewPeriodPath] = useState<string | null>(null);
  const [viewPeriodTitle, setViewPeriodTitle] = useState<string | null>(null);
  const [periods, setPeriods] = useState<PeriodInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<Set<number>>(new Set());
  /** Collapsed day keys — first (newest) day starts expanded */
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  const [composeText, setComposeText] = useState("");
  const [composing, setComposing] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const polishSessionRef = useRef<string | null>(null);
  /** Compose URL detection — when true, show hint to open Note it (记一下) for fetch. */
  const composeIsUrl = useMemo(
    () => /^https?:\/\/\S+$/iu.test(composeText.trim()),
    [composeText],
  );
  /** Entry index currently showing in-card append composer */
  const [appendIdx, setAppendIdx] = useState<number | null>(null);
  const [appendText, setAppendText] = useState("");
  const [appending, setAppending] = useState(false);
  const composeRef = useRef<HTMLTextAreaElement>(null);
  /** Last raw period body — soft refresh skips setEntries when unchanged (anti-jitter). */
  const lastBodyRef = useRef<string | null>(null);
  /** Stable keys for last rendered entries — remap expand across soft reloads. */
  const lastEntryKeysRef = useRef<string[]>([]);

  const select = useViewStore((s) => s.select);
  const todoMaintaining = useTodoStore((s) => s.maintaining === "maintaining");
  const todoEverLoaded = useTodoStore((s) => s.everLoaded);
  const aiReady = useAiStore((s) => s.runtimeStatus?.ready ?? false);

  const activePath = viewPeriodPath ?? ctx?.periodRelPath ?? null;

  // Lazy-load personal list count when Stream mounts (does not open popover).
  useEffect(() => {
    if (!todoEverLoaded) void useTodoStore.getState().refresh();
  }, [todoEverLoaded]);

  const loadPeriodContent = useCallback(async (relPath: string | null, opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    // Soft path never flips full-page loading (boot effect owns setLoading).
    if (!relPath) {
      lastBodyRef.current = null;
      lastEntryKeysRef.current = [];
      setEntries([]);
      return;
    }
    try {
      const content = await api.ws.read(relPath);
      // Identity check: suggestion refresh / file-changed with same body must not reparse
      if (silent && !shouldReplaceStreamBody(lastBodyRef.current, content)) {
        if (silent) setError(null);
        return;
      }
      const nextEntries = parsePeriodNote(content);
      const nextKeys = nextEntries.map((e, i) => streamEntryStableKey(e, i));
      if (silent && lastEntryKeysRef.current.length > 0) {
        setExpandedIdx((prev) =>
          remapExpandedIndices(lastEntryKeysRef.current, nextKeys, prev),
        );
      }
      lastBodyRef.current = content;
      lastEntryKeysRef.current = nextKeys;
      setEntries(nextEntries);
      if (silent) setError(null);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadPeriods = useCallback(async () => {
    try {
      const list = await api.ws.listStreamPeriods();
      setPeriods(
        (list || []).map((p) => ({
          relPath: p.relPath,
          fileName: p.fileName,
          title: p.title,
          reconciled: p.reconciled,
          mtime: p.mtime ?? null,
        })),
      );
    } catch {
      /* non-critical */
    }
  }, []);

  /** Boot once: stream context + current period body + period chips */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [streamCtx, periodList] = await Promise.all([
          api.ws.getStreamContext(),
          api.ws.listStreamPeriods().catch(() => [] as Awaited<ReturnType<typeof api.ws.listStreamPeriods>>),
        ]);
        if (cancelled) return;
        setCtx({
          packing: streamCtx.packing,
          periodRelPath: streamCtx.periodRelPath,
          periodTitle: streamCtx.periodTitle,
        });
        setPeriods(
          (periodList || []).map((p) => ({
            relPath: p.relPath,
            fileName: p.fileName,
            title: p.title,
            reconciled: p.reconciled,
            mtime: p.mtime ?? null,
          })),
        );
        // Prefer current packing period; fall back to newest listed period so feed is never stuck empty
        const fallback = periodList?.[0];
        const path = streamCtx.periodRelPath || fallback?.relPath || null;
        const title =
          streamCtx.periodTitle
          || fallback?.title
          || fallback?.fileName
          || null;
        setViewPeriodPath(path);
        setViewPeriodTitle(title);
        if (path) {
          await loadPeriodContent(path, { silent: true });
        } else {
          setEntries([]);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPeriodContent]);

  // Soft refresh: keep current period path; refresh ctx + body + chips
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = onLocal("workspace:file-changed", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void loadPeriods();
        void loadPeriodContent(activePath, { silent: true });
        void api.ws.getStreamContext().then((streamCtx) => {
          setCtx({
            packing: streamCtx.packing,
            periodRelPath: streamCtx.periodRelPath,
            periodTitle: streamCtx.periodTitle,
          });
        });
      }, 450);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [activePath, loadPeriodContent, loadPeriods]);

  const handleCapture = useCallback(() => {
    emitLocal("overlay:open", { kind: "quick-capture" });
  }, []);

  /**
   * AI polish — rewrites composer textarea via real ai.complete action:"polish".
   * Does NOT open capture overlay; does NOT save to stream until user clicks 记下.
   * Registers inline busy so StatusBar shows progress while complete runs.
   */
  const handleComposePolish = useCallback(async () => {
    const text = composeText.trim();
    if (!text || polishing || composing) return;
    if (!aiReady) {
      emitLocal("toast:show", t("overlays:capture.aiPolishNotReady"));
      return;
    }
    const sessionId = `stream-polish-${Date.now()}`;
    polishSessionRef.current = sessionId;
    useInlineAiStore.getState().begin({
      id: sessionId,
      kind: "polish",
      label: t("workspace:streamDetail.composeAiPolishing", {
        defaultValue: "正在润色…",
      }),
      // Bound to stream surface — leave stream → confirm BEFORE navigation
      anchor: { type: "stream" },
      blocksNavigation: true,
    });
    setPolishing(true);
    try {
      // Period body as document context so polish matches stream note style
      let documentText: string | undefined;
      try {
        if (activePath && lastBodyRef.current) {
          documentText = lastBodyRef.current.slice(0, 28_000);
        } else if (activePath) {
          const body = await api.ws.read(activePath);
          documentText = String(body || "").slice(0, 28_000) || undefined;
        }
      } catch {
        documentText = undefined;
      }
      const polished = await polishComposerText(
        (args) => api.ai.complete(args),
        text,
        "stream-compose-polish",
        documentText ? { documentText } : undefined,
      );
      // Session cleared by leave-guard → do not write into unmounted/abandoned UI
      if (polishSessionRef.current !== sessionId) return;
      if (!useInlineAiStore.getState().sessions.some((s) => s.id === sessionId)) return;
      if (polished) {
        setComposeText(polished);
        emitLocal("toast:show", t("workspace:streamDetail.composeAiPolishDone"));
      }
    } catch (e) {
      if (polishSessionRef.current !== sessionId) return;
      const msg = e instanceof Error ? e.message : String(e);
      if (!/abort|cancel/iu.test(msg)) {
        emitLocal("toast:show", t("workspace:streamDetail.composeAiPolishFailed"));
      }
    } finally {
      useInlineAiStore.getState().end(sessionId);
      if (polishSessionRef.current === sessionId) {
        polishSessionRef.current = null;
        setPolishing(false);
      }
    }
  }, [composeText, polishing, composing, aiReady, t, activePath]);

  // If leave-guard clearAll() wipes polish session, stop local busy UI
  useEffect(() => {
    return useInlineAiStore.subscribe((state) => {
      const id = polishSessionRef.current;
      if (!id) return;
      if (!state.sessions.some((s) => s.id === id)) {
        polishSessionRef.current = null;
        setPolishing(false);
      }
    });
  }, []);

  /** AI maintain todos from stream; open todo panel so results / progressive force are visible. */
  const handleMaintainTodos = useCallback(() => {
    emitLocal("todo:open-popover");
    if (!aiReady) {
      emitLocal("toast:show", t("workspace:streamDetail.suggestionsAiOffline"));
      return;
    }
    // First click respects skip hash; second click after already-processed forces re-scan.
    const st = useTodoStore.getState();
    const force = st.maintainReason === "all-periods-processed";
    void st.maintain(force ? { force: true } : undefined);
  }, [aiReady, t]);

  /** Comment-like append under a stream entry (same Markdown period note). */
  const handleAppendEntry = useCallback(
    async (entry: StreamEntry) => {
      const text = appendText.trim();
      if (!text || !activePath || appending) return;
      setAppending(true);
      try {
        const res = await api.ws.appendStreamEntry({
          relativePath: activePath,
          heading: entry.heading || entry.preview || undefined,
          content: text,
        });
        const extra = res as typeof res & { needsConfirm?: boolean; pending?: boolean; ok?: boolean };
        if (extra.needsConfirm || extra.pending) {
          emitLocal("pending-writes:changed", { source: "stream-append" });
          emitLocal("toast:show", t("workspace:streamDetail.composeNeedsConfirm"));
          return;
        }
        if (extra.ok === false) {
          toastWritebackError(t("workspace:streamDetail.appendFail"), res.userMessage || "failed");
          return;
        }
        setAppendText("");
        setAppendIdx(null);
        toastWriteback(t("workspace:streamDetail.appendOk"), res);
        emitLocal("workspace:file-changed", { relativePath: activePath });
        emitLocal("suggestions:refresh", { reason: "stream-append" });
        await loadPeriodContent(activePath, { silent: true });
      } catch (e) {
        toastWritebackError(t("workspace:streamDetail.appendFail"), e);
      } finally {
        setAppending(false);
      }
    },
    [appendText, activePath, appending, t, loadPeriodContent],
  );

  /** Inline compose — append to current period stream via workspace.ingestInbox. */
  const handleInlineCompose = useCallback(async () => {
    const text = composeText.trim();
    if (!text || composing) return;
    setComposing(true);
    try {
      const res = await api.ws.ingest({
        content: text,
        sourceType: "user-original",
        dest: { mode: "stream" },
      });
      const resExtra = res as typeof res & { needsConfirm?: boolean; pending?: boolean; ok?: boolean };
      if (resExtra.needsConfirm || resExtra.pending) {
        emitLocal("pending-writes:changed", { source: "stream-compose" });
        emitLocal("toast:show", t("workspace:streamDetail.composeNeedsConfirm"));
        return;
      }
      if (resExtra.ok === false) {
        toastWritebackError(t("workspace:streamDetail.composeFail"), res.userMessage || "failed");
        return;
      }
      setComposeText("");
      toastWriteback(t("workspace:streamDetail.composeOk"), res);
      emitLocal("workspace:file-changed", { relativePath: res.path || res.targetPath });
      // Prefer the period we just wrote
      const path = res.path || res.targetPath || activePath;
      if (path) {
        setViewPeriodPath(String(path));
        await loadPeriodContent(String(path), { silent: true });
      } else {
        await loadPeriodContent(activePath, { silent: true });
      }
      void loadPeriods();
      // Re-focus composer for continuous capture
      composeRef.current?.focus();
    } catch (e) {
      toastWritebackError(t("workspace:streamDetail.composeFail"), e);
    } finally {
      setComposing(false);
    }
  }, [composeText, composing, t, activePath, loadPeriodContent, loadPeriods]);

  const handleOpenPeriod = useCallback(
    (focusHeading?: string) => {
      if (activePath) {
        select({
          kind: "file",
          path: activePath,
          ...(focusHeading?.trim() ? { focusHeading: focusHeading.trim() } : {}),
        });
      }
    },
    [activePath, select],
  );

  const handleSelectPeriod = useCallback(
    (p: PeriodInfo) => {
      setViewPeriodPath(p.relPath);
      setViewPeriodTitle(p.title || p.fileName);
      setExpandedIdx(new Set());
      // Period switch is a deliberate navigation — allow body replace
      lastBodyRef.current = null;
      lastEntryKeysRef.current = [];
      void loadPeriodContent(p.relPath, { silent: true });
    },
    [loadPeriodContent],
  );

  const handleBackToCurrent = useCallback(() => {
    if (!ctx?.periodRelPath) return;
    setViewPeriodPath(ctx.periodRelPath);
    setViewPeriodTitle(ctx.periodTitle);
    setExpandedIdx(new Set());
    lastBodyRef.current = null;
    lastEntryKeysRef.current = [];
    void loadPeriodContent(ctx.periodRelPath, { silent: true });
  }, [ctx?.periodRelPath, ctx?.periodTitle, loadPeriodContent]);

  /** Prefer shared organize-week task path (AI rail + task dock); fall back inline if busy. */
  const handleReconcile = useCallback(async () => {
    setReconciling(true);
    try {
      await runOrganizeWeek({ selectStream: false, openTaskPanel: true, openAiPanel: true });
      // Soft refresh after task enqueued (task-store also emits file-changed on completion)
      window.setTimeout(() => {
        void loadPeriodContent(activePath, { silent: true });
        void loadPeriods();
      }, 600);
    } catch (e) {
      // Inline fallback if task path fails
      try {
        const res = await api.ws.reconcileStreamPeriod({
          apply: true,
          relativePath: activePath || undefined,
        });
        if (!res.ok) {
          emitLocal("toast:show", res.message || t("workspace:shared.toastOrganizeFail"));
          openSuggestSurface();
          return;
        }
        emitLocal("workspace:file-changed");
        toastWriteback(
          res.changes && res.changes.length > 0
            ? t("workspace:shared.toastOrganized", { period: null })
            : res.userMessage || t("workspace:shared.toastOrganizedDefault"),
          {
            operation: "update",
            savedAt: new Date().toISOString(),
            ok: res.ok,
            targetPath: res.path || activePath || "",
          },
        );
        const hasCandidates =
          (res.candidates?.core && res.candidates.core.length > 0) ||
          (res.candidates?.topics && res.candidates.topics.length > 0);
        if (hasCandidates) {
          openSuggestSurface();
          emitLocal("suggestions:refresh", { reason: "reconcile" });
          emitLocal("toast:show", t("workspace:streamDetail.candidatesReady"));
        }
        void loadPeriodContent(activePath, { silent: true });
        void loadPeriods();
      } catch (e2) {
        toastWritebackError(t("workspace:shared.toastOrganizeFail"), e2 ?? e);
      }
    } finally {
      setReconciling(false);
    }
  }, [t, loadPeriodContent, loadPeriods, activePath]);

  /**
   * Header actions: no second「记一下」(title bar is the only L1 capture).
   * 个人清单不在此处重复（降噪 2026-08）——唯一入口是标题栏 ListTodo / ⌘⇧T。
   * AI 待办 · 整理 · refresh 为情境动作；个人清单 ≠ ActionBar 建议。
   */
  const headerActions = useMemo((): ChromeAction[] => {
    return [
      {
        id: "ai-todos",
        label: t("workspace:streamDetail.aiMaintainTodos"),
        title: t("workspace:streamDetail.aiMaintainTodosTip"),
        icon: todoMaintaining ? (
          <Loader2 size={ICON.xs} className="animate-spin" />
        ) : (
          <Sparkles size={ICON.xs} />
        ),
        priority: 10,
        disabled: todoMaintaining,
        aiAction: true,
        onClick: handleMaintainTodos,
      },
      {
        id: "organize",
        label: t("workspace:streamDetail.organize"),
        title: t("workspace:streamDetail.organizeTip"),
        icon: reconciling ? (
          <Loader2 size={ICON.xs} className="animate-spin" />
        ) : (
          <Wand2 size={ICON.xs} />
        ),
        priority: 20,
        disabled: reconciling,
        onClick: () => void handleReconcile(),
      },
      {
        id: "reload",
        label: t("common:action.refresh"),
        title: t("shell:sidebar.stream.reloadTooltip"),
        icon: <RefreshCw size={ICON.xs} />,
        priority: 40,
        iconOnlyWhenCompact: true,
        onClick: () => void loadPeriodContent(activePath, { silent: true }),
      },
    ];
  }, [
    t,
    reconciling,
    todoMaintaining,
    aiReady,
    activePath,
    loadPeriodContent,
    handleReconcile,
    handleMaintainTodos,
  ]);

  const toggleExpand = useCallback((idx: number) => {
    setExpandedIdx((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const toggleDayCollapsed = useCallback((dayKey: string) => {
    setCollapsedDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayKey)) next.delete(dayKey);
      else next.add(dayKey);
      return next;
    });
  }, []);

  const dayGroups = useMemo(
    () => groupEntriesByDay(entries, t("workspace:streamDetail.otherDay")),
    [entries, t],
  );

  const dayKeysSig = dayGroups.map((g) => g.dayKey).join("|");
  const seenDayKeysRef = useRef<Set<string>>(new Set());

  // First sight of a non-leading day → start collapsed (keep density); user can expand.
  useEffect(() => {
    if (dayGroups.length === 0) return;
    setCollapsedDays((prev) => {
      const next = new Set(prev);
      const alive = new Set(dayGroups.map((g) => g.dayKey));
      dayGroups.forEach((g, i) => {
        if (!seenDayKeysRef.current.has(g.dayKey)) {
          seenDayKeysRef.current.add(g.dayKey);
          if (i > 0) next.add(g.dayKey);
        }
      });
      for (const k of Array.from(next)) {
        if (!alive.has(k)) next.delete(k);
      }
      return next;
    });
    // Prune seen keys that no longer exist
    for (const k of Array.from(seenDayKeysRef.current)) {
      if (!dayGroups.some((g) => g.dayKey === k)) seenDayKeysRef.current.delete(k);
    }
    // dayKeysSig tracks group identity without depending on full dayGroups ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKeysSig]);

  const periodTitle =
    viewPeriodTitle ||
    ctx?.periodTitle ||
    t("shell:sidebar.stream.defaultTitle");

  const isCurrentPeriod =
    !activePath || !ctx?.periodRelPath || activePath === ctx.periodRelPath;

  if (loading) {
    return (
      <ViewContainer>
        <LoadingState label={t("shell:sidebar.stream.loading")} />
      </ViewContainer>
    );
  }

  if (error) {
    return (
      <ViewContainer>
        <ErrorState
          message={error}
          onRetry={() => {
            setLoading(true);
            void api.ws
              .getStreamContext()
              .then(async (streamCtx) => {
                setCtx({
                  packing: streamCtx.packing,
                  periodRelPath: streamCtx.periodRelPath,
                  periodTitle: streamCtx.periodTitle,
                });
                setViewPeriodPath(streamCtx.periodRelPath);
                setViewPeriodTitle(streamCtx.periodTitle);
                await loadPeriodContent(streamCtx.periodRelPath, { silent: false });
                await loadPeriods();
                setError(null);
              })
              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
              .finally(() => setLoading(false));
          }}
        />
      </ViewContainer>
    );
  }

  return (
    <ViewContainer>
      <PageHeader
        icon={<CalendarDays size={ICON.sm} />}
        title={periodTitle}
        subtitle={
          entries.length > 0
            ? t("workspace:streamDetail.personalStreamSubtitle", {
                count: entries.length,
                packing: ctx?.packing || "weekly",
              })
            : t("workspace:streamDetail.emptySubtitle")
        }
        actions={
          <div className="min-w-0 max-w-[min(100%,22rem)] sm:max-w-[28rem]">
            <ChromeOverflowActions actions={headerActions} />
          </div>
        }
      />

      {periods.length > 1 ? (
        <div
          className="mb-2 flex flex-wrap items-center gap-1"
          data-stream-period-chips
        >
          <span className="sr-only">{t("workspace:streamDetail.periodSwitcher")}</span>
          {periods.slice(0, 6).map((p) => {
            const isActive = activePath === p.relPath;
            const isPackingCurrent = ctx?.periodRelPath === p.relPath;
            return (
              <button
                key={p.relPath}
                type="button"
                onClick={() => handleSelectPeriod(p)}
                data-filter-chip
                data-filter-chip-active={isActive ? "true" : undefined}
                className={cn(
                  "inline-flex h-[var(--control-h-chip)] max-w-[9rem] items-center truncate rounded-full px-2 text-3xs font-medium leading-none transition-colors",
                  isActive
                    ? "bg-accent-bg-subtle text-accent-color shadow-[inset_0_0_0_1px_var(--color-accent-border-subtle)]"
                    : "bg-surface-muted/35 text-text-tertiary hover:bg-surface-muted hover:text-text-secondary",
                )}
                title={
                  !p.reconciled
                    ? `${p.title || p.fileName} · ${t("workspace:streamDetail.unreconciled")}`
                    : p.title || p.fileName
                }
              >
                <span className="truncate">{p.title || p.fileName}</span>
                {isPackingCurrent && !isActive ? (
                  <span className="ml-0.5 shrink-0 text-text-quaternary">·</span>
                ) : null}
                {!p.reconciled && !isActive ? (
                  <span className="ml-0.5 shrink-0 text-warning/80" aria-hidden>
                    ·
                  </span>
                ) : null}
              </button>
            );
          })}
          {!isCurrentPeriod && ctx?.periodRelPath ? (
            <button
              type="button"
              className="text-3xs text-accent-color hover:underline"
              onClick={handleBackToCurrent}
            >
              {t("workspace:streamDetail.backToCurrent")}
            </button>
          ) : null}
        </div>
      ) : null}

      {/*
        建议入口：画布顶 SuggestEntryStrip（EditorArea）→ 唯一 ActionBar 确认面。
        本视图不挂第二套建议列表（data-stream-suggestions-quiet 在全局 strip）。
      */}

      {/* Inline composer — primary capture path: 润色 → 记下。
          无 label/hint meta 行（降噪 2026-08）：placeholder 承担引导，计数在 PageHeader subtitle。 */}
      {composeIsUrl ? (
        <div
          className="mb-2 flex items-center gap-2 rounded-[var(--radius-md)] border border-accent-border-subtle/50 bg-accent-bg-faint/20 px-2.5 py-1.5"
          data-stream-compose-url-hint
        >
          <Link size={ICON.nano} className="shrink-0 text-accent-color" aria-hidden />
          <span className="min-w-0 flex-1 text-3xs text-text-secondary">
            {t("workspace:streamDetail.composeUrlHint")}
          </span>
          <button
            type="button"
            onClick={() => {
              emitLocal("overlay:open", { kind: "quick-capture", prefill: { source: composeText.trim() } } as never);
              setComposeText("");
            }}
            className="shrink-0 rounded-full bg-accent-bg-subtle px-2 py-0.5 text-3xs font-medium text-accent-color hover:bg-accent-bg-faint/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
          >
            {t("workspace:streamDetail.composeUrlAction")}
          </button>
        </div>
      ) : null}
      <div
        className={cn(
          "v4-stream-composer mb-2.5 rounded-[var(--radius-lg)]",
          "bg-surface-elevated shadow-[var(--shadow-card)]",
          "px-3 py-2",
        )}
        data-stream-inline-composer
      >
        <label className="sr-only" htmlFor="stream-inline-compose">
          {t("workspace:streamDetail.composePlaceholder")}
        </label>
        <textarea
          id="stream-inline-compose"
          ref={composeRef}
          rows={2}
          value={composeText}
          disabled={composing}
          placeholder={t("workspace:streamDetail.composePlaceholder")}
          onChange={(e) => setComposeText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void handleInlineCompose();
            }
          }}
          className={cn(
            "w-full resize-y min-h-[2.75rem] max-h-40 bg-transparent",
            "text-md leading-[1.62] text-text-primary placeholder:text-text-quaternary",
            "outline-none border-0 focus:ring-0",
          )}
        />
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle-dim/70 pt-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {/* Tertiary: full capture lives in title bar「记一下」 */}
            <button
              type="button"
              onClick={handleCapture}
              className="text-3xs text-text-quaternary underline-offset-2 hover:text-accent-color hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 rounded-sm"
            >
              {t("workspace:streamDetail.composeFullCapture")}
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <Tooltip
              content={
                aiReady
                  ? t("workspace:streamDetail.composeAiPolishTip")
                  : t("overlays:capture.aiPolishNotReady")
              }
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="v4-ai-btn-ghost h-7 gap-1 text-3xs"
                disabled={!composeText.trim() || polishing || composing || !aiReady}
                onClick={() => void handleComposePolish()}
                aria-label={t("workspace:streamDetail.composeAiPolish")}
                data-stream-compose-polish
              >
                {polishing ? (
                  <Loader2 size={ICON.nano} className="animate-spin" />
                ) : (
                  <Sparkles size={ICON.nano} />
                )}
                {t("workspace:streamDetail.composeAiPolish")}
              </Button>
            </Tooltip>
            <Button
              type="button"
              size="sm"
              className="h-7 gap-1"
              disabled={composing || polishing || !composeText.trim()}
              onClick={() => void handleInlineCompose()}
              data-stream-compose-submit
            >
              {composing ? (
                <Loader2 size={ICON.nano} className="animate-spin" />
              ) : (
                <Send size={ICON.nano} />
              )}
              {t("workspace:streamDetail.composeSubmit")}
              <kbd className="v4-kbd v4-kbd-sm ml-0.5 opacity-80">⌘↵</kbd>
            </Button>
          </div>
        </div>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon={<CalendarDays size={ICON.md} />}
          title={t("shell:sidebar.stream.emptyTitle")}
          hint={t("workspace:streamDetail.emptyComposerHint")}
          action={
            <Button
              size="sm"
              onClick={() => composeRef.current?.focus()}
            >
              <Send size={ICON.xs} /> {t("workspace:streamDetail.composeFocus")}
            </Button>
          }
        />
      ) : (
        <div className="space-y-3" data-stream-feed>
          {dayGroups.map((group, gi) => {
            const dayCollapsed = collapsedDays.has(group.dayKey);
            const rows = groupDayFeedRows(group.entries);
            return (
              <section
                key={group.dayKey}
                className={cn(
                  "overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-card)]",
                  gi === 0 && isCurrentPeriod && "ring-1 ring-inset ring-accent-color/15",
                )}
                data-stream-day-group
                data-stream-day-today={gi === 0 && isCurrentPeriod ? "true" : undefined}
              >
                <button
                  type="button"
                  onClick={() => toggleDayCollapsed(group.dayKey)}
                  className="sticky top-0 z-local flex w-full items-center gap-1.5 bg-surface-muted/25 px-2.5 py-1.5 text-left hover:bg-surface-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
                  aria-expanded={!dayCollapsed}
                  data-stream-day-toggle
                >
                  <ChevronDown
                    size={ICON.nano}
                    className={cn(
                      "shrink-0 text-text-quaternary transition-transform",
                      dayCollapsed && "-rotate-90",
                    )}
                    aria-hidden
                  />
                  <h2 className="text-xs font-semibold tracking-tight text-text-secondary">
                    {group.dayLabel}
                  </h2>
                  <span className="tabular-nums text-3xs text-text-quaternary">
                    {rows.length}
                  </span>
                  {gi === 0 && isCurrentPeriod ? (
                    <span className="rounded-full bg-accent-bg-subtle px-1.5 py-px text-3xs font-medium text-accent-color">
                      {t("workspace:streamDetail.todayBadge")}
                    </span>
                  ) : null}
                </button>

                {!dayCollapsed ? (
                  <div className="divide-y divide-border-subtle-dim/70" data-stream-day-body>
                    {rows.map((row) => (
                      <StreamFeedRowView
                        key={`${group.dayKey}-${row.entry.index}`}
                        row={row}
                        isToday={gi === 0 && isCurrentPeriod}
                        expanded={expandedIdx.has(row.entry.index)}
                        appendOpen={appendIdx === row.entry.index}
                        appendText={appendText}
                        appending={appending}
                        activePath={activePath}
                        onToggleExpand={() => toggleExpand(row.entry.index)}
                        onOpenPeriod={(h) => handleOpenPeriod(h)}
                        onToggleAppend={() => {
                          setAppendIdx((cur) =>
                            cur === row.entry.index ? null : row.entry.index,
                          );
                          setAppendText("");
                        }}
                        onAppendText={setAppendText}
                        onAppendSubmit={() => void handleAppendEntry(row.entry)}
                        onAppendCancel={() => {
                          setAppendIdx(null);
                          setAppendText("");
                        }}
                        t={t}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })}

          {activePath ? (
            <div className="flex justify-center pt-1">
              <Button variant="outline" size="sm" onClick={() => handleOpenPeriod()}>
                <FileText size={ICON.xs} />
                {t("shell:sidebar.stream.openFull")}
                <ChevronRight size={ICON.nano} />
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </ViewContainer>
  );
}
