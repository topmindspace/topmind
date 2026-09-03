/**
 * StreamDetailView — 个人动态流主表面（周期本时间线）。
 *
 * - 随便记下 · 按日时间流 · 条目增补（同文件续写）
 * - 建议入口在 StatusBar 计数 chip（统一）→ SuggestPopover 确认
 * - 本视图不挂第二套建议列表；整理候选合入 SuggestPopover
 */
import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { useTranslation } from "react-i18next";
import {
  RiArrowDownSLine,
  RiArrowGoBackLine,
  RiArrowRightSLine,
  RiArrowUpLine,
  RiCalendar2Line,
  RiChatNewLine,
  RiFileTextLine,
  RiInboxArchiveLine,
  RiLink,
  RiLoader4Line,
  RiMagicLine,
  RiRefreshLine,
  RiSendPlane2Line,
  RiSparklingLine,
  RiUser3Line,
} from "@remixicon/react";
import { api } from "../../../services/api";
import { emitLocal, onLocal } from "../../../plugins/host";
import { useViewStore } from "../../../stores/view-store";
import {
  ViewContainer,
  PageHeader,
  EmptyState,
  LoadingState,
  ErrorState,
  FeedLayoutToggle,
  FeedColumn,
  FeedChrome,
} from "../../../components/ui/view";
import { Button } from "../../../components/ui/Button";
import { ConfirmDialog } from "../../../components/ui/Dialog";
import { LedgerQuickEntry, looksLikeLedgerText } from "../../../components/overlays/LedgerQuickEntry";
import { getCachedSettings, setCachedSettings } from "../../../lib/settings-cache";
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

