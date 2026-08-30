/**
 * StatusBar open control — visible whenever the optional 记账 plugin is enabled.
 */
import { Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PluginContext, StatusBarSlot } from "../types";
import { useViewStore } from "../../stores/view-store";
import { Tooltip } from "../../components/ui/tooltip";
import { ICON } from "../../lib/icons";
import { LEDGER_CHROME_IDS, LEDGER_PLUGIN_ID, PLUGIN_APP_KIND } from "../../lib/plugin-launcher";

export function createLedgerStatusBarSlot(_ctx: PluginContext): StatusBarSlot {
  return {
    kind: "statusBar",
    id: LEDGER_CHROME_IDS.statusBar,
    align: "right",
    order: 180,
    render: () => <LedgerStatusBar />,
  };
}

function LedgerStatusBar() {
  const { t } = useTranslation("ledger");
  const openOverlay = useViewStore((s) => s.openOverlay);
  const label = t("chromeOpen");
  return (
    <Tooltip content={t("chromeOpenTip")}>
      <button
        type="button"
        data-ledger-open
        aria-label={label}
        onClick={() => openOverlay(PLUGIN_APP_KIND, { pluginId: LEDGER_PLUGIN_ID })}
        className="flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary v4-focus-ring"
      >
        <Wallet size={ICON.micro} aria-hidden />
        <span className="hidden text-3xs sm:inline">{label}</span>
      </button>
    </Tooltip>
  );
}
