/**
 * Shared workspace file/path context menu — native-feel actions used by
 * list pages (Inbox / Outputs / Category / Topic / Archive) so TreeView and
 * main lists share the same visual + behavior language.
 */
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Copy, FileText, FolderSearch, Trash2, Upload, Files, Edit3,
  ExternalLink, RotateCcw, FolderOpen,
} from "lucide-react";
import { api } from "../../services/api";
import { emitLocal } from "../../plugins/host";
import { useViewStore } from "../../stores/view-store";
import { ICON } from "../../lib/icons";
import { ConfirmDialog, PromptDialog, ErrorDialog } from "./Dialog";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
} from "./context-menu";

export type FileMenuKind = "note" | "inbox" | "output" | "archive" | "topic" | "category";

export interface FileMenuTarget {
  path: string;
  label?: string;
  kind?: FileMenuKind;
  topicId?: string;
  /** Archive restore default path */
  restoreDefault?: string;
}

export interface FileMenuState {
  x: number;
  y: number;
  target: FileMenuTarget;
}

export function useFileContextMenu() {
  const [menu, setMenu] = useState<FileMenuState | null>(null);

  const open = useCallback((e: React.MouseEvent, target: FileMenuTarget) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, target });
  }, []);

  const close = useCallback(() => setMenu(null), []);

  return { menu, open, close };
}

type DialogState =
  | { kind: "none" }
  | { kind: "confirm-delete"; path: string; label: string }
  | { kind: "confirm-publish"; path: string; label: string }
  | { kind: "move-topic"; path: string; label: string }
  | { kind: "rename"; path: string; label: string }
  | { kind: "restore"; path: string; defaultTarget: string }
  | { kind: "error"; title: string; message: string };

interface WorkspaceFileContextMenuProps {
  menu: FileMenuState | null;
  onClose: () => void;
  /** Called after a mutating action succeeds */
  onMutated?: () => void;
}

