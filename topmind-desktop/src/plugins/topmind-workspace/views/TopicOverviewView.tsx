import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  RiAddLine,
  RiBrainLine,
  RiEdit2Line,
  RiFileTextLine,
  RiFolderOpenLine,
} from "@remixicon/react";
import { api } from "../../../services/api";
import { useViewStore } from "../../../stores/view-store";
import { onLocal } from "../../../plugins/host";
import { Button } from "../../../components/ui/Button";
import {
  ViewContainer,
  SectionHeader,
  EmptyState,
  MetaText,
  RowList,
  FileRow,
  LoadingState,
  ErrorState,
  FeedLayoutToggle,
  CollectionFeed,
  FeedColumn,
  FeedChrome,
} from "../../../components/ui/view";
import { TitleBarActions } from "../../../lib/chrome-portal";
import { useTitleBarChrome } from "../../../lib/titlebar-chrome";
import { PromptDialog, ErrorDialog } from "../../../components/ui/Dialog";
import {
  useFileContextMenu,
  WorkspaceFileContextMenu,
} from "../../../components/ui/workspace-file-menu";
import { Tooltip } from "../../../components/ui/tooltip";
import { displayNoteTitle, noteTitleDiffersFromFile } from "../../../lib/note-meta";
import { formatRelativeTime } from "../../../lib/datetime";
import { ICON } from "../../../lib/icons";
import { cn } from "../../../lib/cn";

interface TopicFileItem {
  name: string;
  title?: string | null;
  mtime: string;
  size: number;
}

interface Props {
  topicId: string;
}

