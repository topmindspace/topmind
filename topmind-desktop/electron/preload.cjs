/** v4 Preload — minimal RPC bridge. 2 functions replace 50+. */
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("topmind", {
  invoke: (method, params) => ipcRenderer.invoke("rpc:invoke", method, params),
  subscribe: (event, handler) => {
    const wrapped = (_e, payload) => handler(payload);
    ipcRenderer.on(event, wrapped);
    return () => ipcRenderer.removeListener(event, wrapped);
  },
  // Resolve the absolute disk path of a dragged File (Electron 32+ removed
  // File.path); used by the OS file-drop importer.
  getPathForFile: (file) => webUtils.getPathForFile(file),
});
