import { useState, useMemo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Search, CornerDownLeft, Compass, Sparkles, Command as CommandIcon, Zap, Inbox } from "lucide-react";
import { registry } from "../../plugins/registry";
import { useViewStore } from "../../stores/view-store";
import { makeMinCtx } from "../../plugins/min-ctx";
import type { ActionSlot } from "../../plugins/types";
import type { Selection } from "../../types";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";

/** Group presentation: display order + localized label + icon. */
const GROUP_ORDER = ["skill", "goto", "navigate", "capture"];
const GROUP_KEY_MAP: Record<string, string> = {
  goto: "overlays:command.groupGoto",
  skill: "overlays:command.groupSkill",
  navigate: "overlays:command.groupNavigate",
  capture: "overlays:command.groupCapture",
};
const GROUP_ICON: Record<string, LucideIcon> = {
  goto: Compass,
  skill: Sparkles,
  navigate: CommandIcon,
  capture: Zap,
};

/** Subsequence fuzzy score. */
function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  let qi = 0;
  let streak = 0;
  let score = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      streak++;
      score += 1 + streak;
    } else {
      streak = 0;
    }
  }
  if (qi < q.length) return -1;
  if (t.startsWith(q)) score += 12;
  else if (t.includes(q)) score += 6;
  return score;
}

/** Context boost: rank skills/actions that match the current selection higher. */
function contextBoost(action: ActionSlot, selection: Selection): number {
  const id = action.id;
  const group = action.group ?? "";
  let boost = 0;

  if (selection.kind === "topic" || (selection.kind === "file" && selection.topicId)) {
    if (id.includes("write") || id.includes("memory") || id.includes("organize")) boost += 40;
    if (id.includes("capture")) boost += 10;
  }
  if (selection.kind === "inbox") {
    if (id.includes("capture") || id.includes("organize") || id.includes("inbox")) boost += 40;
    if (group === "skill") boost += 8;
  }
  if (selection.kind === "category" || selection.kind === "stream") {
    if (id.includes("capture") || id.includes("loop") || id.includes("stream")) boost += 30;
  }
  if (selection.kind === "file") {
    if (id.includes("write") || id.includes("memory")) boost += 25;
  }
  if (selection.kind === "archive" || selection.kind === "outputs") {
    if (id.includes("loop") || id.includes("archive") || id.includes("output")) boost += 25;
  }
  // Prefer skills when no query — daily workflow surface
  if (group === "skill") boost += 5;
  return boost;
}

function contextHint(selection: Selection, t: (key: string, opts?: Record<string, unknown>) => string): string {
  switch (selection.kind) {
    case "topic":
      return t("overlays:command.ctxTopic", { name: selection.topicId.split("/").pop() });
    case "file":
      return t("overlays:command.ctxFile", { name: selection.path.split("/").pop() });
    case "inbox":
      return t("overlays:command.ctxInbox");
    case "stream":
      return t("overlays:command.ctxStream");
    case "category":
      return t("overlays:command.ctxCategory", { name: selection.category });
    case "outputs":
      return t("overlays:command.ctxOutputs");
    case "archive":
      return t("overlays:command.ctxArchive");
    case "connector":
      return selection.id === "weread"
        ? t("overlays:command.ctxWeread")
        : selection.id === "x"
          ? t("overlays:command.ctxX")
          : t("overlays:command.ctxConnector", { id: selection.id });
    default:
      return t("overlays:command.ctxDefault");
  }
}

interface PaletteGroup {
  key: string;
  label: string;
  icon: LucideIcon;
  items: ActionSlot[];
}

