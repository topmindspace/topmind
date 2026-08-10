/**
 * Editor format controls + overflow “more” menu (Design System 2.0).
 * Format tools default expanded; collapse with chevron when space is tight.
 */
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Code, Braces,
  Heading1, Heading2, List, ListOrdered, Quote, Link2,
  Paperclip, Eye, Edit3, MoreHorizontal,
  Hash, Minimize2, ChevronLeft, ChevronRight,
  Upload, Brain, Sparkles, Twitter, Loader2,
  CalendarClock, Focus,
} from "lucide-react";
import {
  DropdownItem,
  DropdownMenu,
  DropdownSectionLabel,
} from "../../../components/ui/DropdownMenu";
import { Tooltip } from "../../../components/ui/tooltip";
import { ICON } from "../../../lib/icons";
import { cn } from "../../../lib/cn";
import { ChromeOverflowActions, type ChromeAction } from "../../../lib/chrome-overflow";
import { ToolbarButton, ToolbarSep, SaveBadge, type SaveState } from "./file-editor-chrome";
import { useMemo } from "react";

export function EditorModeSwitch({
  viewMode,
  onChange,
}: {
  viewMode: "edit" | "preview";
  onChange: (m: "edit" | "preview") => void;
}) {
  const { t } = useTranslation(["workspace", "common"]);
  return (
    <div className="v4-segmented shrink-0 !gap-0.5 !p-0.5" role="tablist" aria-label={t("workspace:formatBar.edit")}>
      <button
        type="button"
        role="tab"
        aria-selected={viewMode === "edit"}
        data-active={viewMode === "edit"}
        onClick={() => onChange("edit")}
        className="v4-segmented-item !flex-none gap-1 !px-2 !py-0.5"
      >
        <Edit3 size={ICON.xs} />
        <span className="hidden text-3xs sm:inline" data-compact-hidden>{t("workspace:formatBar.edit")}</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={viewMode === "preview"}
        data-active={viewMode === "preview"}
        onClick={() => onChange("preview")}
        className="v4-segmented-item !flex-none gap-1 !px-2 !py-0.5"
      >
        <Eye size={ICON.xs} />
        <span className="hidden text-3xs sm:inline" data-compact-hidden>{t("workspace:formatBar.preview")}</span>
      </button>
    </div>
  );
}

