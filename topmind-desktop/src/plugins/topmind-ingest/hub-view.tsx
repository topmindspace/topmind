/**
 * Knowledge ingest hub — drop zone, queue, external tool status.
 * Selection: { kind: "connector", id: "ingest" }
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FileInput, FolderOpen, Loader2, RefreshCw, FileText, Settings,
} from "lucide-react";
import { api } from "../../services/api";
import { emitLocal } from "../host";
import { useViewStore } from "../../stores/view-store";
import { submitIngestBatch, enqueueFromClipboardBatch } from "../../lib/ingest-batch";
import type { PluginContext, ViewSlot } from "../types";
import type { Topic } from "../../types";
import { Button } from "../../components/ui/Button";
import {
  ViewContainer, LoadingState,
} from "../../components/ui/view";
import { Tooltip } from "../../components/ui/tooltip";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import { getCachedTopicGroups } from "../../lib/workspace-data-cache";
import {
  ConnectorHubHeader,
  ConnectorStatusPill,
  ConnectorToolChip,
} from "../connector-ui";
import { IngestQueuePanel, useIngestJobs } from "../../components/ingest/IngestQueuePanel";

export function createIngestHubView(_ctx: PluginContext): ViewSlot {
  return {
    kind: "view",
    id: "topmind-ingest.view.hub",
    order: 25,
    matches: (sel) => sel.kind === "connector" && sel.id === "ingest",
    render: () => <IngestHubView />,
  };
}

function IngestHubView() {
  const { t } = useTranslation("ingest");
  const select = useViewStore((s) => s.select);
  const openOverlay = useViewStore((s) => s.openOverlay);
  const { loading, activeCount, refresh } = useIngestJobs({ limit: 40 });
  const [destMode, setDestMode] = useState<"inbox" | "topic">("inbox");
  const [topicId, setTopicId] = useState("");
  const [topics, setTopics] = useState<{ id: string; label: string }[]>([]);
  const [tools, setTools] = useState<{ pandoc?: boolean; markitdown?: boolean }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getCachedTopicGroups(false).then((groups) => {
      const list: { id: string; label: string }[] = [];
      for (const g of groups) {
        for (const t of g.topics as Topic[]) {
          list.push({ id: t.id, label: t.id });
        }
      }
      setTopics(list.slice(0, 80));
    }).catch(() => {});
    // Read cached tool status only (no force PATH scan on hub open)
    void api.ingest.toolsStatus(false).then((st) => {
      setTools({
        pandoc: st.pandoc?.available,
        markitdown: st.markitdown?.available,
      });
    }).catch(() => {});
  }, []);

  const dest = useMemo(
    () =>
      destMode === "topic" && topicId
        ? { mode: "topic" as const, topicId }
        : { mode: "inbox" as const },
    [destMode, topicId],
  );

  const enqueuePaths = async (paths: string[]) => {
    if (!paths.length) return;
    setBusy(true);
    try {
      const r = await submitIngestBatch(paths, { dest, openQueue: false });
      if (r.status === "enqueued") {
        emitLocal("workspace:file-changed");
        await refresh();
      } else if (r.status === "empty") {
        setError(t("hub.noFilesError"));
      }
      // staging: sheet handles confirm; refresh when queue events fire
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickFiles = async () => {
    const { paths } = await api.ingest.pickFiles();
    await enqueuePaths(paths);
  };

  const pickFolder = async () => {
    const { path: folder } = await api.ingest.pickFolder();
    if (!folder) return;
    await enqueuePaths([folder]);
  };

  const active = activeCount;

  if (loading) return <LoadingState label={t("hub.loading")} />;

  // markitdown is the main quality boost; pandoc optional. Built-ins work without either.
  const enhancedReady = Boolean(tools.markitdown);

  return (
    <ViewContainer>
      <ConnectorHubHeader
        icon={<FileInput size={ICON.md} />}
        title={t("hub.title")}
        subtitle={
          active > 0
            ? t("hub.subtitleActive", { count: active })
            : t("hub.subtitleIdle")
        }
        meta={
          <>
            <ConnectorStatusPill
              ok={enhancedReady}
              okLabel={t("hub.markitdownReady")}
              badLabel={t("hub.builtinReady")}
              badTone="muted"
            />
            <ConnectorToolChip label="markitdown" ok={tools.markitdown} />
            <ConnectorToolChip label="pandoc" ok={tools.pandoc} />
            {!enhancedReady ? (
              <button
                type="button"
                className="text-accent-color underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
                onClick={() => openOverlay("settings", { topicId: "topmind-ingest.settings" })}
                title={t("hub.installMarkitdownTip")}
              >
                {t("hub.installMarkitdown")}
              </button>
            ) : null}
          </>
        }
        actions={
          <>
            <Tooltip content={t("hub.captureTooltip")}>
              <Button size="sm" variant="outline" onClick={() => openOverlay("quick-capture")}>
                {t("hub.capture")}
              </Button>
            </Tooltip>
            <Tooltip content={t("hub.pasteTooltip")}>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void enqueueFromClipboardBatch({ dest })
                    .then((r) => {
                      if (r.status === "empty") setError(t("hub.clipboardEmpty"));
                      else if (r.status === "enqueued") void refresh();
                    })
                    .catch((e) => setError(e instanceof Error ? e.message : String(e)));
                }}
              >
                {t("hub.paste")}
              </Button>
            </Tooltip>
            <Tooltip content={t("hub.settingsTooltip")}>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openOverlay("settings", { topicId: "topmind-ingest.settings" })}
                aria-label={t("hub.settingsTooltip")}
              >
                <Settings size={ICON.sm} />
              </Button>
            </Tooltip>
            <Tooltip content={t("hub.refreshTooltip")}>
              <Button size="sm" variant="outline" onClick={() => void refresh()} aria-label={t("hub.refreshTooltip")}>
                <RefreshCw size={ICON.sm} />
              </Button>
            </Tooltip>
          </>
        }
      />

      {/* Dest */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-3xs" role="radiogroup" aria-label={t("hub.target")}>
        <span className="text-text-tertiary">{t("hub.target")}</span>
        {(
          [
            ["inbox", t("hub.destInbox")],
            ["topic", t("hub.destTopic")],
          ] as const
        ).map(([id, label]) => {
          const active = destMode === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setDestMode(id)}
              className={cn(
                "rounded-full px-2.5 py-0.5 font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
                active
                  ? "bg-accent-bg-subtle text-accent-color shadow-[inset_0_0_0_1px_var(--color-accent-border-subtle)]"
                  : "text-text-tertiary hover:bg-surface-muted",
              )}
            >
              {label}
            </button>
          );
        })}
        {destMode === "topic" ? (
          <select
            className="max-w-[240px] rounded-[var(--radius-md)] border border-border-subtle bg-surface px-2 py-1 text-3xs outline-none focus-visible:border-accent-color focus-visible:ring-2 focus-visible:ring-ring/35"
            value={topicId}
            onChange={(e) => setTopicId(e.target.value)}
            aria-label={t("hub.destTopic")}
          >
            <option value="">{t("hub.selectTopic")}</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        ) : null}
      </div>

      {/* Single drop zone (shell-level FileDropZone is disabled while this hub is open) */}
      <div
        className={cn(
          "mb-4 flex flex-col items-center justify-center gap-3 rounded-[var(--radius-xl)]",
          "border border-dashed border-border-subtle bg-surface-muted/30 px-6 py-8",
          "transition-colors hover:border-accent-border-subtle hover:bg-accent-bg-faint/40",
          busy && "pointer-events-none opacity-70",
        )}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes("Files")) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(e) => {
          if (!Array.from(e.dataTransfer.types).includes("Files")) return;
          e.preventDefault();
          e.stopPropagation();
          const bridge = (window as { topmind?: { getPathForFile?: (f: File) => string } }).topmind;
          const paths = Array.from(e.dataTransfer.files)
            .map((f) => bridge?.getPathForFile?.(f) || "")
            .filter(Boolean);
          void enqueuePaths(paths);
        }}
      >
        <FileInput size={ICON.xl} className="text-accent-color" />
        <div className="text-sm font-medium">{t("hub.dropHere")}</div>
        <div className="max-w-sm text-center text-3xs text-text-tertiary">
          {t("hub.dropHint")}
          <br />
          {t("hub.formats")}
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void pickFiles()} disabled={busy}>
            {busy ? <Loader2 size={ICON.sm} className="animate-spin" /> : <FileText size={ICON.sm} />}
            {t("hub.selectFiles")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void pickFolder()} disabled={busy}>
            <FolderOpen size={ICON.sm} /> {t("hub.selectFolder")}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mb-3 rounded-[var(--radius-md)] border border-error/20 bg-status-error-bg px-3 py-2 text-3xs text-error" role="alert">
          {error}
        </div>
      ) : null}

      {/* Queue — shared with float capture (same main-process jobs) */}
      <IngestQueuePanel
        variant="full"
        maxItems={40}
        emptyHint={t("hub.emptyHint")}
        onOpenResult={(path) => select({ kind: "file", path })}
      />
    </ViewContainer>
  );
}
