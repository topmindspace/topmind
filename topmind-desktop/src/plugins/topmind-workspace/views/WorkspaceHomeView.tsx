/**
 * In-workspace home — the canvas after a workspace is open.
 * Identity, six existing flows, and live stream / Inbox / 交付 info.
 * Not a PrimaryNav anchor and not the deleted dashboard.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RiFolderOpenLine,
  RiHome4Line,
  RiNewspaperLine,
  RiInbox2Line,
  RiPencilLine,
  RiShareForwardLine,
  RiUser3Line,
} from "@remixicon/react";
import { useTranslation } from "react-i18next";
import { api } from "../../../services/api";
import { useViewStore } from "../../../stores/view-store";
import { onLocal } from "../../host";
import { useTitleBarChrome } from "../../../lib/titlebar-chrome";
import { displayPathSegment } from "../../../lib/titlebar-identity";
import { formatRelativeTime } from "../../../lib/datetime";
import { Button } from "../../../components/ui/Button";
import { cn } from "../../../lib/kit";
import { ICON } from "../../../lib/icons";
import {
  summarizeWorkspaceHome,
  workspaceDisplayName,
  type HomeAction,
  type HomeActionId,
  type HomeItemSnap,
  type HomeSummary,
} from "../home-summary";

const ACTION_ICON: Record<HomeActionId, typeof RiPencilLine> = {
  capture: RiPencilLine,
  stream: RiNewspaperLine,
  inbox: RiInbox2Line,
  outputs: RiShareForwardLine,
  memory: RiUser3Line,
  topics: RiFolderOpenLine,
};

function itemLabel(item: HomeItemSnap): string {
  const raw = item.name || item.relativePath.split("/").pop() || item.relativePath;
  return displayPathSegment(raw);
}

export function WorkspaceHomeView() {
  const { t } = useTranslation("workspace");
  const select = useViewStore((s) => s.select);
  const openOverlay = useViewStore((s) => s.openOverlay);
  const workspaceRoot = useViewStore((s) => s.workspaceRoot);
  const topicsRef = useRef<HTMLElement | null>(null);
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [ready, setReady] = useState(false);

  const shell = useMemo(
    () =>
      summarizeWorkspaceHome({
        name: workspaceDisplayName(workspaceRoot),
        root: workspaceRoot,
        streamContext: null,
        periods: [],
        inbox: { count: 0, items: [] },
        outputs: { count: 0, items: [] },
        categories: [],
      }),
    [workspaceRoot],
  );

  const load = useCallback(async () => {
    const root = workspaceRoot;
    const [ctx, periods, inbox, outputs, cats] = await Promise.all([
      api.ws.getStreamContext().catch(() => null),
      api.ws.listStreamPeriods().catch(() => []),
      api.ws.inbox().catch(() => ({ files: [] as { name: string; relativePath: string; mtime?: string }[] })),
      api.ws.outputs().catch(() => ({ files: [] as { name: string; relativePath: string; mtime?: string }[] })),
      api.ws.categories().catch(() => ({ categories: [], rootPath: root })),
    ]);
    if (useViewStore.getState().workspaceRoot !== root) return;
    const inboxFiles = inbox.files || [];
    const outputFiles = outputs.files || [];
    setSummary(
      summarizeWorkspaceHome({
        name: workspaceDisplayName(root),
        root,
        streamContext: ctx
          ? {
              periodRelPath: ctx.periodRelPath,
              periodTitle: ctx.periodTitle,
              periodFileName: ctx.periodFileName,
            }
          : null,
        periods: (periods || []).map((period) => ({
          relPath: period.relPath,
          title: period.title,
          fileName: period.fileName,
          mtime: period.mtime,
        })),
        inbox: {
          count: inboxFiles.length,
          items: inboxFiles.slice(0, 4).map((file) => ({
            name: file.name,
            relativePath: file.relativePath,
            mtime: file.mtime,
          })),
        },
        outputs: {
          count: outputFiles.length,
          items: outputFiles.slice(0, 4).map((file) => ({
            name: file.name,
            relativePath: file.relativePath,
            mtime: file.mtime,
          })),
        },
        categories: (cats.categories || []).map((category) => ({
          name: category.name,
          role: category.role,
          hidden: category.hidden,
        })),
      }),
    );
    setReady(true);
  }, [workspaceRoot]);

  useEffect(() => {
    setReady(false);
    void load();
    const unsub = onLocal("workspace:file-changed", () => {
      void load();
    });
    return () => {
      unsub();
    };
  }, [load]);

  const view = summary ?? shell;
  useTitleBarChrome("workspace-home", {
    title: view.identity.name || t("home.title"),
    stats: ready ? t("home.stats", { inbox: view.inbox.count, outputs: view.outputs.count }) : "",
  });

  const runAction = (action: HomeAction) => {
    if (action.id === "capture") {
      openOverlay("quick-capture");
      return;
    }
    if (action.id === "memory") {
      void (async () => {
        try {
          await api.ws.ensureCoreProfile();
        } catch {
          /* browse still opens onto whatever memory files exist */
        }
        select({ kind: "memory" });
      })();
      return;
    }
    if (action.id === "topics" && !action.target) {
      topicsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    if (action.target) select(action.target);
  };

  const actionLabel = (id: HomeActionId) => t(`home.${id}`);

  return (
    <div className="v4-workspace-home">
      <div
        className="v4-workspace-home-column flex flex-col gap-6 px-[var(--density-page-x,28px)] py-8 pb-16"
        data-workspace-home
        data-home-state={ready ? (view.empty ? "empty" : "ready") : "loading"}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <header className="flex min-w-0 flex-col gap-1.5" data-home-identity>
          <p className="inline-flex w-fit min-w-0 max-w-full items-center gap-1.5 text-3xs text-text-tertiary">
            <RiHome4Line size={ICON.xs} className="shrink-0" aria-hidden />
            <span className="truncate">{t("home.eyebrow")}</span>
          </p>
          <h1 className="min-w-0 truncate text-2xl font-semibold tracking-tight text-text-primary">
            {view.identity.name || t("home.title")}
          </h1>
          {view.identity.root ? (
            <p className="min-w-0 truncate font-mono text-3xs text-text-tertiary" title={view.identity.root}>
              {view.identity.root}
            </p>
          ) : null}
        </header>

        <section aria-label={t("home.actionsLabel")} className="flex min-w-0 flex-col gap-2 lg:max-w-[40rem] lg:items-end">
          <h2 className="text-xs font-medium text-text-secondary lg:sr-only">{t("home.actionsLabel")}</h2>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {view.actions.map((action) => {
              const Icon = ACTION_ICON[action.id];
              const label = actionLabel(action.id);
              return (
                <Button
                  key={action.id}
                  type="button"
                  variant={action.id === "capture" ? "default" : "tonal"}
                  size="sm"
                  data-home-action={action.id}
                  className="min-w-0 max-w-full"
                  onClick={() => runAction(action)}
                >
                  <Icon size={ICON.xs} className="shrink-0" aria-hidden />
                  <span className="min-w-0 truncate">{label}</span>
                </Button>
              );
            })}
          </div>
        </section>
        </div>

        {!ready ? (
          <p className="text-xs text-text-tertiary" data-home-loading>
            {t("home.loading")}
          </p>
        ) : null}

        {ready && view.empty ? (
          <div className="v4-dash-card px-4 py-3" data-home-empty>
            <p className="text-sm font-medium text-text-primary">{t("home.emptyTitle")}</p>
            <p className="mt-1 text-xs leading-relaxed text-text-tertiary">{t("home.emptyHint")}</p>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <section className="v4-dash-card flex min-w-0 flex-col gap-3 p-4 sm:col-span-2" aria-label={t("home.periodLabel")}>
            <div className="flex min-w-0 items-baseline justify-between gap-3">
              <h2 className="text-xs font-medium text-text-secondary">{t("home.periodLabel")}</h2>
              {view.period.present ? (
                <span className="shrink-0 text-3xs text-text-tertiary">
                  {view.period.source === "current" ? t("home.periodCurrent") : t("home.periodLatest")}
                </span>
              ) : null}
            </div>
            {view.period.present ? (
              <>
                <p className="min-w-0 truncate text-lg font-medium text-text-primary">
                  {view.period.title || displayPathSegment(view.period.fileName || view.period.relPath || "")}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" className="min-w-0 max-w-full" onClick={() => select({ kind: "stream" })}>
                    <span className="truncate">{t("home.openStream")}</span>
                  </Button>
                  {view.period.relPath ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-w-0 max-w-full"
                      onClick={() => select({ kind: "file", path: view.period.relPath! })}
                    >
                      <span className="truncate">{t("home.openPeriod")}</span>
                    </Button>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="text-xs leading-relaxed text-text-tertiary">{ready ? t("home.periodEmpty") : t("home.loading")}</p>
            )}
          </section>

          <InfoList
            label={t("home.inboxLabel")}
            count={view.inbox.count}
            items={view.inbox.items}
            empty={t("home.inboxEmpty")}
            ready={ready}
            loading={t("home.loading")}
            openLabel={(name) => t("home.openFile", { name })}
            onOpen={(path) => select({ kind: "file", path })}
            onOpenAll={() => select({ kind: "inbox" })}
            openAll={t("home.openInbox")}
          />
          <InfoList
            label={t("home.outputsLabel")}
            count={view.outputs.count}
            items={view.outputs.items}
            empty={t("home.outputsEmpty")}
            ready={ready}
            loading={t("home.loading")}
            openLabel={(name) => t("home.openFile", { name })}
            onOpen={(path) => select({ kind: "file", path })}
            onOpenAll={() => select({ kind: "outputs" })}
            openAll={t("home.openOutputs")}
          />
        </div>

        <section
          ref={topicsRef}
          className="v4-dash-card flex min-w-0 flex-col gap-3 p-4"
          aria-label={t("home.topicsLabel")}
          data-home-topics
        >
          <div className="flex min-w-0 items-baseline justify-between gap-3">
            <h2 className="text-xs font-medium text-text-secondary">{t("home.topicsLabel")}</h2>
            <span className="shrink-0 text-3xs tabular-nums text-text-tertiary">{view.topics.length}</span>
          </div>
          {view.topics.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {view.topics.map((topic) => (
                <Button
                  key={topic.name}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-w-0 max-w-full"
                  onClick={() => select(topic.target)}
                >
                  <span className="truncate">{topic.name}</span>
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-text-tertiary">{ready ? t("home.topicsEmpty") : t("home.loading")}</p>
          )}
        </section>
      </div>
    </div>
  );
}

function InfoList({
  label,
  count,
  items,
  empty,
  ready,
  loading,
  openLabel,
  onOpen,
  onOpenAll,
  openAll,
}: {
  label: string;
  count: number;
  items: HomeItemSnap[];
  empty: string;
  ready: boolean;
  loading: string;
  openLabel: (name: string) => string;
  onOpen: (path: string) => void;
  onOpenAll: () => void;
  openAll: string;
}) {
  return (
    <section className="v4-dash-card flex min-w-0 flex-col gap-3 p-4" aria-label={label}>
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <h2 className="min-w-0 truncate text-xs font-medium text-text-secondary">{label}</h2>
        <span className="shrink-0 text-lg font-semibold tabular-nums text-text-primary">{ready ? count : ""}</span>
      </div>
      {!ready ? (
        <p className="text-xs text-text-tertiary">{loading}</p>
      ) : count === 0 ? (
        <p className="text-xs leading-relaxed text-text-tertiary">{empty}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {items.map((item) => {
            const name = itemLabel(item);
            const when = item.mtime ? formatRelativeTime(item.mtime) : "";
            return (
              <li key={item.relativePath}>
                <button
                  type="button"
                  className={cn(
                    "flex min-w-0 w-full items-baseline gap-2 rounded-[var(--radius-md)] px-1.5 py-1 text-left",
                    "text-xs text-text-primary hover:bg-surface-muted v4-focus-ring",
                  )}
                  aria-label={openLabel(name)}
                  onClick={() => onOpen(item.relativePath)}
                >
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  {when ? <span className="shrink-0 text-3xs text-text-tertiary">{when}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Button type="button" variant="ghost" size="sm" className="min-w-0 max-w-full self-start" onClick={onOpenAll}>
        <span className="truncate">{openAll}</span>
      </Button>
    </section>
  );
}
