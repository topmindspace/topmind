import { useEffect, useRef, useState, useMemo, useCallback, useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import { useEditor, EditorContent } from "@tiptap/react";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import {
  createFindExtension,
  findClear,
  findGetState,
  findSetSearch,
  findStep,
} from "../../../lib/editor-find";
import { createDebouncedTask } from "../../../lib/hot-path";
import { assembleSourceDocument, createEditorSaveQueue, editorSaveFailureReason, findSourceRanges, markdownNeedsSource, sourceBodyFromInput } from "../../../lib/editor-document";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Typography from "@tiptap/extension-typography";
import CharacterCount from "@tiptap/extension-character-count";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { mergeAttributes } from "@tiptap/core";
import { Markdown } from "tiptap-markdown";
import {
  RiArrowDownSLine,
  RiArrowGoBackLine,
  RiArrowUpSLine,
  RiCloseLine,
  RiEyeLine,
  RiFolderReceivedLine,
  RiLoader4Line,
  RiPriceTag3Line,
  RiSearchLine,
} from "@remixicon/react";
import { EditorOutlinePanel, extractHeadings } from "../../../components/editor/EditorOutlinePanel";
import { api } from "../../../services/api";
import { useAiStore } from "../../../stores/ai-store";
import { useViewStore } from "../../../stores/view-store";
import { FrontmatterBar } from "../../../components/editor/FrontmatterBar";
import {
  SelectionAiBar,
  requestSelectionAiBar,
} from "../../../components/editor/SelectionAiBar";
import { fontFamilyCss } from "../../../lib/editor-prefs";
import { Button } from "../../../components/ui/Button";
import { Tooltip } from "../../../components/ui/tooltip";
import {
  useFileContextMenu,
  WorkspaceFileContextMenu,
} from "../../../components/ui/workspace-file-menu";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../../../components/ui/context-menu";
import { ConfirmDialog, PromptDialog } from "../../../components/ui/Dialog";
import { resolveDiskConflict } from "../../../lib/disk-conflict";
import {
  DropdownMenu,
} from "../../../components/ui/DropdownMenu";
import {
  TopicPickerList,
  useTopicGroups,
} from "../../../components/workspace/TopicPickerMenu";
import { emitLocal, onLocal } from "../../../plugins/host";
import { toastWriteback, toastWritebackError } from "../../../lib/writeback-toast";
import { displayNoteTitle, getStatusColumns, resolveStatusColumn } from "../../../lib/note-meta";
import { joinMarkdownFile, splitMarkdownFile } from "../../../lib/md-frontmatter";
import {
  editorDocumentHasContent,
  EMPTY_PREVIEW_HTML,
  getEditorHtml,
  getEditorMarkdown,
  nextPreviewHtml,
  normalizeContentWidth,
  setEditorMarkdown,
} from "../../../lib/editor-markdown";
import { wikiImageDomAttrs } from "../../../lib/editor-media";
import { ensureWorkspaceImagePaths, invalidateWorkspaceImagePaths } from "../../../lib/workspace-image-paths";
import { focusEditorHeading } from "../../../lib/editor-focus-heading";
import { cn } from "../../../lib/kit";
import { ICON } from "../../../lib/icons";
import { getCachedSettings } from "../../../lib/settings-cache";
import {
  formatDateTime,
  formatFileSize,
  ToolbarSep,
  type SaveState,
} from "./file-editor-chrome";
import {
  EditorFormatBar,
  EditorModeSwitch,
  EditorMoreMenu,
  EditorViewChrome,
  FileEditorTitleBarActions,
} from "./file-editor-format-bar";
import { TitleBarActions } from "../../../lib/chrome-portal";
import { useTitleBarChrome } from "../../../lib/titlebar-chrome";

interface Props {
  path: string;
  topicId?: string;
  readOnly?: boolean;
  /** Stream browser: open period note and jump to this ## heading */
  focusHeading?: string;
}

type ViewMode = "edit" | "source" | "preview";

interface FileMeta {
  frontmatter: Record<string, unknown>;
  bodyPreview: string;
  size: number;
  mtime: string | null;
}

export function FileEditorView({ path, topicId, readOnly = false, focusHeading }: Props) {
  const { t } = useTranslation(["workspace", "common"]);
  const [saveState, setSaveStateRaw] = useState<SaveState>("clean");
  const setSaveState = (s: SaveState | ((prev: SaveState) => SaveState)) => {
    const next = typeof s === "function" ? s(saveStateRef.current) : s;
    saveStateRef.current = next;
    setSaveStateRaw(next);
  };
  const [saveError, setSaveError] = useState<string | null>(null);
  const [documentLoading, setDocumentLoading] = useState(true);
  const documentLoadingRef = useRef(true);
  const [sourceBody, setSourceBody] = useState("");
  const sourceBodyRef = useRef("");
  const sourceActiveRef = useRef(false);
  const sourceInputRef = useRef<HTMLTextAreaElement>(null);
  const editorRootRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Bumped by the error retry button — re-runs the load effect. */
  const [reloadTick, setReloadTick] = useState(0);
  const [wordCount, setWordCount] = useState(0);
  const wordCountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(readOnly ? "preview" : "edit");
  /** Only show X toolbar when connector plugin is enabled in settings */
  const xPublishEnabled = Boolean(getCachedSettings()?.x?.enabled);
  const [showMeta, setShowMeta] = useState(false);
  /** Document outline drawer toggle (Jakob's Law for long-form Markdown navigation) */
  const [showOutline, setShowOutline] = useState(false);
  /** Format tools expanded by default — collapse with chevron when space is tight */
  const [showFormat, setShowFormat] = useState(true);
  /** Properties (frontmatter chips) row — default collapsed to free content height */
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  /** Toolbar compact mode — hides text labels when editor area is narrow */
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarCompact, setToolbarCompact] = useState(false);
  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      setToolbarCompact(w < 480);
    });
    ro.observe(el);
    setToolbarCompact(el.clientWidth < 480);
    return () => ro.disconnect();
  }, []);
  const [editorMenu, setEditorMenu] = useState<{ x: number; y: number } | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  /** Pending external/disk body while dirty — resolved via keep-local / take-disk / merge. */
  const diskChangeTask = useRef<Promise<void> | null>(null);
  const diskChangePhase = useRef<"checking" | "conflict" | null>(null);
  const discardedSaveDocuments = useRef(new Set<number>());
  const [diskConflict, setDiskConflict] = useState<{ disk: string; diskFull: string; source: string } | null>(null);
  const [moving, setMoving] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [linkDialog, setLinkDialog] = useState<{ open: boolean; prevUrl: string }>({ open: false, prevUrl: "" });
  const [fileMeta, setFileMeta] = useState<FileMeta | null>(null);
  /** Full file on disk (frontmatter + body) — source of truth for FM block. */
  const [rawContent, setRawContent] = useState("");
  const sourceNeedsProtection = useMemo(() => markdownNeedsSource(sourceBody), [sourceBody]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const editorSettings = useViewStore((s) => s.editorSettings);
  const setAiPanelOpen = useViewStore((s) => s.setAiPanelOpen);
  const openOverlay = useViewStore((s) => s.openOverlay);
  const focusMode = useViewStore((s) => s.focusMode);
  const toggleFocusMode = useViewStore((s) => s.toggleFocusMode);
  const select = useViewStore((s) => s.select);
  const fileMenu = useFileContextMenu();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string>("");
  /** Serialize body saves so they never race frontmatter / each other */
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const saveStateRef = useRef<SaveState>("clean");
  const pathRef = useRef(path);
  const documentVersion = useRef({ path, documentId: 0, revision: 0 });
  const persistedRevision = useRef(0);
  if (pathRef.current !== path) documentVersion.current = { path, documentId: documentVersion.current.documentId + 1, revision: 0 };
  pathRef.current = path;
  const doSaveRef = useRef<() => Promise<void>>(async () => {});
  const saveErrorText = (error: unknown) => ({
    permission: t("workspace:editor.saveReasonPermission"),
    space: t("workspace:editor.saveReasonSpace"),
    missing: t("workspace:editor.saveReasonMissing"),
    unavailable: t("workspace:editor.saveReasonUnavailable"),
  })[editorSaveFailureReason(error)];
  const saveQueue = useRef<ReturnType<typeof createEditorSaveQueue> | null>(null);
  if (!saveQueue.current) saveQueue.current = createEditorSaveQueue({
    current: () => documentVersion.current,
    write: async (snapshot) => {
      if (discardedSaveDocuments.current.has(snapshot.documentId)) return;
      if (snapshot.path === pathRef.current) {
        if (diskChangePhase.current === "checking") await diskChangeTask.current;
        if (diskChangePhase.current) throw new Error(t("workspace:editor.resolveConflictFirst"));
      }
      await api.ws.save({ relativePath: snapshot.path, content: snapshot.content });
      emitLocal("workspace:file-changed", { relativePath: snapshot.path, event: "change", source: "editor" });
    },
    onState: setSaveState,
    onSaved: (snapshot) => {
      lastSaved.current = snapshot.content;
      persistedRevision.current = snapshot.revision;
      setRawContent(snapshot.content);
      setSaveError(null);
      void api.ws.fileMeta(snapshot.path).then((meta) => {
        if (documentVersion.current.documentId === snapshot.documentId && pathRef.current === snapshot.path) setFileMeta(meta);
      }).catch(() => {});
    },
    onError: (error) => setSaveError(saveErrorText(error)),
  });
  const autoSaveMsRef = useRef(1500);
  autoSaveMsRef.current = Math.max(500, Math.min(5000, editorSettings.autoSaveMs ?? 1500));
  /** Paste/drop images → workspace images/ + relative markdown (set after editor ready). */
  const insertLocalImagesRef = useRef<(files: File[]) => Promise<void>>(async () => {});
  const mountFile = useAiStore((s) => s.mountFile);
  const unmountFile = useAiStore((s) => s.unmountFile);
  const mountedFiles = useAiStore((s) => s.mountedFiles);
  const baseName = path.split("/").pop() ?? path;
  const docTitle = displayNoteTitle(
    baseName,
    typeof fileMeta?.frontmatter?.title === "string" ? fileMeta.frontmatter.title : null,
  );
  useTitleBarChrome(`file:${path}`, { title: docTitle });
  const mounted = mountedFiles.some((m) => m.path === path);
  const resolvedTopicId = topicId
    || (path.includes("/") && !path.startsWith("00") && path.split("/").length >= 2
      ? path.split("/").slice(0, 2).join("/")
      : undefined);
  const canPublish = !readOnly && path.endsWith(".md");

  const contentWidth = normalizeContentWidth(editorSettings.contentWidth);

  const editor = useEditor({
    // React 18 Strict Mode: avoid accessing view before mount
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [
      StarterKit.configure({
        // Ensure list/code-block schemas stay enabled for tiptap-markdown round-trip
        bulletList: { keepMarks: true, keepAttributes: false },
        orderedList: { keepMarks: true, keepAttributes: false },
        codeBlock: { HTMLAttributes: { class: "v4-code-block" } },
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        // Link is registered separately with openOnClick: false
        link: false,
        // Underline is included in StarterKit v3 — do not add ExtensionUnderline again
      }),
      Typography,
      TaskList,
      TaskItem.configure({ nested: true }),
      createFindExtension(),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: { class: "v4-md-link", rel: "noopener noreferrer" },
      }),
      Image.extend({
        renderHTML({ HTMLAttributes }) {
          const title = typeof HTMLAttributes.title === "string" ? HTMLAttributes.title : "";
          const attrs: Record<string, unknown> = { ...HTMLAttributes };
          if (title.startsWith("tmw:")) delete attrs.title;
          return [
            "img",
            mergeAttributes(this.options.HTMLAttributes, attrs, wikiImageDomAttrs(title), {
              loading: "lazy",
            }),
          ];
        },
      }).configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: { class: "v4-md-img" },
      }),
      Placeholder.configure({ placeholder: t("workspace:editor.placeholder") }),
      CharacterCount,
      Markdown.configure({
        html: true, // allow <img> / limited HTML from markdown pipeline
        breaks: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "v4-tiptap outline-none",
        style: `font-size: ${editorSettings.fontSize}px; line-height: ${editorSettings.lineHeight};`,
      },
      handlePaste: (_view, event) => {
        if (readOnly) return false;
        const items = event.clipboardData?.items;
        if (!items?.length) return false;
        const files: File[] = [];
        for (const it of Array.from(items)) {
          if (it.kind === "file" && it.type.startsWith("image/")) {
            const f = it.getAsFile();
            if (f) files.push(f);
          }
        }
        if (!files.length) return false;
        event.preventDefault();
        void insertLocalImagesRef.current(files);
        return true;
      },
      handleDrop: (_view, event) => {
        if (readOnly) return false;
        const dt = event.dataTransfer;
        if (!dt?.files?.length) return false;
        const files = Array.from(dt.files).filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        event.preventDefault();
        void insertLocalImagesRef.current(files);
        return true;
      },
    },
    onUpdate: () => markDocumentChanged(),
  });

  function markDocumentChanged() {
    if (readOnly || documentLoadingRef.current) return;
    documentVersion.current.revision++;
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void doSaveRef.current().catch(() => {}); }, autoSaveMsRef.current);
    if (wordCountTimer.current) clearTimeout(wordCountTimer.current);
    wordCountTimer.current = setTimeout(() => {
      if (sourceActiveRef.current) setWordCount(sourceBodyRef.current.trim().split(/\s+/u).filter(Boolean).length);
      else if (editor && !editor.isDestroyed) setWordCount(editor.storage.characterCount.words());
    }, 400);
  }

  const getBodyMarkdown = (noteRelativePath = pathRef.current): string => {
    if (sourceActiveRef.current) return sourceBodyRef.current;
    if (!editor) return splitMarkdownFile(rawContent).body;
    return getEditorMarkdown(editor, { noteRelativePath, requireMarkdown: true });
  };

  const buildFullFile = (body: string): string => {
    const original = lastSaved.current || rawContent;
    if (sourceActiveRef.current) return assembleSourceDocument(original, body);
    return joinMarkdownFile(splitMarkdownFile(original).frontmatterBlock, body);
  };

  const acceptBody = (body: string, knownPaths?: readonly string[] | null) => {
    diskChangePhase.current = null;
    const newDocument = loadedPathRef.current !== path;
    const source = markdownNeedsSource(body) || (!newDocument && sourceActiveRef.current);
    sourceBodyRef.current = body;
    sourceActiveRef.current = source;
    setSourceBody(body.replace(/\r\n/gu, "\n"));
    if (source) setViewMode("source");
    else if (newDocument) setViewMode(readOnly ? "preview" : "edit");
    documentVersion.current.documentId++;
    documentVersion.current.revision = 0;
    persistedRevision.current = 0;
    setEditorMarkdown(editor, body, { noteRelativePath: path, knownPaths });
  };

  // Apply editor settings reactively when they change (guard: view may not be mounted yet)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    let dom: HTMLElement | null = null;
    try {
      // Accessing .view before mount throws in TipTap 3
      dom = editor.view?.dom as HTMLElement | undefined ?? null;
    } catch {
      return;
    }
    if (!dom) return;
    dom.style.fontSize = `${editorSettings.fontSize}px`;
    dom.style.lineHeight = String(editorSettings.lineHeight);
    dom.style.fontFamily = fontFamilyCss(
      (editorSettings.fontFamily as "sans" | "serif" | "mono") || "sans",
    );
    // Rich-text must use normal white-space so headings/lists/block styles paint.
    // Never use nowrap on the whole ProseMirror (destroys multi-block layout).
    // wordWrap only toggles soft-break of long tokens.
    const wrap = editorSettings.wordWrap !== false;
    dom.style.whiteSpace = "normal";
    dom.style.overflowWrap = wrap ? "anywhere" : "normal";
    dom.style.wordBreak = wrap ? "break-word" : "normal";
  }, [editor, editorSettings]);

  // Edit mode only — preview uses a static HTML surface for reliable formatting
  useEffect(() => {
    if (!editor) return;
    const canEdit = !readOnly && !documentLoading && loadedPathRef.current === path && viewMode === "edit";
    editor.setEditable(canEdit, false);
  }, [editor, viewMode, readOnly, documentLoading, path]);

  // Snapshot HTML when entering preview (or after load while previewing/read-only).
  // EditorContent stays mounted (hidden) so TipTap immediatelyRender:false still has a view.
  // FileEditorView is reused without key=path — reset on path change so empty notes
  // cannot keep the previous document's previewHtml.
  const [previewHtml, setPreviewHtml] = useState(EMPTY_PREVIEW_HTML);
  const [previewEpoch, setPreviewEpoch] = useState(0);
  const loadedPathRef = useRef<string | null>(null);
  const bumpPreview = () => setPreviewEpoch((n) => n + 1);

  const applyDiskConflict = (choice: "keep-local" | "take-disk" | "merge") => {
    const pending = diskConflict;
    if (!pending || !editor || editor.isDestroyed) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const base = splitMarkdownFile(lastSaved.current).body;
    const local = getBodyMarkdown(path);
    const resolved = resolveDiskConflict({ base, local, disk: pending.disk }, choice);
    const discarded = documentVersion.current.documentId;
    discardedSaveDocuments.current.add(discarded);
    documentVersion.current.documentId++;
    void saveQueue.current!.settled().then(() => discardedSaveDocuments.current.delete(discarded));
    diskChangePhase.current = null;
    setDiskConflict(null);
    setSaveError(null);
    lastSaved.current = pending.diskFull;
    setRawContent(pending.diskFull);
    if (choice === "take-disk") {
      acceptBody(resolved.body);
      setSaveState("clean");
    } else {
      if (choice === "merge") {
        acceptBody(resolved.body);
        documentVersion.current.revision++;
      }
      setSaveState("dirty");
      void doSaveRef.current().catch(() => {});
    }
    bumpPreview();
  };
  useEffect(() => {
    loadedPathRef.current = null;
    setPreviewHtml((prev) => nextPreviewHtml(prev, EMPTY_PREVIEW_HTML, { pathChanged: true }));
  }, [path]);
  useEffect(() => {
    if (viewMode !== "preview" && !readOnly) return;
    const snap = () => {
      const ready = loadedPathRef.current === pathRef.current;
      setPreviewHtml((prev) =>
        nextPreviewHtml(prev, ready ? getEditorHtml(editor) : EMPTY_PREVIEW_HTML, {
          pathChanged: !ready,
        }),
      );
    };
    snap();
    const id = requestAnimationFrame(snap);
    return () => cancelAnimationFrame(id);
  }, [editor, viewMode, readOnly, previewEpoch]);

  /** Capture the current document before queueing; later edits keep their dirty state. */
  const doSave = useCallback(async (opts?: { relativePath?: string; fullContent?: string; force?: boolean }) => {
    if ((readOnly && !opts?.force) || documentLoadingRef.current) return;
    const targetPath = opts?.relativePath ?? pathRef.current;
    const hasSnapshot = opts?.fullContent != null;
    if (!hasSnapshot && loadedPathRef.current !== targetPath) return;
    const requestedDocument = documentVersion.current.documentId;
    if (diskChangePhase.current === "checking") await diskChangeTask.current;
    if (!hasSnapshot && (pathRef.current !== targetPath || documentVersion.current.documentId !== requestedDocument)) return;
    if (diskChangePhase.current) throw new Error(t("workspace:editor.resolveConflictFirst"));
    if (!hasSnapshot && persistedRevision.current === documentVersion.current.revision) return;
    let content: string;
    try { content = opts?.fullContent ?? buildFullFile(getBodyMarkdown(targetPath)); }
    catch (error) {
      setSaveError(t("workspace:editor.serializeFailed"));
      setSaveState("error");
      throw error;
    }
    if (content === lastSaved.current && targetPath === pathRef.current) { setSaveState("clean"); return; }
    const pending = saveQueue.current!.save({ ...documentVersion.current, path: targetPath, content });
    saveChain.current = saveQueue.current!.settled();
    return pending;
    // Mutable document refs are read at capture time, never when a queued write starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, readOnly, path]);
  doSaveRef.current = doSave;

  // Paste/drop images → {noteDir}/images/{noteStem}/img-*.{ext} + relative markdown
  useEffect(() => {
    insertLocalImagesRef.current = async (files: File[]) => {
      if (!editor || readOnly || !path.endsWith(".md") || !files.length) return;
      const dir = path.includes("/") ? path.split("/").slice(0, -1).join("/") : "";
      const stem = (path.split("/").pop() || "note").replace(/\.md$/iu, "") || "note";
      const prefix = dir ? `${dir}/images/${stem}` : `images/${stem}`;

      const batch = files.slice(0, 12);
      const overCap = files.length - batch.length;
      let oversized = 0;
      let inserted = 0;
      for (const file of batch) {
        try {
          const buf = new Uint8Array(await file.arrayBuffer());
          if (!buf.length || buf.length > 8_000_000) {
            oversized++;
            continue;
          }
          let binary = "";
          const chunk = 0x8000;
          for (let i = 0; i < buf.length; i += chunk) {
            binary += String.fromCharCode(...buf.subarray(i, i + chunk));
          }
          const b64 = btoa(binary);
          const ext =
            file.type === "image/png"
              ? ".png"
              : file.type === "image/jpeg"
                ? ".jpg"
                : file.type === "image/gif"
                  ? ".gif"
                  : file.type === "image/webp"
                    ? ".webp"
                    : file.type === "image/svg+xml"
                      ? ".svg"
                      : ".png";
          const hash = await crypto.subtle
            .digest("SHA-1", buf)
            .then((d) =>
              Array.from(new Uint8Array(d))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("")
                .slice(0, 12),
            )
            .catch(() => `${Date.now().toString(36)}`);
          const name = `img-${hash}${ext}`;
          const relativePath = `${prefix}/${name}`;
          await api.ws.saveBinary({
            relativePath,
            base64: b64,
            contentType: file.type || "image/png",
          });
          // Editor display uses topmind-asset protocol; disk save rewrites to relative.
          const viewSrc = `topmind-asset://local/${relativePath}`;
          const alt = (file.name || "image").replace(/\.[^.]+$/u, "").slice(0, 80);
          editor.chain().focus().setImage({ src: viewSrc, alt }).run();
          inserted++;
        } catch (e) {
          toastWritebackError(t("workspace:editor.imageSaveFailed"), e instanceof Error ? e.message : String(e));
        }
      }
      // Silent caps are how screenshots quietly vanish — always tell.
      if (oversized > 0 || overCap > 0) {
        emitLocal("toast:show", {
          text: t("workspace:editor.imageInsertCapped", { oversized, overCap }),
          kind: "error",
        });
      }
      if (inserted > 0) {
        // Persist body after inserts
        setSaveState("dirty");
        void doSave().catch(() => {});
      }
    };
  }, [editor, readOnly, path, doSave]);

  // Load file content + metadata; flush dirty buffer when leaving a path
  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    setLoadError(null);
    setSaveError(null);
    diskChangePhase.current = null;
    setDiskConflict(null);
    documentLoadingRef.current = true;
    setDocumentLoading(true);

    (async () => {
      try {
        await saveQueue.current!.settled();
        if (cancelled) return;
        const [content, meta, knownPaths] = await Promise.all([
          api.ws.read(path),
          api.ws.fileMeta(path).catch(() => null),
          ensureWorkspaceImagePaths(useViewStore.getState().workspaceRoot),
        ]);
        if (cancelled) return;
        lastSaved.current = content;
        setRawContent(content);
        setFileMeta(meta);
        const { body } = splitMarkdownFile(content);
        acceptBody(body || "", knownPaths);
        if (!sourceActiveRef.current && body.trim() && !editorDocumentHasContent(editor.state.doc)) {
          const escaped = body
            .replace(/&/gu, "&amp;")
            .replace(/</gu, "&lt;")
            .replace(/>/gu, "&gt;");
          editor.commands.setContent(
            `<p>${escaped.replace(/\n/gu, "<br>")}</p>`,
            { emitUpdate: false },
          );
        }
        loadedPathRef.current = path;
        documentLoadingRef.current = false;
        setDocumentLoading(false);
        setSaveState("clean");
        setWordCount(editor.storage.characterCount.words());
        bumpPreview();
      } catch (e) {
        if (!cancelled) { documentLoadingRef.current = false; setDocumentLoading(false); setLoadError(e instanceof Error ? e.message : String(e)); }
      }
    })();

    return () => {
      cancelled = true;
      if (wordCountTimer.current) {
        clearTimeout(wordCountTimer.current);
        wordCountTimer.current = null;
      }
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      // Flush dirty buffer for the path we're leaving (C1)
      if (readOnly) return;
      const leaving = path;
      if (loadedPathRef.current !== leaving) return;
      const dirty = saveStateRef.current === "dirty" || saveStateRef.current === "error" || saveStateRef.current === "saving";
      if (!dirty || !editor) return;
      try {
        const body = getBodyMarkdown(path);
        const full = buildFullFile(body);
        if (full !== lastSaved.current) {
          void doSave({ relativePath: leaving, fullContent: full, force: true }).catch(() => {});
        }
      } catch {
        /* best-effort flush */
      }
    };
    // Close over editor + path only — avoid re-flushing on content changes (debounced elsewhere).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, path, reloadTick]);

  // Toolbar insert-image: reuses the paste/drop pipeline (size caps + toasts)
  const imageInputRef = useRef<HTMLInputElement>(null);

  // ⌘F find-in-note
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findCount, setFindCount] = useState({ idx: 0, total: 0 });
  const findInputRef = useRef<HTMLInputElement>(null);
  const sourceFind = useRef({ matches: [] as Array<{ from: number; to: number }>, active: 0 });
  const selectSourceRange = (from: number, to = from) => {
    const input = sourceInputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(from, to);
    const line = sourceBodyRef.current.slice(0, from).split("\n").length - 1;
    input.scrollTop = Math.max(0, line * (parseFloat(getComputedStyle(input).lineHeight) || 24) - input.clientHeight / 2);
  };
  function stepFind(direction: -1 | 1) {
    if (viewMode !== "source") { findStep(editor, direction); return; }
    const state = sourceFind.current;
    if (!state.matches.length) return;
    state.active = (state.active + direction + state.matches.length) % state.matches.length;
    const match = state.matches[state.active];
    selectSourceRange(match.from, match.to);
    setFindCount({ idx: state.active + 1, total: state.matches.length });
  }

  const openFind = useCallback(() => {
    setFindOpen(true);
    const input = sourceInputRef.current;
    const range = editor?.state.selection;
    const selected = (viewMode === "source" && input
      ? input.value.slice(input.selectionStart, input.selectionEnd)
      : range ? editor?.state.doc.textBetween(range.from, range.to, "\n") : "")?.trim();
    if (selected && selected.length <= 64 && (selected.includes(" ") || /^[\w\u4e00-\u9fa5-]+$/u.test(selected))) {
      setFindQuery(selected);
    }
    requestAnimationFrame(() => findInputRef.current?.select());
  }, [editor, viewMode]);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    findClear(editor);
  }, [editor]);

  function ownsKeyboardEvent(event: KeyboardEvent) {
    if (useViewStore.getState().overlay !== "none") return false;
    const owner = event.target instanceof HTMLElement ? event.target.closest(".v4-editor-shell") : null;
    if (owner) return owner === editorRootRef.current;
    const selection = useViewStore.getState().selection;
    return selection.kind === "file" && selection.path === path;
  }

  // ⌘F opens find (works in read mode too); ⌘F/F3/⌘G cycle while open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!ownsKeyboardEvent(e)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "f" && !e.shiftKey && !e.altKey) {
        if (useViewStore.getState().overlay !== "none") return;
        e.preventDefault();
        openFind();
      } else if (findOpen && e.key === "F3") {
        e.preventDefault();
        stepFind(e.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, findOpen, openFind, viewMode]);

  // Push query into the plugin — debounced so typing does not scan + dispatch
  // the whole doc per keystroke. Scroll is suppressed while typing (Enter/step
  // re-scrolls to the active match).
  useEffect(() => {
    if (!findOpen || !editor) return;
    const q = findQuery.trim();
    const debounced = createDebouncedTask(160);
    debounced.schedule(() => {
      if (viewMode === "source") {
        const matches = findSourceRanges(sourceBody, q);
        sourceFind.current = { matches, active: 0 };
        setFindCount({ idx: matches.length ? 1 : 0, total: matches.length });
        return;
      }
      const st = findSetSearch(editor, q, { scroll: false });
      setFindCount({ idx: st.matches.length ? 1 : 0, total: st.matches.length });
    });
    return () => debounced.cancel();
  }, [findOpen, editor, findQuery, viewMode, sourceBody]);

  // Keep count live across doc edits while the bar is open
  useEffect(() => {
    if (!editor || !findOpen || viewMode === "source") return;
    const update = () => {
      const st = findGetState(editor);
      setFindCount({ idx: st.matches.length ? st.activeIdx + 1 : 0, total: st.matches.length });
    };
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor, findOpen, viewMode]);

  // Stream browser: jump to ## heading after open / same-file reselect (single path, no double toast)
  useEffect(() => {
    if (!editor || editor.isDestroyed || !focusHeading?.trim()) return;
    let tries = 0;
    let cancelled = false;
    const want = focusHeading.trim();
    const tick = () => {
      if (cancelled || editor.isDestroyed || pathRef.current !== path) return;
      tries += 1;
      const hasText = Boolean(editor.state.doc.textContent?.trim());
      if (!hasText && tries < 24) {
        window.setTimeout(tick, 40);
        return;
      }
      if (!readOnly && !sourceActiveRef.current) setViewMode("edit");
      const heading = sourceActiveRef.current ? extractHeadings(null, sourceBodyRef.current.replace(/\r\n/gu, "\n")).find((item) => item.text === want) : null;
      const ok = sourceActiveRef.current ? Boolean(heading) : focusEditorHeading(editor, want);
      if (heading) selectSourceRange(heading.sourceOffset ?? 0);
      if (!ok) {
        emitLocal(
          "toast:show",
          t("workspace:editor.focusHeadingMiss", { heading: want }),
        );
      }
    };
    const start = window.setTimeout(tick, 50);
    return () => {
      cancelled = true;
      clearTimeout(start);
    };
  }, [editor, focusHeading, path, readOnly, t]);

  // Disk/AI updates never replace a dirty editor or race an unresolved choice.
  useEffect(() => {
    if (!editor || readOnly) return;
    let request = 0;
    let disposed = false;
    return (() => {
      const unsubscribe = onLocal("workspace:file-changed", (payload: unknown) => {
        const change = payload && typeof payload === "object" ? payload as { relativePath?: string; source?: string } : {};
        invalidateWorkspaceImagePaths();
        if (change.relativePath && change.relativePath !== path) return;
        if (change.source === "inline-ai" || change.source === "editor") return;
        const seq = ++request;
        const documentId = documentVersion.current.documentId;
        const current = () => !disposed && seq === request && pathRef.current === path && documentVersion.current.documentId === documentId;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        diskChangePhase.current = "checking";
        const activeWrite = saveQueue.current!.activeWrite();
        const task = (async () => {
          try {
            await activeWrite?.catch(() => {});
            if (!current()) return;
            const disk = await api.ws.read(path);
            if (!current()) return;
            if (disk === lastSaved.current) {
              diskChangePhase.current = null;
              if (saveStateRef.current === "dirty") saveTimer.current = setTimeout(() => { void doSaveRef.current().catch(() => {}); }, autoSaveMsRef.current);
              return;
            }
            const [meta, knownPaths] = await Promise.all([api.ws.fileMeta(path).catch(() => null), ensureWorkspaceImagePaths(useViewStore.getState().workspaceRoot)]);
            if (!current()) return;
            const base = splitMarkdownFile(lastSaved.current).body;
            const local = documentVersion.current.revision === persistedRevision.current ? base : getBodyMarkdown(path);
            const body = splitMarkdownFile(disk).body;
            const resolved = resolveDiskConflict({ base, local, disk: body }, "keep-local");
            if (!resolved.auto) {
              diskChangePhase.current = "conflict";
              setDiskConflict({ disk: body, diskFull: disk, source: change.source || "" });
              return;
            }
            diskChangePhase.current = null;
            lastSaved.current = disk;
            setRawContent(disk);
            setFileMeta(meta);
            if (resolved.autoKind === "disk-eq-base") {
              // External property edits must survive the next local body save.
              saveTimer.current = setTimeout(() => { void doSaveRef.current().catch(() => {}); }, autoSaveMsRef.current);
              return;
            }
            acceptBody(body, knownPaths);
            setSaveError(null);
            setSaveState("clean");
            bumpPreview();
          } catch (error) {
            if (!current()) return;
            diskChangePhase.current = null;
            setSaveError(saveErrorText(error));
            setSaveState("error");
          }
        })();
        diskChangeTask.current = task;
        void task.finally(() => { if (diskChangeTask.current === task) diskChangeTask.current = null; });
      });
      return () => { disposed = true; unsubscribe(); };
    })();
    // Document buffers are read from refs after I/O resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, path, readOnly]);

  const switchViewMode = (mode: ViewMode) => {
    if (!editor || documentLoadingRef.current) return;
    if (mode === "source" && !sourceActiveRef.current) {
      const body = documentVersion.current.revision === persistedRevision.current ? splitMarkdownFile(lastSaved.current).body : getBodyMarkdown();
      sourceBodyRef.current = body;
      setSourceBody(body.replace(/\r\n/gu, "\n"));
      sourceActiveRef.current = true;
    }
    if (mode === "edit" && readOnly) return;
    if (mode === "edit" && sourceActiveRef.current) {
      if (markdownNeedsSource(sourceBodyRef.current)) return;
      setEditorMarkdown(editor, sourceBodyRef.current, { noteRelativePath: path });
      sourceActiveRef.current = false;
    }
    if (mode === "preview") {
      if (sourceActiveRef.current) setEditorMarkdown(editor, sourceBodyRef.current, { noteRelativePath: path });
      setPreviewHtml((prev) => nextPreviewHtml(prev, getEditorHtml(editor)));
    }
    setViewMode(mode);
  };

  /** Insert current date-time at cursor (⌘. shortcut). */
  const handleInsertDateTime = useCallback(() => {
    if (!editor || readOnly || editor.isDestroyed) return;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    editor.chain().focus().insertContent(stamp).run();
  }, [editor, readOnly]);

  /** Open link dialog for insert/edit (replaces native window.prompt). */
  const handleLinkRequest = useCallback(() => {
    if (!editor || editor.isDestroyed) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    setLinkDialog({ open: true, prevUrl: prev || "https://" });
  }, [editor]);

  /** Apply link from dialog — empty string removes existing link. */
  const handleLinkConfirm = useCallback((url: string) => {
    if (!editor || editor.isDestroyed) return;
    if (!url.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
    }
    setLinkDialog({ open: false, prevUrl: "" });
  }, [editor]);

  useEffect(() => {
    if (!editor || readOnly) return;
    const handler = (e: KeyboardEvent) => {
      if (!ownsKeyboardEvent(e)) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (saveTimer.current) clearTimeout(saveTimer.current);
        void doSave().catch(() => {});
      }
      // ⌘. insert date-time at cursor
      if (viewMode === "edit" && (e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        handleInsertDateTime();
      }
      // ⌘⌥O toggle document outline
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        setShowOutline((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editor, path, readOnly, doSave, handleInsertDateTime, viewMode]);

  // Flush dirty buffer on window hide/close
  useEffect(() => {
    if (readOnly) return;
    const flush = () => {
      if (loadedPathRef.current !== path) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const st = saveStateRef.current;
      if (st !== "dirty" && st !== "error") return;
      try {
        if (!editor) return;
        const body = getBodyMarkdown(path);
        const full = buildFullFile(body);
        if (full !== lastSaved.current) {
          void doSave({ fullContent: full, force: true }).catch(() => {});
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
    };
  }, [editor, readOnly, doSave]);

  const handleToggleMount = async () => {
    try {
      if (mounted) {
        unmountFile(path);
        emitLocal("toast:show", t("workspace:editor.unmountedFromAi"));
      } else {
        await doSave();
        if (pathRef.current !== path) return;
        mountFile({ path, name: baseName });
        setAiPanelOpen(true);
        emitLocal("toast:show", t("workspace:editor.mountedToAi"));
      }
    } catch (error) { toastWritebackError(t("workspace:editor.saveFailedKeepDraft"), error); }
  };

  const handleAskNoteAi = async () => {
    try {
      await doSave();
      if (pathRef.current !== path) return;
      mountFile({ path, name: baseName });
      useViewStore.getState().openAiWorkspace("chat");
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".v4-composer-field textarea")?.focus());
    } catch (error) { toastWritebackError(t("workspace:editor.saveFailedKeepDraft"), error); }
  };

  const handlePublish = () => {
    if (!canPublish || busyAction) return;
    setPublishConfirmOpen(true);
  };

  const confirmPublish = async () => {
    setPublishConfirmOpen(false);
    if (!canPublish || busyAction) return;
    setBusyAction("publish");
    try {
      if (saveState === "dirty" || saveState === "error") {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        await doSave();
      }
      const res = await api.ws.publish(path);
      emitLocal("workspace:file-changed");
      const mediaCopied = (res as { mediaCopied?: number }).mediaCopied;
      const target =
        (res as { path?: string; targetPath?: string }).path
        || (res as { targetPath?: string }).targetPath
        || "";
      const extra = mediaCopied
        ? t("workspace:editor.publishMediaExtra", { count: mediaCopied })
        : "";
      toastWriteback(t("workspace:editor.publishDone", { extra }), res);
      // Open the delivery copy so「交付」is one click away from the original
      if (target) {
        select({ kind: "file", path: target });
      }
    } catch (e) {
      toastWritebackError(t("workspace:editor.publishFail"), e);
    } finally {
      setBusyAction(null);
    }
  };

  const { groups: moveGroups, loading: moveLoading } = useTopicGroups(moveOpen);

  const handleMoveToTopic = async (topicId: string) => {
    if (moving || readOnly || !path.endsWith(".md")) return;
    setMoving(true);
    try {
      if (saveState === "dirty" || saveState === "error") {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        await doSave();
      }
      const res = await api.ws.move({ relativePath: path, targetTopicId: topicId });
      emitLocal("workspace:file-changed");
      const media =
        typeof res.mediaMoved === "number" && res.mediaMoved > 0
          ? t("workspace:menu.mediaAssetCount", { count: res.mediaMoved })
          : "";
      toastWriteback(t("workspace:editor.movedToTopic", { media: media ? ` · ${media}` : "" }), res);
      setMoveOpen(false);
      const next = res.newPath || res.path || path;
      if (next && next !== path) {
        select({ kind: "file", path: String(next), topicId });
      }
    } catch (e) {
      toastWritebackError(t("workspace:editor.moveFailed"), e);
    } finally {
      setMoving(false);
    }
  };

  const handleMemory = () => {
    if (!resolvedTopicId) return;
    openOverlay("quick-capture", { intent: "memory", topicId: resolvedTopicId });
  };

  /** Draft current selection (or body start) to X hub for confirmed post. */
  const handlePostToX = () => {
    if (readOnly) return;
    let text = "";
    try {
      const sel = window.getSelection()?.toString()?.trim();
      if (sel) text = sel;
    } catch {
      /* ignore */
    }
    if (!text && editor) {
      const plain = editor.getText()?.trim() || "";
      text = plain.slice(0, 280);
    }
    if (!text) {
      emitLocal("toast:show", t("workspace:editor.noTextToPost"));
      return;
    }
    if ([...text].length > 280) text = [...text].slice(0, 280).join("");
    useViewStore.getState().select({ kind: "connector", id: "x" });
    emitLocal("x:open-prompt", { mode: "post", text });
  };

  // Parse frontmatter for display
  const fmEntries = useMemo(() => {
    if (!fileMeta?.frontmatter) return [];
    return Object.entries(fileMeta.frontmatter).map(([key, value]) => {
      let displayValue: string;
      if (Array.isArray(value)) displayValue = value.join(", ");
      else if (typeof value === "object" && value !== null) displayValue = JSON.stringify(value);
      else displayValue = String(value ?? "");
      return { key, value: displayValue };
    });
  }, [fileMeta]);

  const fileSizeText = fileMeta ? formatFileSize(fileMeta.size) : "";
  const mtimeText = fileMeta?.mtime ? formatDateTime(fileMeta.mtime) : "";

  const canShowProperties = !focusMode && !readOnly && path.endsWith(".md");
  const showPropertiesRow = canShowProperties && propertiesOpen;
  const fmStatusKey = resolveStatusColumn(
    typeof fileMeta?.frontmatter?.status === "string" ? fileMeta.frontmatter.status : null,
  );
  const fmPriority = typeof fileMeta?.frontmatter?.priority === "string" ? fileMeta.frontmatter.priority : "";
  const fmDue =
    typeof fileMeta?.frontmatter?.due === "string"
      ? fileMeta.frontmatter.due
      : typeof fileMeta?.frontmatter?.deadline === "string"
        ? String(fileMeta.frontmatter.deadline)
        : "";
  const propertiesSummary = useMemo(() => {
    if (!canShowProperties) return null;
    const parts: string[] = [];
    if (fmStatusKey) {
      const col = getStatusColumns().find((c) => c.key === fmStatusKey);
      if (col) parts.push(col.label);
    }
    if (fmPriority) parts.push(fmPriority);
    if (fmDue) parts.push(fmDue);
    return parts.length > 0 ? parts.join(" · ") : null;
  }, [canShowProperties, fmStatusKey, fmPriority, fmDue]);
  const viewChrome = (
    <EditorViewChrome
      showOutline={showOutline}
      onToggleOutline={() => setShowOutline((v) => !v)}
      editor={readOnly ? null : editor}
      onOpenSettings={() => openOverlay("settings", { topicId: "general" })}
      focusMode={focusMode}
      onToggleFocus={toggleFocusMode}
      showFocus={!focusMode && !toolbarCompact}
    />
  );

  const pagePadding = editorSettings.pagePadding || "comfortable";
  const paper = editorSettings.paper || "default";
  const proseStyle = {
    fontSize: `${editorSettings.fontSize}px`,
    lineHeight: String(editorSettings.lineHeight),
    fontFamily: fontFamilyCss(
      (editorSettings.fontFamily as "sans" | "serif" | "mono") || "sans",
    ),
  } as const;

  if (loadError && saveState !== "dirty" && saveState !== "saving") {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border-subtle-dim bg-status-error-bg px-5 py-4 text-sm text-error">
          <span>
            {t("common:status.error")}: {loadError}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setLoadError(null);
              setReloadTick((v) => v + 1);
            }}
          >
            <RiArrowGoBackLine size={ICON.xs} /> {t("common:action.retry")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={editorRootRef}
      data-editor-mode={viewMode}
      className="v4-editor-shell flex h-full min-h-0 flex-col"
      data-content-width={contentWidth}
      data-page-padding={pagePadding}
      data-paper={paper}
    >
      {/* Row 1: mode · format · view chrome · properties toggle · save/⋯ */}
      <div className="v4-editor-toolbar shrink-0 border-b border-border-subtle-dim bg-surface/80 backdrop-blur-[2px]">
        <div ref={toolbarRef} className="flex h-(--density-editor-toolbar-y,32px) items-center justify-between gap-1 px-2 sm:px-2.5" data-compact={toolbarCompact ? "true" : undefined}>
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            {!readOnly || sourceActiveRef.current ? (
              <EditorModeSwitch viewMode={viewMode} onChange={switchViewMode} visualDisabled={readOnly || (sourceActiveRef.current && sourceNeedsProtection)} />
            ) : (
              <Tooltip content={t("workspace:formatBar.preview")}>
                <span className="inline-flex items-center gap-1 rounded-[var(--radius-xs)] bg-surface-wash-30 px-2 py-0.5 text-3xs text-text-tertiary">
                  <RiEyeLine size={ICON.micro} />
                  <span data-compact-hidden>{t("workspace:formatBar.preview")}</span>
                </span>
              </Tooltip>
            )}

            {!readOnly && viewMode === "edit" ? (
              <>
                <ToolbarSep />
                <EditorFormatBar
                  editor={editor}
                  showFormat={showFormat}
                  onToggleFormat={() => setShowFormat((v) => !v)}
                  onInsertDateTime={handleInsertDateTime}
                  onInsertLink={handleLinkRequest}
                  onInsertImage={() => imageInputRef.current?.click()}
                />
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    if (files.length > 0) insertLocalImagesRef.current?.(files);
                  }}
                />
              </>
            ) : (
              <span className="truncate px-1 text-3xs text-text-quaternary">{docTitle}</span>
            )}
          </div>

          <div className="flex min-w-0 shrink items-center justify-end gap-0.5">
            {viewChrome}
            {canShowProperties && !toolbarCompact ? (
              <>
                <ToolbarSep />
                <Tooltip
                  content={
                    propertiesOpen
                      ? t("workspace:formatBarOptions.hideProperties")
                      : propertiesSummary
                        ? t("workspace:formatBarOptions.showPropertiesWithSummary", {
                            summary: propertiesSummary,
                          })
                        : t("workspace:formatBarOptions.showProperties")
                  }
                >
                  <button
                    type="button"
                    onClick={() => setPropertiesOpen((v) => !v)}
                    className={cn(
                      "v4-editor-tool-btn",
                      !propertiesOpen && propertiesSummary
                        ? "w-auto max-w-[10rem] gap-1 px-2 text-text-secondary"
                        : null,
                      propertiesOpen && "bg-accent-bg-subtle text-accent-color",
                    )}
                    aria-pressed={propertiesOpen}
                    aria-label={
                      propertiesOpen
                        ? t("workspace:formatBarOptions.hideProperties")
                        : t("workspace:formatBarOptions.showProperties")
                    }
                    data-properties-toggle
                  >
                    <RiPriceTag3Line size={ICON.xs} />
                    {!propertiesOpen && propertiesSummary ? (
                      <span className="ml-1 max-w-[7rem] truncate text-3xs font-medium" data-compact-hidden>
                        {propertiesSummary}
                      </span>
                    ) : null}
                  </button>
                </Tooltip>
              </>
            ) : null}
            <EditorMoreMenu
              moreOpen={moreOpen}
              setMoreOpen={setMoreOpen}
              showMeta={showMeta}
              setShowMeta={setShowMeta}
              readOnly={readOnly}
              saveState={saveState}
              wordCount={wordCount}
              propertiesOpen={propertiesOpen}
              onToggleProperties={() => setPropertiesOpen((v) => !v)}
              showPropertiesToggle={canShowProperties}
            />
          </div>
        </div>
      </div>

      {saveError ? (
        <div className="flex flex-wrap items-center gap-2 bg-status-error-bg px-3 py-2 text-xs text-error" role="alert" data-editor-save-error>
          <span className="min-w-0 flex-1">{t("workspace:editor.saveFailedKeepDraft")} {saveError}</span>
          <Button variant="outline" size="sm" onClick={() => void doSave().catch(() => {})}>{t("workspace:editor.retrySave")}</Button>
        </div>
      ) : null}
      {sourceActiveRef.current && sourceNeedsProtection ? (
        <div className="bg-surface-wash-30 px-3 py-2 text-xs text-text-secondary" role="status" data-editor-source-notice>{t("workspace:editor.sourceRequired")}</div>
      ) : null}
      <TitleBarActions>
        <FileEditorTitleBarActions
          canPublish={canPublish}
          busyAction={busyAction}
          onPublish={() => void handlePublish()}
          resolvedTopicId={resolvedTopicId}
          onMemory={handleMemory}
          readOnly={readOnly}
          xPublishEnabled={xPublishEnabled}
          onPostToX={handlePostToX}
          mounted={mounted}
          onToggleMount={handleToggleMount}
          inlineAi={viewMode === "edit"}
          onRequestAiBar={viewMode === "edit" ? requestSelectionAiBar : () => void handleAskNoteAi()}
          moveControl={
            !readOnly && canPublish && path.endsWith(".md") && !path.match(/^88[- ]/u) ? (
              <DropdownMenu
                open={moveOpen}
                onOpenChange={setMoveOpen}
                align="end"
                minWidth={260}
                maxHeight={360}
                matchTriggerWidth={false}
                trigger={
                  <Tooltip content={t("workspace:menu.moveToTopicTooltip")}>
                    <button
                      type="button"
                      disabled={moving}
                      onClick={() => setMoveOpen((v) => !v)}
                      className="v4-titlebar-btn v4-titlebar-btn-icon"
                      aria-label={t("workspace:menu.moveToTopic")}
                      aria-expanded={moveOpen}
                    >
                      {moving ? (
                        <RiLoader4Line size={ICON.sm} className="animate-spin" />
                      ) : (
                        <RiFolderReceivedLine size={ICON.sm} />
                      )}
                    </button>
                  </Tooltip>
                }
              >
                <TopicPickerList
                  groups={moveGroups}
                  loading={moveLoading}
                  busy={moving}
                  onPick={(id) => void handleMoveToTopic(id)}
                />
              </DropdownMenu>
            ) : null
          }
        />
      </TitleBarActions>

      {/* Properties — status/priority/due chips; default collapsed (toolbar toggle). */}
      {showPropertiesRow ? (
        <FrontmatterBar
          relativePath={path}
          frontmatter={fileMeta?.frontmatter}
          flushBody={async () => {
            if (pathRef.current !== path) throw new Error(t("workspace:editor.documentChanged"));
            // Always drain queue + flush dirty/saving body before FM write (C2)
            if (saveTimer.current) {
              clearTimeout(saveTimer.current);
              saveTimer.current = null;
            }
            await saveChain.current.catch(() => {});
            if (pathRef.current !== path) throw new Error(t("workspace:editor.documentChanged"));
            const st = saveStateRef.current;
            if (st === "dirty" || st === "error" || st === "saving") {
              await doSave();
            }
          }}
          onUpdated={async (next) => {
            if (pathRef.current !== path) return;
            setFileMeta((m) => (m ? { ...m, frontmatter: next } : m));
            // Reload FM block after server write so next body save won't wipe new YAML
            try {
              await saveChain.current.catch(() => {});
              const content = await api.ws.read(path);
              if (pathRef.current !== path) return;
              lastSaved.current = content;
              setRawContent(content);
              const { body } = splitMarkdownFile(content);
              // Keep unsaved body edits; only sync editor when clean
              if (editor && (saveStateRef.current === "clean" || saveStateRef.current === "saved")) {
                acceptBody(body || "");
                bumpPreview();
              }
            } catch {
              /* ignore reload race */
            }
          }}
        />
      ) : null}

      {/* Expanded metadata panel — never in focus mode */}
      {!focusMode && showMeta && fileMeta ? (
        <div className="v4-editor-meta border-b border-border-subtle-dim px-3 py-2">
          <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-3xs text-text-quaternary">
            <span className="min-w-0 max-w-[40%] truncate font-medium text-text-secondary" title={docTitle}>{docTitle}</span>
            <span className="min-w-0 max-w-[50%] truncate font-mono" title={path}>
              {path}
            </span>
            {fileSizeText ? <span>{fileSizeText}</span> : null}
            {mtimeText ? <span>{t("workspace:editor.modifiedTime", { time: mtimeText })}</span> : null}
          </div>
          {fmEntries.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {fmEntries.map(({ key, value }) => (
                <div
                  key={key}
                  className="inline-flex max-w-full items-center gap-1 rounded-md border border-border-subtle-dim bg-surface px-2 py-0.5 text-3xs"
                  title={`${key}: ${value}`}
                >
                  <span className="shrink-0 font-medium text-text-quaternary">{key}</span>
                  <span className="min-w-0 truncate text-text-secondary">{value}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-3xs text-text-quaternary">{t("workspace:editor.noFrontmatterFields")}</p>
          )}
        </div>
      ) : null}

      {/* Edit: TipTap · Source: original Markdown body · Preview: static HTML.
          EditorContent stays mounted (hidden) so immediatelyRender:false still has a view. */}
      {findOpen ? (
        <div
          className="pointer-events-auto absolute right-4 top-2 z-floating flex items-center gap-1.5 rounded-[var(--radius-lg)] border border-border-subtle bg-surface-elevated/95 px-2 py-1.5 shadow-[var(--shadow-float)] backdrop-blur-sm"
          role="search"
          aria-label={t("workspace:editor.findAria")}
        >
          <RiSearchLine size={ICON.xs} className="shrink-0 text-text-quaternary" aria-hidden />
          <input
            ref={findInputRef}
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "F3") {
                e.preventDefault();
                stepFind(e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                closeFind();
                if (viewMode === "source") sourceInputRef.current?.focus();
                else editor?.commands.focus();
              }
            }}
            placeholder={t("workspace:editor.findPlaceholder")}
            className="h-6 w-40 rounded-[var(--radius-sm)] border border-transparent bg-surface-wash-15 px-2 text-3xs text-text-primary outline-none hover:bg-surface-wash-30 focus-visible:border-accent-color focus-visible:bg-surface-elevated sm:w-52"
            aria-label={t("workspace:editor.findPlaceholder")}
          />
          <span className="min-w-12 shrink-0 text-center text-3xs tabular-nums text-text-tertiary">
            {findCount.total > 0 ? `${findCount.idx}/${findCount.total}` : findQuery.trim() ? t("workspace:editor.findNoMatch") : "0/0"}
          </span>
          <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => stepFind(-1)} aria-label={t("workspace:editor.findPrev")}>
            <RiArrowUpSLine size={ICON.xs} />
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => stepFind(1)} aria-label={t("workspace:editor.findNext")}>
            <RiArrowDownSLine size={ICON.xs} />
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={closeFind} aria-label={t("common:action.close")}>
            <RiCloseLine size={ICON.xs} />
          </Button>
        </div>
      ) : null}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div
          className={cn(
            "v4-editor-scroll v4-editor-canvas min-h-0 flex-1 overflow-auto",
            viewMode === "source" && "flex flex-col overflow-hidden",
            (viewMode === "preview" || readOnly) && "v4-md-preview",
          )}
        >
          {/* Reading chrome: every note opens like an article (title always visible). */}
          {docTitle && viewMode !== "source" ? (
            <div className="v4-editor-article-head px-4 pt-5 sm:px-6" data-editor-article-title>
              <h1 className="m-0 text-[1.45em] font-semibold leading-snug tracking-tight text-text-primary">
                {docTitle}
              </h1>
            </div>
          ) : null}
          <div
            className={cn((viewMode !== "edit" || readOnly || documentLoading) && "hidden")}
            aria-hidden={viewMode !== "edit" || readOnly || documentLoading}
          >
            <div
              className="contents"
              onContextMenu={(e) => {
                if (readOnly || viewMode !== "edit") return;
                e.preventDefault();
                setEditorMenu({ x: e.clientX, y: e.clientY });
              }}
            >
              <EditorContent editor={editor} className="v4-editor-content allow-native-context" />
              {viewMode === "edit" && !readOnly ? (
                <SelectionAiBar editor={editor} readOnly={readOnly} notePath={path} frontmatter={splitMarkdownFile(rawContent).frontmatterBlock} />
              ) : null}
            </div>
          </div>
          {viewMode === "source" ? (
            <textarea ref={sourceInputRef} value={sourceBody} readOnly={readOnly} disabled={documentLoading}
              aria-label={t("workspace:formatBar.source")} spellCheck={false}
              className="min-h-0 w-full flex-1 resize-none border-0 bg-transparent px-4 py-4 font-mono text-sm text-text-primary outline-none sm:px-6"
              style={{ fontSize: `${editorSettings.fontSize}px`, lineHeight: String(editorSettings.lineHeight), boxShadow: "none", tabSize: 2, overflowWrap: editorSettings.wordWrap === false ? "normal" : "anywhere", whiteSpace: editorSettings.wordWrap === false ? "pre" : "pre-wrap" }}
              onChange={(event) => { sourceBodyRef.current = sourceBodyFromInput(event.target.value, lastSaved.current); setSourceBody(event.target.value); markDocumentChanged(); }}
              onKeyDown={(event) => { if (findOpen && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeFind(); } }}
            />
          ) : null}
          {viewMode === "preview" ? (
            <div
              className="v4-editor-body v4-tiptap allow-native-context"
              style={proseStyle}
              // Local workspace content only — not remote HTML
              dangerouslySetInnerHTML={{ __html: previewHtml }}
              onContextMenu={(e) => {
                // Preview: native copy is fine; also offer file menu
                if (e.metaKey || e.ctrlKey) return;
                e.preventDefault();
                fileMenu.open(e, {
                  path,
                  label: baseName,
                  kind: readOnly ? "archive" : path.match(/^00[- ]/u) ? "inbox" : "note",
                  topicId: resolvedTopicId,
                });
              }}
            />
          ) : null}
        </div>
        <EditorOutlinePanel
          editor={editor}
          rawMarkdown={viewMode === "source" ? sourceBody : rawContent}
          onSourceSelect={(offset) => selectSourceRange(offset)}
          viewMode={viewMode}
          open={showOutline}
          onClose={() => setShowOutline(false)}
        />
      </div>

      <WorkspaceFileContextMenu menu={fileMenu.menu} onClose={fileMenu.close} />

      <ConfirmDialog
        open={Boolean(diskConflict)}
        title={t("workspace:editor.diskConflictTitle")}
        description={
          diskConflict?.source.startsWith("ai:")
            ? t("workspace:editor.diskConflictDescAi")
            : t("workspace:editor.diskConflictDesc")
        }
        confirmText={t("workspace:editor.diskConflictTakeDisk")}
        cancelText={t("workspace:editor.diskConflictKeepLocal")}
        // take-disk discards unsaved local edits — destructive: Enter lands on Cancel.
        destructive
        onConfirm={() => applyDiskConflict("take-disk")}
        onCancel={() => applyDiskConflict("keep-local")}
      >
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => applyDiskConflict("merge")}
        >
          {t("workspace:editor.diskConflictMerge")}
        </Button>
      </ConfirmDialog>
      <ConfirmDialog
        open={publishConfirmOpen}
        title={t("workspace:editor.publishTitle")}
        description={t("workspace:editor.publishDesc", { title: docTitle })}
        confirmText={t("workspace:menu.publish")}
        cancelText={t("common:action.cancel")}
        onConfirm={() => void confirmPublish()}
        onCancel={() => setPublishConfirmOpen(false)}
      />

      <PromptDialog
        open={linkDialog.open}
        title={t("workspace:editor.formatLink")}
        defaultValue={linkDialog.prevUrl}
        placeholder="https://"
        onConfirm={(v) => handleLinkConfirm(v)}
        onCancel={() => setLinkDialog({ open: false, prevUrl: "" })}
      />

      <ContextMenu
        open={Boolean(editorMenu)}
        x={editorMenu?.x ?? 0}
        y={editorMenu?.y ?? 0}
        onClose={() => setEditorMenu(null)}
        minWidth={180}
      >
        <ContextMenuItem
          onClick={() => {
            document.execCommand("cut");
            setEditorMenu(null);
          }}
        >
          {t("common:action.cut")}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            document.execCommand("copy");
            setEditorMenu(null);
          }}
        >
          {t("common:action.copy")}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            void navigator.clipboard.readText().then((t) => {
              if (t && editor) editor.chain().focus().insertContent(t).run();
            });
            setEditorMenu(null);
          }}
        >
          {t("common:action.paste")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => {
            setEditorMenu(null);
            const { empty } = editor?.state.selection ?? { empty: true };
            if (!editor || empty) {
              emitLocal("toast:show", t("workspace:editor.toastAiSelectText"));
              return;
            }
            editor.chain().focus().run();
            // Next tick so context menu unmount doesn't steal selection
            window.setTimeout(() => requestSelectionAiBar(), 0);
          }}
        >
          {t("workspace:editor.aiRewrite")}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            editor?.chain().focus().toggleBold().run();
            setEditorMenu(null);
          }}
        >
          {t("workspace:editor.formatBold")}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            editor?.chain().focus().toggleItalic().run();
            setEditorMenu(null);
          }}
        >
          {t("workspace:editor.formatItalic")}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            editor?.chain().focus().toggleHeading({ level: 2 }).run();
            setEditorMenu(null);
          }}
        >
          {t("workspace:editor.formatHeader2")}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            if (!editor) return;
            const prev = editor.getAttributes("link").href as string | undefined;
            setLinkDialog({ open: true, prevUrl: prev || "https://" });
            setEditorMenu(null);
          }}
        >
          {t("workspace:editor.formatLink")}…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => {
            const pos = editorMenu;
            setEditorMenu(null);
            if (!pos) return;
            // Re-open shared file menu at same cursor (synthetic event)
            fileMenu.open(
              {
                clientX: pos.x,
                clientY: pos.y,
                preventDefault: () => {},
                stopPropagation: () => {},
              } as unknown as React.MouseEvent,
              {
                path,
                label: baseName,
                kind: path.match(/^00[- ]/u) ? "inbox" : "note",
                topicId: resolvedTopicId,
              },
            );
          }}
        >
          {t("workspace:editor.fileOpsEllipsis")}
        </ContextMenuItem>
      </ContextMenu>
    </div>
  );
}