export function EditorFormatBar({
  editor,
  showFormat,
  onToggleFormat,
  onInsertDateTime,
  onInsertLink,
}: {
  editor: Editor | null;
  showFormat: boolean;
  onToggleFormat: () => void;
  onInsertDateTime?: () => void;
  onInsertLink?: () => void;
}) {
  const { t } = useTranslation(["workspace", "common"]);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
      <ToolbarButton
        onClick={onToggleFormat}
        active={showFormat}
        tip={showFormat ? t("workspace:formatBar.collapseFormat") : t("workspace:formatBar.expandFormat")}
      >
        {showFormat ? <ChevronLeft size={ICON.xs} /> : <ChevronRight size={ICON.xs} />}
      </ToolbarButton>
      {onInsertDateTime ? (
        <ToolbarButton
          onClick={onInsertDateTime}
          active={false}
          tip={`${t("workspace:formatBar.insertDateTime")} ⌘.`}
        >
          <CalendarClock size={ICON.xs} />
        </ToolbarButton>
      ) : null}
      {showFormat ? (
        <div
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="toolbar"
          aria-label={t("workspace:formatBar.toolbarAria")}
        >
          <ToolbarButton onClick={() => editor?.chain().focus().toggleBold().run()} active={editor?.isActive("bold") ?? false} tip={`${t("workspace:editor.formatBold")} ⌘B`}>
            <Bold size={ICON.xs} />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleItalic().run()} active={editor?.isActive("italic") ?? false} tip={`${t("workspace:editor.formatItalic")} ⌘I`}>
            <Italic size={ICON.xs} />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleUnderline().run()} active={editor?.isActive("underline") ?? false} tip={t("workspace:editor.formatUnderline")}>
            <UnderlineIcon size={ICON.xs} />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleStrike().run()} active={editor?.isActive("strike") ?? false} tip={t("workspace:editor.formatStrike")}>
            <Strikethrough size={ICON.xs} />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleCode().run()} active={editor?.isActive("code") ?? false} tip={t("workspace:editor.formatCode")}>
            <Code size={ICON.xs} />
          </ToolbarButton>
          <ToolbarSep />
          <ToolbarButton onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} active={editor?.isActive("heading", { level: 1 }) ?? false} tip={t("workspace:formatBarOptions.h1")}>
            <Heading1 size={ICON.xs} />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} active={editor?.isActive("heading", { level: 2 }) ?? false} tip={t("workspace:formatBarOptions.h2")}>
            <Heading2 size={ICON.xs} />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} active={editor?.isActive("heading", { level: 3 }) ?? false} tip={t("workspace:formatBarOptions.h3")}>
            H3
          </ToolbarButton>
          <ToolbarSep />
          <ToolbarButton onClick={() => editor?.chain().focus().toggleBulletList().run()} active={editor?.isActive("bulletList") ?? false} tip={t("workspace:editor.formatBulletList")}>
            <List size={ICON.xs} />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={editor?.isActive("orderedList") ?? false} tip={t("workspace:editor.formatOrderedList")}>
            <ListOrdered size={ICON.xs} />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleCodeBlock().run()} active={editor?.isActive("codeBlock") ?? false} tip={t("workspace:formatBarOptions.codeBlock")}>
            <Braces size={ICON.xs} />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleBlockquote().run()} active={editor?.isActive("blockquote") ?? false} tip={t("workspace:formatBarOptions.quote")}>
            <Quote size={ICON.xs} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => onInsertLink?.()}
            active={editor?.isActive("link") ?? false}
            tip={t("workspace:formatBarOptions.link")}
          >
            <Link2 size={ICON.xs} />
          </ToolbarButton>
        </div>
      ) : (
        <span className="truncate text-3xs text-text-quaternary">{t("workspace:formatBar.collapsed")}</span>
      )}
    </div>
  );
}

