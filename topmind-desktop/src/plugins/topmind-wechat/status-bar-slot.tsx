/**
 * StatusBar open control — visible whenever the optional 公众号创作 plugin is enabled.
 */
import { RiFileTextLine } from "@remixicon/react";
import { useTranslation } from "react-i18next";
import type { PluginContext, StatusBarSlot } from "../types";
import { useViewStore } from "../../stores/view-store";
import { Tooltip } from "../../components/ui/tooltip";
import { ICON } from "../../lib/icons";
import { WECHAT_CHROME_IDS, WECHAT_PLUGIN_ID, PLUGIN_APP_KIND } from "../../lib/plugin-launcher";

export function createWechatStatusBarSlot(_ctx: PluginContext): StatusBarSlot {
  return {
    kind: "statusBar",
    id: WECHAT_CHROME_IDS.statusBar,
    align: "right",
    order: 181,
    render: () => <WechatStatusBar />,
  };
}

function WechatStatusBar() {
  const { t } = useTranslation("wechat");
  const openOverlay = useViewStore((s) => s.openOverlay);
  const label = t("chromeOpen");
  return (
    <Tooltip content={t("chromeOpenTip")}>
      <button
        type="button"
        data-wechat-open
        aria-label={label}
        onClick={() => openOverlay(PLUGIN_APP_KIND, { pluginId: WECHAT_PLUGIN_ID })}
        className="flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary v4-focus-ring"
      >
        <RiFileTextLine size={ICON.micro} aria-hidden />
        <span className="hidden text-3xs sm:inline">{label}</span>
      </button>
    </Tooltip>
  );
}
