/**
 * QuickCapture link/fetch preview — URL-detected prompt, staged fetch progress,
 * and fetch-result meta (method · words · truncation · enhance actions).
 */
import { useTranslation } from "react-i18next";
import { Download, Loader2, AlertTriangle, Sparkles } from "lucide-react";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import {
  FETCH_DEFAULT,
  FETCH_FULL,
  FETCH_STEP_KEYS,
  methodLabelKey,
} from "./quick-capture-helpers";
import type { CaptureFormApi } from "./CaptureForm";

export function CapturePreview({
  form,
  isMemory,
}: {
  form: CaptureFormApi;
  isMemory: boolean;
}) {
  const { t } = useTranslation();
  const { contentIsUrl, fetching, fetchStage, fetchMeta, showEnhance, handleFetchUrl } = form;

  return (
    <>
      {!isMemory && contentIsUrl && !fetching ? (
        <div className="mt-1.5 flex items-center gap-1.5 text-3xs text-accent-color">
          <Download size={ICON.micro} className="shrink-0" aria-hidden />
          <span>{t("overlays:capture.urlDetected")}</span>
          <button
            type="button"
            onClick={() => void handleFetchUrl()}
            className="font-medium underline underline-offset-2 hover:opacity-80 v4-focus-ring"
          >
            {t("overlays:capture.urlFetchAction")}
          </button>
        </div>
      ) : null}

      {fetching ? (
        <div
          className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius-md)] border border-border-subtle-dim bg-surface-muted/60 px-2 py-1.5"
          role="status"
          aria-live="polite"
          aria-label={t("overlays:capture.fetchAriaLabel")}
        >
          <Loader2 size={ICON.micro} className="shrink-0 animate-spin text-accent-color" aria-hidden />
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
        <div className="mt-1.5 space-y-1">
          <div className="text-3xs text-text-quaternary" role="status">
            {t("overlays:capture.fetchDone")} · {t(methodLabelKey(fetchMeta.method))}
            {typeof fetchMeta.wordCount === "number" ? ` · ${t("overlays:capture.fetchWordCount", { count: fetchMeta.wordCount })}` : ""}
            {fetchMeta.truncated ? ` · ${t("overlays:capture.fetchTruncated")}` : ""}
            {fetchMeta.enhanced ? ` · ${t("overlays:capture.fetchEnhanced")}` : ""}
          </div>
          {fetchMeta.warning || showEnhance ? (
            <div className="flex items-start gap-1.5 rounded-[var(--radius-md)] border border-warning/25 bg-status-warning-bg/40 px-2 py-1.5 text-3xs leading-relaxed text-warning">
              <AlertTriangle size={ICON.micro} className="mt-0.5 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1 space-y-1">
                {fetchMeta.warning ? <div>{fetchMeta.warning}</div> : null}
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {fetchMeta.truncated && (fetchMeta.maxLen ?? 0) < FETCH_FULL ? (
                    <button
                      type="button"
                      disabled={fetching}
                      onClick={() => void handleFetchUrl({ maxLen: FETCH_FULL })}
                      className="font-medium text-accent-color underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
                    >
                      {t("overlays:capture.fetchFull", { kb: FETCH_FULL / 1000 })}
                    </button>
                  ) : null}
                  {showEnhance ? (
                    <button
                      type="button"
                      disabled={fetching}
                      onClick={() => void handleFetchUrl({
                        maxLen: fetchMeta.maxLen ?? FETCH_DEFAULT,
                        render: true,
                      })}
                      className="inline-flex items-center gap-0.5 font-medium text-accent-color underline hover:opacity-80 disabled:opacity-50"
                    >
                      <Sparkles size={ICON.micro} />
                      {t("overlays:capture.fetchEnhanceRender")}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
