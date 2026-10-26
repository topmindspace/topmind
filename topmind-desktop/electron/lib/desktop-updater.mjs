/** Standard updater lifecycle. Injectable for execution-level tests. */
export function createDesktopUpdater(updater, { packaged = false } = {}) {
  let state = { supported: packaged, phase: "idle", progress: 0, version: null, error: null };
  let busy = false;
  if (packaged) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.on("checking-for-update", () => { state = { ...state, phase: "checking", error: null }; });
    updater.on("update-available", info => { state = { ...state, phase: "available", version: info.version }; });
    updater.on("update-not-available", () => { state = { ...state, phase: "current" }; });
    updater.on("download-progress", info => { state = { ...state, phase: "downloading", progress: Math.round(info.percent || 0) }; });
    updater.on("update-downloaded", info => { state = { ...state, phase: "ready", progress: 100, version: info.version }; });
    updater.on("error", () => { state = { ...state, phase: "error", error: "update-failed-use-manual-download" }; });
  }
  return {
    async run(action = "status") {
      if (!["status", "check", "download", "install"].includes(action)) throw new Error("invalid updater action");
      if (action === "status" || !packaged) return { ...state };
      if (busy) return { ...state };
      busy = true;
      try {
        if (action === "check") await updater.checkForUpdates();
        if (action === "download") {
          if (!["available", "ready"].includes(state.phase)) await updater.checkForUpdates();
          if (state.phase === "available") { state = { ...state, phase: "downloading" }; await updater.downloadUpdate(); }
        }
        if (action === "install") {
          if (state.phase !== "ready") throw new Error("update-not-downloaded");
          state = { ...state, phase: "restarting" };
          updater.quitAndInstall(false, true);
        }
      } catch { state = { ...state, phase: "error", error: "update-failed-use-manual-download" }; }
      finally { busy = false; }
      return { ...state };
    },
  };
}
