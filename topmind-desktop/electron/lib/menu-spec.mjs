/**
 * Native application menu — pure template builder.
 *
 * Deliberately free of any `electron` import so plain `node --test` can assert
 * its shape (see tests/app-menu.test.mjs). `app-menu.mjs` owns the Electron
 * wiring (Menu.buildFromTemplate / setApplicationMenu / state store).
 *
 * Three rules this module exists to enforce:
 *
 * 1. **Menu items never re-implement product actions.** Every item that maps to
 *    something the app can already do emits the SAME id the renderer's keyboard
 *    layer uses (`src/lib/shortcuts.ts`). Clicking 专注模式 and pressing
 *    ⌘⌥F therefore run one code path, not two.
 *
 * 2. **In-window chords stay owned by the renderer on Windows/Linux.** There we
 *    pass `registerAccelerator: false`, which *displays* the chord without
 *    registering it — otherwise the native menu and the page would both fire and
 *    any toggle (专注模式 / 显示侧栏) would cancel itself out. macOS has no such
 *    escape hatch: its menus always register, and that is correct there, because
 *    macOS consumes the key equivalent before web content sees it, so exactly
 *    one handler runs.
 *
 * 3. **No duplicate accelerators.** Reload / zoom / fullscreen come from `role`s
 *    with overridden labels, and the old separate 开发 menu was folded into 帮助
 *    + 视图 precisely because it repeated three accelerators that 视图 owns.
 *    Off macOS a `role` owns its chord for real (there is no display-only mode
 *    for roles), so role defaults are compared against `WORKBENCH_SHORTCUTS` too
 *    — that is how `toggleDevTools` (Ctrl+Shift+I on Windows/Linux) was caught
 *    fighting the renderer's Inbox chord. See tests/app-menu.test.mjs.
 *
 * 4. **Every top-level menu carries a stable `id`.** Windows draws the menu on an
 *    app-owned title bar row: the strip is app-drawn and asks main to pop the real
 *    native submenu for the id it was clicked on (`Menu.popup`), so the menu content
 *    is still rendered once, natively. Ids are the only contract between the two.
 */

/** Top-level ids the template may use. Windows' in-row strip renders whatever
 * `menuTopLevel()` reports — it never hardcodes this list. */
export const MENU_TOP_LEVEL_IDS = ["app", "file", "edit", "workspace", "view", "window", "help"];

/** Renderer-owned command ids beyond the keyboard registry. Mirrored in src/lib/native-menu.ts. */
export const MENU_EXTRA_COMMANDS = [
  "ai-tab.chat",
  "ai-tab.suggest",
  "ai-tab.todo",
  "ai-tab.apps",
  "theme.auto",
  "theme.light",
  "theme.dark",
  "locale.auto",
  "locale.zh-CN",
  "locale.en-US",
  "workspace.open",
  "workspace.create",
  "workspace.recent",
  "workspace.close",
  "workspace.refresh",
  "organize-week",
  "view.zoom.in",
  "view.zoom.out",
  "view.zoom.reset",
  "help.about",
];

/** Main-process-only actions (no renderer round-trip needed). */
export const MENU_LOCAL_ACTIONS = [
  "open-logs",
  "docs",
  "reveal-workspace",
  "copy-workspace-path",
  "global-capture",
  "check-updates",
  "toggle-maximize",
  "close-window",
];

const sep = () => ({ type: "separator" });

const PRIMARY_VIEWS = [
  { kind: "stream", key: "menu.viewStream" },
  { kind: "inbox", key: "menu.viewInbox" },
  { kind: "outputs", key: "menu.viewOutputs" },
  { kind: "archive", key: "menu.viewArchive" },
];

const SIDEBAR_VIEWS = [
  { mode: "stream", key: "menu.sidebarStream", command: "sidebar-stream" },
  { mode: "category", key: "menu.sidebarCategory", command: "sidebar-category" },
  { mode: "timeline", key: "menu.sidebarTimeline", command: "sidebar-timeline" },
  { mode: "tags", key: "menu.sidebarTags", command: "sidebar-tags" },
  { mode: "kanban", key: "menu.sidebarKanban", command: "sidebar-kanban-digit" },
];

const AI_TABS = [
  { tab: "chat", key: "menu.aiChat" },
  { tab: "suggest", key: "menu.aiSuggest" },
  { tab: "todo", key: "menu.aiTodo" },
  { tab: "apps", key: "menu.aiApps" },
];

