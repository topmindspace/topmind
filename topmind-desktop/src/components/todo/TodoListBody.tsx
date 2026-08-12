/**
 * TodoListBody — shared todo list rendering for TodoPopover.
 *
 * Design principles:
 * - Apple Reminders / Microsoft To Do style: inline add, click to edit, checkbox to toggle
 * - Compact, not heavy project management
 * - Due dates shown as chips; overdue = warning tone; clickable to set/change
 * - AI source items marked with ✨ (gradient chip)
 * - Completed items collapsible + clearable
 * - Stale items (30+ days) get warning indicator
 * - Health stats shown when relevant (overdue, stale, old completed)
 */
import { useState, useRef, useEffect, useCallback } from "react";
import {
  Check, Plus, Trash2, Sparkles, Loader2, AlertCircle,
  ChevronDown, ChevronRight, Pencil, X, CornerDownLeft,
  CalendarClock, Clock, AlertTriangle, RefreshCw, ExternalLink,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import { useTodoStore } from "../../stores/todo-store";
import { useViewStore } from "../../stores/view-store";
import type { TodoItem } from "../../types";

export function TodoListBody() {
  const { t } = useTranslation("shell");
  const items = useTodoStore((s) => s.items);
  const loading = useTodoStore((s) => s.loading);
  const maintaining = useTodoStore((s) => s.maintaining);
  const maintainMessage = useTodoStore((s) => s.maintainMessage);
  const maintainReason = useTodoStore((s) => s.maintainReason);
  const health = useTodoStore((s) => s.health);
  const add = useTodoStore((s) => s.add);
  const toggle = useTodoStore((s) => s.toggle);
  const clearCompleted = useTodoStore((s) => s.clearCompleted);
  const cleanupStale = useTodoStore((s) => s.cleanupStale);
  const archiveStale = useTodoStore((s) => s.archiveStale);

  const [newItemText, setNewItemText] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showHealthHint, setShowHealthHint] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeItems = items.filter((i) => !i.done);
  const completedItems = items.filter((i) => i.done);
  const aiCount = activeItems.filter((i) => i.source === "ai").length;
  const overdueCount = activeItems.filter((i) => {
    const today = new Date().toISOString().slice(0, 10);
    return i.dueDate && i.dueDate < today;
  }).length;
  const staleCount = activeItems.filter((i) => {
    if (!i.createdAt) return false;
    const today = new Date().toISOString().slice(0, 10);
    const days = Math.round((new Date(today).getTime() - new Date(i.createdAt).getTime()) / 86400000);
    return days > 30;
  }).length;

  const handleAdd = useCallback(async () => {
    const text = newItemText.trim();
    if (!text) return;
    setAdding(true);
    const ok = await add(text);
    if (ok) {
      setNewItemText("");
      inputRef.current?.focus();
    }
    setAdding(false);
  }, [newItemText, add]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleAdd();
    } else if (e.key === "Escape") {
      setNewItemText("");
      inputRef.current?.blur();
    }
  };

  return (
    <div className="flex flex-col">
      {/* AI maintain feedback */}
      {maintainMessage && maintaining !== "maintaining" ? (
        <div
          className={cn(
            "mb-1.5 rounded-md px-2 py-1 text-3xs",
            maintaining === "error"
              ? "bg-status-error-bg text-error"
              : "bg-accent-bg-subtle text-accent-color",
          )}
        >
          <div className="flex items-center gap-1">
            {maintaining === "error" ? (
              <AlertCircle size={ICON.nano} className="shrink-0" />
            ) : (
              <Sparkles size={ICON.nano} className="shrink-0" />
            )}
            <span className="flex-1">{maintainMessage}</span>
            <button
              type="button"
              onClick={() => useTodoStore.setState({ maintainMessage: null })}
              aria-label={t("todo.close")}
              className="text-text-quaternary hover:text-text-secondary"
            >
              <X size={ICON.nano} />
            </button>
            {/* Force retry button for already-processed case */}
            {maintaining === "done" && maintainReason === "all-periods-processed" && (
              <button
                type="button"
                onClick={() => {
                  useTodoStore.setState({ maintainMessage: null, maintainReason: null });
                  void useTodoStore.getState().maintain({ force: true });
                }}
                className="flex items-center gap-0.5 text-text-tertiary hover:text-accent-color ml-1"
                title={t("todo.maintainForceTip")}
              >
                <RefreshCw size={ICON.nano} />
                {t("todo.maintainForceRetry")}
              </button>
            )}
          </div>
        </div>
      ) : null}

      {/* Health hint: stale / overdue warnings */}
      {(staleCount > 0 || overdueCount > 0) && showHealthHint ? (
        <div className="mb-1.5 rounded-md border border-warning/20 bg-warning/5 px-2 py-1 text-3xs text-warning">
          <div className="flex items-center gap-1">
            <AlertTriangle size={ICON.nano} className="shrink-0" />
            <span className="flex-1">
              {overdueCount > 0 ? t("todo.healthOverdue", { count: overdueCount }) : ""}
              {overdueCount > 0 && staleCount > 0 ? " · " : ""}
              {staleCount > 0 ? t("todo.healthStale", { count: staleCount }) : ""}
            </span>
            {(health?.oldCompleted ?? 0) > 0 ? (
              <button
                type="button"
                onClick={() => void cleanupStale()}
                className="underline hover:no-underline"
              >
                {t("todo.cleanupStale")}
              </button>
            ) : null}
            {staleCount > 0 ? (
              <button
                type="button"
                onClick={() => void archiveStale()}
                className="underline hover:no-underline"
              >
                {t("todo.archiveStale")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setShowHealthHint(false)}
              aria-label={t("todo.close")}
              className="text-text-quaternary hover:text-text-secondary"
            >
              <X size={ICON.nano} />
            </button>
          </div>
        </div>
      ) : null}

      {/* Inline add — Apple Reminders style */}
      <div className="mb-1.5">
        <div className="flex items-center gap-1.5 rounded-md border border-border-subtle-dim bg-surface/50 px-2 py-1.5 focus-within:border-accent-border-subtle">
          <Plus size={ICON.nano} className="shrink-0 text-text-quaternary" />
          <input
            ref={inputRef}
            type="text"
            value={newItemText}
            onChange={(e) => setNewItemText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("todo.addPlaceholder")}
            disabled={adding}
            className="min-w-0 flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-quaternary focus:outline-none"
          />
          {newItemText.trim() ? (
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={adding}
              className="flex h-4 w-4 items-center justify-center text-accent-color disabled:opacity-40"
            >
              {adding ? (
                <Loader2 size={ICON.nano} className="animate-spin" />
              ) : (
                <CornerDownLeft size={ICON.nano} />
              )}
            </button>
          ) : null}
        </div>
      </div>

      {/* Active items */}
      {loading && items.length === 0 ? (
        <div className="flex items-center gap-1.5 px-1 py-2 text-3xs text-text-tertiary">
          <Loader2 size={ICON.micro} className="animate-spin" />
          {t("todo.loading")}
        </div>
      ) : activeItems.length === 0 && completedItems.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-4 text-center">
          <span className="text-3xs text-text-tertiary">{t("todo.empty")}</span>
          <span className="px-3 text-3xs leading-relaxed text-text-quaternary">
            {t("todo.emptyHint")}
          </span>
        </div>
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {activeItems.map((item) => (
              <TodoItemRow
                key={item.id}
                item={item}
                onToggle={() => void toggle(item.id)}
              />
            ))}
          </ul>

          {/* Completed section */}
          {completedItems.length > 0 ? (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowCompleted((v) => !v)}
                className="flex w-full items-center gap-1 px-1 py-0.5 text-3xs text-text-quaternary transition-colors hover:text-text-tertiary"
              >
                {showCompleted ? (
                  <ChevronDown size={ICON.nano} />
                ) : (
                  <ChevronRight size={ICON.nano} />
                )}
                <span>
                  {t("todo.completed", { count: completedItems.length })}
                </span>
              </button>
              {showCompleted ? (
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0 pt-0.5">
                  {completedItems.map((item) => (
                    <TodoItemRow
                      key={item.id}
                      item={item}
                      onToggle={() => void toggle(item.id)}
                    />
                  ))}
                  <li className="px-1 py-0.5">
                    <button
                      type="button"
                      onClick={() => void clearCompleted()}
                      className="text-3xs text-text-quaternary transition-colors hover:text-error"
                    >
                      {t("todo.clearCompleted")}
                    </button>
                  </li>
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {/* Footer: AI hint + health toggle */}
      <div className="mt-1.5 flex items-center gap-2 border-t border-border-subtle-dim pt-1 text-3xs text-text-quaternary">
        {aiCount > 0 ? (
          <span className="inline-flex items-center gap-0.5">
            <Sparkles size={ICON.nano} className="text-accent-color/60" />
            {t("todo.aiHint", { count: aiCount })}
          </span>
        ) : null}
        {(staleCount > 0 || overdueCount > 0) && !showHealthHint ? (
          <button
            type="button"
            onClick={() => setShowHealthHint(true)}
            className="ml-auto inline-flex items-center gap-0.5 text-warning/70 hover:text-warning"
          >
            <AlertTriangle size={ICON.nano} />
            {overdueCount > 0 ? t("todo.healthOverdue", { count: overdueCount }) : t("todo.healthStale", { count: staleCount })}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Format due date for display with relative text. */
function formatDueDate(dueDate: string, t: (key: string, opts?: Record<string, unknown>) => string): { text: string; overdue: boolean; cls: string } {
  const today = new Date().toISOString().slice(0, 10);
  const overdue = dueDate < today;
  const d = new Date(dueDate + "T00:00:00");
  const todayDate = new Date(today + "T00:00:00");
  const diffDays = Math.round((d.getTime() - todayDate.getTime()) / 86400000);

  let text: string;
  if (diffDays === 0) text = t("todo.dueToday");
  else if (diffDays === 1) text = t("todo.dueTomorrow");
  else if (diffDays === -1) text = t("todo.dueYesterday");
  else if (diffDays > 0) text = t("todo.dueInDays", { count: diffDays });
  else text = t("todo.dueDaysAgo", { count: -diffDays });

  return {
    text,
    overdue,
    cls: overdue
      ? "bg-status-error-bg text-error"
      : "bg-surface-muted text-text-quaternary",
  };
}

/** Check staleness level: 0 fresh, 1 warning (8-14d), 2 urgent (15-30d), 3 stale (30+d). */
function staleLevel(item: TodoItem): number {
  if (!item.createdAt || item.done) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const days = Math.round((new Date(today).getTime() - new Date(item.createdAt).getTime()) / 86400000);
  if (days > 30) return 3;
  if (days > 14) return 2;
  if (days > 7) return 1;
  return 0;
}

function TodoItemRow({
  item,
  onToggle,
}: {
  item: TodoItem;
  onToggle: () => void;
}) {
  const { t } = useTranslation("shell");
  const remove = useTodoStore((s) => s.remove);
  const update = useTodoStore((s) => s.update);
  const setDueDate = useTodoStore((s) => s.setDueDate);
  const select = useViewStore((s) => s.select);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(item.text);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const editRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);

  // Sync editText when item.text changes externally (e.g. AI maintenance)
  useEffect(() => {
    if (!editing) setEditText(item.text);
  }, [item.text, editing]);

  const handleEdit = async () => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== item.text) {
      await update(item.id, trimmed);
    } else {
      setEditText(item.text);
    }
    setEditing(false);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleEdit();
    } else if (e.key === "Escape") {
      setEditText(item.text);
      setEditing(false);
    }
  };

  const handleDateChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value || null;
    await setDueDate(item.id, val);
    setShowDatePicker(false);
  };

  const isAi = item.source === "ai";
  const sLevel = staleLevel(item);
  const dueInfo = item.dueDate ? formatDueDate(item.dueDate, t) : null;

  return (
    <li className="group flex items-start gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-surface-muted/40">
      {/* Checkbox */}
      <button
        type="button"
        role="checkbox"
        aria-checked={item.done}
        onClick={onToggle}
        className={cn(
          "mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-colors",
          item.done
            ? "border-accent-color bg-accent-color text-text-on-accent"
            : "border-border-subtle hover:border-accent-color/50",
        )}
        aria-label={item.done ? t("todo.uncheck") : t("todo.check")}
      >
        {item.done ? <Check size={ICON.nano} strokeWidth={3} /> : null}
      </button>

      {/* Content */}
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            ref={editRef}
            type="text"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={handleEditKeyDown}
            onBlur={() => void handleEdit()}
            className="w-full bg-transparent text-xs text-text-primary focus:outline-none"
          />
        ) : (
          <div
            className={cn(
              "wrap-break-word text-xs leading-relaxed",
              item.done
                ? "text-text-quaternary line-through opacity-60"
                : "text-text-primary",
            )}
            onDoubleClick={() => setEditing(true)}
          >
            {isAi ? (
              <Sparkles
                size={ICON.nano}
                className="mr-0.5 inline shrink-0 text-accent-color/60"
              />
            ) : null}
            {sLevel > 0 && !item.done ? (
              <Clock
                size={ICON.nano}
                className={cn(
                  "mr-0.5 inline shrink-0",
                  sLevel === 1 && "text-warning/50",
                  sLevel === 2 && "text-warning/70",
                  sLevel === 3 && "text-error/70",
                )}
              />
            ) : null}
            {item.text}
            {dueInfo ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDatePicker((v) => !v);
                }}
                className={cn(
                  "ml-1.5 inline-flex items-center gap-0.5 rounded-full px-1 py-0 text-3xs transition-colors hover:opacity-80",
                  dueInfo.cls,
                )}
              >
                <CalendarClock size={ICON.nano} className="shrink-0" />
                {dueInfo.text}
              </button>
            ) : null}
            {showDatePicker ? (
              <div className="absolute z-10 mt-1 rounded-md border border-border-subtle bg-surface-elevated p-1.5 shadow-elevated-hairline">
                <input
                  ref={dateRef}
                  type="date"
                  value={item.dueDate || ""}
                  onChange={(e) => void handleDateChange(e)}
                  onBlur={() => setShowDatePicker(false)}
                  className="text-3xs text-text-primary bg-transparent focus:outline-none"
                  autoFocus
                />
                {item.dueDate ? (
                  <button
                    type="button"
                    onClick={() => {
                      void setDueDate(item.id, null);
                      setShowDatePicker(false);
                    }}
                    className="mt-1 block text-3xs text-text-quaternary hover:text-error"
                  >
                    {t("todo.clearDueDate")}
                  </button>
                ) : null}
              </div>
            ) : null}
            {isAi && item.sourcePeriod ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  // Navigate to the stream period note where this todo was extracted from
                  select({ kind: "file", path: `10-动态/${item.sourcePeriod}.md` });
                }}
                className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-accent-bg-subtle px-1 py-0 text-3xs text-accent-color/70 transition-colors hover:bg-accent-bg-faint hover:text-accent-color"
                title={t("todo.openSource", { defaultValue: "Open source note" })}
              >
                <ExternalLink size={ICON.nano} className="shrink-0" />
                {item.sourcePeriod}
              </button>
            ) : null}
          </div>
        )}
      </div>

      {/* Hover actions */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto">
        {!item.done ? (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex h-4 w-4 items-center justify-center rounded-xs text-text-quaternary transition-colors hover:bg-surface-muted hover:text-text-secondary"
              aria-label={t("todo.edit")}
            >
              <Pencil size={ICON.nano} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowDatePicker((v) => !v);
              }}
              className="flex h-4 w-4 items-center justify-center rounded-xs text-text-quaternary transition-colors hover:bg-surface-muted hover:text-accent-color"
              aria-label={t("todo.setDueDate")}
            >
              <CalendarClock size={ICON.nano} />
            </button>
          </>
        ) : null}
        <button
          type="button"
          onClick={() => void remove(item.id)}
          className="flex h-4 w-4 items-center justify-center rounded-xs text-text-quaternary transition-colors hover:bg-surface-muted hover:text-error"
          aria-label={t("todo.delete")}
        >
          <Trash2 size={ICON.nano} />
        </button>
      </div>
    </li>
  );
}
