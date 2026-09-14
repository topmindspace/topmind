/**
 * Native application menu contracts.
 *
 * The menu is a second front-end for behavior that already exists in the
 * renderer, which is exactly where front-ends drift. These tests hold the two
 * seams that matter:
 *
 *  1. **Every menu item maps to a command someone actually handles.** Template
 *     ids must resolve to a `WORKBENCH_SHORTCUTS` id or to an extra id that
 *     `src/lib/native-menu.ts` implements. A menu item wired to nothing is a
 *     dead door that looks perfectly alive.
 *  2. **Chords are display-only off macOS.** Windows/Linux must not register the
 *     in-window chords, or the menu and the page both fire and a toggle
 *     (专注模式 / 显示侧栏) cancels itself out.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMenuTemplate, collectAccelerators, MENU_EXTRA_COMMANDS, MENU_LOCAL_ACTIONS } from "../electron/lib/menu-spec.mjs";
import { WORKBENCH_SHORTCUTS } from "../src/lib/shortcuts.ts";
import { t } from "../electron/lib/electron-i18n.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const STATE = {
  workspaceRoot: "/tmp/ws",
  recentWorkspaces: [{ path: "/tmp/a", name: "a" }, { path: "/tmp/b", name: "b" }],
  theme: "dark",
  locale: "zh-CN",
  focusMode: true,
  sidebarCollapsed: false,
  aiPanelOpen: true,
  aiWorkspaceTab: "todo",
  view: "inbox",
  sidebarView: "kanban",
};

function build(platform, state = STATE, isDev = false) {
  const sent = [];
  const local = [];
  const template = buildMenuTemplate({
    platform,
    isDev,
    appName: "topmind",
    state,
    t,
    send: (command) => sent.push(command),
    local: (action, payload) => local.push({ action, payload }),
  });
  return { template, sent, local };
}

/** Every submenu of the template, flattened, with labels for diagnostics. */
function flatten(template, trail = [], out = []) {
  for (const item of template) {
    const label = item.label || item.role || "(unlabeled)";
    out.push({ item, path: [...trail, label] });
    if (Array.isArray(item.submenu)) flatten(item.submenu, [...trail, label], out);
  }
  return out;
}

test("menu structure is identical on Windows and Linux and adds the App menu on macOS", () => {
  const win = build("win32").template.map((i) => i.label);
  const linux = build("linux").template.map((i) => i.label);
  assert.deepEqual(win, linux, "one template, no per-platform drift");
  assert.deepEqual(win, ["文件", "编辑", "工作区", "显示", "窗口", "帮助"]);

  const mac = build("darwin").template;
  assert.equal(mac[0].label, "topmind", "macOS leads with the App menu");
  // macOS moves 设置 into the App menu and drops the explicit 退出 entry
  const macFile = mac.find((i) => i.label === "文件").submenu.map((i) => i.label);
  assert.ok(!macFile.includes("退出"));
  assert.ok(!macFile.includes("设置…"));
});

test("the quick actions the user asked for are all reachable", () => {
  const { template } = build("win32");
  const labels = flatten(template).map((n) => n.item.label).filter(Boolean);

  for (const wanted of [
    "设置…",
    "外观",
    "跟随系统",
    "浅色",
    "深色",
    "语言",
    "简体中文",
    "English",
    "专注模式",
    "显示侧栏",
    "显示 AI 工作区",
    "打开工作区…",
    "新建工作区…",
    "切换工作区…",
    "最近打开",
    "关闭工作区",
    "在文件管理器中显示",
    "复制工作区路径",
    "动态",
    "Inbox",
    "交付",
    "归档",
    "侧栏视图",
    "看板",
    "最大化 / 还原",
    "关闭窗口",
  ]) {
    assert.ok(labels.includes(wanted), `menu is missing 「${wanted}」`);
  }
});