const THEMES = [
  { value: "auto", key: "menu.themeAuto", command: "theme.auto" },
  { value: "light", key: "menu.themeLight", command: "theme.light" },
  { value: "dark", key: "menu.themeDark", command: "theme.dark" },
];

const LOCALES = [
  { value: "auto", key: "menu.localeAuto", command: "locale.auto" },
  { value: "zh-CN", key: "menu.localeZh", command: "locale.zh-CN" },
  { value: "en-US", key: "menu.localeEn", command: "locale.en-US" },
];

/**
 * @param {{
 *   platform?: string,
 *   isDev?: boolean,
 *   appName?: string,
 *   state?: object,
 *   t: (key: string, vars?: Record<string, string|number>) => string,
 *   send: (command: { id: string, [k: string]: unknown }) => void,
 *   local: (action: string, payload?: unknown) => void,
 * }} opts
 * @returns {import('electron').MenuItemConstructorOptions[]}
 */
export function buildMenuTemplate(opts) {
  const {
    platform = process.platform,
    isDev = false,
    appName = "topmind",
    state = {},
    t,
    send,
    local,
  } = opts;

  const mac = platform === "darwin";
  const hasWorkspace = Boolean(state.workspaceRoot);
  const recent = Array.isArray(state.recentWorkspaces) ? state.recentWorkspaces : [];

  /**
   * `registerAccelerator: false` on Windows/Linux keeps the chord display-only
   * so the renderer stays the single owner of in-window key handling.
   */
  const chord = (accelerator) =>
    mac ? { accelerator } : { accelerator, registerAccelerator: false };

  /** Menu command item — clicking runs the same id the keyboard layer uses. */
  const cmd = (id, label, options = {}) => ({
    label,
    click: () => send({ id }),
    ...options,
  });

  const radio = (items) =>
    items.map((item) => ({
      type: "radio",
      label: t(item.key),
      checked: item.isChecked(state),
      click: () => send({ id: item.command }),
    }));

  // ── 文件 ────────────────────────────────────────────────────────────────
  const fileMenu = {
    label: t("menu.file"),
    submenu: [
      cmd("capture", t("menu.capture"), chord("CmdOrCtrl+N")),
      // Global capture is owned by `globalShortcut` in main.mjs
      // (registerGlobalShortcuts → CommandOrControl+Shift+N); this item only
      // mirrors the action so it is discoverable from the menu.
      //
      // Off macOS the chord is displayed but not registered
      // (`registerAccelerator: false`). macOS deliberately gets no accelerator:
      // Electron honours that flag on Linux/Windows only, so there the choice is
      // binary — show the chord and register a second owner, or show nothing.
      // We show nothing and keep the OS hotkey as the single owner; the chord is
      // still documented in-app (window.hideMacHint / tray hints name ⌘⇧N).
      //
      // Keep the chord in lockstep with main.mjs — asserted in
      // tests/app-menu.test.mjs.
      {
        label: t("menu.globalCapture"),
        click: () => local("global-capture"),
        ...(mac ? {} : chord("CmdOrCtrl+Shift+N")),
      },
      sep(),
      cmd("search", t("menu.search"), chord("CmdOrCtrl+P")),
      cmd("command-palette", t("menu.commandPalette"), chord("CmdOrCtrl+K")),
      sep(),
      cmd("organize-week", t("menu.organizeWeek")),
      ...(mac
        ? []
        : [
            sep(),
            cmd("settings", t("menu.settings"), chord("CmdOrCtrl+,")),
            sep(),
            { label: t("menu.exit"), role: "quit" },
          ]),
    ],
  };

  // ── 编辑 ────────────────────────────────────────────────────────────────
  // macOS keeps the `editMenu` role — it brings the complete native Edit menu
  // (dictation, emoji & symbols, the correct ⇧⌘Z redo pairing) — but the
  // menu-bar title still comes from the app locale rather than the OS.
  // Windows/Linux build it from our i18n table because Electron leaves role
  // labels in English off-macOS.
  const editMenu = mac
    ? { role: "editMenu", label: t("menu.edit") }
    : {
        label: t("menu.edit"),
        submenu: [
          { label: t("menu.undo"), role: "undo" },
          { label: t("menu.redo"), role: "redo" },
          sep(),
          { label: t("menu.cut"), role: "cut" },
          { label: t("menu.copy"), role: "copy" },
          { label: t("menu.paste"), role: "paste" },
          { label: t("menu.selectAll"), role: "selectAll" },
        ],
      };

  // ── 工作区 ──────────────────────────────────────────────────────────────
  const recentSubmenu = recent.length
    ? recent.map((entry) => ({
        label: entry.name || entry.path,
        toolTip: entry.path,
        click: () => send({ id: "workspace.recent", path: entry.path }),
      }))
    : [{ label: t("menu.recentEmpty"), enabled: false }];

  const workspaceMenu = {
    label: t("menu.workspace"),
    submenu: [
      cmd("workspace.open", t("menu.openWorkspace")),
      cmd("workspace.create", t("menu.createWorkspace")),
      cmd("workspace-switcher", t("menu.switchWorkspace"), chord("CmdOrCtrl+Shift+W")),
      { label: t("menu.recent"), submenu: recentSubmenu },
      sep(),
      cmd("workspace.refresh", t("menu.refreshWorkspace"), { enabled: hasWorkspace }),
      { label: t("menu.revealWorkspace"), enabled: hasWorkspace, click: () => local("reveal-workspace") },
      {
        label: t("menu.copyWorkspacePath"),
        enabled: hasWorkspace,
        click: () => local("copy-workspace-path"),
      },
      sep(),
      cmd("workspace.close", t("menu.closeWorkspace"), { enabled: hasWorkspace }),
    ],
  };

  // ── 视图 ────────────────────────────────────────────────────────────────
  const viewMenu = {
    label: t("menu.view"),
    submenu: [
      // Primary views reuse the keyboard registry ids verbatim (stream / inbox /
      // outputs / archive) — no third naming scheme for the same four targets.
      ...radio(
        PRIMARY_VIEWS.map((v) => ({
          key: v.key,
          command: v.kind,
          isChecked: (s) => s.view === v.kind,
        })),
      ),
      sep(),
      {
        label: t("menu.sidebarView"),
        submenu: radio(
          SIDEBAR_VIEWS.map((v) => ({
            key: v.key,
            command: v.command,
            isChecked: (s) => s.sidebarView === v.mode,
          })),
        ),
      },
      {
        label: t("menu.aiPanelTabs"),
        submenu: radio(
          AI_TABS.map((v) => ({
            key: v.key,
            command: `ai-tab.${v.tab}`,
            isChecked: (s) => s.aiWorkspaceTab === v.tab,
          })),
        ),
      },
      sep(),
      {
        type: "checkbox",
        label: t("menu.toggleSidebar"),
        checked: !state.sidebarCollapsed,
        ...chord("CmdOrCtrl+B"),
        click: () => send({ id: "toggle-sidebar" }),
      },
      {
        type: "checkbox",
        label: t("menu.toggleAi"),
        checked: Boolean(state.aiPanelOpen),
        ...chord("CmdOrCtrl+Alt+B"),
        click: () => send({ id: "toggle-ai-panel" }),
      },
      {
        type: "checkbox",
        label: t("menu.focusMode"),
        checked: Boolean(state.focusMode),
        ...chord("CmdOrCtrl+Alt+F"),
        click: () => send({ id: "focus-mode" }),
      },
      sep(),
      cmd("back", t("menu.back"), chord("CmdOrCtrl+[")),
      cmd("forward", t("menu.forward"), chord("CmdOrCtrl+]")),
      sep(),
      cmd("toggle-split", t("menu.split"), chord("CmdOrCtrl+\\")),
      cmd("task-panel", t("menu.taskPanel"), chord("CmdOrCtrl+Shift+J")),
      cmd("todo", t("menu.todo"), chord("CmdOrCtrl+Shift+T")),
      sep(),
      {
        label: t("menu.appearance"),
        submenu: radio(
          THEMES.map((v) => ({
            key: v.key,
            command: v.command,
            isChecked: (s) => (s.theme || "auto") === v.value,
          })),
        ),
      },
      {
        label: t("menu.language"),
        submenu: radio(
          LOCALES.map((v) => ({
            key: v.key,
            command: v.command,
            isChecked: (s) => (s.locale || "auto") === v.value,
          })),
        ),
      },
      {
        label: t("menu.zoom"),
        submenu: [
          cmd("view.zoom.reset", t("menu.resetZoom"), chord("CmdOrCtrl+0")),
          cmd("view.zoom.in", t("menu.zoomIn"), chord("CmdOrCtrl+Plus")),
          cmd("view.zoom.out", t("menu.zoomOut"), chord("CmdOrCtrl+-")),
        ],
      },
      sep(),
      // Reload is a rare recovery door; forceReload / DevTools stay out of the
      // everyday strip except in dev (F12 is the Windows convention).
      { label: t("menu.reload"), role: "reload" },
      ...(isDev
        ? [
            { label: t("menu.forceReload"), role: "forceReload" },
            { label: t("menu.devTools"), role: "toggleDevTools", accelerator: "F12" },
          ]
        : []),
      sep(),
      // Label mirrors the live window state (main owns it — the renderer never
      // pushes fullscreen through updateMenuState): macOS's own 全屏 menu item
      // flips to 退出全屏 the same way, and off macOS nothing else would tell
      // the user what the role's F11 / ⌃⌘F press is about to do.
      {
        label: state.fullscreen ? t("menu.exitFullscreen") : t("menu.fullscreen"),
        role: "togglefullscreen",
      },
    ],
  };

  // ── 窗口 ────────────────────────────────────────────────────────────────
  // No `role: 'close'` anywhere: it would claim ⌘W/Ctrl+W and silently take the
  // app's close-tab chord away from the renderer.
  const windowMenu = {
    label: t("menu.window"),
    submenu: [
      { label: t("menu.minimize"), role: "minimize" },
      ...(mac
        ? [{ label: t("menu.zoom"), role: "zoom" }]
        : [
            {
              label: t("menu.maximize"),
              click: () => local("toggle-maximize"),
            },
          ]),
      sep(),
      { label: t("menu.closeWindow"), click: () => local("close-window") },
      ...(mac ? [sep(), { label: t("menu.bringFront"), role: "front" }] : []),
    ],
  };

  // ── 帮助 ────────────────────────────────────────────────────────────────
  const helpMenu = {
    label: t("menu.help"),
    role: "help",
    submenu: [
      { label: t("menu.docs"), click: () => local("docs") },
      { label: t("menu.openLogs"), click: () => local("open-logs") },
      sep(),
      { label: t("menu.checkUpdates"), click: () => local("check-updates") },
      ...(mac ? [] : [sep(), cmd("help.about", t("menu.about"))]),
    ],
  };

  /**
   * macOS-only application menu.
   *
   * Every `role` here carries an explicit `label`. Electron localises role
   * labels to the *OS* language, but this app has its own 语言 switch — leaving
   * the App menu unlabelled gives a Chinese-speaking macOS user who set the app
   * to English a menu bar that is Chinese in exactly one place. Labels come from
   * the app locale instead, which is also the more honest reading: 语言 is an
   * in-app preference, so the menu should obey it, not the OS.
   *
   * 关于 deliberately does NOT use `role: 'about'`: that opens Electron's native
   * About panel, while every other platform routes to Settings → 关于与更新.
   * One product surface, one door — the native panel would be a second, poorer
   * copy of what that tab already shows (version + update check).
   */
  const appMenu = {
    label: appName,
    submenu: [
      { label: t("menu.about"), click: () => send({ id: "help.about" }) },
      { label: t("menu.checkUpdates"), click: () => local("check-updates") },
      sep(),
      cmd("settings", t("menu.settings"), chord("CmdOrCtrl+,")),
      sep(),
      { label: t("menu.services"), role: "services" },
      sep(),
      { label: t("menu.hide"), role: "hide" },
      { label: t("menu.hideOthers"), role: "hideOthers" },
      { label: t("menu.unhide"), role: "unhide" },
      sep(),
      { label: t("menu.quitApp"), role: "quit" },
    ],
  };

  /**
   * Top-level menus carry a stable id here, in one visible list, because the
   * Windows title-bar strip refers to them by id alone: it renders the labels main
   * reports and asks main to pop the matching submenu (`Menu.popup`). Declaring the
   * ids next to each other keeps the strip's contract readable — and an item that
   * forgets its id is a label that opens nothing.
   */
  const top = (id, menu) => ({ id, ...menu });

  return [
    ...(mac ? [top("app", appMenu)] : []),
    top("file", fileMenu),
    top("edit", editMenu),
    top("workspace", workspaceMenu),
    top("view", viewMenu),
    top("window", windowMenu),
    top("help", helpMenu),
  ];
}

/**
 * Collect every chord the template declares — used by tests to prove no two
 * items claim the same accelerator (a silent first-wins bug otherwise).
 * @param {import('electron').MenuItemConstructorOptions[]} template
 * @returns {Array<{ chord: string, label: string }>}
 */
export function collectAccelerators(template) {
  const out = [];
  const walk = (items) => {
    for (const item of items) {
      if (!item) continue;
      if (item.accelerator) out.push({ chord: item.accelerator, label: item.label || item.role || "" });
      if (Array.isArray(item.submenu)) walk(item.submenu);
    }
  };
  walk(template);
  return out;
}
