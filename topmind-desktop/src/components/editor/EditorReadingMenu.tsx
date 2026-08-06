/**
 * Quick reading controls for Markdown editor / preview (Notion / Obsidian style).
 * Changes apply to both edit & preview surfaces; persisted via settings.editor.
 */
import { useState } from "react";
import { Type, Minus, Plus, RotateCcw, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownSectionLabel,
} from "../ui/DropdownMenu";
import { Tooltip } from "../ui/tooltip";
import { ICON } from "../../lib/icons";
import { cn } from "../../lib/cn";
import { useViewStore } from "../../stores/view-store";
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
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
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
  onOpenSettings,
}: {
  /** Jump to global Settings → 编辑器 */
  onOpenSettings?: () => void;
}) {
  const { t } = useTranslation("editor");
  const [open, setOpen] = useState(false);
  const prefs = useViewStore((s) => s.editorSettings);

  const set = (patch: Parameters<typeof applyEditorPrefs>[0]) => {
    void applyEditorPrefs(patch);
  };

  const bumpSize = (delta: number) => {
    set({ fontSize: (prefs.fontSize || 16) + delta });
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
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
            <Type size={ICON.xs} />
          </button>
        </Tooltip>
      }
    >
      <div className="px-1 pb-1 pt-0.5" onClick={(e) => e.stopPropagation()}>
        <DropdownSectionLabel>{t("readingMenu.fontSize")}</DropdownSectionLabel>
        <div className="mb-2 flex items-center gap-1.5 px-1">
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-text-tertiary hover:bg-surface-muted"
            onClick={() => bumpSize(-1)}
            aria-label={t("readingMenu.decrease")}
          >
            <Minus size={ICON.xs} />
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
            <Plus size={ICON.xs} />
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
            <RotateCcw size={ICON.micro} /> {t("readingMenu.reset")}
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
              <Settings size={ICON.micro} /> {t("readingMenu.allSettings")}
            </button>
          ) : null}
        </div>
      </div>
    </DropdownMenu>
  );
}
