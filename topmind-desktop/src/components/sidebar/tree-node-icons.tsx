/**
 * Tree sidebar icons — file type + node kind (Design System 2.0).
 */
import {
  FileText, File, Image as ImageIcon,
  Folder, FolderOpen, Inbox, Archive, Layers, FileCode2, Brain,
} from "lucide-react";
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
      if (node.id === "section/inbox") return <Inbox size={ICON.xs} className={className} />;
      if (node.id === "section/memory") return <Brain size={ICON.xs} className={className} />;
      if (node.id === "section/outputs") return <Layers size={ICON.xs} className={className} />;
      if (node.id === "section/archive") return <Archive size={ICON.xs} className={className} />;
      return <Folder size={ICON.xs} className={className} />;
    case "category":
      return <Folder size={ICON.xs} className={className} />;
    case "topic":
      return expanded ? (
        <FolderOpen size={ICON.xs} className={className} />
      ) : (
        <Folder size={ICON.xs} className={className} />
      );
    case "folder":
      return expanded ? (
        <FolderOpen size={ICON.xs} className={className} />
      ) : (
        <Folder size={ICON.xs} className={className} />
      );
    case "file":
      return <TreeFileIcon label={node.label} className={className} />;
    default:
      return <FileText size={ICON.xs} className={className} />;
  }
}

export function TreeFileIcon({ label, className }: { label: string; className: string }) {
  const ext = (label.split(".").pop() ?? "").toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"].includes(ext)) {
    return <ImageIcon size={ICON.xs} className={className} />;
  }
  if (ext === "html" || ext === "htm" || ext === "xhtml") {
    return <FileCode2 size={ICON.xs} className={className} />;
  }
  if (["json", "xml", "css", "js", "ts", "tsx", "jsx", "yaml", "yml"].includes(ext)) {
    return <FileCode2 size={ICON.xs} className={className} />;
  }
  if (["doc", "docx", "xls", "xlsx", "ppt", "pptx", "pdf", "csv", "rtf"].includes(ext)) {
    return <File size={ICON.xs} className={className} />;
  }
  if (ext === "md" || ext === "markdown" || ext === "txt" || label === ext) {
    return <FileText size={ICON.xs} className={className} />;
  }
  return <File size={ICON.xs} className={className} />;
}
