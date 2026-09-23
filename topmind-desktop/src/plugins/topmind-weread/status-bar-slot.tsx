/**
 * Weread StatusBar — last sync + live progress.
 */
import { RiBookOpenLine, RiLoader4Line } from "@remixicon/react";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../services/api";
import { onLocal } from "../host";
import type { PluginContext, StatusBarSlot } from "../types";
import type { WereadSyncResult } from "../../types";
import { useViewStore } from "../../stores/view-store";
import { Tooltip } from "../../components/ui/tooltip";
import { ICON } from "../../lib/icons";
import { intlLocale } from "../../locales";

export function createWereadStatusBarSlot(_ctx: PluginContext): StatusBarSlot {
  return {
    kind: "statusBar",
    id: "topmind-weread.statusbar",
    align: "right",
    order: 200,
    render: () => <WereadStatusBar />,
  };
}

function WereadStatusBar() {
  const { t } = useTranslation("weread");
  const select = useViewStore((s) => s.select);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    void api.weread.status().then((s) => setLastSync(s.lastSyncAt)).catch(() => {});
    const interval = setInterval(() => {
      void api.weread.status().then((s) => setLastSync(s.lastSyncAt)).catch(() => {});
    }, 30000);
    const unsubP = onLocal("weread:sync-progress", (p: unknown) => {
      const msg = (p as { message?: string } | null)?.message;
      if (msg) setProgress(msg);
    });
    const unsubD = onLocal("weread:sync-done", (p: unknown) => {
      setProgress(null);
      const r = p as WereadSyncResult | null;
      if (r?.lastSyncAt) setLastSync(r.lastSyncAt);
    });
    return () => {
      clearInterval(interval);
      unsubP();
      unsubD();
    };
  }, []);

  if (progress) {
    return (
      <Tooltip content={progress}>
        <button
          type="button"
          onClick={() => select({ kind: "connector", id: "weread" })}
          className="flex max-w-[180px] items-center gap-1 truncate text-accent-color"
        >
          <RiLoader4Line size={ICON.micro} className="shrink-0 animate-spin" />
          <span className="truncate">{progress}</span>
        </button>
      </Tooltip>
    );
  }

  if (!lastSync) return null;

  const date = new Date(lastSync);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const label =
    diffMin < 1
      ? t("statusBar.justNow")
      : diffMin < 60
        ? t("statusBar.minutesAgo", { count: diffMin })
        : diffMin < 1440
          ? t("statusBar.hoursAgo", { count: Math.floor(diffMin / 60) })
          : date.toLocaleDateString(intlLocale());

  return (
    <Tooltip content={t("statusBar.lastSync", { time: date.toLocaleString(intlLocale()) })}>
      <button
        type="button"
        onClick={() => select({ kind: "connector", id: "weread" })}
        className="flex items-center gap-1 text-text-quaternary transition-colors hover:text-text-secondary"
      >
        <RiBookOpenLine size={ICON.micro} />
        <span>{t("statusBar.reading", { label })}</span>
      </button>
    </Tooltip>
  );
}
