// ── TaskPanel — floating detail surface for background engine tasks ────────
// Compact progress lives in AI rail (TaskListBody); this is expand / drag chrome.
import { useEffect, useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import { useTaskStore } from "../../stores/task-store";
import { computeTaskPanelDragPosition } from "../../stores/task-store";
import { RiCloseLine, RiFullscreenExitLine, RiFullscreenLine } from "@remixicon/react";
import { ICON } from "../../lib/icons";
import { TaskListBody } from "./task-list-body";
import {
  loadTaskPanelPos,
  saveTaskPanelPos,
  type TaskPanelPos,
} from "../../lib/task-panel-pos";
import { shouldDismissTaskPanel } from "../../lib/engine-job-follow-up";
import { shouldCloseOnScroll } from "../../lib/scroll-dismiss";

interface TaskPanelProps {
  open: boolean;
  onClose: () => void;
}

export function TaskPanel({ open, onClose }: TaskPanelProps) {
  const { t } = useTranslation("shell");
  const tasks = useTaskStore((s) => s.tasks);
  const panelRef = useRef<HTMLDivElement>(null);
  const runningOrQueued = tasks.some((task) => task.status === "running" || task.status === "queued");

  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState<TaskPanelPos>(() => loadTaskPanelPos());
  const [isDragging, setIsDragging] = useState(false);
  const positionRef = useRef(position);
  positionRef.current = position;
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 });

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest(".task-panel-drag")) return;
    const pos = positionRef.current;
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      posX: pos.x,
      posY: pos.y,
    };
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const next = computeTaskPanelDragPosition(dragStartRef.current, e.clientX, e.clientY);
      positionRef.current = next;
      setPosition(next);
    };
    const onUp = () => {
      setIsDragging(false);
      // Persist the last computed coords (ref), not a stale effect closure.
      saveTaskPanelPos(positionRef.current);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [isDragging]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!shouldDismissTaskPanel({ runningOrQueued, event: "escape" })) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, runningOrQueued]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (!shouldDismissTaskPanel({ runningOrQueued, event: "outside-click" })) return;
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      const triggerEl = (target as Element)?.closest?.("[data-task-panel-trigger]");
      if (triggerEl) return;
      onClose();
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open, onClose, runningOrQueued]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: Event) => {
      if (!shouldDismissTaskPanel({ runningOrQueued, event: "outside-scroll" })) return;
      if (!shouldCloseOnScroll(e, panelRef.current)) return;
      onClose();
    };
    window.addEventListener("scroll", handle, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", handle, { capture: true });
  }, [open, onClose, runningOrQueued]);

  if (!open) return null;

  const runningCount = tasks.filter((task) => task.status === "running").length;

  return (
    <div
      ref={panelRef}
      data-task-panel
      className={cn(
        "fixed z-floating flex flex-col overflow-hidden",
        "rounded-[var(--radius-lg)] border border-border-subtle",
        "bg-surface-elevated/90 backdrop-blur-[var(--blur-glass)] backdrop-saturate-150 shadow-[var(--shadow-overlay)]",
        "animate-fade-in-scale",
      )}
      style={{
        right: position.x,
        bottom: position.y,
        width: minimized ? 220 : 340,
        height: minimized ? 44 : Math.min(480, Math.max(220, tasks.length * 100 + 72)),
        transition:
          "width var(--duration-fast) var(--ease-default), height var(--duration-fast) var(--ease-default)",
      }}
      onMouseDown={handleDragStart}
    >
      <div
        className={cn(
          "task-panel-drag",
          "flex shrink-0 cursor-grab items-center justify-between",
          "border-b border-border-subtle px-3 py-2",
          minimized && "border-b-0",
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">{t("taskPanel.title")}</span>
          {runningCount > 0 ? (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-muted px-1 text-3xs font-semibold text-accent">
              {runningCount}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setMinimized(!minimized)}
            className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-text-tertiary transition-colors hover:bg-surface-muted hover:text-text-primary"
            aria-label={minimized ? t("taskPanel.restore") : t("taskPanel.minimize")}
          >
            {minimized ? <RiFullscreenLine size={ICON.micro} /> : <RiFullscreenExitLine size={ICON.micro} />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-text-tertiary transition-colors hover:bg-surface-muted hover:text-text-primary"
            aria-label={t("taskPanel.close")}
          >
            <RiCloseLine size={ICON.micro} />
          </button>
        </div>
      </div>

      {!minimized ? (
        <div className="v4-sidebar-scroll min-h-0 flex-1 overflow-y-auto p-2">
          <TaskListBody />
        </div>
      ) : null}
    </div>
  );
}
