import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Search, FileText, CornerDownLeft, Loader2, Hash, Clock } from "lucide-react";
import { api } from "../../services/api";
import { useViewStore } from "../../stores/view-store";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import type { SearchResult } from "../../types";

type SearchBucket = "stream" | "memory" | "inbox" | "outputs" | "archive" | "topic" | "other";

/** Light path-based grouping for honest keyword search (no embedding). */
function searchBucket(relativePath: string): SearchBucket {
  const p = relativePath.replace(/\\/g, "/");
  if (p.startsWith("memory/") || p.includes("/memory/")) return "memory";
  if (/(^|\/)(00-|收件箱|inbox)/iu.test(p)) return "inbox";
  if (/(^|\/)(88-|输出|outputs)/iu.test(p)) return "outputs";
  if (/(^|\/)(99-|归档|archive)/iu.test(p)) return "archive";
  if (/(动态|stream|period|weekly|daily|monthly)/iu.test(p)) return "stream";
  if (p.split("/").filter(Boolean).length >= 2) return "topic";
  return "other";
}

const BUCKET_ORDER: SearchBucket[] = [
  "stream",
  "memory",
  "inbox",
  "topic",
  "outputs",
  "archive",
  "other",
];

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
  const [results, setResults] = useState<SearchResult[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const closeOverlay = useViewStore((s) => s.closeOverlay);
  const select = useViewStore((s) => s.select);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const seqRef = useRef(0);

  // Debounced search with race protection
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setTruncated(false);
      setSearchNote(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const seq = ++seqRef.current;
    const timer = setTimeout(async () => {
      try {
        const res = await api.ws.search(q);
        if (seq !== seqRef.current) return;
        setResults(res.results || []);
        // Honesty: never present capped hit list as full-library census
        setTruncated(Boolean(res.truncated));
        setSearchNote(typeof res.note === "string" ? res.note : null);
      } catch {
        if (seq !== seqRef.current) return;
        setResults([]);
        setTruncated(false);
        setSearchNote(null);
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setActiveIdx(0);
  }, [query, results.length]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-search-idx="${activeIdx}"]`);
    if (el instanceof HTMLElement) el.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

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
    const empty = !query.trim();
    const count = empty ? recent.length : results.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(count - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIdx(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIdx(Math.max(count - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (empty) {
        const r = recent[activeIdx];
        if (r) setQuery(r);
        return;
      }
      const r = results[activeIdx];
      if (r) handleOpen(r);
    }
  };

  const empty = !query.trim();
  const optionCount = empty ? recent.length : results.length;
  const activeOptionId =
    optionCount > 0 && activeIdx >= 0 && activeIdx < optionCount
      ? `global-search-opt-${activeIdx}`
      : undefined;

  const groupedResults = useMemo(() => {
    const buckets = new Map<SearchBucket, Array<{ r: SearchResult; flatIdx: number }>>();
    results.forEach((r, flatIdx) => {
      const b = searchBucket(r.relativePath);
      if (!buckets.has(b)) buckets.set(b, []);
      buckets.get(b)!.push({ r, flatIdx });
    });
    return BUCKET_ORDER.filter((b) => buckets.has(b)).map((b) => ({
      bucket: b,
      items: buckets.get(b)!,
    }));
  }, [results]);

  return (
    <div
      className="v4-overlay-sheet v4-palette !w-[min(600px,94vw)]"
      role="dialog"
      aria-modal="true"
      aria-label={t("overlays:search.ariaLabel")}
    >
      <div className="v4-palette-header">
        <Search size={ICON.sm} className="shrink-0 text-text-tertiary" aria-hidden />
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
          <Loader2 size={ICON.xs} className="animate-spin text-accent-color/70" aria-label={t("overlays:search.loadingAria")} />
        ) : null}
        <kbd className="v4-kbd v4-kbd-sm" aria-hidden>
          ESC
        </kbd>
      </div>
      <ul
        id="global-search-list"
        ref={listRef}
        className="v4-sidebar-scroll m-0 max-h-[min(400px,52vh)] list-none overflow-auto p-1.5"
        role="listbox"
        aria-label={empty ? t("overlays:search.listAriaRecent") : t("overlays:search.listAriaResults")}
      >
        {query.trim() && !loading && results.length === 0 ? (
          <li className="flex flex-col items-center gap-2.5 px-3 py-10 text-center" role="presentation">
            <div className="v4-icon-chip flex h-10 w-10 rounded-full text-text-quaternary" aria-hidden>
              <Search size={ICON.sm} />
            </div>
            <div className="text-sm font-medium tracking-tight text-text-secondary">{t("overlays:search.noResultsTitle")}</div>
            <div className="max-w-[260px] text-3xs leading-relaxed text-text-quaternary">
              {t("overlays:search.noResultsHint")}
            </div>
          </li>
        ) : null}
        {!query.trim() ? (
          recent.length > 0 ? (
            <>
              <li className="flex items-center gap-1.5 px-2 py-1 text-3xs font-medium uppercase tracking-wide text-text-quaternary" role="presentation">
                <Clock size={ICON.micro} aria-hidden />
                {t("overlays:search.recentTitle")}
              </li>
              {recent.map((r, i) => (
                <li
                  key={r}
                  id={`global-search-opt-${i}`}
                  data-search-idx={i}
                  data-active={i === activeIdx}
                  role="option"
                  aria-selected={i === activeIdx}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => setQuery(r)}
                  className={cn(
                    "v4-palette-row text-sm",
                    i !== activeIdx && "text-text-primary",
                  )}
                >
                  <Search
                    size={ICON.xs}
                    className={cn(
                      "shrink-0",
                      i === activeIdx ? "text-accent-color" : "text-text-tertiary",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{r}</span>
                  {i === activeIdx ? (
                    <CornerDownLeft size={ICON.micro} className="shrink-0 text-text-tertiary" />
                  ) : null}
                </li>
              ))}
            </>
          ) : (
            <li className="flex flex-col items-center gap-2.5 px-3 py-10 text-center">
              <div className="v4-icon-chip flex h-10 w-10 rounded-full text-text-quaternary">
                <Search size={ICON.sm} />
              </div>
              <div className="text-sm font-medium tracking-tight text-text-secondary">{t("overlays:search.emptyTitle")}</div>
              <div className="max-w-[280px] text-3xs leading-relaxed text-text-quaternary">
                {t("overlays:search.emptyHint")}
              </div>
            </li>
          )
        ) : null}
        {groupedResults.map((group) => (
          <li key={group.bucket} role="presentation" className="list-none">
            <div className="flex items-center gap-1.5 px-2 py-1 text-3xs font-medium text-text-quaternary">
              {t(`overlays:search.group.${group.bucket}`)}
              <span className="tabular-nums opacity-70">{group.items.length}</span>
            </div>
            <ul className="m-0 list-none p-0">
              {group.items.map(({ r, flatIdx: i }) => (
                <li
                  key={r.relativePath}
                  id={`global-search-opt-${i}`}
                  data-search-idx={i}
                  data-active={i === activeIdx}
                  role="option"
                  aria-selected={i === activeIdx}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => handleOpen(r)}
                  className={cn("v4-palette-row items-start py-2.5", i !== activeIdx && "text-text-primary")}
                >
                  <FileText
                    size={ICON.xs}
                    className={cn(
                      "mt-0.5 shrink-0",
                      i === activeIdx ? "text-accent-color" : "text-text-tertiary",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        "truncate font-mono text-2xs",
                        i === activeIdx ? "text-accent-color" : "text-text-secondary",
                      )}
                    >
                      <HighlightPath path={r.relativePath} query={query.trim()} />
                    </div>
                    <div className="mt-0.5 truncate text-3xs text-text-tertiary">
                      <HighlightText text={r.preview} query={query.trim()} />
                    </div>
                  </div>
                  {r.nameMatch ? (
                    <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-accent-bg-subtle px-1.5 py-0.5 text-3xs font-medium text-accent-color">
                      <Hash size={ICON.nano} aria-hidden /> {t("overlays:search.nameMatch")}
                    </span>
                  ) : null}
                  {i === activeIdx ? (
                    <CornerDownLeft size={ICON.xs} className="mt-0.5 shrink-0 text-text-tertiary" />
                  ) : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {truncated && query.trim() && results.length > 0 ? (
        <div
          className="border-t border-border-subtle-dim px-3 py-1.5 text-3xs leading-relaxed text-warning"
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
          <kbd className="v4-kbd">↵</kbd> {t("overlays:search.footerOpen")}
        </span>
        {loading ? <span className="text-text-tertiary">{t("overlays:search.footerSearching")}</span> : null}
        <span className="ml-auto tabular-nums">
          {query.trim()
            ? truncated
              ? t("overlays:search.footerCountTruncated", { count: results.length })
              : t("overlays:search.footerCount", { count: results.length })
            : recent.length
              ? t("overlays:search.footerRecent", { count: recent.length })
              : ""}
        </span>
      </div>
    </div>
  );
}

/** Highlight matching text in search results. */
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx < 0) return <>{text}</>;

  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-[var(--radius-xs)] bg-warning/20 px-0.5 text-text-primary">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

/** Highlight matching segments in file path. */
function HighlightPath({ path, query }: { path: string; query: string }) {
  if (!query) return <>{path}</>;
  const lowerPath = path.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerPath.indexOf(lowerQuery);
  if (idx < 0) return <>{path}</>;

  return (
    <>
      {path.slice(0, idx)}
      <mark className="rounded-[var(--radius-xs)] bg-warning/20 px-0.5 text-accent-color">
        {path.slice(idx, idx + query.length)}
      </mark>
      {path.slice(idx + query.length)}
    </>
  );
}
