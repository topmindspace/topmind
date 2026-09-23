/**
 * 我的情况 browse — feed/card projection of the memory plane.
 * Opening a row lands on the live markdown file (no parallel store).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  RiCalendar2Line,
  RiFileTextLine,
  RiFolderOpenLine,
  RiLoader4Line,
  RiMagicLine,
  RiUser3Line,
} from "@remixicon/react";
import { api } from "../../../services/api";
import { onLocal } from "../../../plugins/host";
import { useViewStore } from "../../../stores/view-store";
import {
  ViewContainer,
  EmptyState,
  LoadingState,
  ErrorState,
  FeedLayoutToggle,
  FeedColumn,
  FeedChrome,
  FilterChip,
} from "../../../components/ui/view";
import { TitleBarActions } from "../../../lib/chrome-portal";
import { useTitleBarChrome } from "../../../lib/titlebar-chrome";
import { Button } from "../../../components/ui/Button";
import { ICON } from "../../../lib/icons";
import { cn } from "../../../lib/kit";
import { assembleMemoryFeed, filterMemoryFeedByLayer, type MemoryFeedItem, type MemoryFeedKind, type MemoryFeedLayer } from "../../../lib/memory-feed";
import { stripListChromeForDisplay } from "../../../lib/stream-md-preview";
import { runMemoryOrganizeConfirm, revealMemoryFolderInTree } from "../../../lib/memory-organize";
import { streamMarkdownToPreviewHtml } from "../../../lib/stream-md-preview";
import { Tooltip } from "../../../components/ui/tooltip";
import type { DirEntry } from "../../../types";

async function collectMarkdownFiles(rel: string, depth = 0): Promise<Array<{ path: string; markdown: string }>> {
  if (!rel || depth > 4) return [];
  let entries: DirEntry[] = [];
  try {
    const listed = await api.ws.listDir(rel, "all");
    entries = listed.entries || [];
  } catch {
    return [];
  }
  // Parallelize: serial IPC reads made grown memory/ folders crawl.
  const dirs = entries.filter((e) => e.kind === "dir");
  const files = entries.filter((e) => {
    const name = (e.name || "").toLowerCase();
    return e.kind !== "dir" && name.endsWith(".md") && name !== "todo.md";
  });
  const [subTrees, fileResults] = await Promise.all([
    Promise.all(dirs.map((e) => collectMarkdownFiles(e.relativePath, depth + 1))),
    Promise.all(
      files.map(async (e) => {
        try {
          const markdown = await api.ws.read(e.relativePath);
          return { path: e.relativePath, markdown };
        } catch {
          return null; /* skip unreadable */
        }
      }),
    ),
  ]);
  const out: Array<{ path: string; markdown: string }> = [];
  for (const sub of subTrees) out.push(...sub);
  for (const f of fileResults) if (f) out.push(f);
  return out;
}

function kindIcon(kind: MemoryFeedKind) {
  if (kind === "periodic") return RiCalendar2Line;
  if (kind === "topic") return RiFolderOpenLine;
  return RiUser3Line;
}

