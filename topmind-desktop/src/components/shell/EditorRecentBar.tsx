/**
 * File tab strip — recent + pinned (independent of history).
 * Click · pin · close · drag reorder · right-click tab actions · close all.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Columns2, FileText, Pin, X, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useViewStore } from "../../stores/view-store";
import { displayNoteTitle } from "../../lib/note-meta";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import { Tooltip } from "../ui/tooltip";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
} from "../ui/context-menu";
import {
  useFileContextMenu,
  WorkspaceFileContextMenu,
} from "../ui/workspace-file-menu";

function openFile(path: string) {
  const parts = path.split("/");
  const topicId = parts.length >= 3 ? `${parts[0]}/${parts[1]}` : undefined;
  useViewStore.getState().select({ kind: "file", path, topicId });
}

function fileMenuKind(path: string): "inbox" | "output" | "archive" | "note" {
  if (/^00[- ]/u.test(path) || /inbox/iu.test(path.split("/")[0] || "")) return "inbox";
  if (/^88[- ]/u.test(path) || /outputs?/iu.test(path.split("/")[0] || "")) return "output";
  if (/^99[- ]/u.test(path) || /archive/iu.test(path.split("/")[0] || "")) return "archive";
  return "note";
}

type TabMenuState = {
  x: number;
  y: number;
  path: string;
  label: string;
};

export function EditorRecentBar() {
  const { t } = useTranslation("shell");
  const fileTabs = useViewStore((s) => s.fileTabs);
  const selection = useViewStore((s) => s.selection);
  const pinFileTab = useViewStore((s) => s.pinFileTab);
  const closeFileTab = useViewStore((s) => s.closeFileTab);
  const closeAllFileTabs = useViewStore((s) => s.closeAllFileTabs);
  const closeOtherFileTabs = useViewStore((s) => s.closeOtherFileTabs);
  const reorderFileTabs = useViewStore((s) => s.reorderFileTabs);
  const splitSecondaryPath = useViewStore((s) => s.splitSecondaryPath);
  const openInSplit = useViewStore((s) => s.openInSplit);
  const clearSplit = useViewStore((s) => s.clearSplit);
  const fileMenu = useFileContextMenu();
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [tabMenu, setTabMenu] = useState<TabMenuState | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLDivElement | null>(null);
  const [edgeFade, setEdgeFade] = useState({ left: false, right: false });

  const activePath = selection.kind === "file" ? selection.path : null;
  const hasUnpinned = fileTabs.some((t) => !t.pinned);

  const updateEdgeFade = useCallback(() => {
    const el = stripRef.current;
    if (!el) {
      setEdgeFade({ left: false, right: false });
      return;
    }
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const max = scrollWidth - clientWidth;
    setEdgeFade({
      left: scrollLeft > 2,
      right: max > 2 && scrollLeft < max - 2,
    });
  }, []);

  // Hooks must run unconditionally — early return when tabs empty used to run
  // fewer hooks after "close all", crashing React and blanking the whole shell.
  useEffect(() => {
    if (fileTabs.length === 0 || !activePath) return;
    const el = activeTabRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      updateEdgeFade();
    });
  }, [activePath, fileTabs.length, updateEdgeFade]);

  useEffect(() => {
    const el = stripRef.current;
    if (!el || fileTabs.length === 0) return;
    updateEdgeFade();
    el.addEventListener("scroll", updateEdgeFade, { passive: true });
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => updateEdgeFade())
        : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", updateEdgeFade);
      ro?.disconnect();
    };
  }, [fileTabs.length, fileTabs.map((t) => t.path).join("|"), updateEdgeFade]);

  if (fileTabs.length === 0) return null;

  return (
    <div className="v4-editor-recents shrink-0">
      <div className="flex min-w-0 items-stretch">
        <div className="v4-tab-strip-wrap">
          <span
            className="v4-tab-strip-fade v4-tab-strip-fade-left"
            data-visible={edgeFade.left ? "true" : "false"}
            aria-hidden
          />
          <span
            className="v4-tab-strip-fade v4-tab-strip-fade-right"
            data-visible={edgeFade.right ? "true" : "false"}
            aria-hidden
          />
        <div
          ref={stripRef}
          className="v4-content-scroll flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto px-1.5 py-1"
          role="tablist"
          aria-label={t("editorRecentBar.openFiles")}
        >
          {fileTabs.map((tab, index) => {
            const name = tab.path.split("/").pop() || tab.path;
            // Full path so topic.md → parent topic name (not three "topic" tabs)
            const label = displayNoteTitle(tab.path);
            const active = activePath === tab.path;
            return (
              <div
                key={tab.path}
                ref={active ? (node) => { activeTabRef.current = node; } : undefined}
                role="tab"
                draggable
                aria-selected={active}
                data-active={active}
                onDragStart={(e) => {
                  dragFrom.current = index;
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", tab.path);
                  setDragOver(index);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dragOver !== index) setDragOver(index);
                }}
                onDragLeave={() => {
                  if (dragOver === index) setDragOver(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = dragFrom.current;
                  dragFrom.current = null;
                  setDragOver(null);
                  if (from == null || from === index) return;
                  reorderFileTabs(from, index);
                }}
                onDragEnd={() => {
                  dragFrom.current = null;
                  setDragOver(null);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setTabMenu({
                    x: e.clientX,
                    y: e.clientY,
                    path: tab.path,
                    label: name,
                  });
                }}
                className={cn(
                  "v4-recent-tab v4-drop-target group relative inline-flex shrink-0 cursor-grab items-center gap-0.5 rounded-t-[var(--radius-md)] py-1 pl-2 pr-1 text-3xs font-medium transition-colors active:cursor-grabbing",
                  active
                    ? "v4-recent-tab-active bg-surface text-text-primary shadow-sm"
                    : "text-text-tertiary hover:bg-surface-muted/70 hover:text-text-secondary",
                  tab.pinned && !active && "text-text-secondary",
                  splitSecondaryPath === tab.path && !active && "ring-1 ring-inset ring-accent-border-subtle",
                  dragOver === index && "v4-drop-target-active",
                )}
              >
                {/* Active indicator bar */}
                {active ? (
                  <span
                    aria-hidden
                    className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-accent-color"
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => openFile(tab.path)}
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      closeFileTab(tab.path);
                    }
                  }}
                  className="flex min-w-0 flex-1 items-center gap-1 py-0.5 text-left"
                  title={tab.path}
                >
                  <FileText
                    size={ICON.nano}
                    className={cn("shrink-0", active ? "text-accent-color opacity-100" : "opacity-70")}
                    aria-hidden
                  />
                  <span className={cn("min-w-0 truncate", active && "font-semibold")}>{label}</span>
                </button>
                <Tooltip content={tab.pinned ? t("editorRecentBar.unpin") : t("editorRecentBar.pin")}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      pinFileTab(tab.path);
                    }}
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-opacity pointer-events-none group-hover:pointer-events-auto focus-visible:pointer-events-auto",
                      tab.pinned
                        ? "text-accent-color opacity-100 pointer-events-auto"
                        : "text-text-quaternary opacity-0 group-hover:opacity-100 hover:bg-surface-muted focus-visible:opacity-100",
                    )}
                    aria-label={tab.pinned ? t("editorRecentBar.unpin") : t("editorRecentBar.pin")}
                    aria-pressed={tab.pinned}
                  >
                    <Pin size={ICON.nano} className={tab.pinned ? "fill-current" : undefined} aria-hidden />
                  </button>
                </Tooltip>
                <Tooltip content={t("editorRecentBar.closeTabTip")}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeFileTab(tab.path);
                    }}
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-quaternary transition-opacity pointer-events-none group-hover:pointer-events-auto hover:bg-surface-muted hover:text-error",
                      active ? "opacity-80 pointer-events-auto" : "opacity-0 group-hover:opacity-100",
                    )}
                    aria-label={t("editorRecentBar.closeAriaLabel")}
                  >
                    <X size={ICON.nano} />
                  </button>
                </Tooltip>
              </div>
            );
          })}
        </div>
        </div>
        {/* Close-all control */}
        <div className="flex shrink-0 items-center gap-0.5 border-l border-border-subtle-dim px-1">
          <Tooltip content={hasUnpinned ? t("editorRecentBar.closeAllUnpinned") : t("editorRecentBar.closeAllTabs")}>
            <button
              type="button"
              onClick={() => closeAllFileTabs({ closePinned: !hasUnpinned })}
              className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-text-quaternary transition-colors hover:bg-surface-muted hover:text-error"
              aria-label={t("editorRecentBar.closeAllTabsAriaLabel")}
            >
              <XCircle size={ICON.xs} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Tab chrome context menu */}
      {tabMenu ? (
        <ContextMenu open x={tabMenu.x} y={tabMenu.y} onClose={() => setTabMenu(null)}>
          <ContextMenuLabel>{tabMenu.label}</ContextMenuLabel>
          <ContextMenuItem
            icon={<FileText size={ICON.nano} />}
            onClick={() => {
              openFile(tabMenu.path);
              setTabMenu(null);
            }}
          >
            {t("editorRecentBar.open")}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Pin size={ICON.nano} />}
            onClick={() => {
              pinFileTab(tabMenu.path);
              setTabMenu(null);
            }}
          >
            {t("editorRecentBar.togglePin")}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Columns2 size={ICON.nano} />}
            onClick={() => {
              if (splitSecondaryPath === tabMenu.path) clearSplit();
              else openInSplit(tabMenu.path);
              setTabMenu(null);
            }}
          >
            {splitSecondaryPath === tabMenu.path ? t("editorRecentBar.closeSplitRight") : t("editorRecentBar.openSplitRight")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            icon={<X size={ICON.nano} />}
            shortcut="⌘W"
            onClick={() => {
              closeFileTab(tabMenu.path);
              setTabMenu(null);
            }}
          >
            {t("editorRecentBar.close")}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              closeOtherFileTabs(tabMenu.path);
              setTabMenu(null);
            }}
          >
            {t("editorRecentBar.closeOthers")}
          </ContextMenuItem>
          <ContextMenuItem
            destructive
            icon={<XCircle size={ICON.nano} />}
            shortcut="⌘⌥W"
            onClick={() => {
              closeAllFileTabs({ closePinned: true });
              setTabMenu(null);
            }}
          >
            {t("editorRecentBar.closeAll")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => {
              const { x, y, path, label } = tabMenu;
              setTabMenu(null);
              // Open filesystem ops menu at same coordinates
              void Promise.resolve().then(() => {
                fileMenu.open(
                  {
                    preventDefault() {},
                    stopPropagation() {},
                    clientX: x,
                    clientY: y,
                  } as React.MouseEvent,
                  {
                    path,
                    label,
                    kind: fileMenuKind(path),
                  },
                );
              });
            }}
          >
            {t("editorRecentBar.fileOps")}
          </ContextMenuItem>
        </ContextMenu>
      ) : null}

      <WorkspaceFileContextMenu menu={fileMenu.menu} onClose={fileMenu.close} />
    </div>
  );
}
