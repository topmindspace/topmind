/**
 * Built-in tree context menu by node kind + plugin slots.
 * Handlers stay in TreeViewNode; this file is presentation only.
 */
import {
  RiAddLine,
  RiContractUpDownLine,
  RiDeleteBin6Line,
  RiEditLine,
  RiExpandUpDownLine,
  RiFileCopyLine,
  RiFileTextLine,
  RiFolderOpenLine,
  RiInboxArchiveLine,
  RiInboxUnarchiveLine,
  RiPuzzleLine,
  RiStackLine,
  RiUpload2Line,
} from "@remixicon/react";
import { useTranslation } from "react-i18next";
import type { TreeNode } from "../../plugins/types";
import type { ContextMenuSlot } from "../../plugins/types";
import {
  ContextMenu, ContextMenuItem, ContextMenuSeparator, ContextMenuLabel,
} from "../ui/context-menu";
import { ICON } from "../../lib/icons";

export type TreeNodeMenuHandlers = {
  closeMenu: () => void;
  handleOpenSelection: () => void;
  handleNewTopic: () => void;
  handleNewCategoryNote: () => void;
  handleNewNote: () => void;
  handleExpandAllUnder: () => void;
  handleCollapseUnder: () => void;
  handleCopyPath: () => void;
  handleReveal: () => void;
  handleDelete: () => void;
  handleRename: () => void;
  handleRenameTopic: () => void;
  handleDuplicate: () => void;
  handlePublish: () => void;
  handleOpenExternal: () => void;
  openQuickCapture: () => void;
  expandFolderIfNeeded: () => void;
  runPlugin: (slot: ContextMenuSlot) => void;
};

