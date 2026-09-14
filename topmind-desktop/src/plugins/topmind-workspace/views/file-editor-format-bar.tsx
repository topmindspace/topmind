/**
 * Editor format controls + exclusive ⋯ menu.
 * Format tools default expanded; collapse with chevron when space is tight.
 */
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiAttachmentLine,
  RiBold,
  RiBrainLine,
  RiCalendarEventLine,
  RiCodeBoxLine,
  RiCodeLine,
  RiDoubleQuotesL,
  RiEditLine,
  RiEyeLine,
  RiFocus3Line,
  RiFormatClear,
  RiFullscreenExitLine,
  RiH1,
  RiH2,
  RiH3,
  RiH4,
  RiHashtag,
  RiImageAddLine,
  RiItalic,
  RiLink,
  RiListCheck2,
  RiListOrdered,
  RiListUnordered,
  RiLoader4Line,
  RiMoreLine,
  RiNodeTree,
  RiSparklingLine,
  RiStrikethrough,
  RiTwitterXLine,
  RiUnderline as UnderlineIcon,
  RiUpload2Line,
} from "@remixicon/react";
import {
  DropdownItem,
  DropdownMenu,
  DropdownSectionLabel,
} from "../../../components/ui/DropdownMenu";
import { Tooltip } from "../../../components/ui/tooltip";
import { ICON } from "../../../lib/icons";
import { cn } from "../../../lib/cn";
import { ToolbarButton, ToolbarSep, SaveBadge, type SaveState } from "./file-editor-chrome";
import { EditorReadingMenu } from "../../../components/editor/EditorReadingMenu";

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
        className="v4-segmented-item !flex-none gap-0.5 !px-1.5 !py-0"
      >
        <RiEditLine size={ICON.xs} />
        <span className="hidden text-3xs sm:inline" data-compact-hidden>{t("workspace:formatBar.edit")}</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={viewMode === "preview"}
        data-active={viewMode === "preview"}
        onClick={() => onChange("preview")}
        className="v4-segmented-item !flex-none gap-0.5 !px-1.5 !py-0"
      >
        <RiEyeLine size={ICON.xs} />
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
  onInsertImage,
}: {
  editor: Editor | null;
  showFormat: boolean;
  onToggleFormat: () => void;
  onInsertDateTime?: () => void;
  onInsertLink?: () => void;
  onInsertImage?: () => void;
}) {
  const { t } = useTranslation(["workspace", "common"]);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
      <ToolbarButton
        onClick={onToggleFormat}
        active={showFormat}
        tip={showFormat ? t("workspace:formatBar.collapseFormat") : t("workspace:formatBar.expandFormat")}
      >
        {showFormat ? <RiArrowLeftSLine size={ICON.xs} /> : <RiArrowRightSLine size={ICON.xs} />}
      </ToolbarButton>
      {showFormat ? (
        <div
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="toolbar"
          aria-label={t("workspace:formatBar.toolbarAria")}
        >
          <ToolbarButton onClick={() => editor?.chain().focus().toggleBold().run()} active={editor?.isActive("bold") ?? false} tip={`${t("workspace:editor.formatBold")} ⌘B`}>
            <RiBold size={ICON.xs} />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleItalic().run()} active={editor?.isActive("italic") ?? false} tip={`${t("workspace:editor.formatItalic")} ⌘I`}>
            <RiItalic size={ICON.xs} />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleUnderline().run()} active={editor?.isActive("underline") ?? false} tip={t("workspace:editor.formatUnderline")}>
            <UnderlineIcon size={ICON.xs} />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleStrike().run()} active={editor?.isActive("strike") ?? false} tip={t("workspace:editor.formatStrike")}>
            <RiStrikethrough size={ICON.xs} />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleCode().run()} active={editor?.isActive("code") ?? false} tip={t("workspace:editor.formatCode")}>
            <RiCodeLine size={ICON.xs} />
          </ToolbarButton>
          <ToolbarSep />
          <ToolbarButton onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} active={editor?.isActive("heading", { level: 1 }) ?? false} tip={t("workspace:formatBarOptions.h1")}>
            <RiH1 size={ICON.xs} />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} active={editor?.isActive("heading", { level: 2 }) ?? false} tip={t("workspace:formatBarOptions.h2")}>
            <RiH2 size={ICON.xs} />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} active={editor?.isActive("heading", { level: 3 }) ?? false} tip={t("workspace:formatBarOptions.h3")}>
            <RiH3 size={ICON.xs} />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleHeading({ level: 4 }).run()} active={editor?.isActive("heading", { level: 4 }) ?? false} tip={t("workspace:formatBarOptions.h4")}>
            <RiH4 size={ICON.xs} />
          </ToolbarButton>
          <ToolbarSep />
          <ToolbarButton onClick={() => editor?.chain().focus().toggleBulletList().run()} active={editor?.isActive("bulletList") ?? false} tip={t("workspace:editor.formatBulletList")}>
            <RiListUnordered size={ICON.xs} />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={editor?.isActive("orderedList") ?? false} tip={t("workspace:editor.formatOrderedList")}>
            <RiListOrdered size={ICON.xs} />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleTaskList().run()} active={editor?.isActive("taskList") ?? false} tip={t("workspace:formatBarOptions.taskList")}>
            <RiListCheck2 size={ICON.xs} />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleCodeBlock().run()} active={editor?.isActive("codeBlock") ?? false} tip={t("workspace:formatBarOptions.codeBlock")}>
            <RiCodeBoxLine size={ICON.xs} />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleBlockquote().run()} active={editor?.isActive("blockquote") ?? false} tip={t("workspace:formatBarOptions.quote")}>
            <RiDoubleQuotesL size={ICON.xs} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => onInsertLink?.()}
            active={editor?.isActive("link") ?? false}
            tip={t("workspace:formatBarOptions.link")}
          >
            <RiLink size={ICON.xs} />
          </ToolbarButton>
          {onInsertDateTime ? (
            <ToolbarButton
              onClick={onInsertDateTime}
              active={false}
              tip={`${t("workspace:formatBar.insertDateTime")} ⌘.`}
            >
              <RiCalendarEventLine size={ICON.xs} />
            </ToolbarButton>
          ) : null}
          {onInsertImage ? (
            <ToolbarButton onClick={onInsertImage} active={false} tip={t("editor:editor.insertImage")}>
              <RiImageAddLine size={ICON.xs} />
            </ToolbarButton>
          ) : null}
          <ToolbarButton
            onClick={() => editor?.chain().focus().clearNodes().unsetAllMarks().run()}
            active={false}
            tip={t("editor:editor.clearFormatting")}
          >
            <RiFormatClear size={ICON.xs} />
          </ToolbarButton>
        </div>
      ) : (
        <span className="truncate text-3xs text-text-quaternary">{t("workspace:formatBar.collapsed")}</span>
      )}
    </div>
  );
}

