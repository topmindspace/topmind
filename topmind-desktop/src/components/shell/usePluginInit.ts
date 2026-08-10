import { useEffect, useState } from "react";
import { activateAll } from "../../plugins/host";
import { api } from "../../services/api";
import type { AppSettings } from "../../types";

/** Activate all plugins once per workspace root, then warm connector caches. */
export function usePluginInit(settings: AppSettings): void {
  const [pluginsActivated, setPluginsActivated] = useState(false);

  useEffect(() => {
    if (pluginsActivated) return;
    void activateAll({ workspaceRoot: settings.workspaceRoot }).then(() => setPluginsActivated(true));
  }, [pluginsActivated, settings.workspaceRoot]);

  // Warm WeRead stats cache in background (non-blocking, hub/status can read later)
  useEffect(() => {
    if (!pluginsActivated) return;
    if (!settings.weread?.enabled || !settings.weread?.apiKey) return;
    const t = setTimeout(() => {
      void api.weread.stats({ mode: "monthly", force: false }).catch(() => {});
    }, 2500);
    return () => clearTimeout(t);
  }, [pluginsActivated, settings.weread?.enabled, settings.weread?.apiKey]);
}
