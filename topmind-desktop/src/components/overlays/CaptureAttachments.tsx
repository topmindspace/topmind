/**
 * QuickCapture attachment chips + empty drop hint.
 * useCaptureDrop owns the sheet-level paste / drag-drop wiring for files.
 */
import { useState } from "react";
import { modKey } from "../../lib/shortcuts";
import { RiCloseLine, RiFileTextLine, RiFolderOpenLine } from "@remixicon/react";
import { useTranslation } from "react-i18next";
import { ICON } from "../../lib/icons";
import type { CaptureAttachment } from "./quick-capture-helpers";

/** Sheet-level smart paste + drag/drop handlers (attachments into the capture form). */
export function useCaptureDrop({
  isFloat,
  addPaths,
  handleSmartPaste,
  setError,
}: {
  isFloat: boolean;
  addPaths: (paths: string[]) => void;
  handleSmartPaste: (opts?: { fromEvent?: boolean }) => Promise<void>;
  setError: (msg: string | null) => void;
}) {
  const { t } = useTranslation();
  const [dragOver, setDragOver] = useState(false);

  /** DOM paste — captures Finder file paste as FileList when available */
  const onPasteCapture = async (e: React.ClipboardEvent) => {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      const bridge = (window as { topmind?: { getPathForFile?: (f: File) => string } }).topmind;
      const paths: string[] = [];
      for (const f of Array.from(files)) {
        const p = bridge?.getPathForFile?.(f) || "";
        if (p) paths.push(p);
      }
      if (paths.length) {
        e.preventDefault();
        addPaths(paths);
        return;
      }
    }
    // If text looks like absolute paths only, treat as file list
    const text = e.clipboardData?.getData("text/plain")?.trim() || "";
    if (text) {
      const lines = text.split(/\r?\n/u).map((l) => l.trim()).filter(Boolean);
      if (
        lines.length >= 1 &&
        lines.every((l) => l.startsWith("file:") || (l.startsWith("/") && l.includes(".")))
      ) {
        // Let smart paste verify existence via main
        e.preventDefault();
        void handleSmartPaste();
      }
    }
  };

  const containerProps = {
    onPaste: onPasteCapture,
    onDragEnter: (e: React.DragEvent) => {
      if (Array.from(e.dataTransfer.types).includes("Files")) {
        e.preventDefault();
        setDragOver(true);
      }
    },
    onDragOver: (e: React.DragEvent) => {
      if (Array.from(e.dataTransfer.types).includes("Files")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    },
    onDragLeave: () => setDragOver(false),
    onDrop: (e: React.DragEvent) => {
      if (!Array.from(e.dataTransfer.types).includes("Files")) return;
      e.preventDefault();
      setDragOver(false);
      const bridge = (window as { topmind?: { getPathForFile?: (f: File) => string } }).topmind;
      const files = Array.from(e.dataTransfer.files);
      const paths = files
        .map((f) => bridge?.getPathForFile?.(f) || "")
        .filter(Boolean);
      if (!paths.length && files.length > 0) {
        setError(
          isFloat
            ? t("overlays:capture.errorDropFloat")
            : t("overlays:capture.errorDropOverlay"),
        );
        return;
      }
      addPaths(paths);
    },
  };

  return { dragOver, containerProps };
}

export function CaptureAttachmentList({
  attachments,
  onRemove,
}: {
  attachments: CaptureAttachment[];
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (attachments.length === 0) return null;
  return (
    <ul className="mb-2 max-h-28 space-y-1 overflow-y-auto">
      {attachments.map((a) => (
        <li
          key={a.id}
          className="flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border-subtle bg-surface-inset px-2 py-1 text-3xs"
        >
          <RiFileTextLine size={ICON.xs} className="shrink-0 text-accent-color" />
          <span className="min-w-0 flex-1 truncate font-medium" title={a.absolutePath}>
            {a.name}
          </span>
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-text-quaternary hover:text-error"
            onClick={() => onRemove(a.id)}
            aria-label={t("overlays:capture.removeAttachment")}
          >
            <RiCloseLine size={ICON.xs} />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function CaptureDropHint({ visible }: { visible: boolean }) {
  const { t } = useTranslation();
  if (!visible) return null;
  return (
    <div className="mb-2 flex flex-col items-center gap-1 rounded-[var(--radius-lg)] border border-dashed border-border-subtle px-3 py-4 text-center">
      <RiFolderOpenLine size={ICON.md} className="text-text-quaternary" />
      <div className="text-3xs text-text-tertiary">{t("overlays:capture.dropHint", { mod: modKey() })}</div>
    </div>
  );
}
