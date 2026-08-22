/**
 * SuggestPopover — global 建议 confirm surface (header-centric).
 *
 * Not embedded in Stream body; not buried only in AI chat transcript.
 * Same ActionStore as ActionBar; open via openSuggestSurface / toggleSuggestSurface.
 * 个人清单 stays TodoPopover.
 *
 * UX principles (parity with TodoPopover):
 * - Outside click dismisses the panel (unpinned behavior).
 * - Outside scroll dismisses the panel (internal list scroll stays open).
 * - Esc closes the panel.
 * - Bulk actions: Accept All (sequential) + Dismiss All (suggestions only).
 * - Cards show concise info; details via hover tooltip.
 * - Paths shown as friendly breadcrumbs, not raw monospace strings.
 */
import { useEffect, useRef, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Sparkles,
  Loader2,
  RefreshCw,
  X,
  FileCheck2,
  Maximize2,
  Inbox,
  Archive,
  Brain,
  FileText,
  FolderClock,
  Lightbulb,
  Zap,
  ZapOff,
  CheckCheck,
  XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import { Tooltip } from "../ui/tooltip";
import { ConfirmDialog } from "../ui/Dialog";
import { shouldCloseOnScroll } from "../../lib/scroll-dismiss";
import { useActionStore, type ActionItem } from "../../stores/action-store";
import { suggestionApplyIsWrite, suggestionOpenPath } from "../../lib/suggest-apply-label";

const PANEL_WIDTH = 400;
const PANEL_MAX_HEIGHT = 560;

function SuggestionIcon({ kind, isHigh }: { kind?: string; isHigh: boolean }) {
  const cls = cn("shrink-0 mt-0.5", isHigh ? "text-warning" : "text-accent-color/70");
  switch (kind) {
    case "inbox_review":
    case "inbox_organize":
      return <Inbox size={ICON.nano} className={cls} />;
    case "stale_topic":
      return <Archive size={ICON.nano} className={cls} />;
    case "stream_digest":
    case "ai_summary":
      return <Brain size={ICON.nano} className={cls} />;
    case "promote_memory":
      return <Lightbulb size={ICON.nano} className={cls} />;
    case "create_topic":
    case "open_profile":
      return <FileText size={ICON.nano} className={cls} />;
    case "catch_all":
      return <FolderClock size={ICON.nano} className={cls} />;
    default:
      return <Sparkles size={ICON.nano} className={cls} />;
  }
}

function kindChipKey(kind?: string, source?: ActionItem["source"]): string | null {
  if (source === "pending_write") return "kindChipPending";
  switch (kind) {
    case "create_topic":
      return "kindChipTopic";
    case "promote_memory":
    case "open_profile":
      return "kindChipProfile";
    case "stream_digest":
    case "ai_summary":
      return "kindChipDigest";
    case "inbox_review":
      return "kindChipInbox";
    case "inbox_organize":
      return "kindChipInboxOrganize";
    case "stale_topic":
    case "catch_all":
      return "kindChipArchive";
    default:
      return kind ? "kindChipSuggest" : null;
  }
}

/** Convert a raw workspace-relative path to a friendly breadcrumb. */
function friendlyPath(rawPath?: string): string | null {
  if (!rawPath) return null;
  const parts = rawPath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 1) return parts[0] || rawPath;
  // Show last 2-3 segments with ellipsis
  const last = parts.slice(-2).join(" / ");
  return parts.length > 2 ? `… / ${last}` : last;
}

