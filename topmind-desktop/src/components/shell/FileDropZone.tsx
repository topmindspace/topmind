import { useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ICON } from "../../lib/icons";
import { submitIngestBatch } from "../../lib/ingest-batch";
import { useViewStore } from "../../stores/view-store";

/**
 * OS file-drop → knowledge ingest pipeline (batch → optional confirm → queue).
 * Path references only; does not copy binaries into the workspace before enqueue.
 * Native HTML5 drag is independent of @dnd-kit inbox→topic moves.
 *
 * When the Knowledge Ingest hub is open, shell-level drop is disabled so only
 * the hub drop zone receives files (avoids dual drop targets).
 */
export function FileDropZone({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation("shell");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const depth = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selection = useViewStore((s) => s.selection);
  /** Ingest hub owns its own drop zone — do not compete with it. */
  const ingestHubActive =
    selection.kind === "connector" && selection.id === "ingest";

  const isFileDrag = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  const flashToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  };

  const onDragEnter = (e: React.DragEvent) => {
    if (ingestHubActive) return;
    if (!isFileDrag(e)) return;
    e.preventDefault();
    depth.current += 1;
    setDragging(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (ingestHubActive) return;
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (ingestHubActive) return;
    if (!isFileDrag(e)) return;
    depth.current -= 1;
    if (depth.current <= 0) {
      depth.current = 0;
      setDragging(false);
    }
  };
  const onDrop = async (e: React.DragEvent) => {
    if (ingestHubActive) return;
    if (!isFileDrag(e)) return;
    e.preventDefault();
    depth.current = 0;
    setDragging(false);

    const bridge = (window as { topmind?: { getPathForFile?: (f: File) => string } }).topmind;
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const paths: string[] = [];
    let skipped = 0;
    for (const f of files) {
      const absolutePath = bridge?.getPathForFile?.(f) ?? "";
      if (absolutePath) paths.push(absolutePath);
      else skipped += 1;
    }
    if (paths.length === 0) {
      flashToast(
        skipped
          ? t("toast.importFailedSkipped", { count: skipped })
          : t("toast.importFailed"),
      );
      return;
    }

    setBusy(true);
    try {
      const res = await submitIngestBatch(paths, {
        dest: { mode: "inbox" },
        openQueue: true,
      });
      if (res.status === "enqueued") {
        flashToast(t("toast.enqueued", { count: res.count }));
      } else if (res.status === "staging") {
        flashToast(t("toast.staging", { count: res.count }));
      } else if (res.status === "empty") {
        flashToast(t("toast.empty"));
      }
    } catch (err) {
      console.error("[ingest]", err);
      flashToast(err instanceof Error ? err.message : t("toast.enqueueFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="relative flex h-full min-h-0 w-full min-w-0 flex-row overflow-hidden"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
      {dragging ? (
        <div className="pointer-events-none absolute inset-0 z-floating flex items-center justify-center bg-accent-bg-subtle/90 animate-fade-in">
          <div className="flex flex-col items-center gap-2.5 rounded-[var(--radius-xl)] border-2 border-dashed border-accent-color bg-surface px-10 py-8 text-accent-color shadow-[var(--shadow-overlay)]">
            <Download size={ICON.xl} />
            <div className="text-sm font-semibold tracking-tight">{t("fileDropZone.releaseToImport")}</div>
            <div className="text-3xs text-text-tertiary">
              {t("fileDropZone.dropHint")}
            </div>
          </div>
        </div>
      ) : null}
      {busy || toast ? (
        // Shell-parity toast frame (Shell.tsx info toast): same bottom offset,
        // radius, padding, shadow and animation so the two surfaces read as one.
        <div className="absolute bottom-10 left-1/2 z-floating flex max-w-[min(420px,90vw)] -translate-x-1/2 items-center gap-2 rounded-[var(--radius-lg)] border border-border-subtle-dim bg-surface px-3.5 py-2 text-3xs font-medium text-text-secondary shadow-[var(--shadow-float)] animate-toast-in">
          {busy ? (
            <span className="flex items-center gap-1.5">
              <Loader2 size={ICON.micro} className="animate-spin text-accent-color" /> {t("fileDropZone.preparing")}
            </span>
          ) : (
            toast
          )}
        </div>
      ) : null}
    </div>
  );
}
