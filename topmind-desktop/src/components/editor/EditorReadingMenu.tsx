/**
 * Quick reading controls for Markdown editor / preview (Notion / Obsidian style).
 * Changes apply to both edit & preview surfaces; persisted via settings.editor.
 */
import { useState } from "react";
import {
  RiAddLine,
  RiArrowGoBackLine,
  RiNodeTree,
  RiSettingsLine,
  RiSubtractLine,
  RiText,
} from "@remixicon/react";
import type { Editor } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownSectionLabel,
} from "../ui/DropdownMenu";
import { Tooltip } from "../ui/tooltip";
import { ICON } from "../../lib/icons";
import { cn } from "../../lib/cn";
import { useViewStore } from "../../stores/view-store";
import { focusEditorHeading } from "../../lib/editor-focus-heading";
import {
  applyEditorPrefs,
  DEFAULT_EDITOR_PREFS,
  FONT_SIZE_PRESETS,
  LINE_HEIGHT_PRESETS,
  getPagePaddingOptions,
  getPaperOptions,
  type EditorFontFamily,
  type EditorPagePadding,
  type EditorPaper,
} from "../../lib/editor-prefs";
import { EDITOR_CONTENT_WIDTHS, type EditorContentWidth } from "../../lib/editor-markdown";

function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "rounded-[var(--radius-sm)] px-2 py-1 text-3xs font-medium transition-colors",
        "v4-focus-ring",
        active
          ? "bg-accent-bg-subtle text-accent-color shadow-[inset_0_0_0_1px_var(--color-accent-border-subtle)]"
          : "bg-surface-muted/60 text-text-tertiary hover:bg-surface-muted hover:text-text-secondary",
      )}
    >
      {children}
    </button>
  );
}

