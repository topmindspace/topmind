/**
 * Tree expand/collapse + sibling sort + file filter — Workspace header chrome for category view.
 * Sort menu uses portal DropdownMenu (never clipped by sidebar overflow).
 */
import { useState } from "react";
import { ChevronsDownUp, ChevronsUpDown, ArrowUpDown, Check, Filter } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "../ui/tooltip";
import {
  DropdownItem,
  DropdownMenu,
  DropdownSectionLabel,
} from "../ui/DropdownMenu";
import { useViewStore } from "../../stores/view-store";
import type { TreeNode } from "../../plugins/types";
import { collectExpandableIds } from "../../lib/tree-reveal";
import { getTreeSortOptions, type TreeSortMode } from "../../lib/tree-sort";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import type { FileFilterMode } from "../../types";

const FILE_FILTER_OPTIONS: { id: FileFilterMode; labelKey: string }[] = [
  { id: "default", labelKey: "fileFilterDefault" },
  { id: "markdown", labelKey: "fileFilterMarkdown" },
  { id: "all", labelKey: "fileFilterAll" },
];

export function TreeToolbar({
  tree,
  sortMode,
  onSortChange,
  fileFilter,
  onFileFilterChange,
}: {
  tree: TreeNode[];
  sortMode: TreeSortMode;
  onSortChange: (m: TreeSortMode) => void;
  fileFilter: FileFilterMode;
  onFileFilterChange: (f: FileFilterMode) => void;
}) {
  const expandNodes = useViewStore((s) => s.expandNodes);
  const setExpandedNodes = useViewStore((s) => s.setExpandedNodes);
  const expandedCount = useViewStore((s) => s.expandedNodeIds.size);
  const { t } = useTranslation("shell");
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  const sortOptions = getTreeSortOptions();
  const currentSortOpt = sortOptions.find((o) => o.id === sortMode);
  const sortLabel = currentSortOpt?.label || t("sidebar.treeToolbar.sort");

  const currentFilterOpt = FILE_FILTER_OPTIONS.find((o) => o.id === fileFilter);
  const filterLabel = currentFilterOpt
    ? t(`sidebar.treeToolbar.${currentFilterOpt.labelKey}`)
    : t("sidebar.treeToolbar.fileFilterDefault");
  const filterActive = fileFilter !== "default";

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Tooltip content={t("sidebar.treeToolbar.expandAll")}>
        <button
          type="button"
          onClick={() => {
            const ids = collectExpandableIds(tree);
            if (ids.length) expandNodes(ids);
          }}
          className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-text-quaternary transition-colors hover:bg-surface-muted hover:text-text-secondary"
          aria-label={t("sidebar.treeToolbar.expandAllAria")}
        >
          <ChevronsUpDown size={ICON.nano} />
        </button>
      </Tooltip>
      <Tooltip content={t("sidebar.treeToolbar.collapseAll")}>
        <button
          type="button"
          onClick={() => setExpandedNodes([])}
          disabled={expandedCount === 0}
          className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-text-quaternary transition-colors hover:bg-surface-muted hover:text-text-secondary disabled:opacity-40"
          aria-label={t("sidebar.treeToolbar.collapseAllAria")}
        >
          <ChevronsDownUp size={ICON.nano} />
        </button>
      </Tooltip>
      <DropdownMenu
        open={sortOpen}
        onOpenChange={setSortOpen}
        align="end"
        minWidth={148}
        maxHeight={240}
        matchTriggerWidth={false}
        trigger={
          <Tooltip content={t("sidebar.treeToolbar.sortTooltip", { label: sortLabel })}>
            <button
              type="button"
              onClick={() => setSortOpen((v) => !v)}
              className={cn(
                "inline-flex h-6 items-center gap-0.5 rounded-[var(--radius-sm)] px-1 text-text-quaternary transition-colors hover:bg-surface-muted hover:text-text-secondary",
                sortOpen && "bg-surface-muted text-text-secondary",
              )}
              aria-label={t("sidebar.treeToolbar.toggleSortAria")}
              aria-expanded={sortOpen}
              aria-haspopup="listbox"
            >
              <ArrowUpDown size={ICON.nano} />
            </button>
          </Tooltip>
        }
      >
        <DropdownSectionLabel>{t("sidebar.treeToolbar.sortSectionLabel")}</DropdownSectionLabel>
        {sortOptions.map((opt) => (
          <DropdownItem
            key={opt.id}
            active={sortMode === opt.id}
            onSelect={() => {
              onSortChange(opt.id);
              setSortOpen(false);
            }}
          >
            <span className="min-w-0 flex-1">{t(`sidebar.treeToolbar.sort${opt.id.replace(/-(.)/gu, (_, c) => c.toUpperCase()).replace(/^./u, (c) => c.toUpperCase())}`)}</span>
            {sortMode === opt.id ? (
              <Check size={ICON.micro} className="shrink-0 text-accent-color" />
            ) : null}
          </DropdownItem>
        ))}
      </DropdownMenu>
      <DropdownMenu
        open={filterOpen}
        onOpenChange={setFilterOpen}
        align="end"
        minWidth={168}
        maxHeight={240}
        matchTriggerWidth={false}
        trigger={
          <Tooltip content={t("sidebar.treeToolbar.fileFilterTooltip", { label: filterLabel })}>
            <button
              type="button"
              onClick={() => setFilterOpen((v) => !v)}
              className={cn(
                "inline-flex h-6 items-center gap-0.5 rounded-[var(--radius-sm)] px-1 text-text-quaternary transition-colors hover:bg-surface-muted hover:text-text-secondary",
                filterOpen && "bg-surface-muted text-text-secondary",
                filterActive && "text-accent-color",
              )}
              aria-label={t("sidebar.treeToolbar.toggleFileFilterAria")}
              aria-expanded={filterOpen}
              aria-haspopup="listbox"
            >
              <Filter size={ICON.nano} />
              {filterActive ? (
                <span className="h-1 w-1 rounded-full bg-accent-color" aria-hidden />
              ) : null}
            </button>
          </Tooltip>
        }
      >
        <DropdownSectionLabel>{t("sidebar.treeToolbar.fileFilterSectionLabel")}</DropdownSectionLabel>
        {FILE_FILTER_OPTIONS.map((opt) => (
          <DropdownItem
            key={opt.id}
            active={fileFilter === opt.id}
            onSelect={() => {
              onFileFilterChange(opt.id);
              setFilterOpen(false);
            }}
          >
            <span className="min-w-0 flex-1">{t(`sidebar.treeToolbar.${opt.labelKey}`)}</span>
            {fileFilter === opt.id ? (
              <Check size={ICON.micro} className="shrink-0 text-accent-color" />
            ) : null}
          </DropdownItem>
        ))}
      </DropdownMenu>
    </div>
  );
}
