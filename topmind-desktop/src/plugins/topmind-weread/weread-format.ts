/**
 * Pure formatters for WeRead hub (no React).
 * Uses i18n directly for locale-aware output.
 */
import i18n, { intlLocale } from "../../locales";

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h <= 0 && m <= 0) return s > 0 ? i18n.t("weread:format.durationLt1") : i18n.t("weread:format.durationZero");
  if (h <= 0) return i18n.t("weread:format.durationMinutes", { count: m });
  if (m <= 0) return i18n.t("weread:format.durationHours", { count: h });
  return i18n.t("weread:format.durationHm", { h, m });
}

export function formatSyncTime(iso: string | null | undefined): string {
  if (!iso) return i18n.t("weread:format.notSynced");
  try {
    return new Date(iso).toLocaleString(intlLocale());
  } catch {
    return iso;
  }
}
