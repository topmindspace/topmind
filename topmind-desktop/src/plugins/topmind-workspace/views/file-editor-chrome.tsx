/**
 * File editor chrome — toolbar controls + save badge (Design System 2.0).
 * Extracted from FileEditorView to keep the view focused on load/save lifecycle.
 */
import { useTranslation } from "react-i18next";
import { memo, type MouseEvent, ReactNode } from "react";
import {
  Check,
  AlertCircle,
  Loader2,
  CloudUpload,
} from "lucide-react";
import { Tooltip } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/cn";
import { ICON } from "../../../lib/icons";

export type SaveState = "clean" | "dirty" | "saving" | "saved" | "error";

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function ToolbarSep() {
  return <span className="v4-chrome-sep mx-0.5! h-3.5! shrink-0" aria-hidden />;
}

export function ToolbarButton({
  onClick,
  active,
  tip,
  children,
  onContextMenu,
}: {
  onClick: () => void;
  active: boolean;
  tip: string;
  children: ReactNode;
  onContextMenu?: (e: MouseEvent) => void;
}) {
  return (
    <Tooltip content={tip}>
      <button
        type="button"
        onClick={onClick}
        onContextMenu={onContextMenu}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-sm",
          "transition-[background-color,color,box-shadow] duration-(--duration-fast)",
          active
            ? "bg-accent-bg-subtle text-accent-color shadow-[inset_0_0_0_1px_var(--color-accent-border-subtle)]"
            : "text-text-tertiary hover:bg-surface-muted hover:text-text-primary",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export const SaveBadge = memo(function SaveBadge({ state }: { state: SaveState }) {
  const { t } = useTranslation(["workspace", "common"]);
  // Merge saved → clean: the visual difference is negligible (/40 vs /50 bg)
  // and the extra state transition causes unnecessary re-renders + flicker.
  const effective = state === "saved" ? "clean" : state;
  const config = {
    clean: {
      icon: <Check size={ICON.xs} />,
      label: t("workspace:editor.saved"),
      color: "text-success",
      bg: "bg-status-success-bg/40",
      tip: t("workspace:editor.saved"),
    },
    dirty: {
      icon: <CloudUpload size={ICON.xs} />,
      label: t("workspace:editor.unsaved"),
      color: "text-warning",
      bg: "bg-status-warning-bg/40",
      tip: t("workspace:editor.unsaved_tip"),
    },
    saving: {
      icon: <Loader2 size={ICON.xs} className="animate-spin" />,
      label: t("workspace:editor.saving"),
      color: "text-accent-color",
      bg: "bg-accent-bg-subtle",
      tip: t("workspace:editor.saving"),
    },
    error: {
      icon: <AlertCircle size={ICON.xs} />,
      label: t("common:status.error"),
      color: "text-error",
      bg: "bg-status-error-bg/50",
      tip: t("common:status.error"),
    },
  }[effective];
  return (
    <Tooltip content={config.tip}>
      <span
        className={cn(
          "ml-0.5 flex items-center gap-1 rounded-full px-2 py-0.5 text-3xs font-medium transition-colors",
          config.color,
          config.bg,
        )}
      >
        {config.icon}
        {config.label}
      </span>
    </Tooltip>
  );
});
