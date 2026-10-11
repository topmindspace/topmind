/**
 * QuickCapture link/fetch preview + shared LinkCaptureCard.
 *
 * LinkCaptureCard is the "link dynamic view" (链接动态视图): URL detection →
 * fetch → result meta. Embedded inline (stream composer) or in capture
 * surfaces — never a modal of its own.
 */
import { useTranslation } from "react-i18next";
import {
  RiAlertLine,
  RiDownload2Line,
  RiLoader4Line,
  RiSparklingLine,
} from "@remixicon/react";
import { cn } from "../../lib/kit";
import { ICON } from "../../lib/icons";
import { remoteAssetUrl } from "../../lib/editor-media";
import {
  FETCH_FULL,
  FETCH_STEP_KEYS,
  classifyCaptureUrlKind,
  methodLabelKey,
  urlKindLabelKey,
} from "./quick-capture-helpers";
import type { FetchMeta } from "./quick-capture-helpers";
import type { CaptureFormApi } from "./CaptureForm";

export type LinkCaptureCardProps = {
  /** Raw URL text (source field or compose body). */
  url: string;
  fetching?: boolean;
  fetchStage?: number;
  fetchMeta?: FetchMeta | null;
  /** Cover / first image from the fetch result (remote URL is fine). */
  imageUrl?: string | null;
  /** Single high-quality fetch entry. */
  onFetch?: (opts?: { maxLen?: number; render?: boolean }) => void | Promise<void>;
  className?: string;
  /** Compact mode for inline composer strip. */
  compact?: boolean;
  /** Override CTA label (stream uses composeUrlAction = 记一下). */
  actionLabel?: string;
};

export function LinkCaptureCard({
  url,
  fetching = false,
  fetchStage = 0,
  fetchMeta = null,
  imageUrl,
  onFetch,
  className,
  compact = false,
  actionLabel,
}: LinkCaptureCardProps) {
  const { t } = useTranslation();
  const trimmed = String(url || "").trim();
  const isHttp = /^https?:\/\/\S+$/iu.test(trimmed);
  const kind = isHttp ? classifyCaptureUrlKind(trimmed) : null;
  if (!isHttp && !fetchMeta && !fetching) return null;

  return (
    <div className={cn("space-y-1.5", className)} data-link-capture-card>
      {isHttp && !fetching && !fetchMeta ? (
        <div className={cn("flex flex-wrap items-center gap-1.5", compact ? "text-3xs" : "text-3xs")}>
          <span className="text-accent-color">
            {t("overlays:capture.urlDetected")}
            {kind ? t(urlKindLabelKey(kind)) : null}
          </span>
          {onFetch ? (
            <button
              type="button"
              onClick={() => void onFetch()}
              className="inline-flex items-center gap-0.5 font-medium text-accent-color underline underline-offset-2 hover:opacity-80 v4-focus-ring"
            >
              <RiDownload2Line size={ICON.micro} className="shrink-0" aria-hidden />
              {actionLabel || t("overlays:capture.urlFetchAction")}
            </button>
          ) : null}
          {!compact ? (
            <span className="text-text-quaternary">{t("overlays:capture.fetchDestHint")}</span>
          ) : null}
        </div>
      ) : null}

      {fetching ? (
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius-md)] border border-border-subtle-dim bg-surface-wash-65 px-2 py-1.5"
          role="status"
          aria-live="polite"
          aria-label={t("overlays:capture.fetchAriaLabel")}
        >
          <RiLoader4Line size={ICON.micro} className="shrink-0 animate-spin text-accent-color" aria-hidden />
          <ol className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-3xs">
            {FETCH_STEP_KEYS.map((step, i) => {
              const done = fetchStage > step.id;
              const active = fetchStage === step.id;
              return (
                <li key={step.id} className="flex items-center gap-1.5">
                  {i > 0 ? (
                    <span className="text-text-quaternary opacity-50" aria-hidden>
                      →
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "font-medium",
                      done && "text-success",
                      active && "text-accent-color",
                      !done && !active && "text-text-quaternary",
                    )}
                  >
                    {t(step.key)}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      {fetchMeta ? (
        <div className="space-y-1">
          <div className="text-3xs text-text-quaternary" role="status">
            {t("overlays:capture.fetchDone")} · {t(methodLabelKey(fetchMeta.method))}
            {typeof fetchMeta.wordCount === "number"
              ? ` · ${t("overlays:capture.fetchWordCount", { count: fetchMeta.wordCount })}`
              : ""}
            {fetchMeta.truncated ? ` · ${t("overlays:capture.fetchTruncated")}` : ""}
            {fetchMeta.enhanced ? ` · ${t("overlays:capture.fetchEnhanced")}` : ""}
          </div>
          {imageUrl && /^https?:\/\//iu.test(imageUrl) ? (
            <img
              src={remoteAssetUrl(imageUrl)}
              alt=""
              loading="lazy"
              className="max-h-40 w-auto max-w-full rounded-[var(--radius-md)] border border-border-subtle-dim object-cover"
              data-link-capture-cover
            />
          ) : null}
          {fetchMeta.warning ? (
            <div className="flex items-start gap-1.5 rounded-[var(--radius-md)] border border-border-subtle-dim bg-status-warning-bg px-2 py-1.5 text-xs leading-relaxed text-warning">
              <RiAlertLine size={ICON.micro} className="mt-0.5 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">{fetchMeta.warning}</div>
            </div>
          ) : null}
          {/* Rare fallback only — default fetch is already highest quality. */}
          {onFetch && fetchMeta.canEnhance && !fetchMeta.enhanced ? (
            <button
              type="button"
              disabled={fetching}
              onClick={() => void onFetch({ render: true, maxLen: fetchMeta.maxLen ?? FETCH_FULL })}
              className="inline-flex items-center gap-0.5 text-3xs font-medium text-accent-color underline hover:opacity-80 disabled:opacity-50"
            >
              <RiSparklingLine size={ICON.micro} />
              {t("overlays:capture.fetchEnhanceRender")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** QuickCapture slot wrapper around the shared LinkCaptureCard. */
export function CapturePreview({
  form,
  isMemory,
}: {
  form: CaptureFormApi;
  isMemory: boolean;
}) {
  const { contentIsUrl, fetching, fetchStage, fetchMeta, handleFetchUrl, source, content } = form;
  if (isMemory) return null;
  const urlText = source.trim() || content.trim();
  const show = contentIsUrl || Boolean(fetchMeta) || fetching || /^https?:\/\/\S+$/iu.test(urlText);
  if (!show) return null;

  return (
    <LinkCaptureCard
      url={urlText}
      fetching={fetching}
      fetchStage={fetchStage}
      fetchMeta={fetchMeta}
      imageUrl={fetchMeta?.image}
      onFetch={handleFetchUrl}
    />
  );
}
