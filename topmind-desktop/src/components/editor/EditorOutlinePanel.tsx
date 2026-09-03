/**
 * EditorOutlinePanel — 现代化 Markdown 长文大纲/目录抽屉 (TOC)。
 *
 * 遵循 Jakob's Law (用户对类似 VS Code / Obsidian / Notion 大纲的交互预期)：
 * - 自动解析 H1-H6 标题层级
 * - 点击平滑直达目标标题 (focusEditorHeading)
 * - 优雅的紧凑层级缩进与活跃高亮
 * - 支持折叠与快捷键
 */
import { useEffect, useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { RiCloseLine, RiListCheck3, RiNodeTree } from "@remixicon/react";
import type { Editor } from "@tiptap/react";
import { ICON } from "../../lib/icons";
import { cn } from "../../lib/cn";
import { focusEditorHeading } from "../../lib/editor-focus-heading";

export interface OutlineItem {
  id: string;
  level: number;
  text: string;
  pos?: number;
}

interface EditorOutlinePanelProps {
  editor: Editor | null | undefined;
  rawMarkdown?: string;
  viewMode: "edit" | "preview";
  open: boolean;
  onClose: () => void;
  className?: string;
}

/** Clean Markdown inline formatting from heading text for clean outline display. */
export function cleanHeadingText(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/<!--.*?-->/gu, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1") // [text](url) -> text
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/gu, "$1") // **bold** or *italic* -> text
    .replace(/`([^`]+)`/gu, "$1") // `code` -> code
    .replace(/~~([^~]+)~~/gu, "$1") // ~~strikethrough~~ -> text
    .trim();
}

/** Extract headings from TipTap doc or raw markdown. */
export function extractHeadings(editor: Editor | null | undefined, rawMarkdown?: string): OutlineItem[] {
  const items: OutlineItem[] = [];

  if (editor && !editor.isDestroyed) {
    let index = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading") {
        const text = node.textContent.trim();
        if (text) {
          items.push({
            id: `heading-${index++}-${pos}`,
            level: (node.attrs.level as number) || 1,
            text,
            pos: pos + 1,
          });
        }
      }
      return true;
    });
    if (items.length > 0) return items;
  }

  // Fallback: parse markdown raw headings (# Heading) while skipping code blocks
  if (rawMarkdown) {
    const lines = rawMarkdown.split("\n");
    let index = 0;
    let inCodeBlock = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) continue;

      const match = line.match(/^(#{1,6})\s+(.+)$/u);
      if (match) {
        const level = match[1].length;
        const text = cleanHeadingText(match[2]);
        if (text) {
          items.push({
            id: `heading-md-${index++}`,
            level,
            text,
          });
        }
      }
    }
  }

  return items;
}

export function EditorOutlinePanel({
  editor,
  rawMarkdown,
  viewMode,
  open,
  onClose,
  className,
}: EditorOutlinePanelProps) {
  const { t } = useTranslation(["workspace", "common"]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [editorVersion, setEditorVersion] = useState(0);

  // Real-time synchronization: subscribe to TipTap document updates so outline updates as user types.
  // Dormant when outline drawer is closed — zero CPU consumption during regular editing.
  useEffect(() => {
    if (!open || !editor || editor.isDestroyed) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handleUpdate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        setEditorVersion((v) => (v + 1) % 1_000_000);
      }, 200); // 200ms debounce keeps editing smooth while updating outline in near real-time
    };
    // Re-sync on open
    setEditorVersion((v) => (v + 1) % 1_000_000);
    editor.on("update", handleUpdate);
    return () => {
      if (timer) clearTimeout(timer);
      editor.off("update", handleUpdate);
    };
  }, [editor, open]);

  const headings = useMemo(() => {
    if (!open) return [];
    return extractHeadings(editor, rawMarkdown);
  }, [editor, rawMarkdown, viewMode, editorVersion, open]);

  // Scrollspy: Sync active heading with the visible editor viewport
  useEffect(() => {
    if (!open || headings.length === 0) return;
    const scrollContainer = document.querySelector(".v4-editor-scroll");
    if (!scrollContainer) return;

    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const headingEls = scrollContainer.querySelectorAll("h1, h2, h3, h4, h5, h6");
        if (!headingEls || headingEls.length === 0) return;

        const containerRect = scrollContainer.getBoundingClientRect();
        const topThreshold = containerRect.top + 80;

        let currentActiveText: string | null = null;
        for (let i = 0; i < headingEls.length; i++) {
          const el = headingEls[i];
          const rect = el.getBoundingClientRect();
          if (rect.top <= topThreshold) {
            currentActiveText = el.textContent?.trim() || null;
          } else {
            break;
          }
        }

        if (currentActiveText) {
          const matched = headings.find((h) => h.text === currentActiveText);
          if (matched) {
            setActiveId(matched.id);
            return;
          }
        }
        if (headings.length > 0 && !currentActiveText) {
          setActiveId(headings[0].id);
        }
      });
    };

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, [open, headings]);

  // Escape key closes outline
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const handleJump = useCallback(
    (item: OutlineItem) => {
      setActiveId(item.id);
      if (editor && !editor.isDestroyed) {
        focusEditorHeading(editor, item.text);
      } else {
        // Preview mode: find heading in preview DOM
        const previewEl = document.querySelector(".v4-editor-body.v4-md-preview");
        if (previewEl) {
          const els = previewEl.querySelectorAll("h1, h2, h3, h4, h5, h6");
          for (let i = 0; i < els.length; i++) {
            const h = els[i] as HTMLElement;
            if (h.textContent?.trim() === item.text) {
              h.scrollIntoView({ behavior: "smooth", block: "start" });
              break;
            }
          }
        }
      }
    },
    [editor],
  );

  if (!open) return null;

  return (
    <aside
      className={cn(
        "v4-editor-outline flex h-full w-56 shrink-0 flex-col border-l border-border-subtle-dim bg-surface/95 backdrop-blur-sm transition-all sm:w-64",
        "max-md:fixed max-md:right-0 max-md:top-[calc(var(--density-chrome-y,40px)+var(--density-editor-toolbar-y,36px))] max-md:bottom-0 max-md:z-30 max-md:shadow-2xl",
        className,
      )}
      aria-label={t("workspace:outline.panelAria", { defaultValue: "文档大纲" })}
    >
      {/* Header */}
      <div className="flex h-(--density-editor-toolbar-y,36px) shrink-0 items-center justify-between border-b border-border-subtle-dim px-2.5">
        <div className="flex items-center gap-1.5 text-text-secondary">
          <RiNodeTree size={ICON.xs} className="text-accent-color" aria-hidden />
          <span className="text-3xs font-semibold uppercase tracking-wider text-text-tertiary">
            {t("workspace:outline.title", { defaultValue: "文档大纲" })}
          </span>
          {headings.length > 0 ? (
            <span className="rounded-full bg-surface-muted px-1.5 py-0.2 text-4xs font-mono text-text-quaternary">
              {headings.length}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-[var(--radius-sm)] p-1 text-text-quaternary hover:bg-surface-muted hover:text-text-primary v4-focus-ring"
          title={t("common:action.close")}
          aria-label={t("common:action.close")}
        >
          <RiCloseLine size={ICON.xs} />
        </button>
      </div>

      {/* Heading Tree */}
      <div className="v4-sidebar-scroll min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {headings.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 text-center text-3xs text-text-quaternary">
            <RiListCheck3 size={ICON.md} className="mb-1.5 opacity-40" />
            <p>{t("workspace:outline.empty", { defaultValue: "当前文档暂无标题" })}</p>
            <span className="mt-1 text-4xs text-text-quaternary/70">
              {t("workspace:outline.emptyHint", { defaultValue: "输入 # 一级标题 即可生成大纲" })}
            </span>
          </div>
        ) : (
          <nav className="space-y-0.5" role="navigation">
            {headings.map((h) => {
              const indentLevel = Math.max(0, Math.min(5, h.level - 1));
              const isActive = activeId === h.id;
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => handleJump(h)}
                  style={{ paddingLeft: `${indentLevel * 12 + 8}px` }}
                  className={cn(
                    "group flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] py-1 pr-2 text-left text-3xs transition-colors",
                    "v4-focus-ring",
                    isActive
                      ? "bg-accent-bg-subtle text-accent-color font-medium shadow-[inset_2px_0_0_0_var(--color-accent-color)]"
                      : "text-text-tertiary hover:bg-surface-hover hover:text-text-primary",
                  )}
                  title={h.text}
                >
                  <span
                    className={cn(
                      "font-mono text-5xs text-text-quaternary group-hover:text-text-tertiary shrink-0",
                      isActive && "text-accent-color",
                    )}
                  >
                    H{h.level}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{h.text}</span>
                </button>
              );
            })}
          </nav>
        )}
      </div>
    </aside>
  );
}
