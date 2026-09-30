import { cn } from "../../lib/kit";

/**
 * StatusDot — 8px semantic status indicator (Muse-goal / Cue-asset register).
 *
 * Own axis from text paint: the dot is a pure fill, never a text-stop alpha.
 * Prefer pairing with a short label; bare dots are for dense rows only.
 */
export type StatusDotTone =
  | "success"
  | "info"
  | "warning"
  | "error"
  | "neutral"
  | "accent"
  | "running";

const TONE_FILL: Record<StatusDotTone, string> = {
  success: "bg-success",
  info: "bg-status-info",
  warning: "bg-warning",
  error: "bg-error",
  neutral: "bg-status-neutral",
  accent: "bg-accent-color",
  running: "bg-accent-color animate-pulse-soft",
};

export function StatusDot({
  tone,
  ok,
  label,
  className,
  title,
}: {
  tone?: StatusDotTone;
  /** Legacy boolean: true → success, false → warning. */
  ok?: boolean;
  /** Optional short label; renders as a soft pill when provided. */
  label?: string;
  className?: string;
  title?: string;
}) {
  const resolved: StatusDotTone =
    tone ?? (ok === undefined ? "neutral" : ok ? "success" : "warning");
  const dot = (
    <span
      className={cn("h-2 w-2 shrink-0 rounded-full", TONE_FILL[resolved], className)}
      aria-hidden
    />
  );
  if (!label) {
    return title ? <span title={title}>{dot}</span> : dot;
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-xs)] px-1.5 py-0.5 text-3xs font-medium",
        resolved === "success" && "bg-status-success-bg text-success",
        resolved === "info" && "bg-status-info-bg text-status-info",
        resolved === "warning" && "bg-status-warning-bg text-warning",
        resolved === "error" && "bg-status-error-bg text-error",
        resolved === "accent" && "bg-accent-bg-subtle text-accent-color",
        resolved === "running" && "bg-accent-bg-subtle text-accent-color",
        resolved === "neutral" && "bg-status-neutral-bg text-text-tertiary",
        className,
      )}
      title={title}
      role="status"
    >
      {dot}
      {label}
    </span>
  );
}