test("every emitted command id resolves to a handler", () => {
  const handledExtras = new Set([
    ...MENU_EXTRA_COMMANDS,
    ...WORKBENCH_SHORTCUTS.map((s) => s.id),
  ]);
  const nativeMenuSrc = read("src/lib/native-menu.ts");
  // Namespaced ids (ai-tab.chat …) are dispatched by prefix in the renderer.
  const handlesPrefix = (id) => {
    const head = id.split(".")[0];
    return nativeMenuSrc.includes(`startsWith("${head}.")`);
  };

  const emitted = new Set();
  for (const platform of ["win32", "linux", "darwin"]) {
    const { template, sent } = build(platform);
    for (const item of flatten(template)) {
      // Exercise each click so we observe the real command, not a regex guess.
      if (typeof item.item.click === "function") item.item.click();
    }
    for (const command of sent) emitted.add(command.id);
  }

  assert.ok(emitted.size >= 20, `expected a useful command surface, got ${emitted.size}`);
  const unresolved = [...emitted].filter(
    (id) => !handledExtras.has(id) && !handlesPrefix(id),
  );
  assert.deepEqual(
    unresolved,
    [],
    `menu commands with no renderer handler (dead doors): ${unresolved.join(", ")}`,
  );
  // And the reverse direction: a declared extra nobody references in the menu.
  const unusedExtras = MENU_EXTRA_COMMANDS.filter((id) => !emitted.has(id));
  assert.deepEqual(unusedExtras, [], `MENU_EXTRA_COMMANDS entries not wired to any item: ${unusedExtras.join(", ")}`);
});

test("local (main-process) actions are declared and wired in both directions", () => {
  // Same class of bug as a dead command id, one layer down: an action declared in
  // MENU_LOCAL_ACTIONS but never emitted is a handler nobody can reach, and a
  // local() call that no one declares is a click that silently does nothing —
  // app-menu.mjs looks the action up in a registry and returns on a miss.
  const emitted = new Set();
  for (const platform of ["win32", "linux", "darwin"]) {
    const { template, local } = build(platform);
    for (const node of flatten(template)) {
      if (typeof node.item.click === "function") node.item.click();
    }
    for (const entry of local) emitted.add(entry.action);
  }

  assert.deepEqual(
    MENU_LOCAL_ACTIONS.filter((a) => !emitted.has(a)),
    [],
    "MENU_LOCAL_ACTIONS entries with no menu item behind them",
  );
  assert.deepEqual(
    [...emitted].filter((a) => !MENU_LOCAL_ACTIONS.includes(a)),
    [],
    "menu items calling an undeclared local action (silent no-op on click)",
  );

  // Quit must stay a platform role on every platform — it owns the OS exit dialog
  // semantics, and a local() action would bypass them.
  for (const platform of ["win32", "linux", "darwin"]) {
    const roles = flatten(build(platform).template).map((n) => n.item.role);
    assert.ok(roles.includes("quit"), `${platform}: quit must be a role`);
  }
});

test("no two items claim the same accelerator", () => {
  for (const platform of ["win32", "linux", "darwin"]) {
    if (platform === "darwin") {
      // macOS App menu + role items bring their own chords (⌘Q, ⌘M, ⌘Z …) that
      // are not visible on the template, so only the win/linux menu is
      // exhaustively checkable here.
      continue;
    }
    const accels = collectAccelerators(build(platform).template);
    const seen = new Map();
    for (const { chord, label } of accels) {
      const key = chord.toLowerCase();
      assert.ok(
        !seen.has(key),
        `${platform}: 「${label}」 and 「${seen.get(key)}」 both claim ${chord} — first-wins makes one dead`,
      );
      seen.set(key, label);
    }
    assert.ok(accels.length >= 10, `expected the chord surface to stay wide, got ${accels.length}`);
  }
});

test("in-window chords are display-only off macOS, registered on macOS", () => {
  const winChords = collectAccelerators(build("win32").template);
  assert.ok(winChords.length > 0);
  for (const node of flatten(build("win32").template)) {
    if (!node.item.accelerator) continue;
    // `role` items get their accelerator from Electron — leave those alone.
    if (node.item.role) continue;
    assert.equal(
      node.item.registerAccelerator,
      false,
      `Windows item 「${node.item.label}」 must not register ${node.item.accelerator} — the renderer owns it`,
    );
  }

  for (const node of flatten(build("darwin").template)) {
    if (!node.item.accelerator || node.item.role) continue;
    // macOS menus always register; sending registerAccelerator there is noise.
    assert.equal(node.item.registerAccelerator, undefined);
  }
});

