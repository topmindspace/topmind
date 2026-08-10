/**
 * Application menu policy for topmind Desktop.
 *
 * - macOS: keep minimal App + Edit + View + Window so clipboard/zoom and
 *   traffic-light behaviors stay native (custom titlebar is hiddenInset).
 *   App chrome actions live in TitleBar + ⌘K / workbench shortcuts — no File
 *   menu that would duplicate the custom UI.
 * - Windows / Linux: hide the menu bar entirely (Menu.setApplicationMenu(null)
 *   + autoHideMenuBar). Chromium still handles clipboard in inputs; app
 *   shortcuts are registered in the renderer OverlayHost.
 */
import { createRequire } from "node:module";
import { t } from "./electron-i18n.mjs";

const require = createRequire(import.meta.url);
const { Menu, app, shell } = require("electron");

/**
 * @param {{ isDev?: boolean, openLogs?: () => void }} [opts]
 */
export function installApplicationMenu(opts = {}) {
  const isDev = Boolean(opts.isDev);
  const isMac = process.platform === "darwin";

  if (!isMac) {
    // Explicit null — no File/Edit strip under custom chrome on Win/Linux.
    Menu.setApplicationMenu(null);
    return;
  }

  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    // Keep Edit for system clipboard (⌘C/V/A/Z) — required on macOS
    { role: "editMenu" },
    {
      label: t("menu.view"),
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        ...(isDev ? [{ role: "toggleDevTools" }] : []),
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: t("menu.window"),
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
      ],
    },
  ];

  if (isDev) {
    template.push({
      label: t("menu.develop"),
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        {
          label: t("menu.openLogs"),
          click: () => {
            try {
              if (typeof opts.openLogs === "function") opts.openLogs();
              else void shell.openPath(app.getPath("logs"));
            } catch {
              /* ignore */
            }
          },
        },
      ],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
