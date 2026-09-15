/**
 * Windows OS chrome strip — one full-width row, outside product IA.
 *
 * Windows cannot merge the native HMENU into the caption (Electron exposes no
 * API for it). v4.2.0 solved that by painting the menu strip inside the center
 * column header, which mixed OS chrome into product chrome and violated the
 * design rule "操作系统外壳不占产品 IA".
 *
 * This strip is the fix: a dedicated row above the three workbench columns that
 * owns icon · app name · menu labels. The OS still paints min/max/close on its
 * right end (`titleBarOverlay` → `--wc-inset-right`). Menu *content* stays native
 * (`popMenuSection` → `Menu.popup`); column headers become pure product chrome
 * again.
 *
 * macOS / Linux return null: system menu bar (mac) / DE frame + native menu (Linux).
 */
import { AppMenuBar } from "./AppMenuBar";
import { usesCaptionOverlay } from "../../lib/platform";

export function OsChromeStrip() {
  if (!usesCaptionOverlay) return null;

  return (
    <header
      data-os-chrome
      className="v4-column-chrome v4-drag relative w-full shrink-0 select-none text-text-secondary"
      data-through-columns
    >
      <AppMenuBar />
    </header>
  );
}