export function TopicOverviewView({ topicId }: Props) {
  const { t } = useTranslation(["workspace", "common"]);
  const [data, setData] = useState<{
    topicName: string;
    category?: string;
    files: TopicFileItem[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [errorDialog, setErrorDialog] = useState<string | null>(null);
  const select = useViewStore((s) => s.select);
  const selection = useViewStore((s) => s.selection);
  const feedLayout = useViewStore((s) => s.feedLayout);
  const setFeedLayout = useViewStore((s) => s.setFeedLayout);
  const openOverlay = useViewStore((s) => s.openOverlay);
  const fileMenu = useFileContextMenu();

  const loadGen = useRef(0);
  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    const gen = ++loadGen.current;
    const silent = Boolean(opts?.silent);
    if (!silent) setLoading(true);
    try {
      const topic = await api.ws.getTopic(topicId);
      if (gen !== loadGen.current) return;
      setData({
        topicName: topic.topicName,
        category: topic.category,
        files: topic.files || [],
      });
      setError(null);
    } catch (e) {
      if (gen !== loadGen.current) return;
      if (!silent) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, [topicId]);

  useEffect(() => {
    void refresh();
    const unsub = onLocal("workspace:file-changed", () => void refresh({ silent: true }));
    return () => { unsub(); };
  }, [refresh]);

  const sortedFiles = useMemo(() => {
    if (!data?.files) return [];
    return [...data.files].sort((a, b) => {
      if (a.name === "topic.md") return -1;
      if (b.name === "topic.md") return 1;
      return b.mtime.localeCompare(a.mtime);
    });
  }, [data?.files]);

  const handleNewNote = () => setPromptOpen(true);

  const confirmNewNote = async (filename: string) => {
    setPromptOpen(false);
    const name = filename.trim();
    if (!name) return;
    const finalName = name.endsWith(".md") ? name : `${name}.md`;
    const relativePath = `${topicId}/${finalName}`;
    try {
      await api.ws.saveNote({
        topicId,
        filename: finalName,
        content: `# ${finalName.replace(/\.md$/, "")}\n\n`,
        sourceType: "user-original",
      });
      await refresh();
      select({ kind: "file", path: relativePath, topicId });
    } catch (e) {
      setErrorDialog(e instanceof Error ? e.message : String(e));
    }
  };

  const openTopicMd = async () => {
    const topicPath = `${topicId}/topic.md`;
    try {
      await api.ws.read(topicPath);
    } catch {
      await api.ws.saveNote({
        topicId,
        filename: "topic.md",
        content: `# ${data?.topicName || topicId}\n\n## Stable Memory\n\n${t("workspace:topicOverview.placeholderText")}\n\n## Working Notes\n\n${t("workspace:topicOverview.placeholderText")}\n`,
        sourceType: "user-original",
      });
      await refresh();
    }
    select({ kind: "file", path: topicPath, topicId });
  };

  const hasTopic = Boolean(data?.files.some((f) => f.name === "topic.md"));
  const mdCount = data?.files.filter((f) => f.name.endsWith(".md")).length ?? 0;
  const categoryLabel = data?.category || topicId.split("/")[0] || "";

  useTitleBarChrome("topic", {
    title: data?.topicName || topicId.split("/").pop() || topicId,
    stats: data
      ? [categoryLabel, t("workspace:topicOverview.notesCount", { count: mdCount }), hasTopic ? t("workspace:topicOverview.hasTopicFile") : null]
          .filter(Boolean)
          .join(" · ")
      : "",
  });

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => void refresh()} />;
  if (!data) return null;

  return (
    <ViewContainer>
      <TitleBarActions>
        <Tooltip content={t("workspace:topicOverview.writeMemory")}>
          <button
            type="button"
            className="v4-titlebar-btn gap-1 px-2 text-xs"
            onClick={() => openOverlay("quick-capture", { intent: "memory", topicId })}
            aria-label={t("workspace:topicOverview.memory")}
          >
            <RiBrainLine size={ICON.sm} />
            <span className="hidden sm:inline">{t("workspace:topicOverview.memory")}</span>
          </button>
        </Tooltip>
        <Tooltip content={hasTopic ? t("workspace:topicOverview.openTopicFile") : t("workspace:topicOverview.createTopicFile")}>
          <button
            type="button"
            className="v4-titlebar-btn"
            onClick={() => void openTopicMd()}
            aria-label={hasTopic ? t("workspace:topicOverview.openTopicFile") : t("workspace:topicOverview.createTopicFile")}
          >
            <RiEdit2Line size={ICON.sm} />
          </button>
        </Tooltip>
        <Tooltip content={t("common:action.new")}>
          <button
            type="button"
            className="v4-titlebar-btn gap-1 px-2 text-xs"
            onClick={handleNewNote}
            aria-label={t("common:action.new")}
          >
            <RiAddLine size={ICON.sm} />
            <span className="hidden sm:inline">{t("common:action.new")}</span>
          </button>
        </Tooltip>
      </TitleBarActions>

      <FeedColumn collection>
        <FeedChrome>
          <FeedLayoutToggle value={feedLayout} onChange={setFeedLayout} />
        </FeedChrome>
      <SectionHeader icon={<RiFileTextLine size={ICON.xs} />} label={t("workspace:topicOverview.notes")} count={sortedFiles.length} />
      {sortedFiles.length === 0 ? (
        <EmptyState
          icon={<RiFileTextLine size={ICON.md} />}
          title={t("workspace:topicOverview.noNotes")}
          hint={t("workspace:topicOverview.noNotesHint")}
          action={
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleNewNote}>
                <RiAddLine size={ICON.xs} /> {t("common:action.new")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => openOverlay("quick-capture")}>
                {t("workspace:inbox.captureBtn")}
              </Button>
            </div>
          }
        />
      ) : (
        <CollectionFeed layout={feedLayout} className={feedLayout === "list" ? "v4-dash-card p-1.5" : undefined}>
          <RowList>
            {sortedFiles.map((f) => {
              const isTopicFile = f.name === "topic.md";
              const label = isTopicFile
                ? t("workspace:topicOverview.topicFile")
                : displayNoteTitle(f.name, f.title);
              const active =
                selection.kind === "file" &&
                selection.path === `${topicId}/${f.name}`;
              return (
                <FileRow
                  key={f.name}
                  icon={
                    <RiFileTextLine
                      size={ICON.xs}
                      className={cn(isTopicFile ? "text-accent-color" : "opacity-80")}
                    />
                  }
                  label={label}
                  secondary={
                    noteTitleDiffersFromFile(f.name, f.title) || isTopicFile
                      ? f.name
                      : undefined
                  }
                  active={active}
                  onClick={() => select({ kind: "file", path: `${topicId}/${f.name}`, topicId })}
                  onContextMenu={(e) =>
                    fileMenu.open(e, {
                      path: `${topicId}/${f.name}`,
                      label: f.name,
                      kind: "note",
                      topicId,
                    })
                  }
                  meta={
                    <MetaText>
                      {isTopicFile ? `${t("workspace:topicOverview.mainPrefix")} · ` : ""}
                      {formatRelativeTime(f.mtime)} · {Math.max(1, Math.ceil(f.size / 1024))}KB
                    </MetaText>
                  }
                />
              );
            })}
          </RowList>
        </CollectionFeed>
      )}
      </FeedColumn>
      <WorkspaceFileContextMenu
        menu={fileMenu.menu}
        onClose={fileMenu.close}
        onMutated={() => void refresh()}
      />
      <PromptDialog
        open={promptOpen}
        title={t("workspace:categoryView.newTopicTitle")}
        defaultValue={t("common:action.newNote") + ".md"}
        onConfirm={(v) => void confirmNewNote(v)}
        onCancel={() => setPromptOpen(false)}
      />
      <ErrorDialog open={!!errorDialog} title={t("common:status.failed")} message={errorDialog || ""} onClose={() => setErrorDialog(null)} />
    </ViewContainer>
  );
}
