/**
 * 集中 datetime 工具函数。
 * 取代 inline formatRelativeTime / formatDate。
 * Locale-aware: uses the active i18n locale for formatting and translation.
 */

import i18n from "i18next";
import { intlLocale } from "../locales";

export function formatRelativeTime(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const diffMs = Date.now() - ts;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) {
    return i18n.t('common:time.justNow');
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return i18n.t('common:time.minutesAgo', { count: min });
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return i18n.t('common:time.hoursAgo', { count: hr });
  }
  const day = Math.floor(hr / 24);
  if (day < 30) {
    return i18n.t('common:time.daysAgo', { count: day });
  }
  return iso.slice(0, 10);
}

export function formatDate(value?: string | null): string {
  if (!value) {
    return i18n.t('common:time.justNow');
  }
  return new Date(value).toLocaleDateString(intlLocale());
}

interface FormatDateTimeOptions {
  locale?: string;
  hour12?: boolean;
  month?: 'numeric' | '2-digit' | 'long' | 'short' | 'narrow';
  day?: 'numeric' | '2-digit';
  hour?: 'numeric' | '2-digit';
  minute?: 'numeric' | '2-digit';
}

/**
 * 统一封装 `new Date(iso).toLocaleString(...)`，零值返回 null。
 * 取代各 View inline 调用。
 * Default locale comes from i18n active locale (not hardcoded zh-CN).
 */
export function formatDateTime(
  value?: string | null,
  options: FormatDateTimeOptions = {},
): string | null {
  if (!value) return null;
  const { locale = intlLocale(), ...intl } = options;
  return new Date(value).toLocaleString(locale, { hour12: false, ...intl });
}