test("checkmarks mirror the state snapshot", () => {
  const nodes = flatten(build("win32").template);
  const checked = (label) => nodes.find((n) => n.item.label === label)?.item.checked;

  assert.equal(checked("专注模式"), true);
  assert.equal(checked("显示侧栏"), true);
  assert.equal(checked("显示 AI 工作区"), true);
  assert.equal(checked("深色"), true);
  assert.equal(checked("浅色"), false);
  assert.equal(checked("简体中文"), true);
  assert.equal(checked("Inbox"), true);
  assert.equal(checked("动态"), false);
  assert.equal(checked("看板"), true);
  assert.equal(checked("清单"), true);

  // And with the inverse state
  const flipped = flatten(
    build("win32", { ...STATE, focusMode: false, sidebarCollapsed: true, aiPanelOpen: false, view: "stream" }).template,
  );
  const checkedFlipped = (label) => flipped.find((n) => n.item.label === label)?.item.checked;
  assert.equal(checkedFlipped("专注模式"), false);
  assert.equal(checkedFlipped("显示侧栏"), false);
  assert.equal(checkedFlipped("显示 AI 工作区"), false);
  assert.equal(checkedFlipped("动态"), true);
});

test("workspace items disable cleanly when no workspace is open", () => {
  const nodes = flatten(build("win32", { ...STATE, workspaceRoot: null, recentWorkspaces: [] }).template);
  const at = (label) => nodes.find((n) => n.item.label === label)?.item;
  assert.equal(at("关闭工作区").enabled, false);
  assert.equal(at("在文件管理器中显示").enabled, false);
  assert.equal(at("复制工作区路径").enabled, false);
  assert.equal(at("重新载入工作区").enabled, false);
  // Open / create / switch stay available — that is how you get a workspace
  assert.equal(at("打开工作区…").enabled, undefined);
  assert.equal(at("切换工作区…").enabled, undefined);
  assert.equal(at("暂无最近工作区").enabled, false);
});

test("recent workspaces become real items carrying their path", () => {
  const { template, sent } = build("linux");
  const nodes = flatten(template);
  const recentParent = nodes.find((n) => n.item.label === "最近打开");
  const submenu = recentParent.item.submenu;
  assert.equal(submenu.length, 2);
  submenu[1].click();
  assert.deepEqual(sent.at(-1), { id: "workspace.recent", path: "/tmp/b" });
});

test("roles used are limited to ones that cannot fight the renderer", () => {
  // One build only: clicking nodes pushes into *this* build's `sent`.
  const { template, sent } = build("win32");
  const nodes = flatten(template);
  const roles = nodes.map((n) => n.item.role).filter(Boolean);

  // The allowlist is the point: every role registers its own accelerator with
  // the OS, invisibly. `resetZoom/zoomIn/zoomOut` own CmdOrCtrl+0/+/-, which the
  // renderer's useShellShortcuts already handles → two owners, one keypress
  // zooms twice. Zoom therefore goes through a renderer command instead.
  const allowed = new Set([
    "undo", "redo", "cut", "copy", "paste", "selectAll",
    "reload", "forceReload", "toggleDevTools", "togglefullscreen",
    "minimize", "quit", "help",
  ]);
  const unexpected = [...new Set(roles)].filter((r) => !allowed.has(r));
  assert.deepEqual(unexpected, [], `unvetted roles (check their accelerators): ${unexpected.join(", ")}`);
  assert.equal(roles.some((r) => /zoom/iu.test(r)), false, "zoom must not use accelerator-owning roles");

  // …and the zoom commands really exist as renderer-handled ids.
  for (const item of nodes) if (typeof item.item.click === "function") item.item.click();
  for (const id of ["view.zoom.in", "view.zoom.out", "view.zoom.reset"]) {
    assert.ok(sent.some((c) => c.id === id), `${id} must be emitted`);
  }
});

