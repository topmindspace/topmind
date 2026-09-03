/**
 * Tree sidebar icons — file type + node kind (Design System 2.0).
 */
import {
  RiBrainLine,
  RiFileCodeLine,
  RiFileLine,
  RiFileTextLine,
  RiFolderLine,
  RiFolderOpenLine,
  RiImageLine as ImageIcon,
  RiInboxArchiveLine,
  RiInboxUnarchiveLine,
  RiStackLine,
} from "@remixicon/react";
import type { TreeNode } from "../../plugins/types";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";

export function TreeNodeIcon({
  node,
  expanded,
  isActive,
}: {
  node: TreeNode;
  expanded: boolean;
  isActive: boolean;
}) {
  const className = cn(
    "shrink-0 transition-colors duration-150",
    isActive ? "text-accent-color" : "text-text-tertiary group-hover:text-text-primary",
  );
  switch (node.kind) {
    case "group":
      if (node.id === "section/inbox") return <RiInboxUnarchiveLine size={ICON.xs} className={className} />;
      if (node.id === "section/memory") return <RiBrainLine size={ICON.xs} className={className} />;
      if (node.id === "section/outputs") return <RiStackLine size={ICON.xs} className={className} />;
      if (node.id === "section/archive") return <RiInboxArchiveLine size={ICON.xs} className={className} />;
      return <RiFolderLine size={ICON.xs} className={className} />;
    case "category":
      return <RiFolderLine size={ICON.xs} className={className} />;
    case "topic":
      return expanded ? (
        <RiFolderOpenLine size={ICON.xs} className={className} />
      ) : (
        <RiFolderLine size={ICON.xs} className={className} />
      );
    case "folder":
      return expanded ? (
        <RiFolderOpenLine size={ICON.xs} className={className} />
      ) : (
        <RiFolderLine size={ICON.xs} className={className} />
      );
    case "file":
      return <TreeFileIcon label={node.label} className={className} />;
    default:
      return <RiFileTextLine size={ICON.xs} className={className} />;
  }
}

export function TreeFileIcon({ label, className }: { label: string; className: string }) {
  const ext = (label.split(".").pop() ?? "").toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"].includes(ext)) {
    return <ImageIcon size={ICON.xs} className={className} />;
  }
  if (ext === "html" || ext === "htm" || ext === "xhtml") {
    return <RiFileCodeLine size={ICON.xs} className={className} />;
  }
  if (["json", "xml", "css", "js", "ts", "tsx", "jsx", "yaml", "yml"].includes(ext)) {
    return <RiFileCodeLine size={ICON.xs} className={className} />;
  }
  if (["doc", "docx", "xls", "xlsx", "ppt", "pptx", "pdf", "csv", "rtf"].includes(ext)) {
    return <RiFileLine size={ICON.xs} className={className} />;
  }
  if (ext === "md" || ext === "markdown" || ext === "txt" || label === ext) {
    return <RiFileTextLine size={ICON.xs} className={className} />;
  }
  return <RiFileLine size={ICON.xs} className={className} />;
}
