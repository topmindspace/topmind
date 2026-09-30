import { useTranslation } from "react-i18next";
import { RiLoader4Line, RiPauseLine, RiSparklingLine } from "@remixicon/react";
import { cn } from "../../lib/kit";
import { ICON } from "../../lib/icons";
import { StatusDot } from "./StatusDot";
import type { StatusDotTone } from "./StatusDot";

export type AgentPresenceState =
  | "idle"
  | "working"
  | "needs-you"
  | "paused"
  | "done"
  | "error";

/**
 * AgentPresence — Muse floating-avatar register: compact capsule that makes
 * long-running agent work visible without a second chrome bar.
 *
 * Mount at the AI-rail header or as a floating capsule. Not a StatusBar
 * replacement — StatusBar still owns multi-task honesty.
 */
export function AgentPresence({
  state,
  detail,
  onActivate,
  className,
  compact,
}: {
  state: AgentPresenceState;
  /** Short status word: tool name, gate label, step hint. */
  detail?: string;
  onActivate?: () => void;
  className?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation("common");

  if (state === "idle") return null;

  const tone: StatusDotTone =
    state === "working"
      ? "running"
      : state === "needs-you"
        ? "warning"
        : state === "paused"
          ? "neutral"
          : state === "done"
            ? "success"
            : "error";

  const label =
    state === "working"
      ? t("presence.working", { defaultValue: "工作中" })
      : state === "needs-you"
        ? t("presence.needsYou", { defaultValue: "需要你" })
        : state === "paused"
          ? t("presence.paused", { defaultValue: "已暂停" })
          : state === "done"
            ? t("presence.done", { defaultValue: "已完成" })
            : t("presence.error", { defaultValue: "出错了" });

  const icon =
    state === "working" ? (
      <RiLoader4Line size={ICON.micro} className="animate-spin text-accent-color" />
    ) : state === "needs-you" ? (
      <RiSparklingLine size={ICON.micro} className="text-warning" />
    ) : state === "paused" ? (
      <RiPauseLine size={ICON.micro} className="text-text-tertiary" />
    ) : (
      <RiSparklingLine size={ICON.micro} className="text-accent-color" />
    );

  const body = (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border",
        "bg-surface-elevated px-2.5 py-1.5 shadow-[var(--shadow-float)]",
        state === "needs-you"
          ? "border-border-strong bg-status-warning-bg"
          : state === "working"
            ? "border-accent-border-subtle"
            : "border-border-subtle-dim",
      )}
    >
      <span
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
          state === "needs-you" ? "bg-status-warning-bg" : "bg-accent-bg-subtle",
        )}
      >
        {icon}
      </span>
      {!compact ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="text-xs font-medium text-text-primary">{label}</span>
          {detail ? (
            <span className="max-w-[12rem] truncate text-3xs text-text-tertiary">{detail}</span>
          ) : null}
        </span>
      ) : (
        <span className="text-3xs font-medium text-text-primary">{label}</span>
      )}
      <StatusDot tone={tone} />
    </span>
  );

  if (!onActivate) return <div className={className}>{body}</div>;
  return (
    <button type="button" onClick={onActivate} className={cn("v4-focus-ring rounded-full", className)}>
      {body}
    </button>
  );
}
