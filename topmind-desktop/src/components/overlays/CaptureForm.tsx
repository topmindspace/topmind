/**
 * QuickCapture form — note body, dest/source/mode controls, submit + AI polish.
 * useCaptureForm owns all capture state + handlers; CaptureForm is presentational
 * (attachment / preview regions arrive as slots so the sheet DOM order is unchanged).
 */
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, Download, Loader2, Sparkles } from "lucide-react";
import { api } from "../../services/api";
import { useViewStore } from "../../stores/view-store";
import { useAiStore } from "../../stores/ai-store";
import { emitLocal } from "../../plugins/host";
import { toastWriteback, toastWritebackError } from "../../lib/writeback-toast";
import { submitIngestBatch } from "../../lib/ingest-batch";
import { IngestQueuePanel } from "../ingest/IngestQueuePanel";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Textarea } from "../ui/textarea";
import { Tooltip } from "../ui/tooltip";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import { CaptureModeBar } from "./CaptureModeBar";
import {
  type CaptureAttachment,
  type CaptureMode,
  type FetchMeta,
  FETCH_DEFAULT,
  FETCH_STEP_KEYS,
  cleanCaptureTitle,
  deriveTitleFromContent,
  methodLabelKey,
  pathToAttachment,
} from "./quick-capture-helpers";
import { polishComposerText } from "../../lib/ai-polish-text";
import { useInlineAiStore } from "../../lib/inline-ai-busy";

