/**
 * Application menu wiring for topmind Desktop.
 *
 * Policy split (see `menu-spec.mjs` for the template itself):
 *
 * - **Windows** — a real native frame + visible native menu bar. The menu is
 *   the discoverable home for theme / language / view / workspace actions, and
 *   because the OS owns the caption buttons nothing is ever painted over app
 *   content (the failure this replaced: overlay caption buttons covering the AI
 *   workspace's 4th tab and the AI panel toggle).
 * - **Linux** — same native menu bar; only the surrounding frame comes from the
 *   desktop environment.
 * - **macOS** — the menu bar is a system surface and is expected to be
 *   complete, so it carries the same actions plus the standard App menu.
 *
 * The renderer owns in-window chords; menu items therefore emit ids rather than
 * re-implementing behavior, and chords are display-only off macOS
 * (`registerAccelerator: false`).
 */
import { createRequire } from "node:module";
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
};

/** @type {((command: { id: string, [k: string]: unknown }) => void) | null} */
let commandSink = null;
/** @type {Record<string, (payload?: unknown) => void>} */
let localActions = {};
/** Rebuild suppression — a burst of state patches rebuilds once. */
let rebuildScheduled = false;

export function getApplicationMenuState() {
  return { ...menuState };
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
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } catch (err) {
    // A malformed template must not take the app down — the previous menu stays.
    // eslint-disable-next-line no-console
    console.error("[app-menu] failed to install application menu", err);
  }
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
        void shell.openPath(app.getPath("logs"));
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