test("no menu item steals the close-tab chord", () => {
  // role:'close' would register ⌘W/Ctrl+W and silently take 关闭标签页 away from
  // the renderer — the app is tabbed, so ⌘W must stay a tab close.
  const nodes = flatten(build("win32").template);
  assert.equal(nodes.some((n) => n.item.role === "close"), false);
  assert.equal(collectAccelerators(build("win32").template).some((a) => /cmdorctrl\+w$/iu.test(a.chord)), false);
  // …and the renderer still owns it
  assert.ok(WORKBENCH_SHORTCUTS.some((s) => s.id === "close-tab"));
});

test("no explicit chord collides with a chord a role registers implicitly", () => {
  // The template cannot see role chords — Electron supplies them — so this is the
  // half of the duplicate-accelerator check the plain scan above cannot reach.
  // It matters on every platform: off macOS our own items are display-only, but a
  // `role` item still registers for real, and on macOS every item does.
  //
  // Defaults as documented for the Electron majors this app ships on. If an
  // upgrade moves one, this test failing is the signal — a menu chord that
  // first-wins against a role is a dead command, not a cosmetic issue.
  const ROLE_CHORDS = {
    undo: ["CmdOrCtrl+Z"],
    redo: ["CmdOrCtrl+Shift+Z"],
    cut: ["CmdOrCtrl+X"],
    copy: ["CmdOrCtrl+C"],
    paste: ["CmdOrCtrl+V"],
    selectAll: ["CmdOrCtrl+A"],
    reload: ["CmdOrCtrl+R"],
    forceReload: ["CmdOrCtrl+Shift+R"],
    toggleDevTools: ["CmdOrCtrl+Alt+I", "CmdOrCtrl+Shift+I", "F12"],
    togglefullscreen: ["Ctrl+CmdOrCtrl+F", "F11"],
    minimize: ["CmdOrCtrl+M"],
    quit: ["CmdOrCtrl+Q"],
    hide: ["CmdOrCtrl+H"],
    hideOthers: ["CmdOrCtrl+Alt+H"],
    unhide: [],
    // Explicitly accelerator-free: zoom / front / services / about / help, and
    // the macOS `editMenu` container (its children are listed individually above).
    zoom: [],
    front: [],
    services: [],
    help: [],
    editMenu: [],
  };

  // "Ctrl+CmdOrCtrl+F" mixes an alias and a concrete key, so normalise token-wise
  // instead of substring-replacing (which would mangle CommandOrControl twice).
  const MOD_ORDER = ["ctrl", "alt", "shift", "cmdorctrl"];
  const canonical = (chord) =>
    chord
      .split("+")
      .map((token) => {
        const low = token.trim().toLowerCase();
        if (["cmdorctrl", "commandorcontrol", "command", "cmd"].includes(low)) return "cmdorctrl";
        if (["ctrl", "control"].includes(low)) return "ctrl";
        if (["alt", "option"].includes(low)) return "alt";
        if (low === "plus") return "+";
        return low;
      })
      .sort((a, b) => MOD_ORDER.indexOf(a) - MOD_ORDER.indexOf(b))
      .join("+");

  for (const platform of ["win32", "linux", "darwin"]) {
    const { template } = build(platform);
    const nodes = flatten(template);
    const used = new Set(nodes.map((n) => n.item.role).filter(Boolean));
    const claimed = new Map();
    for (const role of used) {
      assert.ok(
        role in ROLE_CHORDS,
        `${platform}: role 「${role}」 is not in the chord table — add its default before shipping it`,
      );
      for (const chord of ROLE_CHORDS[role]) claimed.set(canonical(chord), role);
    }

    for (const node of nodes) {
      if (!node.item.accelerator || node.item.role) continue;
      const key = canonical(node.item.accelerator);
      const clash = claimed.get(key);
      assert.ok(
        !clash,
        `${platform}: 「${node.item.label}」 claims ${node.item.accelerator}, already owned by role 「${clash}」 — first-wins kills one of them`,
      );
    }
  }
});