export function useCaptureForm({
  isFloat,
  isMemory,
  memoryTopicId,
  onDone,
}: {
  isFloat: boolean;
  isMemory: boolean;
  memoryTopicId?: string;
  onDone?: () => void;
}) {
  const { t } = useTranslation();

  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [sourceType, setSourceType] = useState<"user-original" | "external-capture">("user-original");
  /** Note landing: stream (default) or inbox when unsure — DESIGN capture dest.
   *  When the user is in the inbox view, default to inbox for seamless capture.
   *  When a URL is fetched, auto-switch to inbox (fetched articles are knowledge,
   *  not stream moments). User can still manually switch back. */
  const [noteDest, setNoteDest] = useState<"stream" | "inbox">(() => {
    const sel = useViewStore.getState().selection;
    return sel.kind === "inbox" ? "inbox" : "stream";
  });
  /** Track if user manually changed dest — prevents auto-switch from overriding. */
  const destUserOverride = useRef(false);
  /** User-facing dest setter — marks override so auto-switch won't clobber. */
  const handleSetNoteDest = useCallback((d: "stream" | "inbox") => {
    destUserOverride.current = true;
    setNoteDest(d);
  }, []);
  /** Progressive disclosure: title / mode / source under「更多」 until needed */
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [attachments, setAttachments] = useState<CaptureAttachment[]>([]);
  const [mode, setMode] = useState<CaptureMode>("auto");
  const [submitting, setSubmitting] = useState(false);
  const [fetching, setFetching] = useState(false);
  /** URL fetch pipeline stage for progressive feedback (reads → extract → markdown). */
  const [fetchStage, setFetchStage] = useState<0 | 1 | 2 | 3>(0);
  const [error, setError] = useState<string | null>(null);
  const [fetchMeta, setFetchMeta] = useState<FetchMeta | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  /** After document enqueue, show shared queue (float can stay without opening main). */
  const [showQueue, setShowQueue] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const aiReady = useAiStore((s) => s.runtimeStatus?.ready ?? false);

  const closeOverlay = useViewStore((s) => s.closeOverlay);
  const select = useViewStore((s) => s.select);
  const contentRef = useRef(content);
  const submittingRef = useRef(submitting);
  const attachmentsRef = useRef(attachments);
  contentRef.current = content;
  submittingRef.current = submitting;
  attachmentsRef.current = attachments;

  const effectiveMode: "note" | "docs" | "mixed" = useMemo(() => {
    if (isMemory) return "note";
    const hasText = Boolean(content.trim());
    const hasDocs = attachments.length > 0;
    if (mode === "note") return hasDocs ? "mixed" : "note";
    if (mode === "docs") return hasText ? "mixed" : "docs";
    // auto
    if (hasDocs && hasText) return "mixed";
    if (hasDocs) return "docs";
    return "note";
  }, [mode, content, attachments, isMemory]);

  const addPaths = useCallback((paths: string[]) => {
    if (!paths.length) return;
    setAttachments((prev) => {
      const existing = new Set(prev.map((a) => a.absolutePath));
      const next = [...prev];
      for (const p of paths) {
        if (!p || existing.has(p)) continue;
        existing.add(p);
        next.push(pathToAttachment(p));
      }
      return next.slice(0, 50);
    });
    setHint(t("overlays:capture.attachedHint", { count: paths.length }));
    setTimeout(() => setHint(null), 2800);
  }, []);

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  /** Smart paste: OS clipboard files + text/html */
  const handleSmartPaste = async (opts?: { fromEvent?: boolean }) => {
    setError(null);
    try {
      const clip = await api.ingest.readClipboard();
      if (clip.filePaths?.length) {
        addPaths(clip.filePaths);
      }
      if (clip.kind === "html" && clip.html && !opts?.fromEvent) {
        // Prefer markdown-ish plain text if available; else stash html as source note
        const textBody = clip.text || clip.html;
        setContent((c) => (c ? `${c}\n${textBody}` : textBody));
        setSourceType("external-capture");
      } else if (clip.text && !opts?.fromEvent) {
        const text = clip.text.trim();
        if (text && !(clip.filePaths?.length && text.split("\n").every((l) => l.startsWith("/") || l.startsWith("file:")))) {
          setContent((c) => (c ? `${c}\n${text}` : text));
          if (/^https?:\/\/\S+$/iu.test(text) && !source.trim()) {
            setSource(text);
            setSourceType("external-capture");
          }
        }
      }
      if (!clip.filePaths?.length && !clip.text && !clip.html) {
        setError(t("overlays:capture.errorEmptyClipboard"));
      }
    } catch {
      // Fallback: browser clipboard text only
      try {
        const text = (await navigator.clipboard.readText()).trim();
        if (!text) {
          setError(t("overlays:capture.errorClipboardRead"));
          return;
        }
        setContent((c) => (c ? `${c}\n${text}` : text));
        if (/^https?:\/\/\S+$/iu.test(text) && !source.trim()) {
          setSource(text);
          setSourceType("external-capture");
        }
      } catch {
        setError(t("overlays:capture.errorClipboardFallback"));
      }
    }
  };

  const applyFetchResult = (
    result: Awaited<ReturnType<typeof api.ws.fetchUrl>>,
    maxLen: number,
  ) => {
    if (result.url) setSource(result.url);
    const cleanedTitle = cleanCaptureTitle(result.title || "", result.siteName);
    const metaLines = [
      `> ${t("overlays:capture.metaSource")}: ${result.url}`,
      `> ${t("overlays:capture.metaTitle")}: ${cleanedTitle || t("overlays:capture.metaNoTitle")}`,
    ];
    if (result.description) metaLines.push(`> ${t("overlays:capture.metaDescription")}: ${result.description}`);
    if (result.author) metaLines.push(`> ${t("overlays:capture.metaAuthor")}: ${result.author}`);
    if (result.siteName) metaLines.push(`> ${t("overlays:capture.metaSite")}: ${result.siteName}`);
    if (result.method) metaLines.push(`> ${t("overlays:capture.metaMethod")}: ${t(methodLabelKey(result.method))}`);
    if (result.truncated) metaLines.push(`> ${t("overlays:capture.metaTruncated")}: ${t("overlays:capture.metaTruncatedYes", { max: result.maxLen ?? maxLen })}`);
    if (result.wordCount != null) metaLines.push(`> ${t("overlays:capture.metaWordCount")}: ${result.wordCount}`);
    const header = `${metaLines.join("\n")}\n\n`;
    const body = (result.text || "").trim() || t("overlays:capture.metaNoBody");
    const bare = /^https?:\/\/\S+$/iu.test(content.trim());
    setContent(bare ? `${header}${body}` : content.trim() ? `${content.trim()}\n\n${header}${body}` : `${header}${body}`);
    if (cleanedTitle && (!title.trim() || /^https?:\/\//iu.test(title.trim()))) {
      setTitle(cleanedTitle);
    }
    setSourceType("external-capture");
    setFetchMeta({
      method: result.method,
      wordCount: result.wordCount,
      truncated: result.truncated,
      maxLen: result.maxLen,
      likelySpa: result.likelySpa,
      warning: result.warning,
      canEnhance: result.canEnhance || result.likelySpa,
      enhanced: result.enhanced,
    });
  };

  const handleFetchUrl = async (opts: { maxLen?: number; render?: boolean } = {}) => {
    const maxLen = opts.maxLen ?? FETCH_DEFAULT;
    const url = source.trim() || content.trim();
    if (!url || !/^https?:\/\//iu.test(url)) {
      setError(t("overlays:capture.errorInvalidUrl"));
      return;
    }
    // Auto-route fetched content to inbox (knowledge capture, not stream clutter)
    if (!destUserOverride.current) {
      setNoteDest("inbox");
    }
    setFetching(true);
    setFetchStage(1);
    setError(null);
    setFetchMeta(null);
    // Staged feedback while single network call runs (perceived progress)
    const stageTimers: ReturnType<typeof setTimeout>[] = [];
    stageTimers.push(setTimeout(() => setFetchStage((s) => (s > 0 && s < 3 ? 2 : s)), 450));
    stageTimers.push(setTimeout(() => setFetchStage((s) => (s > 0 && s < 3 ? 3 : s)), 1100));
    try {
      const result = await api.ws.fetchUrl(url, maxLen, { render: opts.render });
      setFetchStage(3);
      applyFetchResult(result, maxLen);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      const hint =
        /workspace|not configured|No workspace/iu.test(reason)
          ? t("overlays:capture.errorFetchWorkspace")
          : /timeout|超时/iu.test(reason)
            ? t("overlays:capture.errorFetchTimeout")
            : t("overlays:capture.errorFetchFallback");
      setError(t("overlays:capture.errorFetchFailed", { reason, hint }));
    } finally {
      for (const timer of stageTimers) clearTimeout(timer);
      setFetching(false);
      setFetchStage(0);
    }
  };

  const isUrl = /^https?:\/\/\S+$/iu.test(source.trim());
  const contentIsUrl = /^https?:\/\/\S+$/iu.test(content.trim());

  const handleContentChange = (v: string) => {
    setContent(v);
    const trimmed = v.trim();
    if (/^https?:\/\/\S+$/iu.test(trimmed) && !source.trim()) {
      setSource(trimmed);
      setSourceType("external-capture");
      // Auto-route URL captures to inbox (knowledge, not stream moments)
      if (!destUserOverride.current) {
        setNoteDest("inbox");
      }
    }
  };

  const finishClose = async () => {
    if (isFloat) {
      try {
        const s = await api.sys.settings();
        const closeOnSave = (s as { capture?: { closeFloatOnSave?: boolean } }).capture?.closeFloatOnSave !== false;
        if (closeOnSave) {
          await api.sys.closeQuickCapture();
        }
      } catch {
        await api.sys.closeQuickCapture().catch(() => {});
      }
      onDone?.();
    } else {
      closeOverlay();
      onDone?.();
    }
  };

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    const body = contentRef.current.trim();
    const files = attachmentsRef.current;
    if (!body && files.length === 0) return;

    setSubmitting(true);
    setError(null);
    try {
      if (isMemory && memoryTopicId) {
        if (!body) {
          setError(t("overlays:capture.errorMemoryEmpty"));
          return;
        }
        const mem = await api.ws.appendMemory({
          topicId: memoryTopicId,
          entry: body,
          source: "topmind Desktop",
        });
        setContent("");
        setTitle("");
        emitLocal("workspace:file-changed", { topicId: memoryTopicId });
        toastWriteback(t("overlays:capture.toastMemoryAppended"), mem);
        select({ kind: "topic", topicId: memoryTopicId });
        await finishClose();
        return;
      }

      let docsCount = 0;
      let staging = false;

      // Documents → same knowledge-ingest pipeline as FileDropZone / Hub
      // Float window: force auto-enqueue (staging UI is cramped); then open main hub.
      if (files.length > 0) {
        const paths = files.map((a) => a.absolutePath).filter(Boolean);
        if (!paths.length) {
          setError(t("overlays:capture.errorNoFilePath"));
          return;
        }
        const batch = await submitIngestBatch(paths, {
          dest: { mode: "inbox" },
          forceAuto: isFloat,
          openQueue: false,
        });
        if (batch.status === "enqueued") {
          docsCount = batch.count;
          emitLocal("workspace:file-changed");
          emitLocal("ingest:queue-changed");
        } else if (batch.status === "staging") {
          // Overlay (or rare float): IngestStagingSheet takes over docs;
          // still save any note text below, then keep surface open.
          staging = true;
          docsCount = batch.count;
          setAttachments([]);
        } else if (batch.status === "empty") {
          setError(t("overlays:capture.errorNoFiles"));
          return;
        }
      }

      // Text / URL note → 动态周期本（默认 stream）或 Inbox 回退
      // Runs even when docs are in staging so mixed capture doesn't drop the note.
      if (body) {
        const cleaned = cleanCaptureTitle(title.trim());
        let res;
        try {
          res = await api.ws.ingest({
            content: body,
            title: cleaned || deriveTitleFromContent(body) || undefined,
            sourceType,
            source: source.trim() || undefined,
            dest: { mode: noteDest },
          });
        } catch (ingestErr) {
          const msg = ingestErr instanceof Error ? ingestErr.message : String(ingestErr);
          if (/workspace|not configured|No workspace|root/iu.test(msg)) {
            throw new Error(t("overlays:capture.errorSaveWorkspace", { msg }));
          }
          throw ingestErr;
        }
        emitLocal("workspace:file-changed");
        const streamMsg =
          (res as { userMessage?: string }).userMessage ||
          ((res as { appended?: boolean }).appended ? t("overlays:capture.toastStreamAppended") : t("overlays:capture.toastStreamDefault"));
        toastWriteback(
          docsCount > 0 && !staging
            ? t("overlays:capture.toastStreamWithDocs", { streamMsg, count: docsCount })
            : staging
              ? t("overlays:capture.toastStreamWithStaging", { streamMsg, count: docsCount })
              : streamMsg,
          res,
        );
      } else if (docsCount > 0 && !staging) {
        toastWriteback(t("overlays:capture.toastDocsQueued", { count: docsCount }), {
          operation: "create",
          targetPath: t("overlays:capture.toastIngestQueue"),
          savedAt: new Date().toISOString(),
          ok: true,
        });
      }

      if (staging) {
        setContent("");
        setTitle("");
        setSource("");
        setFetchMeta(null);
        setHint(t("overlays:capture.stagingHint", { count: docsCount }));
        // Keep capture surface open so IngestStagingSheet is usable
        return;
      }

      setContent("");
      setTitle("");
      setSource("");
      setAttachments([]);
      setFetchMeta(null);

      // Documents enqueued: surface shared queue in-place (especially float —
      // user may not want the main window). Main overlay can still jump to hub.
      if (docsCount > 0) {
        setShowQueue(true);
        setHint(t("overlays:capture.queuedHint", { count: docsCount }));
        if (!isFloat) {
          select({ kind: "connector", id: "ingest" });
          await finishClose();
        }
        // float: stay open with queue; do not force main shell
        return;
      }

      // Stay in stream / inbox browser mental model; path evidence via toastWriteback
      if (!isFloat) {
        if (noteDest === "inbox") select({ kind: "inbox" });
        else select({ kind: "stream" });
      }

      await finishClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toastWritebackError(t("overlays:capture.toastCaptureFailed"), e);
    } finally {
      setSubmitting(false);
    }
  };

  const pickFiles = async () => {
    try {
      const { paths } = await api.ingest.pickFiles();
      addPaths(paths);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleAiPolish = async () => {
    const text = content.trim();
    if (!text || polishing || submitting) return;
    if (!aiReady) {
      setError(t("overlays:capture.aiPolishNotReady"));
      return;
    }
    const sessionId = `capture-polish-${Date.now()}`;
    useInlineAiStore.getState().begin({
      id: sessionId,
      kind: "polish",
      label: t("overlays:capture.aiPolishing"),
      anchor: { type: "any" },
      // Overlay stays mounted; do not block workspace navigation for capture polish
      blocksNavigation: false,
    });
    setPolishing(true);
    setError(null);
    try {
      const polished = await polishComposerText(
        (args) => api.ai.complete(args),
        text,
        "capture-polish",
      );
      if (polished) {
        setContent(polished);
        setHint(t("overlays:capture.aiPolishDone"));
        window.setTimeout(() => setHint(null), 2000);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/abort|cancel/iu.test(msg)) {
        setError(t("overlays:capture.aiPolishFailed"));
      }
    } finally {
      useInlineAiStore.getState().end(sessionId);
      setPolishing(false);
    }
  };

  const showEnhance =
    fetchMeta &&
    !fetchMeta.enhanced &&
    (fetchMeta.canEnhance || fetchMeta.likelySpa || (fetchMeta.wordCount ?? 0) < 40);

  const canSubmit = Boolean(content.trim() || attachments.length > 0) && !submitting;

  const modeHint =
    effectiveMode === "docs"
      ? t("overlays:capture.modeHintDocsEffective")
      : effectiveMode === "mixed"
        ? t("overlays:capture.modeHintMixed")
        : isMemory
          ? t("overlays:capture.modeHintMemory")
          : t("overlays:capture.modeHintNoteEffective");

  return {
    content,
    title,
    source,
    sourceType,
    noteDest,
    showAdvanced,
    attachments,
    mode,
    submitting,
    fetching,
    fetchStage,
    error,
    fetchMeta,
    hint,
    showQueue,
    polishing,
    aiReady,
    effectiveMode,
    isUrl,
    contentIsUrl,
    showEnhance,
    canSubmit,
    modeHint,
    setTitle,
    setSource,
    setSourceType,
    setNoteDest: handleSetNoteDest,
    setShowAdvanced,
    setMode,
    setError,
    setShowQueue,
    addPaths,
    removeAttachment,
    handleSmartPaste,
    handleFetchUrl,
    handleContentChange,
    handleSubmit,
    pickFiles,
    handleAiPolish,
  };
}

export type CaptureFormApi = ReturnType<typeof useCaptureForm>;

export function CaptureForm({
  form,
  isFloat,
  isMemory,
  topicName,
  wrapperClassName,
  attachmentsSlot,
  previewSlot,
}: {
  form: CaptureFormApi;
  isFloat: boolean;
  isMemory: boolean;
  topicName: string;
  /** Wrapper className — float mode uses flex-col so textarea can grow */
  wrapperClassName?: string;
  attachmentsSlot?: ReactNode;
  previewSlot?: ReactNode;
}) {
  const { t } = useTranslation();
  const select = useViewStore((s) => s.select);
  const closeOverlay = useViewStore((s) => s.closeOverlay);
  const {
    content,
    title,
    source,
    sourceType,
    noteDest,
    showAdvanced,
    attachments,
    mode,
    submitting,
    fetching,
    fetchStage,
    error,
    hint,
    showQueue,
    polishing,
    aiReady,
    effectiveMode,
    isUrl,
    contentIsUrl,
    canSubmit,
    modeHint,
    setTitle,
    setSource,
    setSourceType,
    setNoteDest: handleSetNoteDest,
    setShowAdvanced,
    setMode,
    setShowQueue,
    handleContentChange,
    handleFetchUrl,
    handleSubmit,
    handleAiPolish,
  } = form;

  return (
    <div className={wrapperClassName}>
      {isMemory ? (
        <p className="mb-2 text-3xs leading-relaxed text-text-tertiary">
          {t("overlays:capture.memoryHint", { topic: topicName })}
        </p>
      ) : null}

      {/* Landing dest — always visible for notes (core capture decision) */}
      {!isMemory && effectiveMode !== "docs" ? (
        <div
          className="mb-2 flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label={t("overlays:capture.destAriaLabel")}
        >
          <span className="text-3xs text-text-quaternary">{t("overlays:capture.destLabel")}</span>
          {(
            [
              { id: "stream" as const, label: t("overlays:capture.destStream") },
              { id: "inbox" as const, label: t("overlays:capture.destInbox") },
            ] as const
          ).map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => handleSetNoteDest(d.id)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-3xs font-medium transition-colors",
                noteDest === d.id
                  ? "bg-accent-bg-subtle text-accent-color shadow-[inset_0_0_0_1px_var(--color-accent-border-subtle)]"
                  : "bg-surface-muted/50 text-text-tertiary hover:bg-surface-muted hover:text-text-secondary",
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
      ) : null}

      {attachmentsSlot}

      <Textarea
        value={content}
        onChange={(e) => handleContentChange(e.target.value)}
        placeholder={
          isMemory
            ? t("overlays:capture.contentPlaceholderMemory")
            : attachments.length
              ? t("overlays:capture.contentPlaceholderWithAttachments")
              : t("overlays:capture.contentPlaceholderDefault")
        }
        autoFocus
        rows={isFloat ? 5 : 6}
        className={isFloat ? "min-h-0 flex-1 resize-none" : undefined}
      />

      {/* Advanced: mode · title — collapsed by default (lowest friction) */}
      {!isMemory ? (
        (() => {
          const advancedOpen =
            showAdvanced || mode !== "auto" || Boolean(title.trim()) || attachments.length > 0;
          return (
            <div className="mt-1.5">
              <button
                type="button"
                className="text-3xs text-text-quaternary hover:text-accent-color"
                onClick={() => setShowAdvanced((v) => !v)}
              >
                {advancedOpen
                  ? t("overlays:capture.advancedHide")
                  : t("overlays:capture.advancedShow")}
              </button>
              {advancedOpen ? (
                <div className="mt-1.5 space-y-2">
                  <CaptureModeBar mode={mode} onChange={setMode} hint={modeHint} />
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t("overlays:capture.titlePlaceholder")}
                  />
                </div>
              ) : null}
            </div>
          );
        })()
      ) : null}

      {previewSlot}

      {!isMemory &&
      (showAdvanced || source.trim() || sourceType === "external-capture" || contentIsUrl || isUrl) ? (
        <div className="mt-2 flex items-center gap-1.5">
          <div className="flex shrink-0 overflow-hidden rounded-[var(--radius-md)] border border-border-subtle-dim">
            {([
              ["user-original", t("overlays:capture.sourceOriginal"), t("overlays:capture.sourceOriginalTitle")] as const,
              ["external-capture", t("overlays:capture.sourceExcerpt"), t("overlays:capture.sourceExcerptTitle")] as const,
            ]).map(([val, label, tip]) => (
              <button
                key={val}
                type="button"
                onClick={() => setSourceType(val)}
                title={tip}
                className={cn(
                  "px-2.5 py-1.5 text-3xs font-medium transition-colors",
                  sourceType === val
                    ? "bg-accent-bg-subtle text-accent-color"
                    : "text-text-tertiary hover:bg-surface-muted",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-1 items-center gap-1.5 rounded-[var(--radius-md)] border border-border-subtle-dim bg-input px-2.5 shadow-[var(--shadow-input-inset)] transition-[border-color] focus-within:border-accent-color">
            <Link size={ICON.xs} className="shrink-0 text-text-quaternary" />
            <input
              value={source}
              onChange={(e) => {
                const v = e.target.value;
                setSource(v);
                if (v.trim() && sourceType === "user-original") setSourceType("external-capture");
              }}
              placeholder={t("overlays:capture.sourcePlaceholder")}
              className="h-7 flex-1 bg-transparent text-3xs text-text-primary outline-none placeholder:text-text-quaternary"
            />
            {isUrl ? (
              <Tooltip content={t("overlays:capture.fetchTooltip")}>
                <button
                  type="button"
                  onClick={() => void handleFetchUrl()}
                  disabled={fetching}
                  className="flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-3xs font-medium text-accent-color transition-colors hover:bg-accent-bg-subtle disabled:opacity-50 v4-focus-ring"
                >
                  {fetching ? (
                    <Loader2 size={ICON.micro} className="animate-spin" aria-hidden />
                  ) : (
                    <Download size={ICON.micro} aria-hidden />
                  )}
                  {fetching
                    ? t(FETCH_STEP_KEYS.find((s) => s.id === fetchStage)?.key ?? "overlays:capture.fetchFetching")
                    : t("overlays:capture.fetchFetchLabel")}
                </button>
              </Tooltip>
            ) : null}
          </div>
        </div>
      ) : null}

      {hint ? (
        <div className="mt-2 text-3xs text-accent-color" role="status">
          {hint}
        </div>
      ) : null}

      {error ? (
        <div className="mt-2.5 rounded-[var(--radius-md)] border border-error/20 bg-status-error-bg px-2.5 py-1.5 text-3xs text-error" role="alert">
          {error}
        </div>
      ) : null}

      {/* Shared ingest queue — same jobs as main Hub (float-friendly progress) */}
      {(showQueue || isFloat) && !isMemory ? (
        <div className="mt-3 border-t border-border-subtle-dim pt-2">
          <IngestQueuePanel
            variant="compact"
            maxItems={8}
            hideWhenEmpty={!showQueue}
            emptyHint={t("overlays:capture.emptyQueueHint")}
            onOpenResult={
              isFloat
                ? () => {
                    void api.sys.openIngestHub().catch(() => {});
                  }
                : (path) => select({ kind: "file", path })
            }
          />
          {showQueue && isFloat ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="text-3xs font-medium text-accent-color underline-offset-2 hover:underline"
                onClick={() => void api.sys.openIngestHub().catch(() => {})}
              >
                {t("overlays:capture.openIngestHub")}
              </button>
              <button
                type="button"
                className="text-3xs text-text-quaternary hover:text-text-secondary"
                onClick={() => setShowQueue(false)}
              >
                {t("overlays:capture.collapseQueue")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {polishing ? (
        <div
          className="mt-3 h-0.5 w-full overflow-hidden rounded-full bg-accent-bg-subtle"
          role="progressbar"
          data-capture-ai-busy
          aria-valuetext={t("overlays:capture.aiPolishing")}
        >
          <div className="h-full w-1/3 v4-ai-progress-slide rounded-full bg-accent-color/50" />
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="hidden min-w-0 max-w-[240px] truncate text-3xs text-text-quaternary sm:inline" title={modeHint}>
          {isFloat
            ? t("overlays:capture.floatHint")
            : modeHint}
        </span>
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (isFloat) void api.sys.closeQuickCapture();
              else closeOverlay();
            }}
          >
            {showQueue && isFloat ? t("overlays:capture.close") : t("overlays:capture.cancel")}
          </Button>
          {!isMemory && effectiveMode !== "docs" ? (
            <Tooltip content={aiReady ? t("overlays:capture.aiPolishTip") : t("overlays:capture.aiPolishNotReady")}>
              <Button
                variant="ai"
                size="sm"
                onClick={() => void handleAiPolish()}
                disabled={!content.trim() || polishing || submitting || !aiReady}
                className="v4-ai-btn"
                data-capture-ai-polish
              >
                {polishing ? (
                  <Loader2 size={ICON.xs} className="animate-spin" />
                ) : (
                  <Sparkles size={ICON.xs} />
                )}
                {polishing
                  ? t("overlays:capture.aiPolishing")
                  : t("overlays:capture.aiPolish")}
              </Button>
            </Tooltip>
          ) : null}
          <Button
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
          >
            {submitting
              ? t("overlays:capture.submitProcessing")
              : isMemory
                ? t("overlays:capture.submitMemory")
                : effectiveMode === "docs"
                  ? t("overlays:capture.submitDocs", { count: attachments.length })
                  : effectiveMode === "mixed"
                    ? t("overlays:capture.submitMixed")
                    : t("overlays:capture.submitNote")}
          </Button>
        </div>
      </div>
    </div>
  );
}
