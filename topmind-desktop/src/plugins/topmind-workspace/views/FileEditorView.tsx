import { useEffect, useRef, useState, useMemo, useCallback, useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Typography from "@tiptap/extension-typography";
import CharacterCount from "@tiptap/extension-character-count";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Markdown } from "tiptap-markdown";
import { Eye, FolderInput, Loader2 } from "lucide-react";
import { api } from "../../../services/api";
import { useAiStore } from "../../../stores/ai-store";
import { useViewStore } from "../../../stores/view-store";
import { FrontmatterBar } from "../../../components/editor/FrontmatterBar";
import {
  SelectionAiBar,
  requestSelectionAiBar,
} from "../../../components/editor/SelectionAiBar";
import { EditorReadingMenu } from "../../../components/editor/EditorReadingMenu";
import { fontFamilyCss } from "../../../lib/editor-prefs";
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
import {
  DropdownMenu,
} from "../../../components/ui/DropdownMenu";
import {
  TopicPickerList,
  useTopicGroups,
} from "../../../components/workspace/TopicPickerMenu";
import { emitLocal, onLocal } from "../../../plugins/host";
import { toastWriteback, toastWritebackError } from "../../../lib/writeback-toast";
import { displayNoteTitle } from "../../../lib/note-meta";
import { joinMarkdownFile, splitMarkdownFile } from "../../../lib/md-frontmatter";
import {
  getEditorHtml,
  getEditorMarkdown,
  normalizeContentWidth,
  setEditorMarkdown,
} from "../../../lib/editor-markdown";
import { focusEditorHeading } from "../../../lib/editor-focus-heading";
import { cn } from "../../../lib/cn";
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
} from "./file-editor-format-bar";

interface Props {
  path: string;
  topicId?: string;
  readOnly?: boolean;
  /** Stream browser: open period note and jump to this ## heading */
  focusHeading?: string;
}