test("every role item carries an app-language label", () => {
  // Electron localises role labels to the OS language. This app has its own 语言
  // switch, so an unlabelled role would render in a language the user did not
  // choose — most visible on macOS, whose App menu is entirely roles.
  for (const platform of ["win32", "linux", "darwin"]) {
    for (const node of flatten(build(platform).template)) {
      if (!node.item.role) continue;
      assert.ok(
        node.item.label,
        `${platform}: role 「${node.item.role}」 (${node.path.join(" › ")}) has no label — the OS would choose its language`,
      );
    }
  }
});

test("the global capture chord never diverges from the OS global shortcut", () => {
  // a mirror; if one side is retuned without the other, the menu advertises a
  // chord that opens nothing (or silently becomes a second owner of a chord some
  // other action needs).
  //
  // Read the chord from inside `registerGlobalShortcuts` rather than from the
  // `register()` call: main.mjs assigns it to a const first, then passes that
  // const (the literal is also reused in the log lines).
  const fn = /function registerGlobalShortcuts\(\)[\s\S]*?\n\}/u.exec(read("electron/main.mjs"))?.[0] ?? "";
  const registered = /"([^"]+)"/u.exec(fn)?.[1];
  assert.ok(registered, "main.mjs must register the global capture shortcut");
  const normalize = (s) => s.replaceAll("CommandOrControl", "CmdOrCtrl").toLowerCase();

  const at = (platform) =>
    flatten(build(platform).template).find((n) => n.item.label === t("menu.globalCapture"))?.item;

  for (const platform of ["win32", "linux"]) {
    const item = at(platform);
    assert.ok(item, `${platform}: 记一下（全局）must exist`);
    assert.equal(normalize(item.accelerator), normalize(registered));
    // The OS hotkey stays the owner; the menu only displays the chord.
    assert.equal(item.registerAccelerator, false);
    assert.equal(typeof item.click, "function", "the item itself must still work by mouse");
  }

  // macOS has no display-without-registering escape hatch, so it carries no
  // accelerator at all — that keeps the global hotkey the single owner.
  assert.equal(at("darwin").accelerator, undefined);
});

test("every main-process settings write goes through the one writer", () => {
  // The native menu (workspace / recents / theme / language) and the OS title bar
  // are derived from app-settings, and main.mjs replaces that object from ~8
  // places: boot, workspace activate, workspace close, bounds persist, UI zoom,
  // clip-bridge token, close-behavior choice, recent pruning. Every direct
  // assignment is a chance for the chrome to keep advertising the *previous*
  // workspace — 关闭工作区 still enabled, 最近打开 still listing the old roots,
  // title bar still naming the workspace the user just left.
  //
  // setAppSettings is the choke point. One assignment inside it, none outside.
  const src = read("electron/main.mjs");
  const direct = [...src.matchAll(/^[ \t]*appSettings = (?!null)/gmu)];
  assert.equal(
    direct.length,
    1,
    `expected exactly one direct appSettings write (inside setAppSettings), found ${direct.length} — route it through setAppSettings`,
  );

  const writer = /function setAppSettings\(next\)[\s\S]*?\n\}/u.exec(src)?.[0] ?? "";
  assert.ok(writer.includes("appSettings = next;"), "the one write belongs to setAppSettings");
  for (const signal of ["applyNativeWindowTheme", "syncApplicationMenuFromSettings"]) {
    assert.ok(writer.includes(signal), `setAppSettings must drive ${signal}`);
  }
  // Recents change on their own (a workspace switch rewrites the list without
  // necessarily changing the root), so the diff must cover them too.
  assert.ok(/recentChanged/u.test(writer), "setAppSettings must diff the recents list");

  // The two paths that used to bypass it, called out so they stay covered.
  for (const [name, pattern] of [
    ["activateWorkspace", /async function activateWorkspace\(candidate, opts = \{\}\)[\s\S]*?\n\}/u],
    ["closeWorkspace", /closeWorkspace: async \(\) => \{[\s\S]*?\n {4}\},/u],
  ]) {
    const body = pattern.exec(src)?.[0] ?? "";
    assert.ok(body, `${name} not found — did main.mjs get restructured?`);
    assert.ok(
      body.includes("setAppSettings("),
      `${name} must write through setAppSettings or the menu goes stale on a workspace switch`,
    );
  }
});
