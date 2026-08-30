/**
 * Dedicated plugin mini-app surface. Opens from the header Apps 菜单 or
 * plugin actions; close returns to the main canvas (view-store contract).
 */
import { useTranslation } from "react-i18next";
import { Puzzle, X } from "lucide-react";
import { useViewStore } from "../../stores/view-store";
import { useRegistry } from "../../plugins/registry";
import { Button } from "../ui/Button";
import { ICON } from "../../lib/icons";

export function PluginAppSurface() {
  const { t } = useTranslation("overlays");
  const pluginId = useViewStore((s) => s.overlayContext?.pluginId || "");
  const closeOverlay = useViewStore((s) => s.closeOverlay);
  const overlaySlots = useRegistry((s) => s.overlaySlots);

  const slot =
    overlaySlots.find((s) => {
      try {
        return s.matches(`plugin-app:${pluginId}`);
      } catch {
        return false;
      }
    }) || overlaySlots.find((s) => s.pluginId === pluginId);

  if (slot) {
    return <>{slot.render()}</>;
  }

  return (
    <div className="v4-overlay-sheet flex max-h-[min(88vh,640px)] w-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-5 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="v4-icon-chip flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] text-text-tertiary">
            <Puzzle size={ICON.sm} />
          </span>
          <h2 className="truncate text-sm font-semibold text-text-primary">{pluginId || t("pluginApp.title")}</h2>
        </div>
        <Button variant="ghost" size="sm" onClick={closeOverlay} aria-label={t("pluginApp.close")}>
          <X size={ICON.sm} />
        </Button>
      </div>
      <div className="px-5 py-8 text-center text-3xs text-text-tertiary">{t("pluginApp.missing")}</div>
    </div>
  );
}