/** Floating confirm panel — the primary 建议 surface. */
export function SuggestPopover() {
  const { t } = useTranslation("editor");
  const open = useActionStore((s) => s.panelOpen);
  const setPanelOpen = useActionStore((s) => s.setPanelOpen);
  const items = useActionStore((s) => s.items);
  const loading = useActionStore((s) => s.loading);
  const message = useActionStore((s) => s.message);
  const busyId = useActionStore((s) => s.busyId);
  const autoPrepare = useActionStore((s) => s.autoPrepare);
  const refresh = useActionStore((s) => s.refresh);
  const acceptItem = useActionStore((s) => s.acceptItem);
  const openItem = useActionStore((s) => s.openItem);
  const rejectItem = useActionStore((s) => s.rejectItem);
  const dismissItem = useActionStore((s) => s.dismissItem);
  const clearDismissed = useActionStore((s) => s.clearDismissed);
  const toggleAutoPrepare = useActionStore((s) => s.toggleAutoPrepare);
  const acceptAll = useActionStore((s) => s.acceptAll);
  const dismissAll = useActionStore((s) => s.dismissAll);

  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  // Position immediately when opening — avoid a null first paint (looks like no-op)
  useEffect(() => {
    if (open) {
      setPos((prev) => prev ?? { x: Math.max(8, window.innerWidth - PANEL_WIDTH - 16), y: 52 });
    } else {
      setPos(null);
      setBulkResult(null);
    }
  }, [open]);

  // Ensure data when panel is shown — but only if never loaded or truly empty.
  // openSuggestSurface already handles force-refresh on open; this is a safety net
  // for cases where openSuggestSurface was not the entry path (e.g. titlebar toggle).
  useEffect(() => {
    if (!open) return;
    const st = useActionStore.getState();
    if (!st.everLoaded) {
      void st.refresh({ force: true });
    }
  }, [open]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanelOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setPanelOpen]);

  // Outside click dismisses the panel — parity with TodoPopover (unpinned mode).
  // The TitleBar Lightbulb trigger and StatusBar count chip handle their own
  // click events via stopPropagation in their wrappers, so this listener won't
  // fire for those trigger elements (they call toggleSuggestSurface which
  // closes before this can fire). For other elements (editor, sidebar, etc.)
  // the panel dismisses naturally.
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      const target = e.target as Node;
      // Click inside the panel → keep open
      if (panelRef.current?.contains(target)) return;
      // Click on header triggers (Lightbulb / StatusBar count chip) → let their
      // own onClick handle the toggle (they call toggleSuggestSurface).
      // Check data attributes to avoid double-toggle race.
      const triggerEl = (target as Element)?.closest?.("[data-suggest-header-trigger], [data-status-suggest-count]");
      if (triggerEl) return;
      // Any other outside click → dismiss
      setPanelOpen(false);
    };
    // Use mousedown so we dismiss before button onClick fires (avoids flicker)
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open, setPanelOpen]);

  // Outside scroll dismisses — internal list scroll stays open (parity with TodoPopover)
  useEffect(() => {
    if (!open) return;
    const handle = (e: Event) => {
      if (!shouldCloseOnScroll(e, panelRef.current)) return;
      setPanelOpen(false);
    };
    window.addEventListener("scroll", handle, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", handle, { capture: true });
  }, [open, setPanelOpen]);

  // Auto-clear bulk result message after 3s
  useEffect(() => {
    if (!bulkResult) return;
    const timer = setTimeout(() => setBulkResult(null), 3000);
    return () => clearTimeout(timer);
  }, [bulkResult]);

  // Group items: high priority first, then pending writes, then medium/low
  // Must be called before any conditional return (React Hooks rules)
  const grouped = useMemo(() => {
    const high = items.filter((i) => i.priority === "high" || i.source === "pending_write");
    const normal = items.filter((i) => i.priority !== "high" && i.source !== "pending_write");
    return { high, normal };
  }, [items]);

  if (!open || !pos) return null;

  const hasHigh = items.some((i) => i.priority === "high");
  const reviewItem = items.find((i) => i.id === reviewId) || null;
  const canAcceptAll = items.length > 0 && !bulkBusy && busyId === null;
  const canDismissAll = items.some((i) => i.source === "suggestion") && !bulkBusy && busyId === null;

  const handleAcceptAll = async () => {
    setBulkBusy(true);
    setBulkResult(null);
    try {
      const { accepted, failed, summary } = await acceptAll();
      if (accepted > 0 && failed === 0) {
        const detail = summary ? ` · ${summary}` : "";
        setBulkResult(t("ai.bulkAcceptDone", { count: accepted, defaultValue: `All accepted (${accepted})` }) + detail);
      } else if (accepted > 0 && failed > 0) {
        const detail = summary ? ` · ${summary}` : "";
        setBulkResult(t("ai.bulkAcceptPartial", { accepted, failed, defaultValue: `Accepted ${accepted} · ${failed} failed` }) + detail);
      } else if (failed > 0) {
        setBulkResult(t("ai.bulkAcceptFailed", { count: failed, defaultValue: `${failed} failed` }));
      }
    } catch {
      setBulkResult(t("ai.bulkAcceptError", { defaultValue: "Bulk action error" }));
    } finally {
      setBulkBusy(false);
    }
  };

  const handleDismissAll = () => {
    dismissAll();
    setBulkResult(t("ai.bulkDismissDone", { defaultValue: "All suggestions dismissed" }));
  };

  const renderItem = (item: ActionItem) => {
    const isPendingWrite = item.source === "pending_write";
    const isHigh = item.priority === "high";
    const isBusy = busyId === item.id;
    const chip = kindChipKey(item.suggestionKind, item.source);
    const fPath = friendlyPath(item.targetPath);
    return (
      <li
        key={item.id}
        className={cn(
          "rounded-md p-2.5 flex flex-col gap-0.5 transition-colors",
          isPendingWrite || isHigh
            ? "bg-warning/5 ring-1 ring-inset ring-warning/15"
            : "bg-surface-muted/25 hover:bg-surface-muted/40",
        )}
      >
        <div className="flex items-start gap-1.5">
          {isPendingWrite ? (
            <FileCheck2 size={ICON.nano} className="mt-0.5 shrink-0 text-warning" />
          ) : (
            <SuggestionIcon kind={item.suggestionKind} isHigh={isHigh} />
          )}
          <div className="min-w-0 flex-1 text-3xs font-medium text-text-primary leading-tight">
            {item.title}
          </div>
          {chip ? (
            <Tooltip content={t(`ai.${chip}`)}>
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 py-px text-5xs font-medium cursor-default",
                  isHigh ? "bg-warning/10 text-warning" : "bg-accent-bg-subtle text-accent-color/90",
                )}
              >
                {t(`ai.${chip}`)}
              </span>
            </Tooltip>
          ) : null}
        </div>
        {/* Summary: 2 lines max, with tooltip for full text */}
        <Tooltip
          content={item.summary}
          disabled={!item.summary || item.summary.length < 80}
          side="bottom"
        >
          <div className="line-clamp-2 pl-4.5 text-3xs text-text-tertiary leading-snug">
            {item.summary}
          </div>
        </Tooltip>
        {fPath ? (
          <Tooltip content={item.targetPath} side="bottom">
            <div className="truncate pl-4.5 text-3xs text-text-quaternary/80">
              {fPath}
            </div>
          </Tooltip>
        ) : null}
        <div className="flex gap-2 pl-4.5 pt-1">
          {isPendingWrite ? (
            <>
              <button
                type="button"
                className="inline-flex items-center gap-0.5 text-3xs font-medium text-accent-color hover:text-accent-color/80"
                onClick={() => setReviewId(item.id)}
                disabled={isBusy}
              >
                <Maximize2 size={ICON.nano} />
                {t("ai.pendingReview")}
              </button>
              <button
                type="button"
                className="text-3xs font-medium text-accent-color hover:text-accent-color/80"
                onClick={() => void acceptItem(item.id)}
                disabled={isBusy}
              >
                {isBusy ? <Loader2 size={ICON.micro} className="animate-spin" /> : null}
                {t("ai.pendingAccept")}
              </button>
              <button
                type="button"
                className="text-3xs text-text-quaternary hover:text-error"
                onClick={() => void rejectItem(item.id)}
                disabled={isBusy}
              >
                {t("ai.pendingReject")}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="text-3xs font-medium text-accent-color hover:text-accent-color/80"
                onClick={() => void acceptItem(item.id)}
                disabled={busyId !== null || bulkBusy}
              >
                {isBusy ? <Loader2 size={ICON.micro} className="animate-spin" /> : null}
                {suggestionApplyIsWrite(item.suggestionKind, item.source)
                  ? t("ai.suggestConfirm")
                  : t("ai.suggestOpen")}
              </button>
              {suggestionApplyIsWrite(item.suggestionKind, item.source) && suggestionOpenPath(item) ? (
                <button
                  type="button"
                  className="text-3xs text-text-tertiary hover:text-text-secondary"
                  onClick={() => openItem(item.id)}
                  disabled={busyId !== null || bulkBusy}
                >
                  {t("ai.suggestOpen")}
                </button>
              ) : null}
              <button
                type="button"
                className="text-3xs text-text-quaternary hover:text-text-tertiary"
                onClick={() => dismissItem(item.id)}
                disabled={busyId !== null || bulkBusy}
              >
                {t("ai.suggestIgnore")}
              </button>
            </>
          )}
        </div>
      </li>
    );
  };

  const panel = (
    <div
      ref={panelRef}
      data-suggest-popover
      data-action-bar
      data-menu-surface=""
      className={cn(
        "v4-no-drag v4-todo-popover-enter fixed z-(--z-popover-overlay) flex flex-col overflow-hidden",
        "rounded-lg border border-border-subtle",
        "bg-surface-elevated/90 backdrop-blur-glass backdrop-saturate-150 shadow-elevated-hairline",
      )}
      style={{
        left: pos.x,
        top: pos.y,
        width: PANEL_WIDTH,
        maxHeight: PANEL_MAX_HEIGHT,
      }}
      role="dialog"
      aria-label={t("ai.suggestTitle")}
    >
      {/* Header: title + count + bulk actions + controls */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border-subtle-dim px-3 py-2">
        <Sparkles
          size={ICON.xs}
          className={cn(hasHigh ? "text-warning" : "text-accent-color", bulkBusy && "animate-pulse")}
          aria-hidden
        />
        <span
          className={cn(
            "min-w-0 flex-1 text-3xs font-semibold",
            hasHigh ? "text-warning" : "text-text-primary",
          )}
        >
          {t("ai.suggestTitle")}
          {items.length > 0 ? ` · ${t("ai.actionBarCount", { count: items.length })}` : ""}
        </span>

        {/* Bulk actions — compact icon buttons */}
        {canAcceptAll ? (
          <Tooltip content={t("ai.bulkAcceptTip", { defaultValue: "Accept all" })}>
            <button
              type="button"
              className={cn(
                "flex h-6 items-center gap-0.5 rounded-sm px-1.5",
                "text-accent-color hover:bg-accent-bg-subtle transition-colors",
              )}
              onClick={() => void handleAcceptAll()}
              aria-label={t("ai.bulkAcceptTip", { defaultValue: "Accept all" })}
            >
              <CheckCheck size={ICON.nano} />
              <span className="text-5xs font-medium">
                {t("ai.bulkAccept", { defaultValue: "All" })}
              </span>
            </button>
          </Tooltip>
        ) : null}
        {canDismissAll ? (
          <Tooltip content={t("ai.bulkDismissTip", { defaultValue: "Dismiss all" })}>
            <button
              type="button"
              className={cn(
                "flex h-6 items-center gap-0.5 rounded-sm px-1.5",
                "text-text-quaternary hover:bg-surface-muted hover:text-text-tertiary transition-colors",
              )}
              onClick={handleDismissAll}
              aria-label={t("ai.bulkDismissTip", { defaultValue: "Dismiss all" })}
            >
              <XCircle size={ICON.nano} />
            </button>
          </Tooltip>
        ) : null}

        <Tooltip content={autoPrepare ? t("ai.suggestToggleOff") : t("ai.suggestToggleOn")}>
          <button
            type="button"
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-sm",
              autoPrepare ? "v4-ai-chip-gradient" : "text-text-quaternary hover:bg-surface-muted",
            )}
            onClick={() => void toggleAutoPrepare()}
            aria-pressed={autoPrepare}
          >
            {autoPrepare ? <Zap size={ICON.nano} /> : <ZapOff size={ICON.nano} />}
          </button>
        </Tooltip>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded-sm text-text-tertiary hover:bg-surface-muted"
          onClick={() => {
            clearDismissed();
            void refresh({ force: true });
          }}
          disabled={loading}
          aria-label={t("ai.suggestRefresh")}
        >
          {loading ? (
            <Loader2 size={ICON.nano} className="animate-spin" />
          ) : (
            <RefreshCw size={ICON.nano} />
          )}
        </button>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded-sm text-text-tertiary hover:bg-surface-muted"
          onClick={() => setPanelOpen(false)}
          aria-label={t("ai.pendingCollapse")}
        >
          <X size={ICON.nano} />
        </button>
      </div>

      {/* Bulk result / message feedback */}
      {bulkResult ? (
        <p className="shrink-0 px-3 py-1 text-3xs text-accent-color bg-accent-bg-faint/40">{bulkResult}</p>
      ) : message ? (
        <p className="shrink-0 px-3 py-1 text-3xs text-text-tertiary">{message}</p>
      ) : null}

      {/* Body: suggestion list */}
      <div
        className="v4-sidebar-scroll min-h-0 flex-1 overflow-auto p-2"
        data-scroll-stable-panel=""
        data-suggest-scroll-body=""
      >
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            {loading ? (
              <>
                <Loader2 size={ICON.sm} className="animate-spin text-accent-color/60" />
                <p className="text-3xs text-text-quaternary">{t("ai.suggestLoading")}</p>
              </>
            ) : (
              <>
                <Sparkles size={ICON.sm} className="text-text-quaternary/40" />
                <p className="text-3xs text-text-quaternary">{t("ai.suggestEmpty")}</p>
                {!autoPrepare ? (
                  <button
                    type="button"
                    className="mt-1 inline-flex items-center gap-1 rounded-sm bg-accent-bg-subtle px-2 py-1 text-3xs font-medium text-accent-color hover:bg-accent-bg-faint transition-colors"
                    onClick={() => void toggleAutoPrepare()}
                  >
                    <Zap size={ICON.nano} />
                    {t("ai.suggestToggleOn")}
                  </button>
                ) : null}
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {/* High priority / pending writes group */}
            {grouped.high.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {grouped.high.map(renderItem)}
              </ul>
            ) : null}
            {/* Normal priority group with subtle separator */}
            {grouped.normal.length > 0 && grouped.high.length > 0 ? (
              <div className="flex items-center gap-1.5 px-1 pt-0.5">
                <span className="h-px flex-1 bg-border-subtle-dim" />
                <span className="text-5xs text-text-quaternary/60">{t("ai.suggestOther", { defaultValue: "Others" })}</span>
                <span className="h-px flex-1 bg-border-subtle-dim" />
              </div>
            ) : null}
            {grouped.normal.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {grouped.normal.map(renderItem)}
              </ul>
            ) : null}
          </div>
        )}
      </div>

      {/* Footer hint when items exist */}
      {items.length > 0 ? (
        <div className="shrink-0 border-t border-border-subtle-dim px-3 py-1 text-5xs text-text-quaternary/60">
          {t("ai.suggestFooterHint", { defaultValue: "Accept to write · Dismiss hides for this session" })}
        </div>
      ) : null}

      {reviewItem && reviewItem.source === "pending_write" ? (
        <ConfirmDialog
          open
          title={t("ai.pendingReviewTitle")}
          description={reviewItem.targetPath || reviewItem.title}
          confirmText={t("ai.pendingAccept")}
          cancelText={t("ai.pendingReviewClose")}
          panelClassName="!max-w-2xl"
          onConfirm={() => {
            void acceptItem(reviewItem.id);
            setReviewId(null);
          }}
          onCancel={() => setReviewId(null)}
        >
          <pre className="mb-2 max-h-[min(50vh,360px)] overflow-auto whitespace-pre-wrap wrap-break-word rounded-md border border-border-subtle-dim bg-surface-muted/40 p-2.5 text-3xs leading-relaxed text-text-secondary">
            {reviewItem.writeContent || reviewItem.summary}
          </pre>
        </ConfirmDialog>
      ) : null}
    </div>
  );

  return createPortal(panel, document.body);
}
