/**
 * X StatusBar — shows read/write capability; click opens hub.
 */
import { Twitter } from "lucide-react";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../services/api";
import type { PluginContext, StatusBarSlot } from "../types";
import { useViewStore } from "../../stores/view-store";
import { Tooltip } from "../../components/ui/tooltip";
import { ICON } from "../../lib/icons";

export function createXStatusBarSlot(_ctx: PluginContext): StatusBarSlot {
  return {
    kind: "statusBar",
    id: "topmind-x.statusbar",
    align: "right",
    order: 210,
    render: () => <XStatusBar />,
  };
}

function XStatusBar() {
  const { t } = useTranslation("x");
  const select = useViewStore((s) => s.select);
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => {
      void api.x
        .status()
        .then((s) => {
          if (!s.enabled && s.enabled !== undefined) {
            setLabel(null);
            return;
          }
          if (!s.ready) {
            setLabel(null);
            return;
          }
          if (s.canPost && s.canRead) setLabel(t("statusBar.readWrite"));
          else if (s.canRead) setLabel(t("statusBar.readOnly"));
          else if (s.canPost) setLabel(t("statusBar.canPost"));
          else setLabel(s.accessLayer || "on");
        })
        .catch(() => setLabel(null));
    };
    tick();
    const interval = setInterval(tick, 30_000);
    return () => clearInterval(interval);
  }, []);

  if (!label) return null;

  return (
    <Tooltip content={t("statusBar.openHub")}>
      <button
        type="button"
        onClick={() => select({ kind: "connector", id: "x" })}
        className="flex items-center gap-1 text-text-quaternary transition-colors hover:text-text-secondary"
      >
        <Twitter size={ICON.micro} />
        <span>X · {label}</span>
      </button>
    </Tooltip>
  );
}
