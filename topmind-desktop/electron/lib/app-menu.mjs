/**
 * Application menu wiring for topmind Desktop.
 *
 * Policy split (see `menu-spec.mjs` for the template itself):
 *
 * - **Windows** — the menu bar is hidden, not removed. The app owns the title bar
 *   row, so it draws an in-row strip of top-level labels and clicking one asks
 *   main to pop the *real* native submenu (`popupMenuSection`). The application
 *   menu stays installed, so every accelerator it owns keeps working, and Alt
 *   still reveals the native bar as a keyboard-only fallback for a menu whose
 *   visible form is app-drawn. Why one row beats a native bar on Windows (and why
 *   the reservation that broke the first overlay attempt cannot come back): the
 *   platform table in `window-shell.mjs`.
 * - **Linux** — a native frame plus the visible native menu bar; only the
 *   surrounding decorations come from the desktop environment.
 * - **macOS** — the menu bar is a system surface and is expected to be
 *   complete, so it carries the same actions plus the standard App menu. Nothing
 *   is drawn in-window there.
 *
 * The renderer owns in-window chords; menu items therefore emit ids rather than
 * re-implementing behavior, and chords are display-only off macOS
 * (`registerAccelerator: false`).
 */
import { createRequire } from "node:module";
import path from "node:path";
import { t } from "./electron-i18n.mjs";
import { buildMenuTemplate } from "./menu-spec.mjs";

const require = createRequire(import.meta.url);
const { Menu, app, clipboard, shell } = require("electron");

/**
 * Latest snapshot of renderer state that the menu renders checkmarks from.
 * Owned by main; written through `updateApplicationMenuState`.
 * @type {{
 *   workspaceRoot: string | null,
 *   recentWorkspaces: Array<{ name?: string, path: string }>,
 *   theme?: string,
 *   locale?: string,
 *   focusMode?: boolean,
 *   sidebarCollapsed?: boolean,
 *   aiPanelOpen?: boolean,
 *   aiWorkspaceTab?: string,
 *   view?: string,
 *   sidebarView?: string,
 *   fullscreen?: boolean,
 * }}
 */
let menuState = {
  workspaceRoot: null,
  recentWorkspaces: [],
  theme: "auto",
  locale: "auto",
  focusMode: false,
  sidebarCollapsed: false,
  aiPanelOpen: false,
  aiWorkspaceTab: "chat",
  view: "stream",
  sidebarView: "stream",
  fullscreen: false,
};

/** @type {((command: { id: string, [k: string]: unknown }) => void) | null} */
let commandSink = null;
/** @type {Record<string, (payload?: unknown) => void>} */
let localActions = {};
/** Rebuild suppression — a burst of state patches rebuilds once. */
let rebuildScheduled = false;

/**
 * The installed application menu, kept so the Windows title-bar strip can pop a
 * real native submenu by top-level id (`Menu.popup`) instead of reimplementing
 * one. Null until the first install — before that the strip has nothing to show.
 * @type {import('electron').Menu | null}
 */
let currentMenu = null;

/** @type {((items: Array<{ id: string, label: string }>) => void) | null} */
let topLevelSink = null;
/** Last published top-level list — labels only change with the app locale. */
let lastTopLevelJson = "";
/**
 * Mirror of `topLevelSink` for the *popup* half of the strip: reports which
 * section's submenu is on screen. Separate from `popupOpenId` — that is the
 * state, this is the channel that carries it across to the renderer. Assigning
 * to this without a declaration here is a hard `ReferenceError` under the ESM
 * strict-mode rules, which is how the 4.2.0 build died before its window
 * opened; `tests/electron-module-load.test.mjs` now loads every module for real.
 * @type {((state: { openId: string | null }) => void) | null}
 */
let popupSink = null;

/**
 * Clicking the strip item whose menu is already open must close it rather than
 * reopen: the mousedown closes the popup first (focus loss), so by the time the
 * click reaches us the popup is already gone. The timestamp is what tells
 * "closed by this very click" apart from "opened again on purpose".
 */
const TOGGLE_GUARD_MS = 250;
let popupOpenId = null;
let lastClosedId = null;
let popupClosedAt = 0;
/**
 * The Menu instance currently on screen. Kept so hover-switching can close the
 * *previous* section: closing "the new one" would leave the old popup up.
 * @type {import('electron').Menu | null}
 */
let openSubmenu = null;

