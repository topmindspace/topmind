import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, FileText, PenLine, Sparkles, Brain, Plus } from "lucide-react";
import { api } from "../../../services/api";
import { useViewStore } from "../../../stores/view-store";
import { onLocal } from "../../../plugins/host";
import { Button } from "../../../components/ui/Button";
import {
  ViewContainer,
  PageHeader,
  SectionHeader,
  EmptyState,
  MetaText,
  RowList,
  FileRow,
  LoadingState,
  ErrorState,
} from "../../../components/ui/view";
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
  const setAiPanelOpen = useViewStore((s) => s.setAiPanelOpen);
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

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => void refresh()} />;
  if (!data) return null;

  const hasTopic = data.files.some((f) => f.name === "topic.md");
  const mdCount = data.files.filter((f) => f.name.endsWith(".md")).length;
  const categoryLabel = data.category || topicId.split("/")[0] || "";

  return (
    <ViewContainer>
      <PageHeader
        icon={<FolderOpen size={ICON.sm} />}
        title={data.topicName}
        subtitle={[
          categoryLabel,
          t("workspace:topicOverview.notesCount", { count: mdCount }),
          hasTopic ? t("workspace:topicOverview.hasTopicFile") : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <div className="flex items-center gap-1">
            <Tooltip content={t("workspace:topicOverview.writeMemory")}>
              <Button variant="outline" size="sm" onClick={() => openOverlay("quick-capture", { intent: "memory", topicId })}>
                <Brain size={ICON.xs} /> {t("workspace:topicOverview.memory")}
              </Button>
            </Tooltip>
            <Tooltip content={hasTopic ? t("workspace:topicOverview.openTopicFile") : t("workspace:topicOverview.createTopicFile")}>
              <Button variant="outline" size="sm" onClick={() => void openTopicMd()}>
                <PenLine size={ICON.xs} />
              </Button>
            </Tooltip>
            <Tooltip content={t("workspace:topicOverview.openAiCollaboration")}>
              <Button variant="outline" size="sm" onClick={() => setAiPanelOpen(true)}>
                <Sparkles size={ICON.xs} />
              </Button>
            </Tooltip>
            <Tooltip content={t("common:action.new")}>
              <Button size="sm" onClick={handleNewNote}>
                <Plus size={ICON.xs} /> {t("common:action.new")}
              </Button>
            </Tooltip>
          </div>
        }
      />

      <SectionHeader icon={<FileText size={ICON.xs} />} label={t("workspace:topicOverview.notes")} count={sortedFiles.length} />
      {sortedFiles.length === 0 ? (
        <EmptyState
          icon={<FileText size={ICON.md} />}
          title={t("workspace:topicOverview.noNotes")}
          hint={t("workspace:topicOverview.noNotesHint")}
          action={
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleNewNote}>
                <Plus size={ICON.xs} /> {t("common:action.new")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => openOverlay("quick-capture")}>
                {t("workspace:inbox.captureBtn")}
              </Button>
            </div>
          }
        />
      ) : (
        <div className="v4-dash-card p-1.5">
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
                    <FileText
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
        </div>
      )}
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
