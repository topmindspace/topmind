/**
 * Shared AI stream status labels — StatusBar · ChatMessage · ChatInput must match.
 *
 * Uses the i18n instance directly (not the React hook) so non-React modules
 * can access the current locale's translations without prop-drilling `lang`.
 */
import i18n from "../locales";

export type StreamStatusKey =
  | "preparing"
  | "compacting"
  | "thinking"
  | "calling-tool"
  | "steering"
  | "writing"
  | "done"
  | string;

export function streamStatusLabel(
  status: StreamStatusKey | null | undefined,
  toolName?: string | null,
  count?: number | null,
  maxSteps?: number | null,
): string {
  const stepInfo = count && maxSteps ? ` ${count}/${maxSteps}` : count ? ` ${count}` : "";
  switch (status) {
    case "calling-tool":
      return `${toolName?.trim() || i18n.t("common:streamStatus.tool")}${stepInfo}`;
    case "thinking":
      return i18n.t("common:streamStatus.thinking");
    case "preparing":
      return i18n.t("common:streamStatus.preparing");
    case "compacting":
      return i18n.t("common:streamStatus.organizingContext");
    case "steering":
      return i18n.t("common:streamStatus.contextAdded");
    case "writing":
      return i18n.t("common:streamStatus.responding");
    case "done":
      return i18n.t("common:streamStatus.completed");
    default:
      return status
        ? i18n.t("common:streamStatus.responding")
        : i18n.t("common:streamStatus.session");
  }
}

/** Session chip: streaming → status label; idle → message count or session label */
export function sessionStatusLabel(opts: {
  streaming: boolean;
  streamStatus?: string | null;
  streamToolName?: string | null;
  streamToolCount?: number | null;
  streamMaxSteps?: number | null;
  messageCount: number;
}): string {
  if (opts.streaming) {
    return streamStatusLabel(opts.streamStatus, opts.streamToolName, opts.streamToolCount, opts.streamMaxSteps);
  }
  return opts.messageCount > 0
    ? i18n.t("common:streamStatus.msgCount", { count: opts.messageCount })
    : i18n.t("common:streamStatus.session");
}