export function EditorMoreMenu({
  moreOpen,
  setMoreOpen,
  showMeta,
  setShowMeta,
  canPublish,
  busyAction,
  onPublish,
  resolvedTopicId,
  onMemory,
  readOnly,
  xPublishEnabled,
  onPostToX,
  mounted,
  onToggleMount,
  onOpenAi,
  focusMode,
  onToggleFocus,
  saveState,
  wordCount,
  onRequestAiBar,
}: {
  moreOpen: boolean;
  setMoreOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  showMeta: boolean;
  setShowMeta: (v: boolean | ((prev: boolean) => boolean)) => void;
  canPublish: boolean;
  busyAction: string | null;
  onPublish: () => void;
  resolvedTopicId: string | null | undefined;
  onMemory: () => void;
  readOnly: boolean;
  xPublishEnabled: boolean;
  onPostToX: () => void;
  mounted: boolean;
  onToggleMount: () => void;
  onOpenAi: () => void;
  focusMode: boolean;
  onToggleFocus: () => void;
  saveState: SaveState;
  wordCount: number;
  onRequestAiBar: () => void;
}) {
  const { t } = useTranslation(["workspace", "common"]);

  const overflowActions = useMemo((): ChromeAction[] => {
    const acts: ChromeAction[] = [];
    if (canPublish) {
      acts.push({
        id: "publish",
        label: t("workspace:menu.publish", { defaultValue: "Publish" }),
        title: t("workspace:formatBarOptions.publishToOutputsTip"),
        icon:
          busyAction === "publish" ? (
            <Loader2 size={ICON.xs} className="animate-spin" />
          ) : (
            <Upload size={ICON.xs} />
          ),
        priority: 10,
        disabled: busyAction === "publish",
        iconOnlyWhenCompact: true,
        onClick: onPublish,
      });
    }
    if (!readOnly) {
      acts.push({
        id: "ai-edit",
        label: t("workspace:formatBarOptions.aiEditTip"),
        title: t("workspace:formatBarOptions.aiEditTip"),
        icon: <Sparkles size={ICON.xs} className="text-accent-color" />,
        priority: 20,
        iconOnlyWhenCompact: true,
        onClick: onRequestAiBar,
      });
    }
    // Focus mode is now a direct prominent button — not in overflow
    return acts;
  }, [
    t,
    canPublish,
    busyAction,
    onPublish,
    readOnly,
    onRequestAiBar,
  ]);

  return (
    <div className="flex min-w-0 max-w-[min(100%,18rem)] items-center gap-1 sm:max-w-[22rem]">
      <div className="min-w-0 flex-1">
        <ChromeOverflowActions actions={overflowActions} />
      </div>

      {/* Focus mode — prominent direct button (not in overflow) */}
      <Tooltip content={focusMode ? t("workspace:formatBarOptions.focusModeOff") : t("workspace:formatBarOptions.focusModeOn")}>
        <button
          type="button"
          onClick={onToggleFocus}
          className={cn(
            "flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 text-3xs font-medium transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
            focusMode
              ? "bg-accent-color text-primary-foreground shadow-[var(--shadow-button)] hover:opacity-90"
              : "text-text-tertiary hover:bg-accent-bg-subtle hover:text-accent-color",
          )}
          aria-label={focusMode ? t("workspace:formatBarOptions.focusModeOff") : t("workspace:formatBarOptions.focusModeOn")}
          aria-pressed={focusMode}
        >
          {focusMode ? <Minimize2 size={ICON.xs} /> : <Focus size={ICON.xs} />}
        </button>
      </Tooltip>

      <span
        className="hidden shrink-0 truncate font-mono text-3xs text-text-quaternary sm:inline"
        data-compact-hidden
        title={t("workspace:formatBarOptions.wordCountTitle")}
      >
        {wordCount}w
      </span>

      {!readOnly ? <SaveBadge state={saveState} /> : null}
      <DropdownMenu
        open={moreOpen}
        onOpenChange={setMoreOpen}
        align="end"
        minWidth={200}
        matchTriggerWidth={false}
        trigger={
          <button
            type="button"
            data-menu-trigger
            onClick={() => setMoreOpen((v) => !v)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-text-tertiary transition-colors hover:bg-surface-muted hover:text-text-primary"
            aria-label={t("workspace:formatBarOptions.moreActions")}
            aria-expanded={moreOpen}
            aria-haspopup="menu"
          >
            <MoreHorizontal size={ICON.xs} />
          </button>
        }
      >
        <DropdownSectionLabel>{t("workspace:menu.title")}</DropdownSectionLabel>
        <DropdownItem
          onSelect={() => {
            setShowMeta((v) => !v);
            setMoreOpen(false);
          }}
        >
          <Hash size={ICON.xs} className="shrink-0 text-text-quaternary" />
          {showMeta ? t("workspace:formatBarOptions.hideFileInfo") : t("workspace:formatBarOptions.fileInfo")}
        </DropdownItem>
        {resolvedTopicId ? (
          <DropdownItem
            onSelect={() => {
              setMoreOpen(false);
              onMemory();
            }}
          >
            <Brain size={ICON.xs} className="shrink-0 text-text-quaternary" />
            {t("workspace:formatBarOptions.appendToMemory")}
          </DropdownItem>
        ) : null}
        {!readOnly && xPublishEnabled ? (
          <DropdownItem
            onSelect={() => {
              setMoreOpen(false);
              onPostToX();
            }}
          >
            <Twitter size={ICON.xs} className="shrink-0 text-text-quaternary" />
            {t("workspace:formatBarOptions.postToX")}
          </DropdownItem>
        ) : null}
        <DropdownSectionLabel>{t("workspace:formatBarOptions.aiContext")}</DropdownSectionLabel>
        <DropdownItem
          onSelect={() => {
            setMoreOpen(false);
            onOpenAi();
          }}
        >
          <Sparkles size={ICON.xs} className="shrink-0 text-accent-color" />
          {t("workspace:formatBarOptions.openAiPanel")}
        </DropdownItem>
        <DropdownItem
          onSelect={() => {
            setMoreOpen(false);
            onToggleMount();
          }}
        >
          <Paperclip size={ICON.xs} className="shrink-0 text-text-quaternary" />
          {mounted ? t("workspace:previewView.unmountTooltip") : t("workspace:previewView.mountTooltip")}
        </DropdownItem>
      </DropdownMenu>
    </div>
  );
}