export function EditorReadingMenu({
  editor,
  onOpenSettings,
}: {
  /** Live TipTap instance (edit mode) — enables the heading outline. */
  editor?: Editor | null;
  /** Jump to global Settings → 编辑器 */
  onOpenSettings?: () => void;
}) {
  const { t } = useTranslation("editor");
  const [open, setOpen] = useState(false);
  const prefs = useViewStore((s) => s.editorSettings);
  const [outline, setOutline] = useState<Array<{ level: number; text: string }>>([]);

  const collectOutline = () => {
    if (!editor || editor.isDestroyed) {
      setOutline([]);
      return;
    }
    const items: Array<{ level: number; text: string }> = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "heading") {
        const text = node.textContent.trim();
        if (text) items.push({ level: Number(node.attrs.level) || 1, text });
      }
      return true;
    });
    setOutline(items);
  };

  const set = (patch: Parameters<typeof applyEditorPrefs>[0]) => {
    void applyEditorPrefs(patch);
  };

  const bumpSize = (delta: number) => {
    set({ fontSize: (prefs.fontSize || 16) + delta });
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(v) => {
        if (v) collectOutline();
        setOpen(v);
      }}
      align="end"
      minWidth={288}
      maxHeight={480}
      matchTriggerWidth={false}
      trigger={
        <Tooltip content={t("readingMenu.tooltip")}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)]",
              "text-text-tertiary transition-colors hover:bg-surface-muted hover:text-text-primary",
              open && "bg-accent-bg-subtle text-accent-color",
            )}
            aria-label={t("readingMenu.ariaLabel")}
            aria-expanded={open}
          >
            <RiText size={ICON.xs} />
          </button>
        </Tooltip>
      }
    >
      <div className="px-1 pb-1 pt-0.5" onClick={(e) => e.stopPropagation()}>
        {editor ? (
          <>
            <DropdownSectionLabel>{t("readingMenu.outline")}</DropdownSectionLabel>
            <div className="mb-2 max-h-40 overflow-y-auto px-1">
              {outline.length === 0 ? (
                <p className="px-1 py-0.5 text-3xs text-text-quaternary">
                  {t("readingMenu.outlineEmpty")}
                </p>
              ) : (
                outline.map((h, i) => (
                  <button
                    key={`${i}:${h.text}`}
                    type="button"
                    className={cn(
                      "block w-full truncate rounded-[var(--radius-sm)] px-1.5 py-1 text-left text-3xs text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary v4-focus-ring",
                      h.level === 1 && "font-medium",
                      h.level === 2 && "pl-3",
                      h.level >= 3 && "pl-5 text-text-tertiary",
                    )}
                    onClick={() => {
                      focusEditorHeading(editor, h.text);
                      setOpen(false);
                    }}
                    title={h.text}
                  >
                    {h.text}
                  </button>
                ))
              )}
            </div>
          </>
        ) : null}

        <DropdownSectionLabel>{t("readingMenu.fontSize")}</DropdownSectionLabel>
        <div className="mb-2 flex items-center gap-1.5 px-1">
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-text-tertiary hover:bg-surface-muted"
            onClick={() => bumpSize(-1)}
            aria-label={t("readingMenu.decrease")}
          >
            <RiSubtractLine size={ICON.xs} />
          </button>
          <div className="min-w-[3rem] text-center text-xs font-medium tabular-nums text-text-primary">
            {prefs.fontSize}px
          </div>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-text-tertiary hover:bg-surface-muted"
            onClick={() => bumpSize(1)}
            aria-label={t("readingMenu.increase")}
          >
            <RiAddLine size={ICON.xs} />
          </button>
          <div className="ml-1 flex flex-wrap gap-0.5">
            {FONT_SIZE_PRESETS.map((n) => (
              <Chip key={n} active={prefs.fontSize === n} onClick={() => set({ fontSize: n })}>
                {n}
              </Chip>
            ))}
          </div>
        </div>

        <DropdownSectionLabel>{t("readingMenu.lineHeight")}</DropdownSectionLabel>
        <div className="mb-2 flex flex-wrap gap-1 px-1">
          {LINE_HEIGHT_PRESETS.map((n) => (
            <Chip
              key={n}
              active={Math.abs((prefs.lineHeight || 1.7) - n) < 0.05}
              onClick={() => set({ lineHeight: n })}
            >
              {n.toFixed(1)}
            </Chip>
          ))}
        </div>

        <DropdownSectionLabel>{t("readingMenu.fontFamily")}</DropdownSectionLabel>
        <div className="mb-2 flex flex-wrap gap-1 px-1">
          {(
            [
              ["sans", t("readingMenu.fontSans")],
              ["serif", t("readingMenu.fontSerif")],
              ["mono", t("readingMenu.fontMono")],
            ] as const
          ).map(([id, label]) => (
            <Chip
              key={id}
              active={(prefs.fontFamily || "sans") === id}
              onClick={() => set({ fontFamily: id as EditorFontFamily })}
            >
              {label}
            </Chip>
          ))}
        </div>

        <DropdownSectionLabel>{t("readingMenu.contentWidth")}</DropdownSectionLabel>
        <div className="mb-2 flex flex-wrap gap-1 px-1">
          {EDITOR_CONTENT_WIDTHS.map((w) => (
            <Chip
              key={w.value}
              active={(prefs.contentWidth || "reading") === w.value}
              title={t(`readingMenu.width${w.value.replace(/^./u, (c) => c.toUpperCase())}Hint`)}
              onClick={() => set({ contentWidth: w.value as EditorContentWidth })}
            >
              {t(`readingMenu.width${w.value.replace(/^./u, (c) => c.toUpperCase())}`)}
            </Chip>
          ))}
        </div>

        <DropdownSectionLabel>{t("readingMenu.pagePadding")}</DropdownSectionLabel>
        <div className="mb-2 flex flex-wrap gap-1 px-1">
          {getPagePaddingOptions().map((o) => (
            <Chip
              key={o.value}
              active={(prefs.pagePadding || "comfortable") === o.value}
              title={t(`readingMenu.padding${o.value.replace(/^./u, (c) => c.toUpperCase())}Hint`)}
              onClick={() => set({ pagePadding: o.value as EditorPagePadding })}
            >
              {t(`readingMenu.padding${o.value.replace(/^./u, (c) => c.toUpperCase())}`)}
            </Chip>
          ))}
        </div>

        <DropdownSectionLabel>{t("readingMenu.paper")}</DropdownSectionLabel>
        <div className="mb-2 flex flex-wrap gap-1 px-1">
          {getPaperOptions().map((o) => (
            <Chip
              key={o.value}
              active={(prefs.paper || "default") === o.value}
              title={t(`readingMenu.paper${o.value.replace(/^./u, (c) => c.toUpperCase())}Hint`)}
              onClick={() => set({ paper: o.value as EditorPaper })}
            >
              {t(`readingMenu.paper${o.value.replace(/^./u, (c) => c.toUpperCase())}`)}
            </Chip>
          ))}
        </div>

        <div className="mt-1 flex items-center justify-between gap-2 border-t border-border-subtle-dim px-1 pt-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-1 text-3xs text-text-tertiary hover:bg-surface-muted hover:text-text-secondary"
            onClick={() => {
              void applyEditorPrefs({ ...DEFAULT_EDITOR_PREFS });
            }}
          >
            <RiArrowGoBackLine size={ICON.micro} /> {t("readingMenu.reset")}
          </button>
          {onOpenSettings ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-1 text-3xs font-medium text-accent-color hover:bg-accent-bg-faint"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
            >
              <RiSettingsLine size={ICON.micro} /> {t("readingMenu.allSettings")}
            </button>
          ) : null}
        </div>
      </div>
    </DropdownMenu>
  );
}