/** Outline / appearance / focus — lives on the properties row, not the format mop. */
export function EditorViewChrome({
  showOutline,
  onToggleOutline,
  editor,
  onOpenSettings,
  focusMode,
  onToggleFocus,
  showFocus = true,
}: {
  showOutline: boolean;
  onToggleOutline: () => void;
  editor?: Editor | null;
  onOpenSettings?: () => void;
  focusMode: boolean;
  onToggleFocus: () => void;
  showFocus?: boolean;
}) {
  const { t } = useTranslation(["workspace", "common"]);
  return (
    <div className="flex items-center gap-0.5" data-editor-view-chrome>
      <Tooltip content={showOutline ? t("workspace:outline.hideTip") : t("workspace:outline.showTip")}>
        <button
          type="button"
          onClick={onToggleOutline}
          className={cn("v4-editor-tool-btn", showOutline && "text-accent-color")}
          aria-label={t("workspace:outline.title")}
          aria-pressed={showOutline}
        >
          <RiNodeTree size={ICON.xs} />
        </button>
      </Tooltip>
      <EditorReadingMenu editor={editor} onOpenSettings={onOpenSettings} />
      {showFocus ? (
        <Tooltip content={focusMode ? t("workspace:formatBarOptions.focusModeOff") : t("workspace:formatBarOptions.focusModeOn")}>
          <button
            type="button"
            onClick={onToggleFocus}
            className={cn(
              "v4-editor-tool-btn",
              focusMode && "bg-accent-color text-text-on-accent hover:opacity-90",
            )}
            aria-label={focusMode ? t("workspace:formatBarOptions.focusModeOff") : t("workspace:formatBarOptions.focusModeOn")}
            aria-pressed={focusMode}
          >
            {focusMode ? <RiFullscreenExitLine size={ICON.xs} /> : <RiFocus3Line size={ICON.xs} />}
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

/** File-context shortcuts injected into TitleBar on file/detail pages. */
export function FileEditorTitleBarActions({
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
  onRequestAiBar,
  moveControl,
}: {
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
  onRequestAiBar: () => void;
  moveControl?: ReactNode;
}) {
  const { t } = useTranslation(["workspace", "common"]);
  return (
    <div className="flex items-center gap-0.5" data-file-titlebar-actions>
      {moveControl}
      {canPublish ? (
        <Tooltip content={t("workspace:formatBarOptions.publishToOutputsTip")}>
          <button type="button" className="v4-titlebar-btn" onClick={onPublish} aria-label={t("workspace:formatBarOptions.publishToOutputsTip")}>
            {busyAction === "publish" ? (
              <RiLoader4Line size={ICON.sm} className="animate-spin" />
            ) : (
              <RiUpload2Line size={ICON.sm} />
            )}
          </button>
        </Tooltip>
      ) : null}
      {!readOnly ? (
        <Tooltip content={t("workspace:formatBarOptions.aiEditTip")}>
          <button type="button" className="v4-titlebar-btn" onClick={onRequestAiBar} aria-label={t("workspace:formatBarOptions.aiEditTip")}>
            <RiSparklingLine size={ICON.sm} className="text-accent-color" />
          </button>
        </Tooltip>
      ) : null}
      {resolvedTopicId ? (
        <Tooltip content={t("workspace:formatBarOptions.appendToMemory")}>
          <button type="button" className="v4-titlebar-btn" onClick={onMemory} aria-label={t("workspace:formatBarOptions.appendToMemory")}>
            <RiBrainLine size={ICON.sm} />
          </button>
        </Tooltip>
      ) : null}
      <Tooltip content={mounted ? t("workspace:previewView.unmountTooltip") : t("workspace:previewView.mountTooltip")}>
        <button
          type="button"
          className={cn("v4-titlebar-btn", mounted && "text-accent-color")}
          onClick={onToggleMount}
          aria-pressed={mounted}
          aria-label={mounted ? t("workspace:previewView.unmountTooltip") : t("workspace:previewView.mountTooltip")}
        >
          <RiAttachmentLine size={ICON.sm} />
        </button>
      </Tooltip>
      {!readOnly && xPublishEnabled ? (
        <Tooltip content={t("workspace:formatBarOptions.postToX")}>
          <button type="button" className="v4-titlebar-btn" onClick={onPostToX} aria-label={t("workspace:formatBarOptions.postToX")}>
            <RiTwitterXLine size={ICON.sm} />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

/** Format-rail status cluster — words / save / file-info. Outline · appearance · focus live on the properties row. */
export function EditorMoreMenu({
  moreOpen,
  setMoreOpen,
  showMeta,
  setShowMeta,
  readOnly,
  saveState,
  wordCount,
}: {
  moreOpen: boolean;
  setMoreOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  showMeta: boolean;
  setShowMeta: (v: boolean | ((prev: boolean) => boolean)) => void;
  readOnly: boolean;
  saveState: SaveState;
  wordCount: number;
}) {
  const { t } = useTranslation(["workspace", "common"]);

  return (
    <div className="flex min-w-0 items-center justify-end gap-1">
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
        minWidth={180}
        matchTriggerWidth={false}
        trigger={
          <button
            type="button"
            data-menu-trigger
            onClick={() => setMoreOpen((v) => !v)}
            className="v4-editor-tool-btn"
            aria-label={t("workspace:formatBarOptions.moreActions")}
            aria-expanded={moreOpen}
            aria-haspopup="menu"
          >
            <RiMoreLine size={ICON.xs} />
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
          <RiHashtag size={ICON.xs} className="shrink-0 text-text-quaternary" />
          {showMeta ? t("workspace:formatBarOptions.hideFileInfo") : t("workspace:formatBarOptions.fileInfo")}
        </DropdownItem>
      </DropdownMenu>
    </div>
  );
}
