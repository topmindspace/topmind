/**
 * FilePreviewView — read-only view for non-Markdown files.
 * HTML/HTM: sandboxed iframe preview (size-capped for memory).
 * Other text: monospace. Binary: open externally.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, FileQuestion, ExternalLink, FolderOpen, Paperclip, Loader2, Code2 } from "lucide-react";
import { api } from "../../../services/api";
import { useAiStore } from "../../../stores/ai-store";
import { Button } from "../../../components/ui/Button";
import { Tooltip } from "../../../components/ui/tooltip";
import { ICON } from "../../../lib/icons";
import { cn } from "../../../lib/cn";

const TEXT_EXTS = new Set([
  "txt", "text", "markdown", "mdx", "json", "jsonc", "yaml", "yml", "csv", "tsv",
  "log", "ini", "toml", "xml", "svg", "html", "htm", "css", "scss", "less",
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "kt",
  "c", "h", "cpp", "hpp", "cs", "php", "swift", "sh", "bash", "zsh", "sql", "env",
  "conf", "cfg", "properties", "gitignore", "editorconfig", "dockerfile", "makefile",
]);

/** Soft cap so huge HTML dumps don't inflate renderer memory. */
const HTML_MAX_BYTES = 1_500_000;
const TEXT_MAX_CHARS = 400_000;

function extOf(p: string): string {
  const base = p.split("/").pop() ?? p;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

interface Props {
  path: string;
  topicId?: string;
  readOnly?: boolean;
}

export function FilePreviewView({ path }: Props) {
  const { t } = useTranslation(["workspace", "common"]);
  const ext = extOf(path);
  const isHtml = ext === "html" || ext === "htm";
  const isText = ext === "" || TEXT_EXTS.has(ext);
  const baseName = path.split("/").pop() ?? path;
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(isText);
  const [htmlMode, setHtmlMode] = useState<"preview" | "source">("preview");
  const [truncated, setTruncated] = useState(false);
  const mountFile = useAiStore((s) => s.mountFile);
  const unmountFile = useAiStore((s) => s.unmountFile);
  const mounted = useAiStore((s) => s.mountedFiles.some((m) => m.path === path));

  useEffect(() => {
    if (!isText) {
      setContent(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTruncated(false);
    api.ws
      .read(path)
      .then((c) => {
        if (cancelled) return;
        let body = typeof c === "string" ? c : String(c ?? "");
        if (isHtml && body.length > HTML_MAX_BYTES) {
          body = body.slice(0, HTML_MAX_BYTES);
          setTruncated(true);
        } else if (body.length > TEXT_MAX_CHARS) {
          body = body.slice(0, TEXT_MAX_CHARS);
          setTruncated(true);
        }
        setContent(body);
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

  // Release large strings when leaving the view
  useEffect(() => {
    return () => {
      setContent(null);
    };
  }, [path]);

  // Track effective app theme so the sandboxed preview follows light/dark
  // (iframe srcdoc can't read parent CSS variables).
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
    // Read token values from the document root so the iframe preview stays
    // in sync with the design system without duplicating hex values.
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const fg = cs.getPropertyValue("--color-text-primary").trim()
      || (dark ? "#f0ede4" : "#2b2822");
    const bg = cs.getPropertyValue("--color-surface").trim()
      || (dark ? "#282520" : "#fffefb");
    return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="color-scheme" content="${dark ? "dark" : "light"}"/><style>html,body{margin:0;padding:12px;font:14px/1.55 system-ui,sans-serif;color:${fg};background:${bg};word-break:break-word}img,video{max-width:100%;height:auto}</style></head><body>${content}</body></html>`;
  }, [isHtml, content, dark]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[var(--control-h-lg,36px)] items-center justify-between border-b border-border-subtle px-3">
        <Tooltip content={path}>
          <span className="flex min-w-0 items-center gap-1.5 text-3xs text-text-tertiary">
            <Eye size={ICON.xs} /> {isHtml ? "HTML" : t("workspace:editor.readOnly")}
            <span className="max-w-[360px] truncate font-mono text-text-quaternary">{path}</span>
            {truncated ? <span className="text-warning">· {t("workspace:previewView.truncated")}</span> : null}
          </span>
        </Tooltip>
        <div className="flex shrink-0 items-center gap-1">
          {isHtml ? (
            <div className="mr-1 flex rounded-[var(--radius-md)] border border-border-subtle bg-surface-muted/40 p-0.5">
              <button
                type="button"
                className={cn(
                  "rounded px-1.5 py-0.5 text-3xs",
                  htmlMode === "preview" ? "bg-surface text-accent-color shadow-sm" : "text-text-tertiary",
                )}
                onClick={() => setHtmlMode("preview")}
              >
                {t("workspace:previewView.html")}
              </button>
              <button
                type="button"
                className={cn(
                  "rounded px-1.5 py-0.5 text-3xs",
                  htmlMode === "source" ? "bg-surface text-accent-color shadow-sm" : "text-text-tertiary",
                )}
                onClick={() => setHtmlMode("source")}
              >
                {t("workspace:previewView.source")}
              </button>
            </div>
          ) : null}
          {isText ? (
            <Tooltip content={mounted ? t("workspace:previewView.unmountTooltip") : t("workspace:previewView.mountTooltip")}>
              <Button
                variant={mounted ? "default" : "ghost"}
                size="sm"
                onClick={() => (mounted ? unmountFile(path) : mountFile({ path, name: baseName }))}
              >
                <Paperclip size={ICON.xs} /> {mounted ? t("workspace:previewView.mountedAi") : t("workspace:previewView.mountAi")}
              </Button>
            </Tooltip>
          ) : null}
          <Tooltip content={t("workspace:previewView.openExternalTooltip")}>
            <Button variant="ghost" size="sm" onClick={() => void api.ws.open(path)}>
              <ExternalLink size={ICON.xs} /> {t("workspace:previewView.openExternal")}
            </Button>
          </Tooltip>
          <Tooltip content={t("workspace:previewView.revealTooltip")}>
            <Button variant="ghost" size="sm" onClick={() => void api.ws.reveal(path)}>
              <FolderOpen size={ICON.xs} /> {t("workspace:previewView.reveal")}
            </Button>
          </Tooltip>
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