function StreamNestedAppends({
  appends,
  showFull,
  needsExpand,
  t,
}: {
  appends: Array<StreamEntry & { index: number }>;
  showFull: boolean;
  needsExpand: boolean;
  t: TFunction;
}) {
  if (appends.length === 0) return null;
  return (
    <div className="relative mt-2 space-y-1.5 border-l-2 border-accent-border-subtle/50 pl-3" data-stream-nested-appends>
      {(showFull ? appends : appends.slice(0, 1)).map((a) => {
        const replyTime = extractBodyTimestamp(a.body);
        return (
          <div key={a.index} className="relative flex items-start gap-1.5 text-3xs text-text-secondary" data-stream-append-card>
            {/* Thread branch line indicator */}
            <span className="absolute -left-3 top-2.5 h-px w-2 bg-accent-border-subtle/60" aria-hidden />
            {replyTime ? (
              <span className="mt-0.5 shrink-0 font-medium tabular-nums text-text-quaternary">{replyTime}</span>
            ) : null}
            <div className="min-w-0 flex-1">
              <StreamMdBody
                markdown={a.body || a.preview || ""}
                expanded={showFull}
                isAppendCard
                allowClamp={needsExpand}
                className="text-xs leading-[1.55] text-text-secondary"
              />
            </div>
          </div>
        );
      })}
      {!showFull && appends.length > 1 ? (
        <div className="relative pl-0.5 text-3xs text-text-quaternary">
          <span className="absolute -left-3 top-2 h-px w-2 bg-accent-border-subtle/40" aria-hidden />
          +{appends.length - 1} {t("workspace:streamDetail.moreAppends")}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One feed row inside a day panel — moment/prose (compact), article (title+summary),
 * with nested appends. Expand only when content is truly long.
 * Wrapped in React.memo to isolate card renders from compose-box typing & scroll.
 */
const StreamFeedRowView = memo(function StreamFeedRowView({
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
  onToggleExpand: (index: number) => void;
  onOpenPeriod: (heading?: string) => void;
  onToggleAppend: (index: number, headingOrPreview?: string) => void;
  onAppendText: (v: string, headingOrPreview?: string) => void;
  onAppendSubmit: (entry: StreamEntry) => void;
  onAppendCancel: (headingOrPreview?: string) => void;
  t: TFunction;
}) {
  const { entry, kind, appends } = row;
  const headingOrPreview = entry.heading || entry.preview;
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
        className="group v4-feed-post"
        data-stream-entry-card
        data-stream-entry-kind="article"
      >
        <div className="flex items-start gap-1">
          <button
            type="button"
            onClick={() => onOpenPeriod(entry.heading || undefined)}
            className={cn(
              "flex min-w-0 flex-1 flex-col gap-0.5 rounded-md bg-surface-muted/15 px-2.5 py-2 text-left",
              "transition-colors hover:bg-accent-bg-faint/30",
              "v4-focus-ring",
            )}
            data-stream-article-open
          >
            <div className="flex items-start gap-2">
              <RiFileTextLine size={ICON.xs} className="mt-0.5 shrink-0 text-accent-color/80" aria-hidden />
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
                  {t("workspace:streamDetail.openArticle")}
                  <RiArrowRightSLine size={ICON.nano} aria-hidden />
                </div>
              </div>
            </div>
          </button>
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto">
            <Tooltip content={t("workspace:streamDetail.appendTip")}>
              <button
                type="button"
                onClick={() => onToggleAppend(entry.index, headingOrPreview)}
                className="flex h-6 w-6 items-center justify-center rounded-sm text-text-quaternary hover:bg-surface-muted hover:text-accent-color focus-visible:opacity-100 v4-focus-ring"
                aria-label={t("workspace:streamDetail.append")}
              >
                <RiChatNewLine size={ICON.xs} />
              </button>
            </Tooltip>
          </div>
        </div>
        <StreamNestedAppends
          appends={appends}
          showFull={showFull}
          needsExpand={needsExpand}
          t={t}
        />
        {needsExpand ? (
          <button
            type="button"
            onClick={() => onToggleExpand(entry.index)}
            className="mt-1 flex items-center gap-1 text-3xs text-text-quaternary transition-colors hover:text-accent-color"
            data-stream-expand-toggle
          >
            <RiArrowDownSLine
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
            className="mt-2 rounded-md border border-border-subtle-dim bg-surface-muted/25 p-2"
            data-stream-entry-append
          >
            <textarea
              rows={2}
              value={appendText}
              disabled={appending}
              placeholder={t("workspace:streamDetail.appendPlaceholder")}
              onChange={(e) => onAppendText(e.target.value, headingOrPreview)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (!appending && appendText.trim() && activePath) {
                    onAppendSubmit(entry);
                  }
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onAppendCancel(headingOrPreview);
                }
              }}
              className={cn(
                "w-full resize-y min-h-9 max-h-28 bg-transparent",
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
                onClick={() => onAppendCancel(headingOrPreview)}
              >
                {t("workspace:streamDetail.appendCancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7"
                disabled={appending || !appendText.trim() || !activePath}
                onClick={() => onAppendSubmit(entry)}
              >
                {appending ? (
                  <RiLoader4Line size={ICON.xs} className="animate-spin" />
                ) : (
                  <RiChatNewLine size={ICON.xs} />
                )}
                {t("workspace:streamDetail.appendSubmit")}
              </Button>
            </div>
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <article
      className={cn(
        "group relative v4-feed-post",
        kind === "append" && "bg-surface-muted/10",
      )}
      data-stream-entry-card
      data-stream-entry-kind={kind}
    >
      <div className="flex items-start gap-2">
        {/* Time column — day cohesion; right-aligned with consistent baseline */}
        <div className="flex w-9 shrink-0 justify-end pt-1">
          {bodyTime ? (
            <span className="text-3xs font-medium tabular-nums leading-none text-text-quaternary">
              {bodyTime}
            </span>
          ) : (
            <span
              className={cn(
                "h-1 w-1 shrink-0 rounded-full",
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
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto">
              <Tooltip content={t("workspace:streamDetail.appendTip")}>
                <button
                  type="button"
                  onClick={() => onToggleAppend(entry.index, headingOrPreview)}
                  className="flex h-6 w-6 items-center justify-center rounded-sm text-text-quaternary hover:bg-surface-muted hover:text-accent-color focus-visible:opacity-100 v4-focus-ring"
                  aria-label={t("workspace:streamDetail.append")}
                >
                  <RiChatNewLine size={ICON.xs} />
                </button>
              </Tooltip>
              <Tooltip content={t("workspace:streamDetail.openInEditorTip")}>
                <button
                  type="button"
                  onClick={() => onOpenPeriod(entry.heading || undefined)}
                  className="flex h-6 w-6 items-center justify-center rounded-sm text-text-quaternary hover:bg-surface-muted hover:text-accent-color focus-visible:opacity-100 v4-focus-ring"
                  aria-label={t("workspace:streamDetail.openInEditor")}
                  data-stream-open-segment
                >
                  <RiFileTextLine size={ICON.xs} />
                </button>
              </Tooltip>
            </div>
          </div>

          <StreamNestedAppends
            appends={appends}
            showFull={showFull}
            needsExpand={needsExpand}
            t={t}
          />

          {needsExpand ? (
            <button
              type="button"
              onClick={() => onToggleExpand(entry.index)}
              className="mt-1 flex items-center gap-1 text-3xs text-text-quaternary transition-colors hover:text-accent-color"
              data-stream-expand-toggle
            >
              <RiArrowDownSLine
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
              className="mt-2 rounded-md border border-border-subtle-dim bg-surface-muted/25 p-2"
              data-stream-entry-append
            >
              <textarea
                rows={2}
                value={appendText}
                disabled={appending}
                placeholder={t("workspace:streamDetail.appendPlaceholder")}
                onChange={(e) => onAppendText(e.target.value, headingOrPreview)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    if (!appending && appendText.trim() && activePath) {
                      onAppendSubmit(entry);
                    }
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    onAppendCancel(headingOrPreview);
                  }
                }}
                className={cn(
                  "w-full resize-y min-h-9 max-h-28 bg-transparent",
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
                  onClick={() => onAppendCancel(headingOrPreview)}
                >
                  {t("workspace:streamDetail.appendCancel")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-7"
                  disabled={appending || !appendText.trim() || !activePath}
                  onClick={() => onAppendSubmit(entry)}
                >
                  {appending ? (
                    <RiLoader4Line size={ICON.xs} className="animate-spin" />
                  ) : (
                    <RiChatNewLine size={ICON.xs} />
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
});

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
    // First-line list/time chrome lives in the card header chip — never as body title.
    // Multi-line moments keep remaining lines; task boxes stay (stripListChromeForDisplay).
    return stripListChromeForDisplay(parts.main);
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

/** True when a day-group key (ISO / MM-DD / M月D日) is the actual current day. */
function isTodayGroupKey(dayKey: string): boolean {
  const now = new Date();
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (dayKey === iso) return true;
  const md = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (dayKey === `md-${md}`) return true;
  return dayKey === `cn-${now.getMonth() + 1}-${now.getDate()}`;
}

/** Session-scoped composer drafts — the view unmounts on any selection
 * change, and a half-written moment must survive navigating away. Cleared on
 * successful submit. */
const composeDrafts = new Map<string, string>();
const appendDrafts = new Map<string, string>();
const appendDraftKey = (period: string | null | undefined, heading?: string | null) =>
  `${period ?? ""}#${heading ?? ""}`;

export function StreamDetailView() {
  const { t } = useTranslation(["workspace", "shell", "common"]);
  const [entries, setEntries] = useState<StreamEntry[]>([]);
  const [ctx, setCtx] = useState<StreamContext | null>(null);
  /** Viewing path — may differ from current packing period when user switches chips */
  const [viewPeriodPath, setViewPeriodPath] = useState<string | null>(null);
  const [viewPeriodTitle, setViewPeriodTitle] = useState<string | null>(null);
  const [periods, setPeriods] = useState<PeriodInfo[]>([]);
  const [streamYears, setStreamYears] = useState<Array<{ year: string; periodCount: number; archived: boolean }>>([]);
  const [showMoreThisYear, setShowMoreThisYear] = useState(false);
  const [expandedPastYear, setExpandedPastYear] = useState<string | null>(null);
  const [archivingYear, setArchivingYear] = useState<string | null>(null);
  /** Archive-year confirm gate (ConfirmDialog replaces native window.confirm). */
  const [archiveConfirm, setArchiveConfirm] = useState<{ year: string; count: number } | null>(null);
  // 记账 × 记下：composer 检测到记账口令时注入口（enable-gated；非第六概念）
  const [ledgerEnabled, setLedgerEnabled] = useState(
    () => getCachedSettings()?.ledger?.enabled !== false,
  );
  useEffect(() => {
    const refreshFrom = (s: { ledger?: { enabled?: boolean } } | null | undefined) =>
      setLedgerEnabled(s?.ledger?.enabled !== false);
    const unsub = onLocal("plugins:settings-changed", () => refreshFrom(getCachedSettings()));
    void api.sys.settings().then((s) => {
      setCachedSettings(s);
      refreshFrom(s);
    }).catch(() => {});
    return unsub;
  }, []);
  const [pastYearPeriods, setPastYearPeriods] = useState<Record<string, PeriodInfo[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<Set<number>>(new Set());
  /** Collapsed day keys — first (newest) day starts expanded */
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  const [composeText, setComposeText] = useState("");
  const [composing, setComposing] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [polishBackup, setPolishBackup] = useState<string | null>(null);
  const polishSessionRef = useRef<string | null>(null);
  /** Compose URL detection — when true, show hint to open Note it (记一下) for fetch. */
  const composeIsUrl = useMemo(
    () => /^https?:\/\/\S+$/iu.test(composeText.trim()),
    [composeText],
  );

  // 记账意图检测 — 驱动记下区域上方的快速记账注入口
  const composerLooksLedger = useMemo(
    () => looksLikeLedgerText(composeText),
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
  const feedLayout = useViewStore((s) => s.feedLayout);
  const setFeedLayout = useViewStore((s) => s.setFeedLayout);
  const todoMaintaining = useTodoStore((s) => s.maintaining === "maintaining");
  const todoEverLoaded = useTodoStore((s) => s.everLoaded);
  const aiReady = useAiStore((s) => s.runtimeStatus?.ready ?? false);

  const activePath = viewPeriodPath ?? ctx?.periodRelPath ?? null;

  // Draft persistence: hydrate on period switch, store on every keystroke.
  useEffect(() => {
    setComposeText(activePath ? composeDrafts.get(activePath) ?? "" : "");
  }, [activePath]);
  const updateComposeText = useCallback(
    (v: string) => {
      setComposeText(v);
      if (!activePath) return;
      if (v.trim()) composeDrafts.set(activePath, v);
      else composeDrafts.delete(activePath);
    },
    [activePath],
  );

  // Lazy-load personal list count when Stream mounts (does not open popover).
  useEffect(() => {
    if (!todoEverLoaded) void useTodoStore.getState().refresh();
  }, [todoEverLoaded]);

  // Auto-grow textarea height as user types
  useEffect(() => {
    const el = composeRef.current;
    if (!el) return;
    el.style.height = "auto";
    const nextH = Math.max(48, Math.min(el.scrollHeight, 280));
    el.style.height = `${nextH}px`;
  }, [composeText]);

  // Floating back-to-top detection (Fitts's law affordance for long streams)
  const [showBackToTop, setShowBackToTop] = useState(false);
  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const scrollY = window.scrollY || document.documentElement.scrollTop;
        setShowBackToTop(scrollY > 400);
      });
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

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
      setError(null);
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

  const loadStreamYears = useCallback(async () => {
    try {
      const list = await api.ws.listStreamYears();
      setStreamYears(list || []);
    } catch {
      /* non-critical */
    }
  }, []);

  const loadPastYearPeriods = useCallback(async (year: string) => {
    if (pastYearPeriods[year]) return;
    try {
      // Year filter runs in the engine (covers {year}/ dir AND flat {year}-*
      // files) before the result limit applies — no truncated misses.
      const list = await api.ws.listStreamPeriods(year);
      const yearPeriods = (list || []).map((p) => ({
        relPath: p.relPath,
        fileName: p.fileName,
        title: p.title,
        reconciled: p.reconciled,
        mtime: p.mtime ?? null,
      }));
      setPastYearPeriods((prev) => ({ ...prev, [year]: yearPeriods }));
    } catch {
      /* non-critical */
    }
  }, [pastYearPeriods]);

  const handleArchiveYear = useCallback((year: string, count: number) => {
    setArchiveConfirm({ year, count });
  }, []);

  const runArchiveYear = useCallback(async (year: string) => {
    setArchivingYear(year);
    try {
      const result = await api.ws.archiveStreamYear(year);
      if (result.ok) {
        toastWriteback(
          result.userMessage ||
            t("workspace:streamDetail.archiveYearOk", {
              year,
              count: result.movedCount,
              path: result.archivePath,
            }),
        );
        // Honest partial failure: name what could not be moved
        if (result.failedFiles && result.failedFiles.length > 0) {
          emitLocal("toast:show", { text: t("workspace:streamDetail.archiveYearPartialFail", {
            count: result.failedFiles.length,
          }), kind: "error" });
        }
        // Refresh years and periods
        await loadStreamYears();
        await loadPeriods();
      } else {
        // Reason-specific human message (not a raw code)
        const reasonKey =
          result.reason === "current-or-future-year"
            ? "workspace:streamDetail.archiveReasonCurrentYear"
            : result.reason === "already-archived"
              ? "workspace:streamDetail.archiveReasonAlreadyArchived"
              : result.reason === "year-dir-not-found"
                ? "workspace:streamDetail.archiveReasonYearNotFound"
                : "workspace:streamDetail.archiveReasonGeneric";
        const msg =
          reasonKey === "workspace:streamDetail.archiveReasonGeneric"
            ? t(reasonKey, { reason: result.reason || "unknown" })
            : t(reasonKey);
        toastWritebackError(t("workspace:streamDetail.archiveYear"), msg);
      }
    } catch (e) {
      toastWritebackError(t("workspace:streamDetail.archiveYear"), e);
    } finally {
      setArchivingYear(null);
    }
  }, [t, loadStreamYears, loadPeriods]);

  /** Boot once: stream context + current period body + period chips */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [streamCtx, periodList, yearsList] = await Promise.all([
          api.ws.getStreamContext(),
          api.ws.listStreamPeriods().catch(() => [] as Awaited<ReturnType<typeof api.ws.listStreamPeriods>>),
          api.ws.listStreamYears().catch(() => [] as Awaited<ReturnType<typeof api.ws.listStreamYears>>),
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
        setStreamYears(yearsList || []);
        // Prefer current packing period when it exists on disk; otherwise fall back to
        // the newest listed period so the feed is never stuck empty (e.g., new week not yet created).
        const fallback = periodList?.[0];
        const currentExists = streamCtx.periodRelPath
          && (periodList || []).some((p) => p.relPath === streamCtx.periodRelPath);
        const path = (currentExists ? streamCtx.periodRelPath : fallback?.relPath) || null;
        const title = (currentExists
          ? streamCtx.periodTitle
          : fallback?.title || fallback?.fileName) || null;
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
      emitLocal("toast:show", { text: t("overlays:capture.aiPolishNotReady"), kind: "error" });
      return;
    }
    const sessionId = `stream-polish-${Date.now()}`;
    polishSessionRef.current = sessionId;
    useInlineAiStore.getState().begin({
      id: sessionId,
      kind: "polish",
      label: t("workspace:streamDetail.composeAiPolishing"),
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
        setPolishBackup(text);
        updateComposeText(polished);
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
          heading: entry.heading || undefined,
          content: text,
          startLine: entry.startLine,
          endLine: entry.endLine,
          anchorText: entry.anchorText || entry.preview || undefined,
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
        appendDrafts.delete(appendDraftKey(activePath, entry.heading || entry.preview));
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

  const handleToggleAppend = useCallback(
    (index: number, headingOrPreview?: string) => {
      setAppendIdx((cur) => (cur === index ? null : index));
      setAppendText(
        appendDrafts.get(appendDraftKey(activePath, headingOrPreview)) ?? "",
      );
    },
    [activePath],
  );

  const handleUpdateAppendText = useCallback(
    (v: string, headingOrPreview?: string) => {
      setAppendText(v);
      const key = appendDraftKey(activePath, headingOrPreview);
      if (v.trim()) appendDrafts.set(key, v);
      else appendDrafts.delete(key);
    },
    [activePath],
  );

  const handleAppendSubmit = useCallback(
    (entry: StreamEntry) => {
      void handleAppendEntry(entry);
    },
    [handleAppendEntry],
  );

  const handleAppendCancel = useCallback(
    (headingOrPreview?: string) => {
      appendDrafts.delete(appendDraftKey(activePath, headingOrPreview));
      setAppendIdx(null);
      setAppendText("");
    },
    [activePath],
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
      updateComposeText("");
      setPolishBackup(null);
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
  }, [composeText, composing, t, activePath, loadPeriodContent, loadPeriods, updateComposeText]);

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
      // Period switch is a deliberate navigation — allow body replace.
      // Not silent: a failed read must surface (ErrorState + retry), never
      // leave the feed silently showing the previous period.
      lastBodyRef.current = null;
      lastEntryKeysRef.current = [];
      void loadPeriodContent(p.relPath, { silent: false });
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
          emitLocal("toast:show", { text: res.message || t("workspace:shared.toastOrganizeFail"), kind: "error" });
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
          emitLocal("toast:show", { text: t("workspace:streamDetail.candidatesReady"), kind: "success" });
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
          <RiLoader4Line size={ICON.xs} className="animate-spin" />
        ) : (
          <RiSparklingLine size={ICON.xs} />
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
          <RiLoader4Line size={ICON.xs} className="animate-spin" />
        ) : (
          <RiMagicLine size={ICON.xs} />
        ),
        priority: 20,
        disabled: reconciling,
        onClick: () => void handleReconcile(),
      },
      {
        id: "reload",
        label: t("common:action.refresh"),
        title: t("shell:sidebar.stream.reloadTooltip"),
        icon: <RiRefreshLine size={ICON.xs} />,
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
          // Two newest days start expanded — weekly review shouldn't cost a
          // click per day; older days stay collapsed for density.
          if (i > 1) next.add(g.dayKey);
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
    // dayKeysSig tracks group identity without depending on full dayGroups ref (avoids re-run on every content change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKeysSig]);

  const periodTitle =
    viewPeriodTitle ||
    ctx?.periodTitle ||
    t("shell:sidebar.stream.defaultTitle");

  const isCurrentPeriod =
    !activePath || !ctx?.periodRelPath || activePath === ctx.periodRelPath;

  // "More this year" counts only this calendar year's periods — both year-dir
  // ({year}/{period}.md) and flat ({year}-{period}.md) layouts count.
  const currentYear = String(new Date().getFullYear());
  const thisYearPeriods = useMemo(
    () =>
      periods.filter(
        (p) =>
          p.relPath.split("/").includes(currentYear) ||
          p.fileName.startsWith(`${currentYear}-`),
      ),
    [periods, currentYear],
  );

  if (loading) {
    return (
      <ViewContainer variant="feed">
        <LoadingState label={t("shell:sidebar.stream.loading")} />
      </ViewContainer>
    );
  }

  if (error) {
    return (
      <ViewContainer variant="feed">
        <ErrorState
          message={error}
          onRetry={() => {
            setLoading(true);
            // Period-switch failure: retry the period we tried to open
            if (activePath) {
              void loadPeriodContent(activePath, { silent: false }).finally(() =>
                setLoading(false),
              );
              return;
            }
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
    <ViewContainer variant="feed">
      <PageHeader
        icon={<RiCalendar2Line size={ICON.sm} />}
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
          <div className="flex min-w-0 max-w-[min(100%,28rem)] items-center justify-end gap-1.5 sm:max-w-lg">
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
          {/* Recent 5 periods of the current year (primary chips) */}
          {thisYearPeriods.slice(0, 5).map((p) => {
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
                  "inline-flex h-(--control-h-chip) max-w-36 items-center truncate rounded-full px-2 text-3xs font-medium leading-none transition-colors",
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
                  <span className="ml-0.5 shrink-0 rounded-full bg-accent-bg-subtle px-1 text-3xs font-medium leading-4 text-accent-color">
                    {t("workspace:streamDetail.packingCurrentShort")}
                  </span>
                ) : null}
                {!p.reconciled && !isActive ? (
                  <span className="ml-0.5 shrink-0 rounded-full bg-warning/10 px-1 text-3xs font-medium leading-4 text-warning">
                    {t("workspace:streamDetail.unreconciledShort")}
                  </span>
                ) : null}
              </button>
            );
          })}
          {/* More this year (expandable) — count reflects only this year's periods */}
          {thisYearPeriods.length > 5 ? (
            <button
              type="button"
              onClick={() => setShowMoreThisYear((v) => !v)}
              className="inline-flex h-(--control-h-chip) items-center gap-0.5 rounded-full px-2 text-3xs font-medium text-text-tertiary transition-colors hover:bg-surface-muted hover:text-text-secondary"
            >
              <RiArrowDownSLine
                size={ICON.nano}
                className={cn("transition-transform", showMoreThisYear && "rotate-180")}
              />
              {t("workspace:streamDetail.moreThisYear", { count: thisYearPeriods.length - 5 })}
            </button>
          ) : null}
          {showMoreThisYear && thisYearPeriods.length > 5 ? (
            <div className="flex w-full flex-wrap items-center gap-1 pl-2">
              {thisYearPeriods.slice(5).map((p) => {
                const isActive = activePath === p.relPath;
                return (
                  <button
                    key={p.relPath}
                    type="button"
                    onClick={() => handleSelectPeriod(p)}
                    data-filter-chip
                    data-filter-chip-active={isActive ? "true" : undefined}
                    className={cn(
                      "inline-flex h-(--control-h-chip) max-w-36 items-center truncate rounded-full px-2 text-3xs font-medium leading-none transition-colors",
                      isActive
                        ? "bg-accent-bg-subtle text-accent-color shadow-[inset_0_0_0_1px_var(--color-accent-border-subtle)]"
                        : "bg-surface-muted/35 text-text-tertiary hover:bg-surface-muted hover:text-text-secondary",
                    )}
                    title={p.title || p.fileName}
                  >
                    <span className="truncate">{p.title || p.fileName}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {/* Past years (expandable) */}
          {streamYears.length > 0 ? (
            <div className="flex w-full flex-wrap items-center gap-1 pt-0.5">
              <button
                type="button"
                onClick={() => setExpandedPastYear(expandedPastYear ? null : "list")}
                className="inline-flex h-(--control-h-chip) items-center gap-0.5 rounded-full px-2 text-3xs font-medium text-text-tertiary transition-colors hover:bg-surface-muted hover:text-text-secondary"
              >
                <RiArrowDownSLine
                  size={ICON.nano}
                  className={cn("transition-transform", expandedPastYear && "rotate-180")}
                />
                {t("workspace:streamDetail.pastYears")}
              </button>
              {expandedPastYear ? (
                <>
                  {streamYears.map((y) => {
                    const isExpanded = expandedPastYear === y.year;
                    return (
                      <div key={y.year} className="flex w-full flex-wrap items-center gap-1 pl-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (isExpanded) {
                              setExpandedPastYear("list");
                            } else {
                              setExpandedPastYear(y.year);
                              void loadPastYearPeriods(y.year);
                            }
                          }}
                          className={cn(
                            "inline-flex h-(--control-h-chip) items-center gap-1 rounded-full px-2 text-3xs font-medium transition-colors",
                            isExpanded
                              ? "bg-accent-bg-subtle text-accent-color"
                              : "text-text-tertiary hover:bg-surface-muted hover:text-text-secondary",
                          )}
                        >
                          <span>{y.year}</span>
                          <span className="text-text-quaternary">
                            ({t("workspace:streamDetail.yearPeriodCount", { count: y.periodCount })})
                          </span>
                        </button>
                        {isExpanded ? (
                          <>
                            {(pastYearPeriods[y.year] || []).map((p) => {
                              const isActive = activePath === p.relPath;
                              return (
                                <button
                                  key={p.relPath}
                                  type="button"
                                  onClick={() => handleSelectPeriod(p)}
                                  data-filter-chip
                                  data-filter-chip-active={isActive ? "true" : undefined}
                                  className={cn(
                                    "inline-flex h-(--control-h-chip) max-w-36 items-center truncate rounded-full px-2 text-3xs font-medium leading-none transition-colors",
                                    isActive
                                      ? "bg-accent-bg-subtle text-accent-color"
                                      : "bg-surface-muted/35 text-text-tertiary hover:bg-surface-muted hover:text-text-secondary",
                                  )}
                                  title={p.title || p.fileName}
                                >
                                  <span className="truncate">{p.title || p.fileName}</span>
                                </button>
                              );
                            })}
                            {!y.archived ? (
                              <button
                                type="button"
                                disabled={archivingYear === y.year}
                                onClick={() => void handleArchiveYear(y.year, y.periodCount)}
                                className="inline-flex h-(--control-h-chip) items-center gap-0.5 rounded-full px-2 text-3xs font-medium text-text-tertiary transition-colors hover:bg-warning/10 hover:text-warning"
                                title={t("workspace:streamDetail.archiveYear")}
                              >
                                {archivingYear === y.year ? (
                                  <RiLoader4Line size={ICON.micro} className="animate-spin" />
                                ) : (
                                  <RiInboxArchiveLine size={ICON.micro} />
                                )}
                                {t("workspace:streamDetail.archiveYear")}
                              </button>
                            ) : (
                              <span className="inline-flex h-(--control-h-chip) items-center gap-0.5 rounded-full px-2 text-3xs font-medium text-text-quaternary">
                                <RiInboxArchiveLine size={ICON.micro} />
                                {t("common:status.archived")}
                              </span>
                            )}
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {/* Back to current period — always available when viewing another period,
          even when there is only one period chip listed. */}
      {!isCurrentPeriod && ctx?.periodRelPath ? (
        <div className="mb-2">
          <button
            type="button"
            className="text-3xs text-accent-color hover:underline"
            onClick={handleBackToCurrent}
          >
            {t("workspace:streamDetail.backToCurrent")}
          </button>
        </div>
      ) : null}

      {/*
        建议入口：StatusBar 计数 chip → SuggestPopover 确认面。
        本视图不挂第二套建议列表。
      */}

      {/* Shared reading column: compose + layout toggle + posts (same --feed-column-max). */}
      <FeedColumn stream>
      {/* Inline composer — primary capture path: 润色 → 记下。
          无 label/hint meta 行（降噪 2026-08）：placeholder 承担引导，计数在 PageHeader subtitle。 */}
      {composeIsUrl ? (
        <div
          className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-accent-border-subtle/40 bg-accent-bg-faint/30 px-3 py-1.5 transition-all duration-200"
          data-stream-compose-url-hint
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <RiLink size={ICON.xs} className="shrink-0 text-accent-color" aria-hidden />
            <span className="min-w-0 truncate text-3xs font-medium text-text-secondary">
              {t("workspace:streamDetail.composeUrlHint")}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              emitLocal("overlay:open", { kind: "quick-capture", prefill: { source: composeText.trim() } } as never);
              updateComposeText("");
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-color/10 px-2.5 py-0.5 text-3xs font-medium text-accent-color transition-colors hover:bg-accent-color/20 v4-focus-ring"
          >
            <span>{t("workspace:streamDetail.composeUrlAction")}</span>
            <RiArrowRightSLine size={ICON.nano} aria-hidden />
          </button>
        </div>
      ) : null}
      <div
        className={cn(
          "v4-stream-composer mb-2.5 rounded-xl border border-border-subtle-dim/80",
          "bg-surface-elevated shadow-(--shadow-card) transition-all duration-200",
          "px-3.5 py-2.5",
        )}
        data-stream-inline-composer
      >
        <label className="sr-only" htmlFor="stream-inline-compose">
          {t("workspace:streamDetail.composePlaceholder")}
        </label>
        {ledgerEnabled && composerLooksLedger ? (
          <LedgerQuickEntry
            content={composeText}
            visible
            onSaved={() => updateComposeText("")}
          />
        ) : null}
        <textarea
          id="stream-inline-compose"
          ref={composeRef}
          rows={2}
          value={composeText}
          disabled={composing}
          placeholder={t("workspace:streamDetail.composePlaceholder")}
          onChange={(e) => updateComposeText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void handleInlineCompose();
            }
          }}
          className={cn(
            "w-full resize-none min-h-[48px] max-h-72 bg-transparent",
            "text-md leading-[1.62] text-text-primary placeholder:text-text-quaternary",
            "outline-none border-0 focus:ring-0 transition-[height] duration-75",
          )}
        />
        {polishing ? (
          <div
            className="mt-2 h-1 w-full overflow-hidden rounded-full bg-accent-bg-subtle v4-ai-shimmer-track"
            role="progressbar"
            data-stream-polish-busy
            aria-valuetext={t("workspace:streamDetail.composeAiPolish")}
          >
            <div className="h-full w-full v4-ai-progress-slide rounded-full bg-accent-color/30" />
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle-dim/70 pt-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {/* Tertiary: full capture lives in title bar「记一下」 */}
            <button
              type="button"
              onClick={handleCapture}
              className="text-3xs text-text-quaternary underline-offset-2 transition-colors hover:text-accent-color hover:underline v4-focus-ring rounded-sm"
            >
              {t("workspace:streamDetail.composeFullCapture")}
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            {polishBackup && polishBackup !== composeText ? (
              <Tooltip content={t("workspace:streamDetail.composeRevertOriginal")}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-3xs text-text-quaternary transition-colors hover:text-text-primary"
                  onClick={() => {
                    updateComposeText(polishBackup);
                    setPolishBackup(null);
                  }}
                  aria-label={t("workspace:streamDetail.revert")}
                >
                  <RiArrowGoBackLine size={ICON.xs} />
                  <span>{t("workspace:streamDetail.revert")}</span>
                </Button>
              </Tooltip>
            ) : null}
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
                  <RiLoader4Line size={ICON.xs} className="animate-spin" />
                ) : (
                  <RiSparklingLine size={ICON.xs} />
                )}
                {t("workspace:streamDetail.composeAiPolish")}
              </Button>
            </Tooltip>
            <Button
              type="button"
              size="sm"
              className="h-7 gap-1 font-medium transition-transform active:scale-[0.98]"
              disabled={composing || polishing || !composeText.trim()}
              onClick={() => void handleInlineCompose()}
              data-stream-compose-submit
            >
              {composing ? (
                <RiLoader4Line size={ICON.xs} className="animate-spin" />
              ) : (
                <RiSendPlane2Line size={ICON.xs} />
              )}
              {t("workspace:streamDetail.composeSubmit")}
              <kbd className="v4-kbd v4-kbd-sm ml-0.5 opacity-80">⌘↵</kbd>
            </Button>
          </div>
        </div>
      </div>

      <FeedChrome>
        <FeedLayoutToggle value={feedLayout} onChange={setFeedLayout} />
        <Tooltip content={t("workspace:streamDetail.openMemoryTip")}>
          <button
            type="button"
            data-stream-open-memory
            onClick={() => select({ kind: "memory" })}
            className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-3xs font-medium text-text-tertiary transition-colors hover:bg-surface-muted hover:text-accent-color v4-focus-ring"
            aria-label={t("workspace:streamDetail.openMemory")}
          >
            <RiUser3Line size={ICON.xs} aria-hidden />
            <span>{t("workspace:streamDetail.openMemory")}</span>
          </button>
        </Tooltip>
      </FeedChrome>

      {entries.length === 0 ? (
        <EmptyState
          icon={<RiCalendar2Line size={ICON.md} />}
          title={t("shell:sidebar.stream.emptyTitle")}
          hint={t("workspace:streamDetail.emptyComposerHint")}
          action={
            <Button
              size="sm"
              onClick={() => composeRef.current?.focus()}
            >
              <RiSendPlane2Line size={ICON.xs} /> {t("workspace:streamDetail.composeFocus")}
            </Button>
          }
        />
      ) : (
        <div
          className={cn("v4-feed", feedLayout === "card" ? "v4-feed-card" : "v4-feed-list")}
          data-stream-feed
          data-layout={feedLayout}
        >
          {dayGroups.map((group, gi) => {
            const dayCollapsed = collapsedDays.has(group.dayKey);
            const rows = groupDayFeedRows(group.entries);
            return (
              <section
                key={group.dayKey}
                className={cn(
                  gi === 0 && isCurrentPeriod && "ring-1 ring-inset ring-accent-color/10 rounded-lg",
                )}
                data-stream-day-group
                data-stream-day-today={isTodayGroupKey(group.dayKey) && isCurrentPeriod ? "true" : undefined}
              >
                <button
                  type="button"
                  onClick={() => toggleDayCollapsed(group.dayKey)}
                  className="flex w-full items-center gap-1.5 text-left hover:bg-surface-muted/35 v4-focus-ring"
                  aria-expanded={!dayCollapsed}
                  data-stream-day-toggle
                >
                  <RiArrowDownSLine
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
                  {isTodayGroupKey(group.dayKey) && isCurrentPeriod ? (
                    <span className="rounded-full bg-accent-bg-subtle px-1.5 py-px text-3xs font-medium text-accent-color">
                      {t("workspace:streamDetail.todayBadge")}
                    </span>
                  ) : null}
                  {dayCollapsed && rows[0]?.entry.preview ? (
                    <span className="hidden min-w-0 flex-1 truncate text-3xs text-text-quaternary sm:block">
                      {rows[0].entry.preview}
                    </span>
                  ) : null}
                </button>

                {!dayCollapsed ? (
                  <div data-stream-day-body>
                    {rows.map((row) => (
                      <StreamFeedRowView
                        key={`${group.dayKey}-${row.entry.index}`}
                        row={row}
                        isToday={isTodayGroupKey(group.dayKey) && isCurrentPeriod}
                        expanded={expandedIdx.has(row.entry.index)}
                        appendOpen={appendIdx === row.entry.index}
                        appendText={appendIdx === row.entry.index ? appendText : ""}
                        appending={appending}
                        activePath={activePath}
                        onToggleExpand={toggleExpand}
                        onOpenPeriod={handleOpenPeriod}
                        onToggleAppend={handleToggleAppend}
                        onAppendText={handleUpdateAppendText}
                        onAppendSubmit={handleAppendSubmit}
                        onAppendCancel={handleAppendCancel}
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
                <RiFileTextLine size={ICON.xs} />
                {t("shell:sidebar.stream.openFull")}
                <RiArrowRightSLine size={ICON.nano} />
              </Button>
            </div>
          ) : null}
        </div>
      )}
      </FeedColumn>

      <ConfirmDialog
        open={archiveConfirm !== null}
        title={t("workspace:streamDetail.archiveYear")}
        description={
          archiveConfirm
            ? t("workspace:streamDetail.archiveYearConfirm", {
                year: archiveConfirm.year,
                count: archiveConfirm.count,
              })
            : ""
        }
        confirmText={t("workspace:streamDetail.archiveYear")}
        destructive
        onCancel={() => setArchiveConfirm(null)}
        onConfirm={() => {
          const year = archiveConfirm?.year;
          setArchiveConfirm(null);
          if (year) void runArchiveYear(year);
        }}
      />

      {/* Floating Back to Top / Compose Button (Fitts's Law) */}
      {showBackToTop ? (
        <button
          type="button"
          onClick={() => {
            window.scrollTo({ top: 0, behavior: "smooth" });
            composeRef.current?.focus();
          }}
          className={cn(
            "fixed bottom-6 right-8 z-30 flex items-center gap-1.5 rounded-full px-3 py-1.5",
            "bg-surface-elevated/95 text-text-secondary shadow-lg backdrop-blur-md border border-border-subtle",
            "text-3xs font-medium transition-all hover:bg-accent-bg-subtle hover:text-accent-color hover:border-accent-border-subtle",
            "v4-focus-ring",
          )}
          aria-label={t("workspace:streamDetail.backToTop", { defaultValue: "回顶并记下" })}
        >
          <RiArrowUpLine size={ICON.xs} />
          <span>{t("workspace:streamDetail.backToTop", { defaultValue: "回顶并记下" })}</span>
        </button>
      ) : null}
    </ViewContainer>
  );
}
