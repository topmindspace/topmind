/**
 * 我的情况 browse — feed/card projection of the memory plane.
 * Opening a row lands on the live markdown file (no parallel store).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Brain, CalendarDays, FileText, FolderOpen, Loader2, UserRound, Wand2 } from "lucide-react";
import { api } from "../../../services/api";
import { onLocal } from "../../../plugins/host";
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
  FilterChip,
} from "../../../components/ui/view";
import { Button } from "../../../components/ui/Button";
import { ICON } from "../../../lib/icons";
import { cn } from "../../../lib/cn";
import { assembleMemoryFeed, filterMemoryFeedByLayer, type MemoryFeedItem, type MemoryFeedKind } from "../../../lib/memory-feed";
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
  const out: Array<{ path: string; markdown: string }> = [];
  for (const e of entries) {
    if (e.kind === "dir") {
      out.push(...(await collectMarkdownFiles(e.relativePath, depth + 1)));
      continue;
    }
    const name = e.name || "";
    if (!name.toLowerCase().endsWith(".md")) continue;
    if (name.toLowerCase() === "todo.md") continue;
    try {
      const markdown = await api.ws.read(e.relativePath);
      out.push({ path: e.relativePath, markdown });
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

function kindIcon(kind: MemoryFeedKind) {
  if (kind === "periodic") return CalendarDays;
  if (kind === "topic") return FolderOpen;
  return UserRound;
}

export function MemoryBrowseView() {
  const { t } = useTranslation(["workspace", "shell", "common"]);
  const [items, setItems] = useState<MemoryFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layer, setLayer] = useState<"all" | MemoryFeedKind>("all");
  const [organizing, setOrganizing] = useState(false);
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
    } catch (e) {
      if (gen !== loadGen.current) return;
      if (!silent) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const unsub = onLocal("workspace:file-changed", () => void load({ silent: true }));
    return () => {
      unsub();
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

  const visible = useMemo(
    () => filterMemoryFeedByLayer(items, layer),
    [items, layer],
  );

  const layerCounts = useMemo(() => {
    const counts = { profile: 0, periodic: 0, topic: 0 };
    for (const i of items) counts[i.kind] += 1;
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

  const openItem = (item: MemoryFeedItem) => {
    select({
      kind: "file",
      path: item.path,
      ...(item.heading ? { focusHeading: item.heading } : {}),
    });
  };

  if (loading) return <LoadingState label={t("common:action.loading")} />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;

  return (
    <ViewContainer>
      <PageHeader
        icon={<Brain size={ICON.sm} />}
        title={t("workspace:memoryBrowse.title")}
        subtitle={
          items.length > 0
            ? t("workspace:memoryBrowse.subtitleCount", { count: items.length })
            : t("workspace:memoryBrowse.subtitle")
        }
        actions={
          <div className="flex items-center gap-1.5">
            <Tooltip content={t("workspace:memoryBrowse.openFolderTip")}>
              <Button
                variant="outline"
                size="sm"
                data-memory-open-folder
                onClick={() => revealMemoryFolderInTree()}
              >
                <FolderOpen size={ICON.xs} /> {t("workspace:memoryBrowse.openFolder")}
              </Button>
            </Tooltip>
            <Tooltip content={t("workspace:memoryBrowse.organizeTip")}>
              <Button
                variant="outline"
                size="sm"
                data-memory-organize
                disabled={organizing}
                onClick={() => void handleOrganize()}
              >
                {organizing ? (
                  <Loader2 size={ICON.xs} className="animate-spin" />
                ) : (
                  <Wand2 size={ICON.xs} />
                )}{" "}
                {t("workspace:memoryBrowse.organize")}
              </Button>
            </Tooltip>
          </div>
        }
      />

      <FeedColumn>
        <FeedChrome>
          <div className="flex min-w-0 flex-wrap items-center gap-1" role="tablist" aria-label={t("workspace:memoryBrowse.layerFilter")}>
            <FilterChip
              active={layer === "all"}
              label={t("workspace:memoryBrowse.layerAll")}
              count={items.length}
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
          </div>
          <FeedLayoutToggle value={feedLayout} onChange={setFeedLayout} />
        </FeedChrome>

      {visible.length === 0 ? (
        <EmptyState
          icon={<UserRound size={ICON.md} />}
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
              <FileText size={ICON.xs} /> {t("workspace:memoryBrowse.openEditor")}
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
            const html = streamMarkdownToPreviewHtml(item.body);
            return (
              <article
                key={item.id}
                data-memory-feed-item
                data-memory-kind={item.kind}
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
                      <h2 className="truncate text-sm font-medium text-text-primary">{item.title}</h2>
                      <span className="rounded-full bg-surface-muted px-1.5 py-px text-3xs text-text-quaternary">
                        {kindLabel[item.kind]}
                      </span>
                    </div>
                    {feedLayout === "card" && html ? (
                      <div
                        className="v4-stream-md mt-1.5 line-clamp-6 text-3xs leading-relaxed text-text-secondary"
                        dangerouslySetInnerHTML={{ __html: html }}
                      />
                    ) : (
                      <p className="mt-0.5 line-clamp-2 text-3xs leading-relaxed text-text-tertiary">
                        {item.preview}
                      </p>
                    )}
                    <div className="mt-1 font-mono text-3xs text-text-quaternary">{item.path}</div>
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
