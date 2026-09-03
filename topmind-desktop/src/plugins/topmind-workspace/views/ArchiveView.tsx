import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  RiArrowGoBackLine,
  RiFolderOpenLine,
  RiInboxArchiveLine,
  RiLoader4Line,
} from "@remixicon/react";
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
  FilterChip,
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

type ArchiveLayer = "all" | "receipt" | "backup" | "trash" | "other";

function classifyArchiveRel(rel: string): Exclude<ArchiveLayer, "all"> {
  const p = String(rel || "").replace(/\\/g, "/");
  if (/\/receipts\//u.test(p) || /\/restore-receipts\//u.test(p)) return "receipt";
  if (/\/backups\/trash\//u.test(p) || /\/trash\//u.test(p)) return "trash";
  if (/\/backups\//u.test(p)) return "backup";
  return "other";
}

export function ArchiveView() {
  const { t } = useTranslation(["workspace", "common"]);
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [layer, setLayer] = useState<ArchiveLayer>("all");
  const [outputsName, setOutputsName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [restoreDialog, setRestoreDialog] = useState<{ item: ArchiveItem; defaultTarget: string } | null>(null);
  const select = useViewStore((s) => s.select);
  const selection = useViewStore((s) => s.selection);
  const fileMenu = useFileContextMenu();

  const loadGen = useRef(0);
  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    const gen = ++loadGen.current;
    const silent = Boolean(opts?.silent);
    if (!silent) setLoading(true);
    try {
      const [archive, outputs] = await Promise.all([
        api.ws.archive({ recursiveFlat: true, limit: 240 }),
        api.ws.outputs().catch(() => ({ files: [], outputsName: "88-Outputs" as string })),
      ]);
      if (gen !== loadGen.current) return;
      setItems(archive.items || []);
      if (outputs.outputsName) setOutputsName(outputs.outputsName);
      setError(null);
    } catch (e) {
      if (gen !== loadGen.current) return;
      if (!silent) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsub = onLocal("workspace:file-changed", () => void refresh({ silent: true }));
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

  const visible = items.filter((it) => {
    if (layer === "all") return true;
    return classifyArchiveRel(it.relativePath) === layer;
  });
  const layerCounts = {
    receipt: items.filter((it) => classifyArchiveRel(it.relativePath) === "receipt").length,
    backup: items.filter((it) => classifyArchiveRel(it.relativePath) === "backup").length,
    trash: items.filter((it) => classifyArchiveRel(it.relativePath) === "trash").length,
  };

  if (loading) return <LoadingState label={t("common:action.loading")} />;
  if (error) return <ErrorState message={error} onRetry={() => void refresh()} />;

  return (
    <ViewContainer>
      <PageHeader
        icon={<RiInboxArchiveLine size={ICON.sm} />}
        title={t("workspace:archiveView.title")}
        subtitle={
          items.length > 0
            ? t("workspace:archiveView.subtitleItems", { count: items.length })
            : t("workspace:archiveView.subtitleDefault")
        }
      />
      {items.length > 0 ? (
        <div className="mb-2.5 flex flex-wrap items-center gap-1" role="tablist" aria-label={t("workspace:archiveView.layerFilter")}>
          <FilterChip active={layer === "all"} label={t("workspace:archiveView.layerAll")} count={items.length} onClick={() => setLayer("all")} />
          <FilterChip active={layer === "receipt"} label={t("workspace:archiveView.layerReceipt")} count={layerCounts.receipt} onClick={() => setLayer("receipt")} />
          <FilterChip active={layer === "backup"} label={t("workspace:archiveView.layerBackup")} count={layerCounts.backup} onClick={() => setLayer("backup")} />
          <FilterChip active={layer === "trash"} label={t("workspace:archiveView.layerTrash")} count={layerCounts.trash} onClick={() => setLayer("trash")} />
        </div>
      ) : null}
      {visible.length === 0 ? (
        <EmptyState
          icon={<RiInboxArchiveLine size={ICON.md} />}
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
                  <RiFolderOpenLine size={ICON.xs} /> {t("workspace:outputsView.title")}
                </Button>
              </Tooltip>
            </div>
          }
        />
      ) : (
        <div className="v4-dash-card p-1.5">
        <RowList>
          {visible.map((a) => {
            const active = selection.kind === "file" && selection.path === a.relativePath;
            const kind = classifyArchiveRel(a.relativePath);
            const friendly = a.name.replace(/^\d{4}-\d{2}-\d{2}T?[\d._-]*__?/, "") || a.name;
            const kindLabel =
              kind === "receipt"
                ? t("workspace:archiveView.layerReceipt")
                : kind === "backup"
                  ? t("workspace:archiveView.layerBackup")
                  : kind === "trash"
                    ? t("workspace:archiveView.layerTrash")
                    : t("workspace:archiveView.layerOther");
            const canRestore = kind === "backup" || kind === "trash";
            return (
              <FileRow
                key={a.relativePath}
                icon={<RiInboxArchiveLine size={ICON.xs} className="opacity-80" />}
                label={friendly}
                secondary={`${kindLabel} · ${a.relativePath}`}
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
                  canRestore ? (
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
                        <RiLoader4Line size={ICON.micro} className="animate-spin" />
                      ) : (
                        <RiArrowGoBackLine size={ICON.micro} />
                      )}
                      {t("workspace:archiveView.restoreBtn")}
                    </Button>
                  </Tooltip>
                  ) : (
                    <span className="text-3xs text-text-quaternary">{t("workspace:archiveView.viewOnly")}</span>
                  )
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
