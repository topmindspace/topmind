/**
 * DnD shell — isolates @dnd-kit so the main Shell can lazy-load it after boot.
 */
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { FileText } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { emitLocal } from "../../plugins/host";
import { api } from "../../services/api";
import { ICON } from "../../lib/icons";

import type { ToastPayload } from "../../lib/local-events";

export function DndShell({
  children,
  onToast,
}: {
  children: ReactNode;
  onToast: (msg: string | ToastPayload) => void;
}) {
  const { t } = useTranslation("shell");
  const [activeDrag, setActiveDrag] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = useCallback(
    async (e: DragEndEvent) => {
      const { active, over } = e;
      setActiveDrag(null);
      if (!over) return;
      const dragData = active.data.current as { type?: string; relativePath?: string } | undefined;
      const dropData = over.data.current as { type?: string; topicId?: string } | undefined;
      if (dragData?.type === "inbox-file" && dropData?.type === "topic" && dragData.relativePath && dropData.topicId) {
        try {
          await api.ws.move({ inboxRelativePath: dragData.relativePath, targetTopicId: dropData.topicId });
          emitLocal("workspace:file-changed");
        } catch (err) {
          onToast({ text: t("toast.moveFailedDetail", { error: err instanceof Error ? err.message : String(err) }), kind: "error" });
        }
      }
    },
    [onToast],
  );

  const handleDragStart = useCallback((e: DragStartEvent) => {
    const data = e.active.data.current as { type?: string; relativePath?: string } | undefined;
    if (data?.type === "inbox-file" && data.relativePath) {
      setActiveDrag(data.relativePath);
    }
  }, []);

  const handleDragCancel = useCallback(() => setActiveDrag(null), []);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {activeDrag ? (
          <div className="flex items-center gap-1.5 rounded-[var(--radius-md)] border border-accent-border-subtle bg-surface-elevated px-2.5 py-1.5 text-3xs font-medium text-text-primary shadow-[var(--shadow-elevated-hairline,var(--shadow-float))]">
            <FileText size={ICON.xs} className="text-accent-color" aria-hidden />
            <span className="max-w-[160px] truncate">{activeDrag.split("/").pop()}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