export function getApplicationMenuState() {
  return { ...menuState };
}

/**
 * Top-level entries as the in-row menu strip needs them: id + already-localized
 * label, in template order. Windows/Linux render exactly this list — the strip
 * never hardcodes 文件/编辑/… so a new top-level menu appears without a renderer
 * change, and macOS (system menu bar) simply ignores it.
 * @returns {Array<{ id: string, label: string }>}
 */
export function getMenuTopLevel() {
  if (!currentMenu) return [];
  return currentMenu.items
    .filter((item) => Boolean(item.id))
    .map((item) => ({ id: item.id, label: item.label }));
}

/**
 * Register the single outbound channel for menu → renderer commands.
 * @param {(command: { id: string, [k: string]: unknown }) => void} sink
 */
export function setMenuCommandSink(sink) {
  commandSink = sink;
}

/**
 * Register main-process-only handlers (open logs, reveal workspace, …).
 * @param {Record<string, (payload?: unknown) => void>} actions
 */
export function setMenuLocalActions(actions) {
  localActions = actions;
}

function send(command) {
  if (typeof commandSink === "function") commandSink(command);
}

function local(action, payload) {
  const handler = localActions[action];
  if (typeof handler === "function") handler(payload);
}

/**
 * Merge a renderer state patch and rebuild the menu.
 * @param {object} patch
 * @param {{ rebuild?: boolean }} [opts]
 */
export function updateApplicationMenuState(patch, opts = {}) {
  if (!patch || typeof patch !== "object") return getApplicationMenuState();
  menuState = { ...menuState, ...patch };
  if (opts.rebuild === false) return getApplicationMenuState();
  scheduleMenuRebuild();
  return getApplicationMenuState();
}

/** Coalesce rebuilds so a renderer state burst doesn't rebuild N times. */
function scheduleMenuRebuild() {
  if (rebuildScheduled) return;
  rebuildScheduled = true;
  setImmediate(() => {
    rebuildScheduled = false;
    // `Menu.setApplicationMenu` is only legal once the app is ready. Boot writes
    // to app-settings can land first (initApp runs ahead of the menu wiring) —
    // the ready-time `syncApplicationMenuFromSettings` is what installs then.
    if (!app.isReady()) return;
    installApplicationMenu();
  });
}

/**
 * Build + install the application menu for the current platform.
 * @param {{ isDev?: boolean }} [opts]
 */
export function installApplicationMenu(opts = {}) {
  const isDev = Boolean(opts.isDev ?? !app.isPackaged);
  const template = buildMenuTemplate({
    platform: process.platform,
    isDev,
    appName: app.name || "topmind",
    state: menuState,
    t,
    send,
    local,
  });

  try {
    currentMenu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(currentMenu);
    publishTopLevel();
  } catch (err) {
    // A malformed template must not take the app down — the previous menu stays.
    // eslint-disable-next-line no-console
    console.error("[app-menu] failed to install application menu", err);
  }
}

/**
 * Register the channel that hands the strip its top-level entries. Called with
 * the full list whenever it actually changes (in practice: on locale switch).
 * @param {(items: Array<{ id: string, label: string }>) => void} sink
 */
export function setMenuTopLevelSink(sink) {
  topLevelSink = sink;
  // Publish immediately when a menu already exists: the sink is wired during the
  // ready sequence, which may run after the first install.
  publishTopLevel();
}

function publishTopLevel() {
  if (typeof topLevelSink !== "function") return;
  const items = getMenuTopLevel();
  const json = JSON.stringify(items);
  if (json === lastTopLevelJson) return;
  lastTopLevelJson = json;
  topLevelSink(items);
}

/**
 * Register the channel that reports which section popup is on screen, so the
 * strip can show the pressed state and hover-switch between sections. Main is the
 * authority here: it is the only side that knows a click closed a menu rather than
 * opened one.
 * @param {(state: { openId: string | null }) => void} sink
 */
export function setMenuPopupSink(sink) {
  popupSink = sink;
}

function publishPopupState() {
  if (typeof popupSink === "function") popupSink({ openId: popupOpenId });
}

