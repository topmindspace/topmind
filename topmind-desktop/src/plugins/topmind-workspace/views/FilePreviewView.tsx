/**
 * FilePreviewView — read-only view for non-Markdown files.
 * HTML/HTM: sandboxed iframe preview (size-capped for memory).
 * Other text: monospace. Binary: open externally.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, FileQuestion, ExternalLink, FolderOpen, Paperclip, Loader2, Code2 } from "lucide-react";
import { api } from "../../../services/api";
import { useAiStore } from "../../../stores/ai-store";
import { Button } from "../../../components/ui/Button";
import { Tooltip } from "../../../components/ui/tooltip";
import { ICON } from "../../../lib/icons";
import { cn } from "../../../lib/cn";
import {
  extOf,
  isHtmlPreviewExt,
  isPreviewableText,
  previewTruncationLimit,
  truncatePreviewContent,
} from "../../../lib/file-preview";

interface Props {
  path: string;
  topicId?: string;
  readOnly?: boolean;
}

export function FilePreviewView({ path }: Props) {
  const { t } = useTranslation(["workspace", "common"]);
  const ext = extOf(path);
  const isHtml = isHtmlPreviewExt(ext);
  const isText = isPreviewableText(ext);
  const baseName = path.split("/").pop() ?? path;
  const [sessionPath, setSessionPath] = useState(path);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(isText);
  const [htmlMode, setHtmlMode] = useState<"preview" | "source">("preview");
  const [truncated, setTruncated] = useState(false);
  // Adjust state during render when the same instance is reused for a new path
  // (React discards this paint). key={path} at call sites remounts as well.
  if (path !== sessionPath) {
    setSessionPath(path);
    setContent(null);
    setError(null);
    setTruncated(false);
    setHtmlMode("preview");
    setLoading(isText);
  }
  const mountFile = useAiStore((s) => s.mountFile);
  const unmountFile = useAiStore((s) => s.unmountFile);
  const mounted = useAiStore((s) => s.mountedFiles.some((m) => m.path === path));
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarCompact, setToolbarCompact] = useState(false);

  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      setToolbarCompact(w < 420);
    });
    ro.observe(el);
    setToolbarCompact(el.clientWidth < 420);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!isText) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.ws
      .read(path)
      .then((c) => {
        if (cancelled) return;
        const raw = typeof c === "string" ? c : String(c ?? "");
        const next = truncatePreviewContent(raw, isHtml);
        setTruncated(next.truncated);
        setContent(next.body);
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path, isText, isHtml]);

  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains("dark"));
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const srcDoc = useMemo(() => {
    if (!isHtml || !content) return "";
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const fg = cs.getPropertyValue("--color-text-primary").trim()
      || (dark ? "#ecece8" : "#2b2b27");
    const bg = cs.getPropertyValue("--color-surface").trim()
      || (dark ? "#262624" : "#fdfdfc");
    return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="color-scheme" content="${dark ? "dark" : "light"}"/><style>html,body{margin:0;padding:12px;font:14px/1.55 system-ui,sans-serif;color:${fg};background:${bg};word-break:break-word}img,video{max-width:100%;height:auto}</style></head><body>${content}</body></html>`;
  }, [isHtml, content, dark]);

  const truncatedHint = truncated
    ? t("workspace:previewView.truncated", { count: previewTruncationLimit(isHtml) })
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col" data-file-preview>
      <div className="v4-editor-toolbar shrink-0 border-b border-border-subtle-dim bg-surface/80">
        <div
          ref={toolbarRef}
          className="flex h-(--density-editor-toolbar-y,36px) items-center justify-between gap-1 px-2 sm:px-2.5"
          data-compact={toolbarCompact ? "true" : undefined}
          data-file-preview-toolbar
        >
          <Tooltip content={path}>
            <span className="flex min-w-0 items-center gap-1.5 text-3xs text-text-tertiary">
              <Eye size={ICON.xs} className="shrink-0" />
              <span className="shrink-0">{isHtml ? "HTML" : t("workspace:editor.readOnly")}</span>
              <span className="min-w-0 truncate font-mono text-text-quaternary">{baseName}</span>
              {truncatedHint ? (
                <span className="min-w-0 truncate text-warning">· {truncatedHint}</span>
              ) : null}
            </span>
          </Tooltip>
          <div className="flex shrink-0 items-center gap-0.5">
            {isHtml ? (
              <div className="v4-segmented mr-0.5 !gap-0.5 !p-0.5" role="tablist" aria-label={t("workspace:previewView.html")}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={htmlMode === "preview"}
                  data-active={htmlMode === "preview"}
                  className="v4-segmented-item !flex-none gap-1 !px-1.5 !py-0.5"
                  onClick={() => setHtmlMode("preview")}
                >
                  <Eye size={ICON.xs} />
                  <span className="text-3xs" data-compact-hidden>{t("workspace:previewView.html")}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={htmlMode === "source"}
                  data-active={htmlMode === "source"}
                  className="v4-segmented-item !flex-none gap-1 !px-1.5 !py-0.5"
                  onClick={() => setHtmlMode("source")}
                >
                  <Code2 size={ICON.xs} />
                  <span className="text-3xs" data-compact-hidden>{t("workspace:previewView.source")}</span>
                </button>
              </div>
            ) : null}
            {isText ? (
              <Tooltip content={mounted ? t("workspace:previewView.unmountTooltip") : t("workspace:previewView.mountTooltip")}>
                <button
                  type="button"
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] transition-colors",
                    "v4-focus-ring",
                    mounted
                      ? "bg-accent-bg-subtle text-accent-color"
                      : "text-text-tertiary hover:bg-surface-muted hover:text-text-primary",
                  )}
                  aria-label={mounted ? t("workspace:previewView.unmountTooltip") : t("workspace:previewView.mountTooltip")}
                  aria-pressed={mounted}
                  onClick={() => (mounted ? unmountFile(path) : mountFile({ path, name: baseName }))}
                >
                  <Paperclip size={ICON.xs} />
                </button>
              </Tooltip>
            ) : null}
            <Tooltip content={t("workspace:previewView.openExternalTooltip")}>
              <button
                type="button"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-text-tertiary transition-colors hover:bg-surface-muted hover:text-text-primary v4-focus-ring"
                aria-label={t("workspace:previewView.openExternalTooltip")}
                onClick={() => void api.ws.open(path)}
              >
                <ExternalLink size={ICON.xs} />
              </button>
            </Tooltip>
            <Tooltip content={t("workspace:previewView.revealTooltip")}>
              <button
                type="button"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-text-tertiary transition-colors hover:bg-surface-muted hover:text-text-primary v4-focus-ring"
                aria-label={t("workspace:previewView.revealTooltip")}
                onClick={() => void api.ws.reveal(path)}
              >
                <FolderOpen size={ICON.xs} />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden bg-surface">
        {isText ? (
          loading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-text-tertiary">
              <Loader2 size={ICON.sm} className="animate-spin" /> {t("common:action.loading")}
            </div>
          ) : error ? (
            <div className="p-6 text-sm text-error">{t("common:status.error")}: {error}</div>
          ) : isHtml && htmlMode === "preview" ? (
            <iframe
              key={path}
              title={baseName}
              sandbox=""
              referrerPolicy="no-referrer"
              className="h-full w-full border-0 bg-surface"
              srcDoc={srcDoc}
            />
          ) : (
            <div className="h-full overflow-auto">
              {isHtml && htmlMode === "source" ? (
                <div className="flex items-center gap-1 border-b border-border-subtle-dim px-3 py-1 text-3xs text-text-quaternary">
                  <Code2 size={ICON.nano} /> {t("workspace:previewView.source")}
                </div>
              ) : null}
              <pre className="whitespace-pre-wrap wrap-break-word p-6 font-mono text-2xs leading-relaxed text-text-primary">
                {content}
              </pre>
            </div>
          )
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="v4-icon-chip flex h-14 w-14 rounded-2xl text-text-quaternary">
              <FileQuestion size={ICON.lg} />
            </div>
            <div className="text-sm font-medium text-text-secondary">{t("workspace:previewView.cannotPreviewTitle")}</div>
            <div className="max-w-sm text-3xs text-text-quaternary">
              {t("workspace:previewView.cannotPreviewHint")}
            </div>
            <Button variant="outline" size="sm" onClick={() => void api.ws.open(path)}>
              <ExternalLink size={ICON.xs} /> {t("workspace:previewView.openExternal")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
