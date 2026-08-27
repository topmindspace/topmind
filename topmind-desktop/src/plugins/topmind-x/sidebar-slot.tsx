/**
 * X Sidebar — open hub; quick fetch dialog kept as shortcut.
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Twitter, Loader2, Settings, ExternalLink, Send } from "lucide-react";
import { api } from "../../services/api";
import { onLocal } from "../host";
import type { PluginContext, SidebarSlot } from "../types";
import type { AppSettings } from "../../types";
import { Tooltip } from "../../components/ui/tooltip";
import { ICON } from "../../lib/icons";

export function createXSidebarSlot(ctx: PluginContext): SidebarSlot {
  return {
    kind: "sidebar",
    id: "topmind-x.sidebar",
    label: "X / Twitter",
    icon: "twitter",
    order: 210,
    render: () => <XSidebarEntry ctx={ctx} />,
  };
}

function XSidebarEntry({ ctx }: { ctx: PluginContext }) {
  const { t } = useTranslation("x");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [canPost, setCanPost] = useState(false);
  const [canRead, setCanRead] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    void api.sys.settings().then((s) => setSettings(s as AppSettings)).catch(() => {});
    void api.x
      .status()
      .then((s) => {
        setCanPost(Boolean(s.canPost));
        setCanRead(Boolean(s.canRead));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    const unsub = onLocal("x:open-prompt", () => {
      ctx.navigate({ kind: "connector", id: "x" });
    });
    return unsub;
  }, [ctx]);

  if (!settings?.x?.enabled) return null;

  const isConfigured = canRead || canPost;
  const statusText = loading
    ? t("sidebar.detecting")
    : !isConfigured
      ? t("sidebar.clickConfig")
      : canPost
        ? t("sidebar.readWriteHub")
        : t("sidebar.readOnlyHub");

  const openHub = () => {
    if (!isConfigured) {
      ctx.openOverlay("settings", { topicId: "topmind-x.settings" });
      return;
    }
    ctx.navigate({ kind: "connector", id: "x" });
  };

  return (
    <div className="group relative flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] p-2 transition-colors hover:bg-surface-muted">
      <Tooltip content={isConfigured ? t("sidebar.openHubTooltip") : t("sidebar.configBearer")}>
        <div
          onClick={() => openHub()}
          className="flex flex-1 cursor-pointer select-none items-center gap-2.5 truncate"
        >
          {loading ? (
            <Loader2 size={ICON.xs} className="shrink-0 animate-spin text-text-tertiary" />
          ) : (
            <Twitter size={ICON.xs} className="shrink-0 text-text-tertiary" />
          )}
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-3xs font-medium text-text-primary">X / Twitter</span>
            <span className="truncate text-3xs text-text-quaternary">{statusText}</span>
          </div>
        </div>
      </Tooltip>
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {canPost ? (
          <Tooltip content={t("sidebar.composePost")}>
            <button
              type="button"
              aria-label={t("sidebar.composePost")}
              onClick={(e) => {
                e.stopPropagation();
                ctx.navigate({ kind: "connector", id: "x" });
                ctx.events.emit("x:open-prompt", { mode: "post" });
              }}
              className="rounded-[var(--radius-sm)] p-1 text-text-tertiary transition-colors hover:bg-surface-active v4-focus-ring hover:text-text-primary"
            >
              <Send size={ICON.micro} />
            </button>
          </Tooltip>
        ) : null}
        {isConfigured ? (
          <Tooltip content={t("sidebar.openHub")}>
            <button
              type="button"
              aria-label={t("sidebar.openHub")}
              onClick={(e) => {
                e.stopPropagation();
                openHub();
              }}
              className="rounded-[var(--radius-sm)] p-1 text-text-tertiary transition-colors hover:bg-surface-active v4-focus-ring hover:text-text-primary"
            >
              <ExternalLink size={ICON.micro} />
            </button>
          </Tooltip>
        ) : null}
        <Tooltip content={t("sidebar.settings")}>
          <button
            type="button"
            aria-label={t("sidebar.settings")}
            onClick={(e) => {
              e.stopPropagation();
              ctx.openOverlay("settings", { topicId: "topmind-x.settings" });
            }}
            className="rounded-[var(--radius-sm)] p-1 text-text-tertiary transition-colors hover:bg-surface-active v4-focus-ring hover:text-text-primary"
          >
            <Settings size={ICON.micro} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
