import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  RiCornerDownLeftLine,
  RiFileTextLine,
  RiHashtag,
  RiLoader4Line,
  RiSearchLine,
  RiTimeLine,
} from "@remixicon/react";
import { api } from "../../services/api";
import { useViewStore } from "../../stores/view-store";
import { cn } from "../../lib/kit";
import { ICON } from "../../lib/icons";
import { formatChord } from "../../lib/chord";
import { FilterChip } from "../ui/view";
import type { SearchResult } from "../../types";
import { EMPTY_SEARCH, SEARCH_BUCKET_ORDER, groupSearchResults, searchBucket, startWorkspaceSearch, type SearchBucket } from "../../lib/workspace-search";

const RECENT_KEY = "topmind:search-recent";
const MAX_RECENT = 8;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string").slice(0, MAX_RECENT)
      : [];
  } catch {
    return [];
  }
}

function clearRecent(): void {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    /* ignore */
  }
}

function pushRecent(q: string) {
  const t = q.trim();
  if (t.length < 2) return;
  try {
    const next = [t, ...loadRecent().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(
      0,
      MAX_RECENT,
    );
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function GlobalSearch() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [{ results, truncated, note: searchNote, loading, error: searchError }, setSearch] = useState(EMPTY_SEARCH);
  const [retry, setRetry] = useState(0);
  const [activeIdx, setActiveIdx] = useState(0);
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const [bucketFilter, setBucketFilter] = useState<SearchBucket | "all">("all");
  const closeOverlay = useViewStore((s) => s.closeOverlay);
  const select = useViewStore((s) => s.select);
  const workspaceRoot = useViewStore((s) => s.workspaceRoot);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const groupedResults = useMemo(() => groupSearchResults(results, bucketFilter), [results, bucketFilter]);
  const filteredResults = useMemo(() => groupedResults.flatMap((g) => g.items.map(({ r }) => r)), [groupedResults]);

  const bucketCounts = useMemo(() => {
    const counts = new Map<SearchBucket, number>();
    for (const r of results) {
      const b = searchBucket(r.relativePath);
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    return counts;
  }, [results]);

  useEffect(() => startWorkspaceSearch(query, api.ws.search, setSearch), [query, retry, workspaceRoot]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setActiveIdx(0);
  }, [query, bucketFilter, results]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-search-idx="${activeIdx}"]`);
    if (el instanceof HTMLElement) el.scrollIntoView({ block: "nearest" });
  }, [activeIdx, filteredResults]);

  const handleOpen = (r: SearchResult) => {
    pushRecent(query);
    setRecent(loadRecent());
    const parts = r.relativePath.split("/");
    const topicId =
      parts.length >= 3
        ? `${parts[0]}/${parts[1]}`
        : parts.length === 2
          ? parts[0]
          : undefined;
    select({ kind: "file", path: r.relativePath, topicId });
    closeOverlay();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      e.stopPropagation();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") e.stopPropagation();
    const empty = !query.trim();
    if (!empty && (loading || searchError)) return;
    const count = empty ? recent.length : filteredResults.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(count - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (empty) {
        const r = recent[activeIdx];
        if (r) setQuery(r);
        return;
      }
      const r = filteredResults[activeIdx];
      if (r) handleOpen(r);
    }
  };

  const empty = !query.trim();
  const optionCount = empty ? recent.length : filteredResults.length;
  const activeOptionId =
    !loading && !searchError && optionCount > 0 && activeIdx >= 0 && activeIdx < optionCount
      ? `global-search-opt-${activeIdx}`
      : undefined;


  return (
    <div
      className="v4-overlay-sheet v4-palette !w-[min(600px,94vw)]"
      role="dialog"
      aria-modal="true"
      aria-label={t("overlays:search.ariaLabel")}
    >
      <div className="v4-palette-header">
        <RiSearchLine size={ICON.sm} className="shrink-0 text-text-tertiary" aria-hidden />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("overlays:search.placeholder")}
          role="combobox"
          aria-label={t("overlays:search.inputAriaLabel")}
          aria-expanded="true"
          aria-controls="global-search-list"
          aria-activedescendant={activeOptionId}
          aria-autocomplete="list"
          className="v4-palette-input"
        />
        {loading ? (
          <RiLoader4Line size={ICON.xs} className="animate-spin text-accent-color" aria-label={t("overlays:search.loadingAria")} />
        ) : null}
        <kbd className="v4-kbd v4-kbd-sm" aria-hidden>
          ESC
        </kbd>
      </div>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {empty ? "" : loading ? t("overlays:search.footerSearching") : searchError
          ? t("overlays:search.errorTitle")
          : t(truncated ? "overlays:search.footerCountTruncated" : "overlays:search.footerCount", { count: filteredResults.length })}
      </div>
      {searchError ? (
        <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
          <div className="text-sm font-medium text-text-primary">{t("overlays:search.errorTitle")}</div>
          <div className="text-xs text-text-secondary">{t("overlays:search.errorHint")}</div>
          <button type="button" className="v4-chip v4-focus-ring" onClick={() => setRetry((n) => n + 1)}>
            {t("overlays:search.retry")}
          </button>
        </div>
      ) : null}
      <ul
        id="global-search-list"
        ref={listRef}
        className="v4-sidebar-scroll m-0 max-h-[min(400px,52vh)] list-none overflow-auto p-1.5"
        role="listbox"
        aria-busy={loading}
        aria-label={empty ? t("overlays:search.listAriaRecent") : t("overlays:search.listAriaResults")}
      >
        {query.trim() && !loading && !searchError && results.length === 0 ? (
          <li className="flex flex-col items-center gap-2.5 px-3 py-10 text-center" role="presentation">
            <div className="v4-icon-chip flex h-10 w-10 rounded-full text-text-quaternary" aria-hidden>
              <RiSearchLine size={ICON.sm} />
            </div>
            <div className="text-sm font-medium tracking-tight text-text-secondary">{t("overlays:search.noResultsTitle")}</div>
            <div className="max-w-[260px] text-xs leading-relaxed text-text-tertiary">
              {t("overlays:search.noResultsHint")}
            </div>
          </li>
        ) : null}
        {!query.trim() ? (
          recent.length > 0 ? (
            <>
              <li className="flex items-center gap-1.5 px-2 py-1 text-3xs font-medium uppercase tracking-wide text-text-quaternary" role="presentation">
                <RiTimeLine size={ICON.micro} aria-hidden />
                <span className="flex-1">{t("overlays:search.recentTitle")}</span>
                <button
                  type="button"
                  className="rounded-[var(--radius-sm)] px-1.5 py-0.5 normal-case transition-colors hover:bg-state-hover hover:text-text-secondary v4-focus-ring"
                  onClick={() => {
                    clearRecent();
                    setRecent([]);
                  }}
                >
                  {t("overlays:search.clearRecent")}
                </button>
              </li>
              {recent.map((r, i) => (
                <li
                  key={r}
                  id={`global-search-opt-${i}`}
                  data-search-idx={i}
                  data-active={i === activeIdx}
                  role="option"
                  aria-selected={i === activeIdx}
                  onMouseMove={() => setActiveIdx(i)}
                  onClick={() => setQuery(r)}
                  className={cn(
                    "v4-palette-row text-sm",
                    i !== activeIdx && "text-text-primary",
                  )}
                >
                  <RiSearchLine
                    size={ICON.xs}
                    className={cn(
                      "shrink-0",
                      i === activeIdx ? "text-accent-color" : "text-text-tertiary",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{r}</span>
                  {i === activeIdx ? (
                    <RiCornerDownLeftLine size={ICON.micro} className="shrink-0 text-text-tertiary" />
                  ) : null}
                </li>
              ))}
            </>
          ) : (
            <li className="flex flex-col items-center gap-2.5 px-3 py-10 text-center">
              <div className="v4-icon-chip flex h-10 w-10 rounded-full text-text-quaternary">
                <RiSearchLine size={ICON.sm} />
              </div>
              <div className="text-sm font-medium tracking-tight text-text-secondary">{t("overlays:search.emptyTitle")}</div>
              <div className="max-w-[280px] text-xs leading-relaxed text-text-tertiary">
                {t("overlays:search.emptyHint")}
              </div>
            </li>
          )
        ) : null}
        {query.trim() && !loading && results.length > 0 ? (
          <li className="flex flex-wrap items-center gap-1 px-2 py-1" role="presentation">
            <FilterChip
              active={bucketFilter === "all"}
              label={t("overlays:search.filterAll")}
              count={results.length}
              onClick={() => setBucketFilter("all")}
            />
            {SEARCH_BUCKET_ORDER.filter((b) => bucketCounts.has(b)).map((b) => (
              <FilterChip
                key={b}
                active={bucketFilter === b}
                label={t(`overlays:search.group.${b}`)}
                count={bucketCounts.get(b)}
                onClick={() => setBucketFilter(b)}
              />
            ))}
          </li>
        ) : null}
        {groupedResults.map((group) => (
          <li key={group.bucket} role="presentation" className="list-none">
            <div className="flex items-center gap-1.5 px-2 py-1 text-3xs font-medium text-text-quaternary">
              {t(`overlays:search.group.${group.bucket}`)}
              <span className="tabular-nums opacity-70">{group.items.length}</span>
            </div>
            <ul className="m-0 list-none p-0" role="group" aria-label={t(`overlays:search.group.${group.bucket}`)}>
              {group.items.map(({ r, flatIdx: i }) => (
                <li
                  key={r.relativePath}
                  id={`global-search-opt-${i}`}
                  data-search-idx={i}
                  data-active={i === activeIdx}
                  role="option"
                  aria-selected={i === activeIdx}
                  onMouseMove={() => setActiveIdx(i)}
                  onClick={() => handleOpen(r)}
                  className={cn("v4-palette-row items-start py-2.5", i !== activeIdx && "text-text-primary")}
                >
                  <RiFileTextLine
                    size={ICON.xs}
                    className={cn(
                      "mt-0.5 shrink-0",
                      i === activeIdx ? "text-accent-color" : "text-text-tertiary",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                      "truncate text-xs font-medium",
                        i === activeIdx ? "text-accent-color" : "text-text-secondary",
                      )}
                    >
                      <HighlightPath path={r.relativePath} query={query.trim()} />
                    </div>
                    <div className="mt-0.5 truncate text-xs text-text-tertiary">
                      <HighlightText text={r.preview} query={query.trim()} />
                    </div>
                  </div>
                  {r.nameMatch ? (
                    <span className="flex shrink-0 items-center gap-0.5 rounded-[var(--radius-xs)] bg-accent-bg-subtle px-1.5 py-0.5 text-3xs font-medium text-accent-color">
                      <RiHashtag size={ICON.micro} aria-hidden /> {t("overlays:search.nameMatch")}
                    </span>
                  ) : null}
                  {i === activeIdx ? (
                    <RiCornerDownLeftLine size={ICON.xs} className="mt-0.5 shrink-0 text-text-tertiary" />
                  ) : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {truncated && query.trim() && results.length > 0 ? (
        <div
          className="border-t border-border-subtle-dim px-3 py-1.5 text-xs leading-relaxed text-warning"
          role="status"
        >
          {searchNote || t("overlays:search.truncatedHint", { count: results.length })}
        </div>
      ) : null}
      <div className="v4-palette-footer">
        <span className="flex items-center gap-1">
          <kbd className="v4-kbd">↑↓</kbd> {t("overlays:search.footerSelect")}
        </span>
        <span className="flex items-center gap-1">
          <kbd className="v4-kbd">{formatChord("↵")}</kbd> {t("overlays:search.footerOpen")}
        </span>
        {loading ? <span className="text-text-tertiary">{t("overlays:search.footerSearching")}</span> : null}
        <span className="ml-auto tabular-nums">
          {query.trim()
            ? loading || searchError ? "" : truncated
              ? t("overlays:search.footerCountTruncated", { count: filteredResults.length })
              : t("overlays:search.footerCount", { count: filteredResults.length })
            : recent.length
              ? t("overlays:search.footerRecent", { count: recent.length })
              : ""}
        </span>
      </div>
    </div>
  );
}

/** Highlight ALL occurrences of the query in text. */
function HighlightAll({
  text,
  query,
  markClassName,
}: {
  text: string;
  query: string;
  markClassName: string;
}) {
  if (!query) return <>{text}</>;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  if (!lowerText.includes(lowerQuery)) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let idx = lowerText.indexOf(lowerQuery);
  let key = 0;
  while (idx >= 0) {
    if (idx > cursor) parts.push(text.slice(cursor, idx));
    parts.push(
      <mark key={`hit-${key++}`} className={markClassName}>
        {text.slice(idx, idx + query.length)}
      </mark>,
    );
    cursor = idx + query.length;
    idx = lowerText.indexOf(lowerQuery, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

/** Highlight matching text in search results. */
function HighlightText({ text, query }: { text: string; query: string }) {
  return (
    <HighlightAll
      text={text}
      query={query}
      markClassName="rounded-[var(--radius-xs)] bg-status-warning-bg px-0.5 text-text-primary"
    />
  );
}

/** Highlight matching segments in file path. */
function HighlightPath({ path, query }: { path: string; query: string }) {
  return (
    <HighlightAll
      text={path}
      query={query}
      markClassName="rounded-[var(--radius-xs)] bg-status-warning-bg px-0.5 text-accent-color"
    />
  );
}
