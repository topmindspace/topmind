import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Archive, RotateCcw, Loader2, FolderOpen } from "lucide-react";
import { api } from "../../../services/api";
import { formatRelativeTime } from "../../../lib/datetime";
import { Button } from "../../../components/ui/Button";
import {
  ViewContainer,
  PageHeader,
  EmptyState,
  MetaText,
  RowList,
  FileRow,
  LoadingState,
  ErrorState,
} from "../../../components/ui/view";
import { PromptDialog } from "../../../components/ui/Dialog";
import {
  useFileContextMenu,
  WorkspaceFileContextMenu,
} from "../../../components/ui/workspace-file-menu";
import { Tooltip } from "../../../components/ui/tooltip";
import { useViewStore } from "../../../stores/view-store";
import { onLocal } from "../../../plugins/host";
import { ICON } from "../../../lib/icons";

interface ArchiveItem {
  name: string;
  relativePath: string;
  size: number;
  mtime: string;
}

export function ArchiveView() {
  const { t } = useTranslation(["workspace", "common"]);
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [outputsName, setOutputsName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [restoreDialog, setRestoreDialog] = useState<{ item: ArchiveItem; defaultTarget: string } | null>(null);
  const select = useViewStore((s) => s.select);
  const selection = useViewStore((s) => s.selection);
  const fileMenu = useFileContextMenu();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [archive, outputs] = await Promise.all([
        api.ws.archive(),
        api.ws.outputs().catch(() => ({ files: [], outputsName: "88-Outputs" as string })),
      ]);
      setItems(archive.items || []);
      if (outputs.outputsName) setOutputsName(outputs.outputsName);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsub = onLocal("workspace:file-changed", () => void refresh());
    return () => { unsub(); };
  }, [refresh]);

  const handleRestore = (item: ArchiveItem) => {
    const defaultTarget = `${outputsName}/${item.name.replace(/^\d{4}-\d{2}-\d{2}__/, "")}`;
    setRestoreDialog({ item, defaultTarget });
  };

  const confirmRestore = async (target: string) => {
    if (!restoreDialog) return;
    const { item } = restoreDialog;
    setRestoreDialog(null);
    if (!target.trim()) return;
    setBusy(item.relativePath);
    try {
      await api.ws.restoreReceipt({ archiveRelativePath: item.relativePath, targetRelativePath: target.trim() });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <LoadingState label={t("common:action.loading")} />;
  if (error) return <ErrorState message={error} onRetry={() => void refresh()} />;

  return (
    <ViewContainer>
      <PageHeader
        icon={<Archive size={ICON.sm} />}
        title={t("workspace:archiveView.title")}
        subtitle={
          items.length > 0
            ? t("workspace:archiveView.subtitleItems", { count: items.length })
            : t("workspace:archiveView.subtitleDefault")
        }
      />
      {items.length === 0 ? (
        <EmptyState
          icon={<Archive size={ICON.md} />}
          title={t("workspace:archiveView.emptyTitle")}
          hint={t("workspace:archiveView.emptyHint")}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Tooltip content={t("workspace:archiveView.goStreamTip")}>
                <Button size="sm" onClick={() => select({ kind: "stream" })}>
                  {t("workspace:archiveView.goStream")}
                </Button>
              </Tooltip>
              <Tooltip content={t("workspace:outputsView.title")}>
                <Button variant="outline" size="sm" onClick={() => select({ kind: "outputs" })}>
                  <FolderOpen size={ICON.xs} /> {t("workspace:outputsView.title")}
                </Button>
              </Tooltip>
            </div>
          }
        />
      ) : (
        <div className="v4-dash-card p-1.5">
        <RowList>
          {items.map((a) => {
            const active = selection.kind === "file" && selection.path === a.relativePath;
            const friendly = a.name.replace(/^\d{4}-\d{2}-\d{2}T?[\d._-]*__?/, "") || a.name;
            return (
              <FileRow
                key={a.relativePath}
                icon={<Archive size={ICON.xs} className="opacity-80" />}
                label={friendly}
                secondary={a.relativePath}
                active={active}
                onClick={() => select({ kind: "file", path: a.relativePath, readOnly: true })}
                onContextMenu={(e) =>
                  fileMenu.open(e, {
                    path: a.relativePath,
                    label: friendly,
                    kind: "archive",
                    restoreDefault: `${outputsName}/${a.name.replace(/^\d{4}-\d{2}-\d{2}__/, "")}`,
                  })
                }
                meta={<MetaText>{formatRelativeTime(a.mtime)} · {Math.ceil(a.size / 1024)}KB</MetaText>}
                actions={
                  <Tooltip content={t("workspace:archiveView.restoreTip")}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleRestore(a);
                      }}
                      disabled={busy === a.relativePath}
                      className="h-7 gap-1 px-2 text-3xs shadow-none"
                    >
                      {busy === a.relativePath ? (
                        <Loader2 size={ICON.micro} className="animate-spin" />
                      ) : (
                        <RotateCcw size={ICON.micro} />
                      )}
                      {t("workspace:archiveView.restoreBtn")}
                    </Button>
                  </Tooltip>
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

      {restoreDialog && (
        <PromptDialog
          open
          title={t("workspace:archiveView.restoreBtn")}
          description={`${t("workspace:archiveView.restoreLabel")}: ${restoreDialog.item.relativePath}`}
          defaultValue={restoreDialog.defaultTarget}
          onConfirm={(v) => { void confirmRestore(v); }}
          onCancel={() => setRestoreDialog(null)}
        />
      )}
    </ViewContainer>
  );
}