export function TreeNodeContextMenu({
  open,
  x,
  y,
  node,
  expanded,
  isFileNode,
  isReadOnly,
  pluginMenuItems,
  h,
}: {
  open: boolean;
  x: number;
  y: number;
  node: TreeNode;
  expanded: boolean;
  isFileNode: boolean;
  isReadOnly: boolean;
  pluginMenuItems: ContextMenuSlot[];
  h: TreeNodeMenuHandlers;
}) {
  const { t } = useTranslation("shell");
  const label =
    node.kind === "file"
      ? t("sidebar.contextMenu.labelFile")
      : node.kind === "topic"
        ? t("sidebar.contextMenu.labelTopic")
        : node.kind === "category"
          ? t("sidebar.contextMenu.labelCategory")
          : node.kind === "group"
            ? t("sidebar.contextMenu.labelGroup")
            : t("sidebar.contextMenu.labelDefault");

  return (
    <ContextMenu open={open} x={x} y={y} onClose={h.closeMenu} minWidth={208}>
      <ContextMenuLabel>{label}</ContextMenuLabel>
      {node.kind === "group" && node.id === "section/inbox" ? (
        <>
          <ContextMenuItem icon={<RiInboxUnarchiveLine size={ICON.sm} />} onClick={h.handleOpenSelection} shortcut="⌘⇧I">
            {t("sidebar.contextMenu.openInbox")}
          </ContextMenuItem>
          <ContextMenuItem icon={<RiAddLine size={ICON.sm} />} shortcut="⌘N" onClick={h.openQuickCapture}>
            {t("sidebar.contextMenu.quickCapture")}
          </ContextMenuItem>
        </>
      ) : null}
      {node.kind === "group" && node.id === "section/outputs" ? (
        <ContextMenuItem icon={<RiStackLine size={ICON.sm} />} onClick={h.handleOpenSelection} shortcut="⌘⇧O">
          {t("sidebar.contextMenu.openOutputs")}
        </ContextMenuItem>
      ) : null}
      {node.kind === "group" && node.id === "section/archive" ? (
        <ContextMenuItem icon={<RiInboxArchiveLine size={ICON.sm} />} onClick={h.handleOpenSelection} shortcut="⌘⇧A">
          {t("sidebar.contextMenu.openArchive")}
        </ContextMenuItem>
      ) : null}

      {node.kind === "category" ? (
        <>
          <ContextMenuItem icon={<RiFolderOpenLine size={ICON.sm} />} onClick={h.handleOpenSelection}>
            {t("sidebar.contextMenu.openCategory")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem icon={<RiAddLine size={ICON.sm} />} onClick={h.handleNewTopic}>
            {t("sidebar.contextMenu.newTopic")}
          </ContextMenuItem>
          <ContextMenuItem icon={<RiAddLine size={ICON.sm} />} onClick={h.handleNewCategoryNote}>
            {t("sidebar.contextMenu.newNote")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem icon={<RiExpandUpDownLine size={ICON.sm} />} onClick={h.handleExpandAllUnder}>
            {t("sidebar.contextMenu.expandAll")}
          </ContextMenuItem>
          <ContextMenuItem icon={<RiContractUpDownLine size={ICON.sm} />} onClick={h.handleCollapseUnder}>
            {t("sidebar.contextMenu.collapseAll")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem icon={<RiFileCopyLine size={ICON.sm} />} onClick={h.handleCopyPath}>
            {t("sidebar.contextMenu.copyPath")}
          </ContextMenuItem>
          <ContextMenuItem icon={<RiFolderOpenLine size={ICON.sm} />} onClick={h.handleReveal}>
            {t("sidebar.contextMenu.revealInFolder")}
          </ContextMenuItem>
        </>
      ) : null}

      {node.kind === "folder" ? (
        <>
          <ContextMenuItem icon={<RiFolderOpenLine size={ICON.sm} />} onClick={h.expandFolderIfNeeded}>
            {expanded ? t("sidebar.contextMenu.expanded") : t("sidebar.contextMenu.expandFolder")}
          </ContextMenuItem>
          <ContextMenuItem icon={<RiFileCopyLine size={ICON.sm} />} onClick={h.handleCopyPath}>
            {t("sidebar.contextMenu.copyPath")}
          </ContextMenuItem>
          <ContextMenuItem icon={<RiFolderOpenLine size={ICON.sm} />} onClick={h.handleReveal}>
            {t("sidebar.contextMenu.revealInFolder")}
          </ContextMenuItem>
        </>
      ) : null}

      {node.kind === "topic" ? (
        <>
          <ContextMenuItem icon={<RiFolderOpenLine size={ICON.sm} />} onClick={h.handleOpenSelection}>
            {t("sidebar.contextMenu.openTopic")}
          </ContextMenuItem>
          <ContextMenuItem icon={<RiAddLine size={ICON.sm} />} onClick={h.handleNewNote}>
            {t("sidebar.contextMenu.newNote")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem icon={<RiEditLine size={ICON.sm} />} onClick={h.handleRenameTopic}>
            {t("sidebar.contextMenu.renameTopic")}
          </ContextMenuItem>
          <ContextMenuItem icon={<RiFileCopyLine size={ICON.sm} />} onClick={h.handleCopyPath}>
            {t("sidebar.contextMenu.copyPath")}
          </ContextMenuItem>
          <ContextMenuItem icon={<RiFolderOpenLine size={ICON.sm} />} onClick={h.handleReveal}>
            {t("sidebar.contextMenu.revealInFolder")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem icon={<RiDeleteBin6Line size={ICON.sm} />} destructive onClick={h.handleDelete}>
            {t("sidebar.contextMenu.deleteTopic")}
          </ContextMenuItem>
        </>
      ) : null}

      {isFileNode ? (
        isReadOnly ? (
          <>
            <ContextMenuItem icon={<RiFileTextLine size={ICON.sm} />} onClick={h.handleOpenSelection}>
              {t("sidebar.contextMenu.openPreview")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem icon={<RiFileCopyLine size={ICON.sm} />} onClick={h.handleCopyPath}>
              {t("sidebar.contextMenu.copyPath")}
            </ContextMenuItem>
            <ContextMenuItem icon={<RiFolderOpenLine size={ICON.sm} />} onClick={h.handleReveal}>
              {t("sidebar.contextMenu.revealInFolder")}
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem icon={<RiFileTextLine size={ICON.sm} />} onClick={h.handleOpenSelection}>
              {t("sidebar.contextMenu.open")}
            </ContextMenuItem>
            <ContextMenuItem icon={<RiEditLine size={ICON.sm} />} onClick={h.handleRename}>
              {t("sidebar.contextMenu.rename")}
            </ContextMenuItem>
            <ContextMenuItem icon={<RiFileCopyLine size={ICON.sm} />} onClick={h.handleDuplicate}>
              {t("sidebar.contextMenu.duplicate")}
            </ContextMenuItem>
            <ContextMenuItem icon={<RiUpload2Line size={ICON.sm} />} onClick={h.handlePublish}>
              {t("sidebar.contextMenu.publishToOutputs")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem icon={<RiFileCopyLine size={ICON.sm} />} onClick={h.handleCopyPath}>
              {t("sidebar.contextMenu.copyPath")}
            </ContextMenuItem>
            <ContextMenuItem icon={<RiFolderOpenLine size={ICON.sm} />} onClick={h.handleReveal}>
              {t("sidebar.contextMenu.revealInFolder")}
            </ContextMenuItem>
            <ContextMenuItem icon={<RiFileTextLine size={ICON.sm} />} onClick={h.handleOpenExternal}>
              {t("sidebar.contextMenu.openExternal")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem icon={<RiDeleteBin6Line size={ICON.sm} />} destructive onClick={h.handleDelete}>
              {t("sidebar.contextMenu.delete")}
            </ContextMenuItem>
          </>
        )
      ) : null}

      {pluginMenuItems.length > 0 ? (
        <>
          <ContextMenuSeparator />
          {pluginMenuItems.map((slot) => (
            <ContextMenuItem
              key={slot.id}
              icon={<RiPuzzleLine size={ICON.sm} />}
              disabled={slot.available ? !slot.available(node) : false}
              onClick={() => h.runPlugin(slot)}
            >
              {slot.label}
            </ContextMenuItem>
          ))}
        </>
      ) : null}
    </ContextMenu>
  );
}