export function MemoryBrowseView() {
  const { t } = useTranslation(["workspace", "shell", "common"]);
  const [items, setItems] = useState<MemoryFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layer, setLayer] = useState<MemoryFeedLayer>("all");
  const [organizing, setOrganizing] = useState(false);
  const [query, setQuery] = useState("");
  const [healthIssues, setHealthIssues] = useState<string[]>([]);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const select = useViewStore((s) => s.select);
  const feedLayout = useViewStore((s) => s.feedLayout);
  const setFeedLayout = useViewStore((s) => s.setFeedLayout);
  const loadGen = useRef(0);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const gen = ++loadGen.current;
    const silent = Boolean(opts?.silent);
    if (!silent) setLoading(true);
    try {
      const ensured = await api.ws.ensureCoreProfile();
      const ctx = await api.ws.getStreamContext();
      const memDir = ctx.memory?.dir || "memory";
      const profilePath = ensured.profileRelPath || ctx.memory?.profileRelPath || null;

      let profile: { path: string; markdown: string } | null = null;
      if (profilePath) {
        try {
          profile = { path: profilePath, markdown: await api.ws.read(profilePath) };
        } catch {
          profile = { path: profilePath, markdown: "" };
        }
      }

      const [periodic, topics] = await Promise.all([
        collectMarkdownFiles(`${memDir}/periodic`),
        collectMarkdownFiles(`${memDir}/topics`),
      ]);

      if (gen !== loadGen.current) return;
      setItems(assembleMemoryFeed({ profile, periodic, topics }));
      setError(null);
      // Best-effort health badge (near-dupes / oversized) — never blocks browse.
      void api.ws
        .profileHealth()
        .then((h) => {
          if (gen === loadGen.current) setHealthIssues(h.health?.issues || []);
        })
        .catch(() => setHealthIssues([]));
    } catch (e) {
      if (gen !== loadGen.current) return;
      if (!silent) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Silent reloads only react to memory-plane changes, debounced — the raw
    // event fires for every workspace write (incl. editor autosaves).
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = onLocal("workspace:file-changed", (payload) => {
      const rel = (payload as { relativePath?: string } | null)?.relativePath;
      if (typeof rel === "string" && rel.trim() && !rel.replace(/\\/g, "/").startsWith("memory/")) {
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load({ silent: true }), 800);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  const kindLabel = useMemo(
    () =>
      ({
        profile: t("workspace:memoryBrowse.kindProfile"),
        periodic: t("workspace:memoryBrowse.kindPeriodic"),
        topic: t("workspace:memoryBrowse.kindTopic"),
      }) as Record<MemoryFeedKind, string>,
    [t],
  );

  const visible = useMemo(() => {
    const byLayer = filterMemoryFeedByLayer(items, layer);
    const q = query.trim().toLowerCase();
    if (!q) return byLayer;
    return byLayer.filter((i) => {
      const hay = `${i.title || ""}\n${i.preview || ""}\n${i.body || ""}\n${i.path || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, layer, query]);

  const layerCounts = useMemo(() => {
    const counts = { profile: 0, periodic: 0, topic: 0, history: 0 };
    for (const i of items) {
      if (i.history) counts.history += 1;
      else counts[i.kind] += 1;
    }
    return counts;
  }, [items]);

  const handleOrganize = async () => {
    setOrganizing(true);
    try {
      await runMemoryOrganizeConfirm();
    } finally {
      setOrganizing(false);
    }
  };

  const handleRestore = async (item: MemoryFeedItem, e: ReactMouseEvent) => {
    e.stopPropagation();
    if (restoringId) return;
    const match = stripListChromeForDisplay(item.body || item.title || "").trim();
    if (!match) return;
    setRestoringId(item.id);
    try {
      const res = await api.ws.restoreProfileFact({ match });
      if (res.ok) {
        await load({ silent: true });
      }
    } catch {
      /* keep row; user can retry */
    } finally {
      setRestoringId(null);
    }
  };

  const openItem = (item: MemoryFeedItem) => {
    select({
      kind: "file",
      path: item.path,
      ...(item.heading ? { focusHeading: item.heading } : {}),
    });
  };

  useTitleBarChrome("memory", {
    title: t("workspace:memoryBrowse.title"),
    stats: items.length > 0
      ? t("workspace:memoryBrowse.subtitleCount", { count: items.length })
      : t("workspace:memoryBrowse.subtitle"),
  });

  if (loading) {
    return (
      <ViewContainer variant="feed">
        <LoadingState label={t("common:action.loading")} />
      </ViewContainer>
    );
  }
  if (error) {
    return (
      <ViewContainer variant="feed">
        <ErrorState message={error} onRetry={() => void load()} />
      </ViewContainer>
    );
  }

  return (
    <ViewContainer variant="feed">
      <TitleBarActions>
        <Tooltip content={t("workspace:memoryBrowse.openFolderTip")}>
          <button
            type="button"
            className="v4-titlebar-btn gap-1 px-2 text-xs"
            data-memory-open-folder
            onClick={() => revealMemoryFolderInTree()}
            aria-label={t("workspace:memoryBrowse.openFolder")}
          >
            <RiFolderOpenLine size={ICON.sm} />
            <span className="hidden sm:inline">{t("workspace:memoryBrowse.openFolder")}</span>
          </button>
        </Tooltip>
        <Tooltip content={t("workspace:memoryBrowse.organizeTip")}>
          <button
            type="button"
            className="v4-titlebar-btn gap-1 px-2 text-xs"
            data-memory-organize
            disabled={organizing}
            onClick={() => void handleOrganize()}
            aria-label={t("workspace:memoryBrowse.organize")}
          >
            {organizing ? (
              <RiLoader4Line size={ICON.sm} className="animate-spin" />
            ) : (
              <RiMagicLine size={ICON.sm} />
            )}
            <span className="hidden sm:inline">{t("workspace:memoryBrowse.organize")}</span>
          </button>
        </Tooltip>
      </TitleBarActions>

      <FeedColumn>
        <FeedChrome>
          <div className="flex min-w-0 flex-wrap items-center gap-1" role="tablist" aria-label={t("workspace:memoryBrowse.layerFilter")}>
            <FilterChip
              active={layer === "all"}
              label={t("workspace:memoryBrowse.layerAll")}
              count={items.filter((i) => i.history !== true).length}
              onClick={() => setLayer("all")}
            />
            <FilterChip
              active={layer === "profile"}
              label={kindLabel.profile}
              count={layerCounts.profile}
              onClick={() => setLayer("profile")}
            />
            <FilterChip
              active={layer === "periodic"}
              label={kindLabel.periodic}
              count={layerCounts.periodic}
              onClick={() => setLayer("periodic")}
            />
            <FilterChip
              active={layer === "topic"}
              label={kindLabel.topic}
              count={layerCounts.topic}
              onClick={() => setLayer("topic")}
            />
            {layerCounts.history > 0 ? (
              <FilterChip
                active={layer === "history"}
                label={t("workspace:memoryBrowse.kindHistory")}
                count={layerCounts.history}
                onClick={() => setLayer("history")}
              />
            ) : null}
            {healthIssues.length > 0 ? (
              <Tooltip content={healthIssues.join(" · ")}>
                <span
                  data-memory-health-issues
                  className="rounded-full bg-status-warning-bg px-1.5 py-px text-3xs text-warning"
                >
                  {t("workspace:memoryBrowse.healthIssues", { count: healthIssues.length })}
                </span>
              </Tooltip>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("workspace:memoryBrowse.searchPlaceholder")}
              aria-label={t("workspace:memoryBrowse.searchPlaceholder")}
              data-memory-search
              className="h-7 w-36 min-w-0 rounded-[var(--radius-md)] border border-border-subtle bg-surface px-2 text-xs text-text-primary outline-none v4-focus-ring sm:w-48"
            />
            <FeedLayoutToggle value={feedLayout} onChange={setFeedLayout} />
          </div>
        </FeedChrome>

      {visible.length === 0 ? (
        <EmptyState
          icon={<RiUser3Line size={ICON.md} />}
          title={t("workspace:memoryBrowse.emptyTitle")}
          hint={t("workspace:memoryBrowse.emptyHint")}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void (async () => {
                  const ensured = await api.ws.ensureCoreProfile();
                  if (ensured.profileRelPath) {
                    select({ kind: "file", path: ensured.profileRelPath });
                  }
                })();
              }}
            >
              <RiFileTextLine size={ICON.xs} /> {t("workspace:memoryBrowse.openEditor")}
            </Button>
          }
        />
      ) : (
        <div
          className={cn("v4-feed", feedLayout === "card" ? "v4-feed-card" : "v4-feed-list")}
          data-memory-feed
          data-layout={feedLayout}
        >
          {visible.map((item) => {
            const Icon = kindIcon(item.kind);
            const displayMd = stripListChromeForDisplay(item.body);
            const firstLine = (item.body || "").split("\n").find((l) => l.trim()) || "";
            const firstPlain = firstLine
              .replace(/^\s*[-*+]\s+(\[[ xX]\]\s*)?/u, "")
              .replace(/^\s*\d+\.\s+/u, "")
              .replace(/^#{1,6}\s+/u, "")
              .trim();
            const titleDupesBody = Boolean(item.title) && firstPlain === item.title;
            const html = streamMarkdownToPreviewHtml(displayMd, item.path);
            const kindText = item.history
              ? t("workspace:memoryBrowse.kindHistory")
              : kindLabel[item.kind];
            return (
              <article
                key={item.id}
                data-memory-feed-item
                data-memory-kind={item.kind}
                data-memory-history={item.history ? "true" : undefined}
                data-memory-path={item.path}
                className="group cursor-pointer v4-focus-ring rounded-[var(--radius-lg)]"
                role="button"
                tabIndex={0}
                onClick={() => openItem(item)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openItem(item);
                  }
                }}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 text-text-quaternary">
                    <Icon size={ICON.xs} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {titleDupesBody ? null : (
                        <h2 className="truncate text-sm font-medium text-text-primary">{item.title}</h2>
                      )}
                      {item.heading && item.heading !== item.title ? (
                        <span className="rounded-full bg-surface-muted px-1.5 py-px text-3xs text-text-tertiary">
                          {item.heading}
                        </span>
                      ) : null}
                      <span className="rounded-full bg-surface-muted px-1.5 py-px text-3xs text-text-quaternary">
                        {kindText}
                      </span>
                      {item.history && item.kind === "profile" ? (
                        <button
                          type="button"
                          data-memory-restore
                          disabled={restoringId === item.id}
                          className="rounded-full bg-surface-muted px-1.5 py-px text-3xs text-text-secondary hover:text-text-primary v4-focus-ring"
                          onClick={(e) => void handleRestore(item, e)}
                        >
                          {restoringId === item.id
                            ? t("workspace:memoryBrowse.restoring")
                            : t("workspace:memoryBrowse.restore")}
                        </button>
                      ) : null}
                    </div>
                    {html ? (
                      <div
                        className={cn(
                          "v4-stream-md mt-1 text-sm leading-[1.55] text-text-secondary",
                          feedLayout === "list" && "line-clamp-3",
                          feedLayout === "card" && "line-clamp-8",
                        )}
                        dangerouslySetInnerHTML={{ __html: html }}
                      />
                    ) : item.preview ? (
                      <p className="mt-0.5 line-clamp-2 text-3xs leading-relaxed text-text-tertiary">
                        {item.preview}
                      </p>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      </FeedColumn>
    </ViewContainer>
  );
}