export function CommandPalette() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const closeOverlay = useViewStore((s) => s.closeOverlay);
  const selection = useViewStore((s) => s.selection);
  const workspaceRoot = useViewStore((s) => s.workspaceRoot);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const available = useMemo(() => {
    return registry.actions().filter((a) => !a.available || a.available(selection));
  }, [selection]);

  /** Resolve action label via i18n key when available. */
  const resolveLabel = (a: ActionSlot) => a.labelKey ? t(a.labelKey) : a.label;

  const groups = useMemo<PaletteGroup[]>(() => {
    const q = query.trim();
    const scored = available
      .map((a) => {
        const fuzzy = fuzzyScore(q, `${resolveLabel(a)} ${a.id}`);
        if (fuzzy < 0) return null;
        const score = q ? fuzzy : (100 - (a.order ?? 100)) + contextBoost(a, selection);
        return { a, score };
      })
      .filter((x): x is { a: ActionSlot; score: number } => x !== null);

    const byGroup = new Map<string, { a: ActionSlot; score: number }[]>();
    for (const x of scored) {
      const g = x.a.group ?? "other";
      const bucket = byGroup.get(g);
      if (bucket) bucket.push(x);
      else byGroup.set(g, [x]);
    }

    // When no query: skill first (workflow). With query: pure relevance group order.
    const order = q ? ["goto", "skill", "navigate", "capture"] : GROUP_ORDER;
    const orderedKeys = [
      ...order.filter((g) => byGroup.has(g)),
      ...[...byGroup.keys()].filter((g) => !order.includes(g)),
    ];

    return orderedKeys.map((key) => {
      const items = byGroup.get(key)!;
      items.sort((x, y) => y.score - x.score || (x.a.order ?? 100) - (y.a.order ?? 100));
      const meta = GROUP_KEY_MAP[key];
      return {
        key,
        label: meta ? t(meta) : key,
        icon: GROUP_ICON[key] ?? CommandIcon,
        items: items.map((x) => x.a),
      };
    });
  }, [available, query, selection]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setActiveIdx(0);
  }, [query, selection.kind]);

  // Keep active row visible
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-palette-idx="${activeIdx}"]`);
    if (el instanceof HTMLElement) el.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  const runAction = (a: ActionSlot) => {
    closeOverlay();
    void a.run(makeMinCtx(workspaceRoot), selection);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(flat.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIdx(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIdx(Math.max(flat.length - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const a = flat[activeIdx];
      if (a) runAction(a);
    }
  };

  let runningIdx = -1;

  const activeOptionId =
    flat.length > 0 && activeIdx >= 0 && activeIdx < flat.length
      ? `command-palette-opt-${activeIdx}`
      : undefined;

  return (
    <div
      className="v4-overlay-sheet v4-palette"
      role="dialog"
      aria-modal="true"
      aria-label={t("overlays:command.ariaLabel")}
    >
      <div className="v4-palette-header">
        <Search size={ICON.sm} className="shrink-0 text-text-quaternary" aria-hidden />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("overlays:command.placeholder")}
          role="combobox"
          aria-label={t("overlays:command.inputAriaLabel")}
          aria-expanded="true"
          aria-controls="command-palette-list"
          aria-activedescendant={activeOptionId}
          aria-autocomplete="list"
          className="v4-palette-input"
        />
        <kbd className="v4-kbd v4-kbd-sm" aria-hidden>
          ESC
        </kbd>
      </div>

      <div className="flex items-center gap-1.5 px-3.5 py-1.5 text-3xs text-text-quaternary">
        {selection.kind === "inbox" ? (
          <Inbox size={ICON.micro} className="text-warning" />
        ) : (
          <Sparkles size={ICON.micro} className="text-accent-color/60" />
        )}
        <span className="truncate">{contextHint(selection, t)}</span>
        {!query ? <span className="ml-auto shrink-0 opacity-70">{t("overlays:command.scenePriority")}</span> : null}
      </div>

      <ul
        id="command-palette-list"
        ref={listRef}
        className="v4-sidebar-scroll m-0 max-h-[min(360px,50vh)] list-none overflow-auto p-1.5"
        role="listbox"
        aria-label={t("overlays:command.listAriaLabel")}
      >
        {flat.length === 0 ? (
          <li className="flex flex-col items-center gap-2 px-3 py-10 text-center" role="presentation">
            <div className="v4-icon-chip flex h-9 w-9 rounded-full" aria-hidden>
              <Search size={ICON.sm} />
            </div>
            <div className="text-sm text-text-secondary">{t("overlays:command.noMatchTitle")}</div>
            <div className="max-w-[240px] text-3xs leading-relaxed text-text-quaternary">
              {t("overlays:command.noMatchHint")}
            </div>
          </li>
        ) : (
          groups.map((group) => (
            <li key={group.key} className="mb-1 last:mb-0" role="presentation">
              <div className="flex items-center gap-1.5 px-2 py-1 text-3xs font-medium uppercase tracking-wide text-text-quaternary">
                <group.icon size={ICON.micro} aria-hidden />
                {group.label}
                <span className="font-normal normal-case tabular-nums text-text-quaternary/70" aria-hidden>
                  {group.items.length}
                </span>
              </div>
              <ul className="m-0 list-none p-0" role="group" aria-label={group.label}>
                {group.items.map((a) => {
                  runningIdx += 1;
                  const idx = runningIdx;
                  const active = idx === activeIdx;
                  return (
                    <li
                      key={a.id}
                      id={`command-palette-opt-${idx}`}
                      data-palette-idx={idx}
                      role="option"
                      aria-selected={active}
                      data-active={active}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => runAction(a)}
                      className={cn(
                        "v4-palette-row justify-between text-sm",
                        !active && "text-text-primary",
                      )}
                    >
                      <span className="min-w-0 truncate font-medium">{resolveLabel(a)}</span>
                      <div className="ml-2 flex min-w-[5.5rem] shrink-0 items-center justify-end gap-2">
                        {a.shortcut ? (
                          <kbd className="v4-kbd tabular-nums">{a.shortcut}</kbd>
                        ) : (
                          <span className="w-0" aria-hidden />
                        )}
                        {active ? (
                          <CornerDownLeft size={ICON.micro} className="text-text-tertiary" aria-hidden />
                        ) : (
                          <span className="inline-block w-[11px]" aria-hidden />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))
        )}
      </ul>

      <div className="v4-palette-footer">
        <span className="flex items-center gap-1">
          <kbd className="v4-kbd">↑↓</kbd> {t("overlays:command.footerSelect")}
        </span>
        <span className="flex items-center gap-1">
          <kbd className="v4-kbd">↵</kbd> {t("overlays:command.footerRun")}
        </span>
        <span className="flex items-center gap-1">
          <kbd className="v4-kbd">⌘N</kbd> {t("overlays:command.footerCapture")}
        </span>
        <span className="ml-auto tabular-nums">{t("overlays:command.footerCount", { count: flat.length })}</span>
      </div>
    </div>
  );
}
