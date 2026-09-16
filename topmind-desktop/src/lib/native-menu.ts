/**
 * Native application menu bridge (renderer half).
 *
 * The menu lives in the main process, but the behavior behind it already exists
 * here. This module is the adapter, and it holds two invariants:
 *
 * 1. **Menu items run the same commands as the keyboard.** `app:command` ids
 *    either match a `WORKBENCH_SHORTCUTS` id (→ `runWorkbenchAction`) or one of
 *    the extra ids in `electron/lib/menu-spec.mjs`. No behavior is re-implemented.
 *
 * 2. **The menu never renders stale state.** Checkmarks and radio groups come
 *    from a snapshot the renderer pushes on every relevant change, so 显示侧栏 /
 *    专注模式 / 当前视图 stay truthful while the menu is open.
 *
 * Ownership split: main owns settings-derived fields (workspace, recents, theme,
 * locale — see `syncApplicationMenuFromSettings`); this module owns the UI-state
 * booleans that only exist in the view store.
 */
import { subscribe } from "../services/rpc";
import { useViewStore } from "../stores/view-store";
import { WORKBENCH_SHORTCUTS } from "./shortcuts";
import { runWorkbenchAction } from "./workbench-commands";
import { setLocalePreference, setThemePreference, type LocalePreference } from "./appearance";
import { applyWorkspaceChange } from "./workspace-switch";
import { api } from "../services/api";
import type { AiWorkspaceTab } from "../stores/view-store";
import type { Theme } from "./theme";

interface AppMenuCommand {
  id: string;
  /** `workspace.recent` payload */
  path?: string;
}

/** Extra commands that are not part of the keyboard registry. */
function runExtraCommand(cmd: AppMenuCommand): boolean {
  const store = useViewStore.getState();
  const { id } = cmd;

  if (id.startsWith("ai-tab.")) {
    const tab = id.slice("ai-tab.".length) as AiWorkspaceTab;
    // openAiWorkspace (not setAiWorkspaceTab) so the column opens and focus mode
    // steps aside — same door the 应用 command uses.
    store.openAiWorkspace(tab);
    return true;
  }

  switch (id) {
    case "view.zoom.in":
    case "view.zoom.out":
    case "view.zoom.reset":
      // Same call the Ctrl +/-/0 handler makes — one zoom owner per platform.
      void api.sys.zoom(id.slice("view.zoom.".length) as "in" | "out" | "reset");
      return true;
    case "theme.auto":
    case "theme.light":
    case "theme.dark":
      setThemePreference(id.slice("theme.".length) as Theme);
      return true;
    case "locale.auto":
    case "locale.zh-CN":
    case "locale.en-US":
      setLocalePreference(id.slice("locale.".length) as LocalePreference);
      return true;
    case "organize-week":
      // Same event the ⌘K 整理本周 command emits.
      void import("./organize-week").then(({ runOrganizeWeek }) => runOrganizeWeek());
      return true;
    case "help.about":
      // There is no standalone About overlay — 关于与更新 is a Settings tab.
      // Opening the Settings overlay at that tab keeps one surface, one door.
      store.openOverlay("settings", { topicId: "about" });
      return true;
    case "workspace.recent":
      void switchWorkspace(cmd.path);
      return true;
    case "workspace.open":
      void pickAndOpenWorkspace({ create: false });
      return true;
    case "workspace.create":
      void pickAndOpenWorkspace({ create: true });
      return true;
    case "workspace.close":
      void api.sys
        .closeWorkspace()
        .then((res) => applyWorkspaceChange(res?.settings ?? null))
        .catch(() => {});
      return true;
    case "workspace.refresh":
      window.location.reload();
      return true;
    default:
      return false;
  }
}

async function switchWorkspace(path?: string): Promise<void> {
  if (!path) return;
  try {
    const res = await api.sys.switchWorkspace(path);
    applyWorkspaceChange(res?.settings ?? null);
  } catch {
    // Missing / unreadable path: the main process prunes it from recents and
    // reports through the toast pipeline. Nothing to reload.
  }
}

/**
 * 打开工作区… / 新建工作区… — one folder picker, two intents.
 * `create` seeds a fresh workspace (categories + contract); otherwise an
 * existing folder is adopted as-is, falling back to init when it is empty.
 */
async function pickAndOpenWorkspace({ create }: { create: boolean }): Promise<void> {
  try {
    const { path } = await api.sys.pickWorkspaceFolder();
    if (!path) return;
    if (create) {
      await api.sys.createWorkspace(path);
      const res = await api.sys.switchWorkspace(path);
      applyWorkspaceChange(res?.settings ?? null);
      return;
    }
    try {
      const res = await api.sys.switchWorkspace(path);
      applyWorkspaceChange(res?.settings ?? null);
    } catch {
      const res = await api.sys.openOrCreateWorkspace(path);
      applyWorkspaceChange(res?.settings ?? null);
    }
  } catch {
    /* user cancelled or folder unusable — main surfaces the reason */
  }
}

/** Run a menu command. Returns false when the id is unknown to the renderer. */
export function runMenuCommand(cmd: AppMenuCommand): boolean {
  if (!cmd || typeof cmd.id !== "string") return false;
  const def = WORKBENCH_SHORTCUTS.find((s) => s.id === cmd.id);
  if (def) return runWorkbenchAction(def.action);
  return runExtraCommand(cmd);
}

/**
 * Serialize the view-store fields the menu renders.
 * Mirrors the shape main starts from in app-menu.mjs.
 */
function menuStateSnapshot() {
  const s = useViewStore.getState();
  return {
    focusMode: s.focusMode,
    sidebarCollapsed: s.sidebarCollapsed,
    aiPanelOpen: s.aiPanelOpen,
    aiWorkspaceTab: s.aiWorkspaceTab,
    view: s.selection.kind,
    sidebarView: s.sidebarView,
  };
}

function pushMenuState(): void {
  void api.sys.updateMenuState(menuStateSnapshot()).catch(() => {});
}

/**
 * Install the bridge. Returns a teardown function.
 * Mount once, from the shell — the menu outlives any single column.
 */
export function installNativeMenuBridge(): () => void {
  const offCommand = subscribe("app:command", (payload) => {
    const cmd = payload as AppMenuCommand | null;
    if (cmd) runMenuCommand(cmd);
  });

  // The store fires on every mutation — splitter drags alone would be dozens of
  // IPC calls and native menu rebuilds per second. Snapshot-diff + one frame of
  // coalescing keeps this at "only when a menu-visible field actually changed".
  let lastPushed = JSON.stringify(menuStateSnapshot());
  let frame = 0;
  const schedulePush = () => {
    if (frame) return;
    const raf =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (cb: () => void) => window.setTimeout(cb, 16);
    frame = raf(() => {
      frame = 0;
      const next = JSON.stringify(menuStateSnapshot());
      if (next === lastPushed) return;
      lastPushed = next;
      pushMenuState();
    });
  };

  const offStore = useViewStore.subscribe(schedulePush);
  // Push once up front so the first paint of the menu is truthful.
  pushMenuState();

  return () => {
    offCommand();
    offStore();
  };
}