export function WorkspaceFileContextMenu({
  menu,
  onClose,
  onMutated,
}: WorkspaceFileContextMenuProps) {
  const { t } = useTranslation(["workspace", "common"]);
  const select = useViewStore((s) => s.select);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [permanentDelete, setPermanentDelete] = useState(false);

  const target = menu?.target;
  const kind = target?.kind ?? "note";
  const path = target?.path ?? "";
  const label = target?.label || path.split("/").pop() || path;

  const closeAll = () => {
    onClose();
  };

  const fail = (title: string, e: unknown) => {
    setDialog({
      kind: "error",
      title,
      message: e instanceof Error ? e.message : String(e),
    });
  };

  const handleOpen = () => {
    closeAll();
    if (!path) return;
    if (kind === "topic") {
      select({ kind: "topic", topicId: path });
      return;
    }
    if (kind === "category") {
      select({ kind: "category", category: path });
      return;
    }
    select({
      kind: "file",
      path,
      topicId: target?.topicId,
      readOnly: kind === "archive" ? true : undefined,
    });
  };

  const handleCopyPath = async () => {
    closeAll();
    if (!path) return;
    try {
      await api.ws.copyPath(path);
      emitLocal("toast:show", t("workspace:menu.toastPathCopied"));
    } catch (e) {
      fail(t("workspace:menu.failCopyPath"), e);
    }
  };

  const handleReveal = async () => {
    closeAll();
    if (!path) return;
    try {
      await api.ws.reveal(path);
    } catch (e) {
      fail(t("workspace:menu.failLocate"), e);
    }
  };

  const handleOpenExternal = async () => {
    closeAll();
    if (!path || kind === "topic" || kind === "category") return;
    try {
      await api.ws.open(path);
    } catch (e) {
      fail(t("workspace:menu.failOpen"), e);
    }
  };

  const handleDuplicate = async () => {
    closeAll();
    if (!path || kind !== "note") return;
    try {
      await api.ws.duplicate(path);
      emitLocal("workspace:file-changed");
      emitLocal("toast:show", t("workspace:menu.toastCopyCreated"));
      onMutated?.();
    } catch (e) {
      fail(t("workspace:menu.failMakeCopy"), e);
    }
  };

  const handlePublishRequest = () => {
    onClose();
    if (!path || (kind !== "note" && kind !== "inbox")) return;
    setDialog({ kind: "confirm-publish", path, label });
  };

  const handlePublishConfirm = async () => {
    const d = dialog.kind === "confirm-publish" ? dialog : null;
    setDialog({ kind: "none" });
    if (!d) return;
    try {
      const res = await api.ws.publish(d.path) as {
        note?: string;
        path?: string;
        targetPath?: string;
        mediaCopied?: number;
      };
      emitLocal("workspace:file-changed");
      const media = res?.mediaCopied
        ? ` · ${t("workspace:menu.mediaAssetCount", { count: res.mediaCopied })}`
        : "";
      emitLocal("toast:show", t("workspace:menu.toastDeliveryPublished", { media }));
      const target = res.path || res.targetPath;
      if (target) {
        useViewStore.getState().select({ kind: "file", path: target });
      }
      onMutated?.();
    } catch (e) {
      fail(t("workspace:menu.failPublish"), e);
    }
  };

  const handleMoveRequest = () => {
    onClose();
    if (!path || (kind !== "note" && kind !== "inbox")) return;
    if (!path.endsWith(".md")) return;
    setDialog({ kind: "move-topic", path, label });
  };

  const handleMoveConfirm = async (topicId: string) => {
    const d = dialog.kind === "move-topic" ? dialog : null;
    setDialog({ kind: "none" });
    if (!d || !topicId.trim()) return;
    try {
      const res = await api.ws.move({
        relativePath: d.path,
        targetTopicId: topicId.trim(),
      });
      emitLocal("workspace:file-changed");
      const media = typeof res.mediaMoved === "number" && res.mediaMoved > 0
        ? ` · ${t("workspace:menu.mediaAssetCount", { count: res.mediaMoved })}`
        : "";
      emitLocal("toast:show", t("workspace:menu.toastMovedToTopic", { media }));
      if (res.newPath || res.path) {
        select({ kind: "file", path: String(res.newPath || res.path), topicId: topicId.trim() });
      }
      onMutated?.();
    } catch (e) {
      fail(t("workspace:menu.failMove"), e);
    }
  };

  const handleRenameRequest = () => {
    onClose();
    setDialog({ kind: "rename", path, label });
  };

  const handleRenameConfirm = async (newName: string) => {
    const d = dialog.kind === "rename" ? dialog : null;
    setDialog({ kind: "none" });
    if (!d || !newName.trim() || newName.trim() === d.label) return;
    try {
      const dir = d.path.split("/").slice(0, -1).join("/");
      const nextPath = dir ? `${dir}/${newName.trim()}` : newName.trim();
      await api.ws.rename({ relativePath: d.path, newName: newName.trim() });
      emitLocal("workspace:file-changed");
      select({ kind: "file", path: nextPath });
      onMutated?.();
    } catch (e) {
      fail(t("workspace:menu.failRename"), e);
    }
  };

  const handleDeleteRequest = () => {
    onClose();
    setDialog({ kind: "confirm-delete", path, label });
  };

  const handleDeleteConfirm = async () => {
    const d = dialog.kind === "confirm-delete" ? dialog : null;
    const wasPermanent = permanentDelete;
    setDialog({ kind: "none" });
    setPermanentDelete(false);
    if (!d) return;
    try {
      if (kind === "topic") {
        await api.ws.deleteTopic(d.path);
        select({ kind: "stream" });
      } else {
        await api.ws.del(d.path, { permanent: wasPermanent });
      }
      emitLocal("workspace:file-changed");
      emitLocal("toast:show", wasPermanent ? t("workspace:menu.toastPermanentDeleted") : t("workspace:menu.toastDeleted"));
      onMutated?.();
    } catch (e) {
      fail(t("workspace:menu.failDelete"), e);
    }
  };

  const handleRestoreRequest = () => {
    onClose();
    setDialog({
      kind: "restore",
      path,
      defaultTarget: target?.restoreDefault || path.replace(/^99[- ]Archive\//iu, ""),
    });
  };

  const handleRestoreConfirm = async (targetPath: string) => {
    const d = dialog.kind === "restore" ? dialog : null;
    setDialog({ kind: "none" });
    if (!d || !targetPath.trim()) return;
    try {
      await api.ws.restoreReceipt({
        archiveRelativePath: d.path,
        targetRelativePath: targetPath.trim(),
      });
      emitLocal("workspace:file-changed");
      emitLocal("toast:show", t("workspace:menu.toastRestored"));
      onMutated?.();
    } catch (e) {
      fail(t("workspace:menu.failRestore"), e);
    }
  };

  const showNoteActions = kind === "note";
  const showDelete = kind === "note" || kind === "inbox" || kind === "output" || kind === "topic";
  const showPublish = kind === "note" || kind === "inbox";
  const showMove = (kind === "note" || kind === "inbox") && path.endsWith(".md");
  const showExternal = kind === "note" || kind === "inbox" || kind === "output";
  const showArchive = kind === "archive";
  const showTopic = kind === "topic";
  const showCategory = kind === "category";

  return (
    <>
      <ContextMenu
        open={!!menu}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        onClose={onClose}
        minWidth={216}
      >
        <ContextMenuLabel>
          {kind === "topic"
            ? t("common:category.topic")
            : kind === "category"
              ? t("workspace:sidebar.categoryView")
              : kind === "archive"
                ? t("common:category.archive")
                : kind === "output"
                  ? t("common:category.outputs")
                  : kind === "inbox"
                    ? t("common:category.inbox")
                    : t("workspace:shared.newNote")}
        </ContextMenuLabel>

        <ContextMenuItem
          icon={kind === "topic" || kind === "category" ? <FolderOpen size={ICON.sm} /> : <FileText size={ICON.sm} />}
          onClick={handleOpen}
        >
          {showArchive ? t("workspace:menu.readOnlyOpen") : t("workspace:menu.open")}
        </ContextMenuItem>

        {showNoteActions ? (
          <>
            <ContextMenuItem icon={<Edit3 size={ICON.sm} />} onClick={handleRenameRequest}>
              {t("workspace:menu.rename")}
            </ContextMenuItem>
            <ContextMenuItem icon={<Files size={ICON.sm} />} onClick={() => void handleDuplicate()}>
              {t("workspace:menu.makeCopy")}
            </ContextMenuItem>
          </>
        ) : null}

        {showMove ? (
          <ContextMenuItem icon={<FolderOpen size={ICON.sm} />} onClick={handleMoveRequest}>
            {t("workspace:menu.moveToTopic")}
          </ContextMenuItem>
        ) : null}

        {showPublish ? (
          <ContextMenuItem icon={<Upload size={ICON.sm} />} onClick={handlePublishRequest}>
            {t("workspace:menu.publishDelivery")}
          </ContextMenuItem>
        ) : null}

        {showArchive ? (
          <ContextMenuItem icon={<RotateCcw size={ICON.sm} />} onClick={handleRestoreRequest}>
            {t("workspace:menu.restoreTo")}
          </ContextMenuItem>
        ) : null}

        {showTopic ? (
          <ContextMenuItem
            icon={<FileText size={ICON.sm} />}
            onClick={() => {
              closeAll();
              // Create note via prompt in parent — emit intent for TopicOverview
              emitLocal("workspace:new-note", { topicId: path });
            }}
          >
            {t("workspace:menu.newNote")}
          </ContextMenuItem>
        ) : null}

        {showCategory ? (
          <ContextMenuItem
            icon={<FolderOpen size={ICON.sm} />}
            onClick={() => {
              closeAll();
              emitLocal("workspace:new-topic", { category: path });
            }}
          >
            {t("workspace:menu.newTopic")}
          </ContextMenuItem>
        ) : null}

        <ContextMenuSeparator />

        <ContextMenuItem icon={<Copy size={ICON.sm} />} onClick={() => void handleCopyPath()} shortcut="⌘⇧C">
          {t("workspace:menu.copyPath")}
        </ContextMenuItem>
        <ContextMenuItem icon={<FolderSearch size={ICON.sm} />} onClick={() => void handleReveal()}>
          {t("workspace:menu.showInFileManager")}
        </ContextMenuItem>
        {showExternal ? (
          <ContextMenuItem icon={<ExternalLink size={ICON.sm} />} onClick={() => void handleOpenExternal()}>
            {t("workspace:menu.openWithDefaultApp")}
          </ContextMenuItem>
        ) : null}

        {showDelete ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              icon={<Trash2 size={ICON.sm} />}
              destructive
              onClick={handleDeleteRequest}
            >
              {t("workspace:menu.delete")}
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenu>

      <ConfirmDialog
        open={dialog.kind === "confirm-delete"}
        title={t("workspace:menu.confirmDeleteTitle")}
        description={
          dialog.kind === "confirm-delete"
            ? t("workspace:menu.confirmDeleteMsg", { name: dialog.label })
            : ""
        }
        destructive
        onConfirm={() => void handleDeleteConfirm()}
        onCancel={() => { setDialog({ kind: "none" }); setPermanentDelete(false); }}
      >
        {dialog.kind === "confirm-delete" ? (
          <label className="flex cursor-pointer items-center gap-2 text-3xs text-text-tertiary">
            <input
              type="checkbox"
              checked={permanentDelete}
              onChange={(e) => setPermanentDelete(e.target.checked)}
              className="size-3.5 rounded border-border-subtle accent-error"
            />
            <span>{t("workspace:menu.permanentDelete")}</span>
          </label>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog.kind === "confirm-publish"}
        title={t("workspace:menu.publishDeliveryTitle")}
        description={
          dialog.kind === "confirm-publish"
            ? t("workspace:menu.publishDeliveryMsg", { name: dialog.label })
            : ""
        }
        confirmText={t("workspace:menu.publishBtn")}
        onConfirm={() => void handlePublishConfirm()}
        onCancel={() => setDialog({ kind: "none" })}
      />
      <PromptDialog
        open={dialog.kind === "move-topic"}
        title={t("workspace:menu.moveToTopicTitle")}
        description={
          dialog.kind === "move-topic"
            ? t("workspace:menu.moveToTopicMsg")
            : undefined
        }
        defaultValue=""
        placeholder={t("workspace:menu.moveToTopicPlaceholder")}
        confirmText={t("workspace:menu.moveBtn")}
        onConfirm={(v) => void handleMoveConfirm(v)}
        onCancel={() => setDialog({ kind: "none" })}
      />
      <PromptDialog
        open={dialog.kind === "rename"}
        title={t("workspace:menu.newFileNameTitle")}
        defaultValue={dialog.kind === "rename" ? dialog.label : ""}
        onConfirm={(v) => void handleRenameConfirm(v)}
        onCancel={() => setDialog({ kind: "none" })}
      />
      <PromptDialog
        open={dialog.kind === "restore"}
        title={t("workspace:menu.restorePathTitle")}
        description={dialog.kind === "restore" ? `${t("common:category.archive")}: ${dialog.path}` : undefined}
        defaultValue={dialog.kind === "restore" ? dialog.defaultTarget : ""}
        onConfirm={(v) => void handleRestoreConfirm(v)}
        onCancel={() => setDialog({ kind: "none" })}
      />
      <ErrorDialog
        open={dialog.kind === "error"}
        title={dialog.kind === "error" ? dialog.title : t("workspace:menu.errorTitle")}
        message={dialog.kind === "error" ? dialog.message : ""}
        onClose={() => setDialog({ kind: "none" })}
      />
    </>
  );
}
