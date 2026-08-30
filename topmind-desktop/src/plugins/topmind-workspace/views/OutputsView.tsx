/**
 * Outputs (88-输出) — user-facing delivery shelf.
 * Recursive flat list of filtered files + search + open/reveal/delete.
 */
import { useEffect, useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Layers, FolderOpen, Trash2, Loader2, Zap, FileText, File, FileCode2, RefreshCw,
  FileDown, Copy,
} from "lucide-react";
import { api } from "../../../services/api";
import { formatRelativeTime } from "../../../lib/datetime";
import {
  exportBasenameFromPath,
  markdownBodyToHtmlDocument,
  stripFrontmatterForExport,
} from "../../../lib/export-markdown";
import { toastWriteback, toastWritebackError } from "../../../lib/writeback-toast";
import { emitLocal } from "../../../plugins/host";
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
  FeedLayoutToggle,
  CollectionFeed,
  FeedColumn,
  FeedChrome,
} from "../../../components/ui/view";
import { ConfirmDialog } from "../../../components/ui/Dialog";
import {
  useFileContextMenu,
  WorkspaceFileContextMenu,
} from "../../../components/ui/workspace-file-menu";
import { Tooltip } from "../../../components/ui/tooltip";
import { useViewStore } from "../../../stores/view-store";
import { onLocal } from "../../../plugins/host";
import { ICON } from "../../../lib/icons";
import { cn } from "../../../lib/cn";

interface OutputFile {
  name: string;
  relativePath: string;
  size: number;
  mtime: string;
  ext?: string;
  /** From frontmatter published_at when published via workspace.publishPath */
  publishedAt?: string | null;
  title?: string | null;
}

function fileIcon(name: string) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (ext === "md" || ext === "markdown" || ext === "txt") {
    return <FileText size={ICON.xs} className="opacity-80" />;
  }
  if (ext === "html" || ext === "htm") {
    return <FileCode2 size={ICON.xs} className="opacity-80" />;
  }
  return <File size={ICON.xs} className="opacity-80" />;
}

type OutputGroupKey = "today" | "yesterday" | "older" | "date";

function groupByDay(files: OutputFile[]): { key: OutputGroupKey; date?: string; items: OutputFile[] }[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const map = new Map<string, OutputFile[]>();
  const order: string[] = [];
  for (const f of files) {
    const ts = Date.parse(f.mtime);
    let key: OutputGroupKey = "older";
    let date: string | undefined;
    if (Number.isFinite(ts)) {
      const d = new Date(ts);
      d.setHours(0, 0, 0, 0);
      if (d.getTime() === today.getTime()) key = "today";
      else if (d.getTime() === yesterday.getTime()) key = "yesterday";
      else {
        key = "date";
        date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      }
    }
    const mapKey = `${key}:${date ?? ""}`;
    if (!map.has(mapKey)) {
      map.set(mapKey, []);
      order.push(mapKey);
    }
    map.get(mapKey)!.push(f);
  }
  return order.map((mapKey) => {
    const [key, date] = mapKey.split(":") as [OutputGroupKey, string | undefined];
    return { key, date: date || undefined, items: map.get(mapKey)! };
  });
}