type ViewMode = "edit" | "preview";

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
    setSaveStateRaw((prev) => {
      const next = typeof s === "function" ? s(prev) : s;
      saveStateRef.current = next;
      return next;
    });
  };
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>(readOnly ? "preview" : "edit");
  /** Only show X toolbar when connector plugin is enabled in settings */
  const xPublishEnabled = Boolean(getCachedSettings()?.x?.enabled);
  const [showMeta, setShowMeta] = useState(false);
  /** Format tools collapsed by default — quieter chrome; chevron expands on demand */
  const [showFormat, setShowFormat] = useState(false);
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
  const [moving, setMoving] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [linkDialog, setLinkDialog] = useState<{ open: boolean; prevUrl: string }>({ open: false, prevUrl: "" });
  const [fileMeta, setFileMeta] = useState<FileMeta | null>(null);
  /** Full file on disk (frontmatter + body) — source of truth for FM block. */
  const [rawContent, setRawContent] = useState("");
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
  pathRef.current = path;
  /** Last serialized markdown body — used to detect no-op onUpdate (formatting toggles etc.) */
  const lastSerializedBodyRef = useRef<string>("");
  const autoSaveMsRef = useRef(1500);
  autoSaveMsRef.current = Math.max(500, Math.min(5000, editorSettings.autoSaveMs ?? 1500));
  /** Skip one disk-change reload after our own save */
  const ignoreDiskReloadUntil = useRef(0);
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
        heading: { levels: [1, 2, 3, 4] },
        // Link is registered separately with openOnClick: false
        link: false,
        // Underline is included in StarterKit v3 — do not add ExtensionUnderline again
      }),
      Typography,
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: { class: "v4-md-link", rel: "noopener noreferrer" },
      }),
      Image.configure({
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
    onUpdate: () => {
      if (readOnly) return;
      // Compare serialized markdown with last known state to avoid false dirty
      // (formatting toggles, undo/redo to same state, etc.)
      if (editor) {
        try {
          const currentBody = getEditorMarkdown(editor, { noteRelativePath: pathRef.current });
          if (currentBody === lastSerializedBodyRef.current) {
            // Content unchanged — don't mark dirty, clear any pending save timer
            if (saveStateRef.current === "dirty") setSaveState("clean");
            if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
            setCharCount(editor.storage.characterCount.characters());
            setWordCount(editor.storage.characterCount.words());
            return;
          }
        } catch {
          // Serialization failed — fall through to dirty
        }
      }
      setSaveState("dirty");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      // doSave is stable via ref path; schedule by path at fire time
      saveTimer.current = setTimeout(() => {
        void saveChain.current.then(() => {
          const ed = editor;
          if (!ed || pathRef.current !== path) return;
          const body = getEditorMarkdown(ed, { noteRelativePath: pathRef.current });
          lastSerializedBodyRef.current = body;
          const { frontmatterBlock } = splitMarkdownFile(lastSaved.current);
          const full = joinMarkdownFile(frontmatterBlock, body);
          return doSave({ relativePath: pathRef.current, fullContent: full });
        });
      }, autoSaveMsRef.current);
      if (editor) {
        setCharCount(editor.storage.characterCount.characters());
        setWordCount(editor.storage.characterCount.words());
      }
    },
  });

  const getBodyMarkdown = (): string => {
    if (!editor) {
      const { body } = splitMarkdownFile(rawContent);
      return body;
    }
    return getEditorMarkdown(editor, { noteRelativePath: pathRef.current });
  };

  const buildFullFile = (body: string): string => {
    const { frontmatterBlock } = splitMarkdownFile(lastSaved.current || rawContent);
    return joinMarkdownFile(frontmatterBlock, body);
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
    const canEdit = !readOnly && viewMode === "edit";
    editor.setEditable(canEdit);
  }, [editor, viewMode, readOnly]);

  // Snapshot HTML when entering preview (or when body changes while previewing)
  const [previewHtml, setPreviewHtml] = useState("<p></p>");
  useEffect(() => {
    if (viewMode !== "preview" && !readOnly) return;
    setPreviewHtml(getEditorHtml(editor) || "<p></p>");
    // Only depend on editor, viewMode, readOnly, and path — NOT wordCount/charCount/saveState/rawContent
    // which change on every keystroke and cause unnecessary re-renders + flicker.
  }, [editor, viewMode, readOnly, path]);

  /**
   * Persist body for a path. Serialized via saveChain.
   * When switching files, call with the previous path + forced body/FM so we never drop dirty buffers.
   */
  const doSave = useCallback(
    async (opts?: { relativePath?: string; fullContent?: string; force?: boolean }) => {
      if (readOnly && !opts?.force) return;
      const targetPath = opts?.relativePath ?? pathRef.current;
      const run = async () => {
        let content = opts?.fullContent;
        if (content == null) {
          if (!editor) return;
          const body = getBodyMarkdown();
          content = buildFullFile(body);
        }
        if (content === lastSaved.current && targetPath === pathRef.current) {
          setSaveState("clean");
          return;
        }
        // Only flip UI saving state when still on this path
        if (targetPath === pathRef.current) setSaveState("saving");
        try {
          await api.ws.save({ relativePath: targetPath, content });
          ignoreDiskReloadUntil.current = Date.now() + 800;
          if (targetPath === pathRef.current) {
            lastSaved.current = content;
            setRawContent(content);
            setSaveState("saved");
            const meta = await api.ws.fileMeta(targetPath).catch(() => null);
            if (meta) setFileMeta(meta);
            setTimeout(() => {
              if (pathRef.current === targetPath && saveStateRef.current === "saved") {
                setSaveState("clean");
              }
            }, 1200);
          }
          emitLocal("workspace:file-changed", { relativePath: targetPath });
        } catch (e) {
          if (targetPath === pathRef.current) {
            setSaveState("error");
            setLoadError(e instanceof Error ? e.message : String(e));
          }
          throw e;
        }
      };
      const queued = saveChain.current.then(run, run);
      saveChain.current = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
    // getBodyMarkdown/buildFullFile close over editor/rawContent — rebind when path/editor change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, readOnly, path],
  );

  // Paste/drop images → {noteDir}/images/{noteStem}/img-*.{ext} + relative markdown
  useEffect(() => {
    insertLocalImagesRef.current = async (files: File[]) => {
      if (!editor || readOnly || !path.endsWith(".md") || !files.length) return;
      const dir = path.includes("/") ? path.split("/").slice(0, -1).join("/") : "";
      const stem = (path.split("/").pop() || "note").replace(/\.md$/iu, "") || "note";
      const prefix = dir ? `${dir}/images/${stem}` : `images/${stem}`;

      for (const file of files.slice(0, 12)) {
        try {
          const buf = new Uint8Array(await file.arrayBuffer());
          if (!buf.length || buf.length > 8_000_000) continue;
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
        } catch (e) {
          toastWritebackError(t("workspace:editor.imageSaveFailed"), e instanceof Error ? e.message : String(e));
        }
      }
      // Persist body after inserts
      setSaveState("dirty");
      void doSave();
    };
  }, [editor, readOnly, path, doSave]);

  // Load file content + metadata; flush dirty buffer when leaving a path
  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    setLoadError(null);

    (async () => {
      try {
        const [content, meta] = await Promise.all([
          api.ws.read(path),
          api.ws.fileMeta(path).catch(() => null),
        ]);
        if (cancelled) return;
        lastSaved.current = content;
        setRawContent(content);
        setFileMeta(meta);
        const { body } = splitMarkdownFile(content);
        setEditorMarkdown(editor, body || "", { noteRelativePath: path });
        lastSerializedBodyRef.current = body || "";
        setSaveState("clean");
        setCharCount(editor.storage.characterCount.characters());
        setWordCount(editor.storage.characterCount.words());
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      // Flush dirty buffer for the path we're leaving (C1)
      if (readOnly) return;
      const leaving = path;
      const dirty = saveStateRef.current === "dirty" || saveStateRef.current === "error" || saveStateRef.current === "saving";
      if (!dirty || !editor) return;
      try {
        const body = getEditorMarkdown(editor, { noteRelativePath: path });
        const { frontmatterBlock } = splitMarkdownFile(lastSaved.current);
        const full = joinMarkdownFile(frontmatterBlock, body);
        if (full !== lastSaved.current) {
          void doSave({ relativePath: leaving, fullContent: full, force: true });
        }
      } catch {
        /* best-effort flush */
      }
    };
    // Close over editor + path only — avoid re-flushing on content changes (debounced elsewhere).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, path]);

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
      if (!readOnly) setViewMode("edit");
      const ok = focusEditorHeading(editor, want);
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

  // External / AI writes to the open file (C3)
  useEffect(() => {
    if (!editor || readOnly) return;
    return onLocal("workspace:file-changed", (payload: unknown) => {
      const rel =
        payload && typeof payload === "object" && "relativePath" in payload
          ? String((payload as { relativePath?: string }).relativePath || "")
          : "";
      if (rel && rel !== path) return;
      if (Date.now() < ignoreDiskReloadUntil.current) return;
      const st = saveStateRef.current;
      if (st === "dirty" || st === "saving" || st === "error") {
        emitLocal("toast:show", t("workspace:editor.diskFileUpdatedUnsaved"));
        return;
      }
      void (async () => {
        try {
          const [content, meta] = await Promise.all([
            api.ws.read(path),
            api.ws.fileMeta(path).catch(() => null),
          ]);
          if (pathRef.current !== path) return;
          if (content === lastSaved.current) return;
          lastSaved.current = content;
          setRawContent(content);
          setFileMeta(meta);
          const { body } = splitMarkdownFile(content);
          setEditorMarkdown(editor, body || "", { noteRelativePath: path });
          lastSerializedBodyRef.current = body || "";
          setSaveState("clean");
          setCharCount(editor.storage.characterCount.characters());
          setWordCount(editor.storage.characterCount.words());
        } catch {
          /* ignore reload races */
        }
      })();
    });
  }, [editor, path, readOnly]);

  const switchViewMode = (mode: ViewMode) => {
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
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (saveTimer.current) clearTimeout(saveTimer.current);
        void doSave();
      }
      // ⌘. insert date-time at cursor
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        handleInsertDateTime();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editor, path, readOnly, doSave, handleInsertDateTime]);

  // Flush dirty buffer on window hide/close
  useEffect(() => {
    if (readOnly) return;
    const flush = () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const st = saveStateRef.current;
      if (st !== "dirty" && st !== "error") return;
      try {
        if (!editor) return;
        const body = getEditorMarkdown(editor, { noteRelativePath: path });
        const { frontmatterBlock } = splitMarkdownFile(lastSaved.current);
        const full = joinMarkdownFile(frontmatterBlock, body);
        if (full !== lastSaved.current) {
          void doSave({ fullContent: full, force: true });
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

  const handleToggleMount = () => {
    if (mounted) {
      unmountFile(path);
      emitLocal("toast:show", t("workspace:editor.unmountedFromAi"));
    } else {
      mountFile({ path, name: baseName });
      setAiPanelOpen(true);
      emitLocal("toast:show", t("workspace:editor.mountedToAi"));
    }
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
      // Open the delivery copy so「写出来」is one click away from the original
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

  const handleOpenAi = () => {
    if (!mounted) mountFile({ path, name: baseName });
    setAiPanelOpen(true);
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

  if (loadError && saveState !== "dirty" && saveState !== "saving") {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="rounded-lg border border-error/20 bg-status-error-bg px-5 py-4 text-sm text-error">
          {t("common:status.error")}: {loadError}
        </div>
      </div>
    );
  }

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

  const pathParts = path.split("/").filter(Boolean);
  const crumbCategory = pathParts.length >= 2 ? pathParts[0] : null;
  const crumbTopic = pathParts.length >= 3 ? pathParts[1] : pathParts.length === 2 && !baseName.endsWith(".md") ? pathParts[0] : resolvedTopicId?.split("/")[1] ?? null;

  const pagePadding = editorSettings.pagePadding || "comfortable";
  const paper = editorSettings.paper || "default";
  const proseStyle = {
    fontSize: `${editorSettings.fontSize}px`,
    lineHeight: String(editorSettings.lineHeight),
    fontFamily: fontFamilyCss(
      (editorSettings.fontFamily as "sans" | "serif" | "mono") || "sans",
    ),
  } as const;

  return (
    <div
      className="v4-editor-shell flex h-full min-h-0 flex-col"
      data-content-width={contentWidth}
      data-page-padding={pagePadding}
      data-paper={paper}
    >
      {/* Row 1: mode · format tools · primary actions (title lives on property row) */}
      <div className="v4-editor-toolbar shrink-0 border-b border-border-subtle-dim bg-surface/80 backdrop-blur-[2px]">
        <div ref={toolbarRef} className="flex h-(--density-editor-toolbar-y,36px) items-center justify-between gap-1 px-2 sm:px-2.5" data-compact={toolbarCompact ? "true" : undefined}>
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            {!readOnly ? (
              <EditorModeSwitch viewMode={viewMode} onChange={switchViewMode} />
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-3xs text-text-tertiary">
                <Eye size={ICON.micro} /> {t("workspace:formatBar.preview")}
              </span>
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
                />
              </>
            ) : (
              <span className="truncate px-1 text-3xs text-text-quaternary">{docTitle}</span>
            )}
          </div>

          <div className="flex min-w-0 max-w-[min(52%,22rem)] shrink items-center justify-end gap-0.5 sm:max-w-104">
            <EditorReadingMenu
              onOpenSettings={() => openOverlay("settings", { topicId: "general" })}
            />
            <ToolbarSep />
            {!readOnly && canPublish && path.endsWith(".md") && !path.match(/^88[- ]/u) ? (
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
                      className="flex h-7 shrink-0 items-center gap-1 rounded-sm px-1.5 text-text-tertiary transition-colors hover:bg-surface-muted hover:text-text-primary disabled:opacity-50"
                      aria-label={t("workspace:menu.moveToTopic")}
                      aria-expanded={moveOpen}
                    >
                      {moving ? (
                        <Loader2 size={ICON.xs} className="animate-spin" />
                      ) : (
                        <FolderInput size={ICON.xs} />
                      )}
                      <span className="hidden text-3xs lg:inline" data-compact-hidden>
                        {t("workspace:menu.moveToTopic")}
                      </span>
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
            ) : null}
            <EditorMoreMenu
              moreOpen={moreOpen}
              setMoreOpen={setMoreOpen}
              showMeta={showMeta}
              setShowMeta={setShowMeta}
              canPublish={canPublish}
              busyAction={busyAction}
              onPublish={() => void handlePublish()}
              resolvedTopicId={resolvedTopicId}
              onMemory={handleMemory}
              onRequestAiBar={requestSelectionAiBar}
              readOnly={readOnly}
              xPublishEnabled={xPublishEnabled}
              onPostToX={handlePostToX}
              mounted={mounted}
              onToggleMount={handleToggleMount}
              onOpenAi={handleOpenAi}
              focusMode={focusMode}
              onToggleFocus={toggleFocusMode}
              saveState={saveState}
              wordCount={wordCount}
            />
          </div>
        </div>
      </div>

      {/* Properties + identity (title/breadcrumb) — frees toolbar for format tools */}
      {!focusMode && !readOnly && path.endsWith(".md") ? (
        <FrontmatterBar
          relativePath={path}
          frontmatter={fileMeta?.frontmatter}
          identity={{
            title: docTitle,
            breadcrumb: crumbCategory
              ? `${crumbCategory}${crumbTopic ? ` / ${crumbTopic}` : ""}`
              : baseName,
            onContextMenu: (e) =>
              fileMenu.open(e, {
                path,
                label: baseName,
                kind: path.match(/^00[- ]/u) ? "inbox" : "note",
                topicId: resolvedTopicId,
              }),
          }}
          flushBody={async () => {
            // Always drain queue + flush dirty/saving body before FM write (C2)
            if (saveTimer.current) {
              clearTimeout(saveTimer.current);
              saveTimer.current = null;
            }
            await saveChain.current.catch(() => {});
            const st = saveStateRef.current;
            if (st === "dirty" || st === "error" || st === "saving") {
              await doSave();
            }
          }}
          onUpdated={async (next) => {
            setFileMeta((m) => (m ? { ...m, frontmatter: next } : m));
            // Reload FM block after server write so next body save won't wipe new YAML
            try {
              await saveChain.current.catch(() => {});
              const content = await api.ws.read(path);
              lastSaved.current = content;
              setRawContent(content);
              const { body } = splitMarkdownFile(content);
              // Keep unsaved body edits; only sync editor when clean
              if (editor && (saveStateRef.current === "clean" || saveStateRef.current === "saved")) {
                setEditorMarkdown(editor, body || "", { noteRelativePath: path });
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
            <span className="font-medium text-text-secondary">{docTitle}</span>
            <span className="font-mono" title={path}>
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

      {/* Edit: TipTap surface · Preview: static HTML (same .v4-tiptap styles, reliable paint) */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className={cn(
            "v4-editor-scroll v4-editor-canvas min-h-0 flex-1 overflow-auto",
            (viewMode === "preview" || readOnly) && "v4-md-preview",
          )}
        >
          {viewMode === "preview" || readOnly ? (
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
          ) : (
            <div
              className="contents"
              onContextMenu={(e) => {
                if (readOnly) return;
                e.preventDefault();
                setEditorMenu({ x: e.clientX, y: e.clientY });
              }}
            >
              <EditorContent editor={editor} className="v4-editor-content allow-native-context" />
              <SelectionAiBar editor={editor} readOnly={readOnly} notePath={path} frontmatter={splitMarkdownFile(rawContent).frontmatterBlock} />
            </div>
          )}
        </div>
      </div>

      <WorkspaceFileContextMenu menu={fileMenu.menu} onClose={fileMenu.close} />

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
