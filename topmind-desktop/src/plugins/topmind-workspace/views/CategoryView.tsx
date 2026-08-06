import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Folder, FolderOpen, FileText, Plus } from "lucide-react";
import { api } from "../../../services/api";
import { useViewStore } from "../../../stores/view-store";
import { onLocal, emitLocal } from "../../../plugins/host";
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
import { displayNoteTitle } from "../../../lib/note-meta";
import { ICON } from "../../../lib/icons";
import type { Topic, LooseNote } from "../../../types";

interface Props {
  category: string;
}

export function CategoryView({ category }: Props) {
  const { t } = useTranslation(["workspace", "common"]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [looseNotes, setLooseNotes] = useState<LooseNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "topic" | "note">(null);
  const [errorDialog, setErrorDialog] = useState<string | null>(null);
  const select = useViewStore((s) => s.select);
  const fileMenu = useFileContextMenu();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { topics, looseNotes } = await api.ws.topics(category);
      setTopics(topics || []);
      setLooseNotes(looseNotes || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    void refresh();
    const unsub = onLocal("workspace:file-changed", () => void refresh());
    return () => { unsub(); };
  }, [refresh]);

  const confirmNewTopic = async (name: string) => {
    setDialog(null);
    if (!name.trim()) return;
    try {
      const result = await api.ws.createTopic(category, name.trim());
      emitLocal("workspace:file-changed");
      select({ kind: "topic", topicId: result.topicId });
    } catch (e) {
      setErrorDialog(e instanceof Error ? e.message : String(e));
    }
  };

  const confirmNewNote = async (name: string) => {
    setDialog(null);
    const filename = name.trim();
    if (!filename) return;
    const relativePath = `${category}/${filename.endsWith(".md") ? filename : `${filename}.md`}`;
    try {
      await api.ws.save({ relativePath, content: `# ${filename.replace(/\.md$/, "")}\n\n` });
      emitLocal("workspace:file-changed");
      select({ kind: "file", path: relativePath });
    } catch (e) {
      setErrorDialog(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading) return <LoadingState label={t("common:action.loading")} />;
  if (error) return <ErrorState message={error} onRetry={() => void refresh()} />;

  const empty = topics.length === 0 && looseNotes.length === 0;

  return (
    <ViewContainer>
      <PageHeader
        icon={<Folder size={ICON.md} />}
        title={category}
        subtitle={
          empty
            ? t("workspace:categoryView.noTopicsHint")
            : `${t("workspace:categoryView.topicCount", { count: topics.length })} · ${t("workspace:categoryView.fileCount", { count: looseNotes.length })}`
        }
        actions={
          <div className="flex items-center gap-1.5">
            <Tooltip content={t("workspace:shared.newTopic")}>
              <Button size="sm" onClick={() => setDialog("topic")}>
                <Plus size={ICON.sm} /> {t("workspace:shared.newTopic")}
              </Button>
            </Tooltip>
            <Tooltip content={t("workspace:shared.newNote")}>
              <Button variant="outline" size="sm" onClick={() => setDialog("note")}>
                <Plus size={ICON.sm} /> {t("workspace:shared.newNote")}
              </Button>
            </Tooltip>
          </div>
        }
      />

      {empty ? (
        <EmptyState
          icon={<Folder size={ICON.md} />}
          title={t("workspace:categoryView.noTopicsTitle")}
          hint={t("workspace:categoryView.noTopicsHint")}
          action={
            <>
              <Button variant="outline" size="sm" onClick={() => setDialog("note")}>
                <Plus size={ICON.sm} /> {t("workspace:shared.newNote")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDialog("topic")}>
                <Plus size={ICON.sm} /> {t("workspace:shared.newTopic")}
              </Button>
            </>
          }
        />
      ) : null}

      {topics.length > 0 ? (
        <section className="mb-5">
          <SectionHeader icon={<FolderOpen size={ICON.sm} />} label={t("workspace:topic.title")} count={topics.length} />
          <div className="v4-dash-card p-1.5">
            <RowList>
              {topics.map((item) => (
                <FileRow
                  key={item.id}
                  icon={<FolderOpen size={ICON.xs} className="opacity-80" />}
                  label={item.name}
                  onClick={() => select({ kind: "topic", topicId: item.id })}
                  onContextMenu={(e) =>
                    fileMenu.open(e, { path: item.id, label: item.name, kind: "topic" })
                  }
                  meta={<MetaText>{t("workspace:topic.fileCount", { count: item.fileCount })}</MetaText>}
                />
              ))}
            </RowList>
          </div>
        </section>
      ) : null}

      {looseNotes.length > 0 ? (
        <section>
          <SectionHeader icon={<FileText size={ICON.xs} />} label={t("workspace:categoryView.recentNotes")} count={looseNotes.length} />
          <div className="v4-dash-card p-1.5">
            <RowList>
              {looseNotes.map((n) => (
                <FileRow
                  key={n.relativePath}
                  icon={<FileText size={ICON.xs} className="opacity-80" />}
                  label={displayNoteTitle(n.name)}
                  onClick={() => select({ kind: "file", path: n.relativePath })}
                  onContextMenu={(e) =>
                    fileMenu.open(e, {
                      path: n.relativePath,
                      label: n.name,
                      kind: "note",
                    })
                  }
                />
              ))}
            </RowList>
          </div>
        </section>
      ) : null}

      <WorkspaceFileContextMenu
        menu={fileMenu.menu}
        onClose={fileMenu.close}
        onMutated={() => void refresh()}
      />

      <PromptDialog
        open={dialog === "topic"}
        title={t("workspace:topic.createTitle")}
        defaultValue={`${new Date().getFullYear()}-${t("common:action.newTopic")}`}
        onConfirm={(v) => void confirmNewTopic(v)}
        onCancel={() => setDialog(null)}
      />
      <PromptDialog
        open={dialog === "note"}
        title={t("workspace:shared.newNote")}
        defaultValue={`${t("common:action.newNote")}.md`}
        onConfirm={(v) => void confirmNewNote(v)}
        onCancel={() => setDialog(null)}
      />
      <ErrorDialog
        open={!!errorDialog}
        title={t("common:status.error")}
        message={errorDialog ?? ""}
        onClose={() => setErrorDialog(null)}
      />
    </ViewContainer>
  );
}