export function OutputsView() {
  const { t } = useTranslation(["workspace", "common"]);
  const [files, setFiles] = useState<OutputFile[]>([]);
  const [outputsName, setOutputsName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OutputFile | null>(null);
  const [filter, setFilter] = useState("");
  const select = useViewStore((s) => s.select);
  const selection = useViewStore((s) => s.selection);
  const feedLayout = useViewStore((s) => s.feedLayout);
  const setFeedLayout = useViewStore((s) => s.setFeedLayout);
  const openOverlay = useViewStore((s) => s.openOverlay);
  const fileMenu = useFileContextMenu();

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      let fileFilter = "default";
      try {
        const settings = await api.sys.settings();
        fileFilter = (settings.ui as { fileFilter?: string } | undefined)?.fileFilter || "default";
      } catch {
        /* */
      }
      const { files: list, outputsName: name } = await api.ws.outputs({
        recursiveFlat: true,
        filter: fileFilter,
        limit: 500,
      });
      const sorted = [...(list || [])].sort((a, b) =>
        String(b.mtime || "").localeCompare(String(a.mtime || "")),
      );
      setFiles(sorted);
      if (name) setOutputsName(name);
      setError(null);
    } catch (e) {
      if (!opts?.silent) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsub1 = onLocal("workspace:file-changed", () => void refresh({ silent: true }));
    const unsub2 = onLocal("sidebar:file-filter-changed", () => void refresh());
    return () => {
      unsub1();
      unsub2();
    };
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return files;
    return files.filter(
      (f) =>
        f.name.toLowerCase().includes(q)
        || f.relativePath.toLowerCase().includes(q),
    );
  }, [files, filter]);

  const groups = useMemo(() => groupByDay(filtered), [filtered]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const file = deleteTarget;
    setDeleteTarget(null);
    setBusy(file.relativePath);
    try {
      await api.ws.del(file.relativePath);
      await refresh({ silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleReveal = async (file: OutputFile) => {
    try {
      await api.ws.reveal(file.relativePath);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleExportHtml = async (file: OutputFile) => {
    if (!file.name.toLowerCase().endsWith(".md")) return;
    setBusy(file.relativePath);
    try {
      const raw = await api.ws.read(file.relativePath);
      const { body, title } = stripFrontmatterForExport(raw);
      const html = markdownBodyToHtmlDocument(body, {
        title: title || file.name.replace(/\.md$/iu, ""),
        sourcePath: file.relativePath,
      });
      const dir = file.relativePath.includes("/")
        ? file.relativePath.slice(0, file.relativePath.lastIndexOf("/"))
        : "";
      const outName = exportBasenameFromPath(file.relativePath, "html");
      const outRel = dir ? `${dir}/${outName}` : outName;
      const res = await api.ws.save({ relativePath: outRel, content: html });
      emitLocal("workspace:file-changed", { relativePath: outRel });
      toastWriteback(t("workspace:outputsView.exportHtmlDone", { path: outRel }), res);
      await refresh({ silent: true });
    } catch (e) {
      toastWritebackError(t("workspace:outputsView.exportHtmlFail"), e);
    } finally {
      setBusy(null);
    }
  };

  const handleCopyMarkdown = async (file: OutputFile) => {
    if (!file.name.toLowerCase().endsWith(".md")) return;
    try {
      const raw = await api.ws.read(file.relativePath);
      const { body } = stripFrontmatterForExport(raw);
      await navigator.clipboard.writeText(body);
      emitLocal("toast:show", { text: t("workspace:outputsView.copyMarkdownDone"), kind: "success" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading) return <LoadingState label={t("common:action.loading")} />;
  if (error) return <ErrorState message={error} onRetry={() => void refresh()} />;

  return (
    <ViewContainer>
      <PageHeader
        icon={<Layers size={ICON.sm} />}
        title={t("workspace:outputsView.title")}
        subtitle={
          files.length > 0
            ? t("workspace:outputsView.subtitle", { name: outputsName, count: files.length })
            : t("workspace:outputsView.emptySubtitle", { name: outputsName })
        }
        actions={
          <div className="flex items-center gap-1">
            <Tooltip content={t("common:action.refresh")}>
              <Button variant="ghost" size="sm" onClick={() => void refresh()} className="h-7 w-7 p-0">
                <RefreshCw size={ICON.xs} />
              </Button>
            </Tooltip>
            <Tooltip content={t("workspace:inbox.captureBtn")}>
              <Button variant="outline" size="sm" onClick={() => openOverlay("quick-capture")}>
                <Zap size={ICON.xs} /> {t("workspace:inbox.captureBtn")}
              </Button>
            </Tooltip>
          </div>
        }
      />
      {files.length === 0 ? (
        <EmptyState
          icon={<Layers size={ICON.md} />}
          title={t("workspace:outputsView.emptyTitle")}
          hint={t("workspace:outputsView.emptyHint")}
          action={
            <Tooltip content={t("workspace:inbox.captureBtn")}>
              <Button variant="outline" size="sm" onClick={() => openOverlay("quick-capture")}>
                <Zap size={ICON.xs} /> {t("workspace:inbox.captureBtn")}
              </Button>
            </Tooltip>
          }
        />
      ) : (
        <FeedColumn collection>
        <FeedChrome>
          <FeedLayoutToggle value={feedLayout} onChange={setFeedLayout} />
        </FeedChrome>
        <div className={feedLayout === "list" ? "v4-dash-card p-1.5" : undefined}>
          <div className="mb-1.5 flex items-center gap-2 px-1">
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("common:placeholder.filter")}
              className="v4-input h-7 min-w-0 flex-1 rounded-[var(--radius-md)] border border-border-subtle bg-surface px-2 text-3xs"
            />
            <span className="shrink-0 text-3xs tabular-nums text-text-quaternary">
              {filtered.length}/{files.length}
            </span>
          </div>
          {filtered.length === 0 ? (
            <p className="px-2 py-4 text-center text-3xs text-text-quaternary">{t("workspace:inbox.emptyNoMatchTitle")}</p>
          ) : (
            groups.map((g) => (
              <div key={`${g.key}:${g.date ?? ""}`} className="mb-1.5">
                <div className="sticky top-0 z-local flex items-center gap-1.5 bg-surface/95 px-2 py-1 text-3xs font-medium text-text-quaternary">
                  {g.key === "today"
                    ? t("workspace:outputsView.groupToday")
                    : g.key === "yesterday"
                      ? t("workspace:outputsView.groupYesterday")
                      : g.key === "older"
                        ? t("workspace:outputsView.groupOlder")
                        : g.date}
                  <span className="tabular-nums opacity-70">{g.items.length}</span>
                </div>
                <CollectionFeed layout={feedLayout}>
                <RowList>
                  {g.items.map((f) => {
                    const active =
                      selection.kind === "file" && selection.path === f.relativePath;
                    const label =
                      (typeof f.title === "string" && f.title.trim())
                        || f.name.replace(/\.[^.]+$/u, "")
                        || f.name;
                    const folderHint = f.relativePath.includes("/")
                      ? f.relativePath.split("/").slice(1, -1).join(" / ")
                      : "";
                    const isPublished = Boolean(f.publishedAt && String(f.publishedAt).trim());
                    return (
                      <FileRow
                        key={f.relativePath}
                        icon={fileIcon(f.name)}
                        label={label}
                        secondary={
                          folderHint
                            ? `${folderHint} · ${f.name}`
                            : f.name !== label
                              ? f.name
                              : undefined
                        }
                        active={active}
                        onClick={() => select({ kind: "file", path: f.relativePath })}
                        onContextMenu={(e) =>
                          fileMenu.open(e, {
                            path: f.relativePath,
                            label: f.name,
                            kind: "output",
                          })
                        }
                        meta={
                          <MetaText>
                            <span
                              className={cn(
                                "mr-1.5 inline-flex rounded px-1 py-px text-3xs font-medium",
                                isPublished
                                  ? "bg-success/10 text-success"
                                  : "bg-surface-muted text-text-quaternary",
                              )}
                            >
                              {isPublished
                                ? t("workspace:outputsView.badgePublished")
                                : t("workspace:outputsView.badgeDraft")}
                            </span>
                            {isPublished
                              ? t("workspace:outputsView.metaPublished", {
                                  when: formatRelativeTime(String(f.publishedAt)),
                                })
                              : formatRelativeTime(f.mtime)}
                            {" · "}
                            {Math.max(1, Math.ceil(f.size / 1024))}KB
                          </MetaText>
                        }
                        actions={
                          <>
                            {f.name.toLowerCase().endsWith(".md") ? (
                              <>
                                <Tooltip content={t("workspace:outputsView.copyMarkdown")}>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => void handleCopyMarkdown(f)}
                                    disabled={busy === f.relativePath}
                                    className="h-6 w-6 p-0"
                                  >
                                    <Copy size={ICON.micro} />
                                  </Button>
                                </Tooltip>
                                <Tooltip content={t("workspace:outputsView.exportHtml")}>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => void handleExportHtml(f)}
                                    disabled={busy === f.relativePath}
                                    className="h-6 w-6 p-0"
                                  >
                                    <FileDown size={ICON.micro} />
                                  </Button>
                                </Tooltip>
                              </>
                            ) : null}
                            <Tooltip content={t("workspace:outputsView.openFolder")}>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void handleReveal(f)}
                                disabled={busy === f.relativePath}
                                className="h-6 w-6 p-0"
                              >
                                <FolderOpen size={ICON.micro} />
                              </Button>
                            </Tooltip>
                            <Tooltip content={t("workspace:menu.confirmDeleteTitle")}>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => setDeleteTarget(f)}
                                disabled={busy === f.relativePath}
                                className="h-6 w-6 p-0"
                              >
                                {busy === f.relativePath ? (
                                  <Loader2 size={ICON.micro} className="animate-spin" />
                                ) : (
                                  <Trash2 size={ICON.micro} />
                                )}
                              </Button>
                            </Tooltip>
                          </>
                        }
                        className={cn(busy === f.relativePath && "opacity-60")}
                      />
                    );
                  })}
                </RowList>
                </CollectionFeed>
              </div>
            ))
          )}
        </div>
        </FeedColumn>
      )}
      <WorkspaceFileContextMenu
        menu={fileMenu.menu}
        onClose={fileMenu.close}
        onMutated={() => void refresh({ silent: true })}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t("workspace:menu.delete")}
        description={
          deleteTarget
            ? t("workspace:outputsView.confirmDelete", { name: deleteTarget.name })
            : ""
        }
        confirmText={t("common:action.delete")}
        cancelText={t("common:action.cancel")}
        destructive
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </ViewContainer>
  );
}