/**
 * Pop the real native submenu for a top-level id, anchored under the strip item
 * the user clicked.
 *
 * The menu is not reimplemented anywhere: the strip only says *which* id was
 * clicked and *where*, and Electron renders the rest — items, accelerators,
 * checkmarks, submenus, disabled states — from the single template in
 * `menu-spec.mjs`. Two consequences worth knowing:
 *
 * - `x`/`y` arrive in CSS pixels (a `getBoundingClientRect()`). Popup positions
 *   are DIP, so they are scaled by the window's zoom factor — with ⌘+/Ctrl+ the
 *   UI zoomed, an unscaled anchor drifts.
 * - Re-popping while a popup is open is how hover-to-switch between top-level
 *   items works. The one case that must *not* re-pop is clicking the item that is
 *   already open (see TOGGLE_GUARD_MS).
 *
 * @param {string} id
 * @param {{ window?: import('electron').BrowserWindow | null, x?: number, y?: number }} [opts]
 * @returns {boolean} true when a popup was requested
 */
export function popupMenuSection(id, opts = {}) {
  const win = opts.window;
  if (!currentMenu || !win || win.isDestroyed?.()) return false;
  const item = currentMenu.items.find((entry) => entry.id === id);
  if (!item || !item.submenu) return false;

  const now = Date.now();
  if (openSubmenu === null && lastClosedId === id && now - popupClosedAt < TOGGLE_GUARD_MS) {
    // The user just closed this very menu by clicking its strip label — the
    // mousedown already did the closing, so reopening here would make the item
    // impossible to dismiss.
    publishPopupState();
    return true;
  }

  let zoom = 1;
  try {
    zoom = win.webContents.getZoomFactor() || 1;
  } catch {
    zoom = 1;
  }
  const x = Math.round(Number(opts.x) * zoom) || 0;
  const y = Math.round(Number(opts.y) * zoom) || 0;

  try {
    // Hover-switching between two open sections: drop the *previous* popup first,
    // otherwise the old menu stays up beside the new one.
    if (openSubmenu) {
      const previous = openSubmenu;
      openSubmenu = null;
      try {
        previous.closePopup(win);
      } catch {
        /* already dismissed by the click that got us here */
      }
    }

    const submenu = item.submenu;
    submenu.removeAllListeners("menu-will-close");
    submenu.once("menu-will-close", () => {
      if (openSubmenu === submenu) openSubmenu = null;
      popupOpenId = null;
      lastClosedId = id;
      popupClosedAt = Date.now();
      publishPopupState();
    });
    openSubmenu = submenu;
    popupOpenId = id;
    publishPopupState();
    submenu.popup({ window: win, x, y });
    return true;
  } catch (err) {
    openSubmenu = null;
    popupOpenId = null;
    publishPopupState();
    // eslint-disable-next-line no-console
    console.error("[app-menu] failed to pop menu section", id, err);
    return false;
  }
}

/** True while a section popup is on screen — used by tests and diagnostics. */
export function isMenuSectionOpen() {
  return popupOpenId !== null;
}

/**
 * Default main-process handlers for the template's `local()` actions.
 * Kept here so main.mjs only supplies what needs app state (workspace root).
 * @param {{ getWorkspaceRoot: () => string | null, toggleMaximize: () => void, closeWindow: () => void, globalCapture: () => void, checkUpdates: () => void | Promise<void>, docsUrl?: string }} ctx
 */
export function createDefaultMenuLocalActions(ctx) {
  return {
    "open-logs": () => {
      try {
        // Real sink is desktopStateHome/logs/main.log — not Electron's logs path
        // (app.setPath("userData") does not move getPath("logs")).
        const logFile = typeof ctx.getLogFilePath === "function" ? ctx.getLogFilePath() : null;
        const dir = logFile ? path.dirname(logFile) : null;
        void shell.openPath(dir || app.getPath("logs"));
      } catch {
        /* ignore */
      }
    },
    docs: () => {
      try {
        void shell.openExternal(ctx.docsUrl || "https://github.com/topmindspace/topmind");
      } catch {
        /* ignore */
      }
    },
    "reveal-workspace": () => {
      const root = ctx.getWorkspaceRoot();
      if (!root) return;
      shell.showItemInFolder(root);
    },
    "copy-workspace-path": () => {
      const root = ctx.getWorkspaceRoot();
      if (!root) return;
      clipboard.writeText(root);
    },
    "global-capture": () => ctx.globalCapture(),
    "check-updates": () => ctx.checkUpdates(),
    "toggle-maximize": () => ctx.toggleMaximize(),
    "close-window": () => ctx.closeWindow(),
  };
}
