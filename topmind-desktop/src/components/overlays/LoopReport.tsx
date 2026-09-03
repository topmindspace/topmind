/**
 * Loop / workspace health report overlay.
 * Shows native workspaceHealth results (deterministic layer of topmind-loop).
 */
import {
  RiAlertLine,
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiFileWarningLine,
  RiNodeTree,
  RiPulseLine,
} from "@remixicon/react";
import { useTranslation } from "react-i18next";
import { useViewStore } from "../../stores/view-store";
import { Button } from "../ui/Button";
import { ICON } from "../../lib/icons";
import type { LoopReportPayload } from "../../types";
import { cn } from "../../lib/cn";

export function LoopReport() {
  const { t } = useTranslation();
  const closeOverlay = useViewStore((s) => s.closeOverlay);
  const select = useViewStore((s) => s.select);
  const ctx = useViewStore((s) => s.overlayContext);
  const report = (ctx?.loopReport || {}) as LoopReportPayload;
  const issues = report.issues || [];
  const summary = report.summary || {};
  const ok = report.ok !== false && (summary.errorCount ?? 0) === 0;
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning" || i.severity === "warn");
  const others = issues.filter((i) => i.severity !== "error" && i.severity !== "warning" && i.severity !== "warn");

  return (
    <div
      className="v4-overlay-sheet flex max-h-[min(80vh,640px)] w-[520px] flex-col overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="loop-report-title"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "v4-icon-chip flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)]",
              ok ? "text-success" : "text-warning",
            )}
          >
            {ok ? <RiCheckboxCircleLine size={ICON.md} /> : <RiPulseLine size={ICON.md} />}
          </span>
          <div className="min-w-0">
            <h2 id="loop-report-title" className="text-sm font-semibold tracking-tight text-text-primary">
              {t("overlays:loop.title")}
            </h2>
            <p className="mt-0.5 text-3xs text-text-tertiary">
              {t("overlays:loop.subtitle")}
              {report.ranAt ? ` · ${new Date(report.ranAt).toLocaleString()}` : ""}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={closeOverlay}>
          {t("overlays:loop.close")}
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-2 border-b border-border-subtle px-5 py-3">
        <Stat label={t("overlays:loop.statCategory")} value={summary.categoryCount ?? 0} />
        <Stat label={t("overlays:loop.statTopic")} value={summary.topicCount ?? 0} />
        <Stat label={t("overlays:loop.statLooseNote")} value={summary.looseNoteCount ?? 0} />
        <Stat
          label={t("overlays:loop.statIssue")}
          value={(summary.errorCount ?? 0) + (summary.warningCount ?? 0)}
          warn={!ok}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        {issues.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <RiCheckboxCircleLine size={ICON.lg} className="text-success" />
            <div className="text-sm font-medium text-text-secondary">{t("overlays:loop.allClear")}</div>
            <p className="max-w-xs text-3xs leading-relaxed text-text-quaternary">
              {t("overlays:loop.allClearHint")}
            </p>
          </div>
        ) : (
          <ul className="m-0 list-none space-y-2 p-0">
            {errors.map((i, idx) => (
              <IssueRow key={`e-${idx}`} issue={i} tone="error" onOpenPath={select} />
            ))}
            {warnings.map((i, idx) => (
              <IssueRow key={`w-${idx}`} issue={i} tone="warning" onOpenPath={select} />
            ))}
            {others.map((i, idx) => (
              <IssueRow key={`o-${idx}`} issue={i} tone="neutral" onOpenPath={select} />
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            closeOverlay();
            select({ kind: "inbox" });
          }}
        >
          <RiNodeTree size={ICON.sm} /> {t("overlays:loop.openInbox")}
        </Button>
        <Button size="sm" onClick={closeOverlay}>
          {t("overlays:loop.done")}
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-border-subtle bg-surface-muted/40 px-2 py-1.5 text-center">
      <div className={cn("text-sm font-semibold tabular-nums", warn ? "text-warning" : "text-text-primary")}>
        {value}
      </div>
      <div className="text-3xs text-text-quaternary">{label}</div>
    </div>
  );
}

function IssueRow({
  issue,
  tone,
  onOpenPath,
}: {
  issue: { severity: string; code?: string; message: string; path?: string };
  tone: "error" | "warning" | "neutral";
  onOpenPath: (sel: { kind: "file"; path: string }) => void;
}) {
  const Icon = tone === "error" ? RiCloseCircleLine : tone === "warning" ? RiAlertLine : RiFileWarningLine;
  const color =
    tone === "error" ? "text-error border-error/20 bg-status-error-bg" :
    tone === "warning" ? "text-warning border-warning/25 bg-status-warning-bg/40" :
    "text-text-secondary border-border-subtle bg-surface-muted/30";

  return (
    <li className={cn("rounded-[var(--radius-md)] border px-3 py-2 text-3xs", color)}>
      <div className="flex items-start gap-2">
        <Icon size={ICON.sm} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-medium leading-snug text-text-primary">{issue.message}</div>
          {issue.code ? (
            <div className="mt-0.5 font-mono text-3xs text-text-quaternary">{issue.code}</div>
          ) : null}
          {issue.path ? (
            /\.md$/iu.test(issue.path!) ? (
              <button
                type="button"
                className="mt-1 truncate font-mono text-3xs text-accent-color underline v4-focus-ring"
                title={issue.path}
                onClick={() => onOpenPath({ kind: "file", path: issue.path! })}
              >
                {issue.path}
              </button>
            ) : (
              <div className="mt-1 truncate font-mono text-3xs text-text-quaternary" title={issue.path}>
                {issue.path}
              </div>
            )
          ) : null}
        </div>
      </div>
    </li>
  );
}
