/**
 * Workspace switching side effects — shared by the sidebar workspace menu and
 * the native application menu (工作区 → 打开/切换/最近/关闭).
 *
 * A workspace switch is not a soft navigation: the desktop state cache, the
 * settings cache and every cached listing belong to the previous root, so the
 * window reloads. Keeping the sequence in one place means the two entry points
 * can't drift into "menu switches but keeps stale data".
 */
import { setCachedSettings } from "./settings-cache";
import { invalidateWorkspaceDataCache } from "./workspace-data-cache";
import type { AppSettings } from "../types";

export function applyWorkspaceChange(settings?: AppSettings | null): void {
  try {
    if (settings) setCachedSettings(settings);
    else setCachedSettings(null);
  } catch {
    /* ignore */
  }
  try {
    invalidateWorkspaceDataCache();
  } catch {
    /* ignore */
  }
  window.setTimeout(() => window.location.reload(), 80);
}
