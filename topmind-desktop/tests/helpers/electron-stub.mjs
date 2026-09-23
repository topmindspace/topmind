/**
 * An inert stand-in for the `electron` module, used when the main process is
 * loaded under plain Node.
 *
 * This is a real module file rather than a string embedded in the loader on
 * purpose: code inside a template literal is invisible to the type checker, the
 * dead-code scan and the undeclared-identifier check. Shipping a stub nobody
 * can check would repeat the mistake that made the 4.2.0 build a dead app.
 *
 * ## What it is
 *
 * Every method is a harmless no-op and every getter returns a benign value. The
 * goal is to get past module *loading*, not to simulate Electron: behaviour
 * belongs in a real test with a real double scoped to one module.
 *
 * `universal()` is the escape hatch for APIs nobody has needed yet. Without it,
 * a new `app.somethingNew()` call turns into "cannot read properties of
 * undefined" and looks like a regression in the code under test rather than a
 * gap in this file.
 */

const noop = () => {};
const asyncNoop = async () => {};

/**
 * Calls the boot sequence makes only when something has gone wrong.
 *
 * This is what turns "the module loaded" into "the module reached a window".
 * Main swallows its boot failures into `showBootError`, which logs and then
 * opens a native error box — so a process that dies before its first window
 * still exits 0 and still prints a green line. Recording the error box is how
 * `load-main-process-modules.mjs` notices.
 */
export const bootDiagnostics = {
  /** @type {Array<{ title: string, detail: string }>} */
  errorBoxes: [],
  quitCalls: 0,
  exitCalls: 0,
};

/**
 * A value that behaves like anything: callable, constructible, and
 * infinitely property-accessible. Cached, so `app.x === app.x`.
 *
 * Deliberately not thenable — `await` on any Electron surface would otherwise
 * resolve to a stub instead of the value the code is actually handling.
 */
let anywhere = null;
export function universal() {
  if (anywhere) return anywhere;
  const callable = function () {
    return universal();
  };
  anywhere = new Proxy(callable, {
    get(_target, key) {
      if (key === "then") return undefined;
      if (key === Symbol.iterator) return undefined;
      if (key === Symbol.toPrimitive) return () => "";
      if (key === "toString") return () => "[electron-stub]";
      if (key === "valueOf") return () => 0;
      if (key === "inspect" || key === Symbol.for("nodejs.util.inspect.custom")) {
        return () => "[electron-stub]";
      }
      return universal();
    },
    apply: () => universal(),
    construct: () => universal(),
    has: () => true,
  });
  return anywhere;
}

/**
 * Wrap a hand-written stub so APIs added later degrade instead of crashing.
 * Explicit members win — that is what keeps this file honest about the calls
 * the codebase makes today.
 */
function fallback(target) {
  return new Proxy(target, {
    get(obj, key) {
      if (key in obj) return obj[key];
      return universal();
    },
  });
}

/** The event-target surface every Electron object shares. */
function emitter() {
  return {
    on: noop,
    once: noop,
    off: noop,
    addListener: noop,
    removeListener: noop,
    removeAllListeners: noop,
    emit: noop,
    prependListener: noop,
    setMaxListeners: noop,
  };
}

export const clipboard = fallback({
  readText: () => "",
  writeText: noop,
  readHTML: () => "",
  writeHTML: noop,
  readImage: () => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) }),
  writeImage: noop,
  clear: noop,
  availableFormats: () => [],
});

export const shell = fallback({
  openExternal: asyncNoop,
  openPath: async () => "",
  showItemInFolder: noop,
  trashItem: asyncNoop,
  beep: noop,
});

export const dialog = fallback({
  showMessageBox: async () => ({ response: 0, checkboxChecked: false }),
  showMessageBoxSync: () => 0,
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  showOpenDialogSync: () => undefined,
  showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
  showSaveDialogSync: () => undefined,
  // Recorded, not ignored: main routes every boot failure through here.
  showErrorBox: (title, detail) => {
    bootDiagnostics.errorBoxes.push({ title: String(title), detail: String(detail) });
  },
});

export const app = fallback({
  ...emitter(),
  getPath: () => "/tmp/topmind-stub",
  getAppPath: () => "/tmp/topmind-stub",
  getName: () => "topmind",
  setName: noop,
  setPath: noop,
  getVersion: () => "0.0.0-stub",
  getLocale: () => "en-US",
  getSystemLocale: () => "en-US",
  getPreferredSystemLanguages: () => ["en-US"],
  getLocaleCountryCode: () => "US",
  setLocale: noop,
  isPackaged: false,
  quit: () => {
    bootDiagnostics.quitCalls += 1;
  },
  exit: () => {
    bootDiagnostics.exitCalls += 1;
  },
  relaunch: noop,
  whenReady: async () => {},
  setAppUserModelId: noop,
  requestSingleInstanceLock: () => true,
  releaseSingleInstanceLock: noop,
  setLoginItemSettings: noop,
  getLoginItemSettings: () => ({ openAtLogin: false }),
  setAboutPanelOptions: noop,
  showAboutPanel: noop,
  setAsDefaultProtocolClient: () => true,
  removeAsDefaultProtocolClient: () => true,
  isDefaultProtocolClient: () => false,
  decorateURL: (url) => url,
  setActivationPolicy: () => true,
  setBadgeCount: () => true,
  getBadgeCount: () => 0,
  addRecentDocument: noop,
  clearRecentDocuments: noop,
  getAppMetrics: () => [],
  enableSandbox: noop,
  disableHardwareAcceleration: noop,
  commandLine: {
    appendSwitch: noop,
    appendArgument: noop,
    hasSwitch: () => false,
    getSwitchValue: () => "",
  },
  dock: {
    show: noop,
    hide: noop,
    setBadge: noop,
    setIcon: noop,
    isVisible: () => true,
    setMenu: noop,
  },
});

export class BrowserWindow {
  constructor(options = {}) {
    this.options = options;
    Object.assign(this, emitter());
    this.webContents = {
      ...emitter(),
      send: noop,
      executeJavaScript: asyncNoop,
      getZoomFactor: () => 1,
      setZoomFactor: noop,
      openDevTools: noop,
      closeDevTools: noop,
      isDevToolsOpened: () => false,
      setWindowOpenHandler: noop,
      id: 1,
    };
  }

  static getAllWindows() {
    return [];
  }
  static getFocusedWindow() {
    return null;
  }
  static fromWebContents() {
    return null;
  }
  static fromId() {
    return null;
  }

  loadURL() {
    return Promise.resolve();
  }
  loadFile() {
    return Promise.resolve();
  }
  isDestroyed() {
    return false;
  }
  isMinimized() {
    return false;
  }
  isMaximized() {
    return false;
  }
  isFullScreen() {
    return false;
  }
  isVisible() {
    return true;
  }
  getBounds() {
    return { x: 0, y: 0, width: 1200, height: 800 };
  }
  getContentBounds() {
    return this.getBounds();
  }
  getTitlebarAreaRect() {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
}

// Window methods that exist purely to be called.
for (const method of [
  "minimize", "maximize", "unmaximize", "restore", "show", "hide", "focus",
  "blur", "close", "destroy", "setFullScreen", "setMenuBarVisibility",
  "setAutoHideMenuBar", "setTitleBarOverlay", "setWindowButtonVisibility",
  "setBackgroundColor", "setTitle", "setSize", "setPosition", "setMinimumSize",
  "setAlwaysOnTop", "setSkipTaskbar", "setVisibleOnAllWorkspaces",
  "setRepresentedFilename", "setDocumentEdited", "center",
  "setTrafficLightPosition", "setVibrancy", "setOpacity", "flashFrame",
  "previewFile", "moveTop",
]) {
  BrowserWindow.prototype[method] = noop;
}

const applicationMenuStub = () => ({
  items: [],
  popup: noop,
  closePopup: noop,
  getMenuItemById: () => null,
});

export const Menu = fallback({
  buildFromTemplate: applicationMenuStub,
  setApplicationMenu: noop,
  getApplicationMenu: () => null,
  sendActionToFirstResponder: noop,
});

export class MenuItem {
  constructor(options = {}) {
    this.options = options;
  }
}

export const ipcMain = fallback({
  ...emitter(),
  handle: noop,
  handleOnce: noop,
  removeHandler: noop,
});

export const nativeTheme = fallback({
  ...emitter(),
  themeSource: "system",
  shouldUseDarkColors: false,
  shouldUseHighContrastColors: false,
  shouldUseInvertedColorScheme: false,
});

export const globalShortcut = fallback({
  register: () => true,
  registerAll: noop,
  unregister: noop,
  unregisterAll: noop,
  isRegistered: () => false,
});

const primaryDisplay = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  workAreaSize: { width: 1920, height: 1040 },
  scaleFactor: 1,
  size: { width: 1920, height: 1080 },
};

/**
 * A NativeImage that reports itself as empty, so callers take their
 * "no bytes to show" branch instead of rendering a zero-sized bitmap.
 */
const emptyImage = fallback({
  isEmpty: () => true,
  getSize: () => ({ width: 0, height: 0 }),
  getAspectRatio: () => 1,
  resize: () => emptyImage,
  crop: () => emptyImage,
  setTemplateImage: noop,
  isTemplateImage: () => false,
  addRepresentation: noop,
  toPNG: () => Buffer.alloc(0),
  toJPEG: () => Buffer.alloc(0),
  toBitmap: () => Buffer.alloc(0),
  toDataURL: () => "data:image/png;base64,",
});

export const nativeImage = fallback({
  createEmpty: () => emptyImage,
  createFromPath: () => emptyImage,
  createFromBuffer: () => emptyImage,
  createFromBitmap: () => emptyImage,
  createFromDataURL: () => emptyImage,
  createFromNamedImage: () => emptyImage,
});

export const screen = fallback({
  ...emitter(),
  getPrimaryDisplay: () => primaryDisplay,
  getAllDisplays: () => [primaryDisplay],
  getDisplayNearestPoint: () => primaryDisplay,
  getDisplayMatching: () => primaryDisplay,
  getCursorScreenPoint: () => ({ x: 0, y: 0 }),
});

export class Tray {
  constructor() {
    Object.assign(this, emitter());
  }
}
for (const method of [
  "setToolTip", "setContextMenu", "setImage", "setTitle", "destroy", "popUpContextMenu",
]) {
  Tray.prototype[method] = noop;
}

export class Notification {
  constructor() {
    Object.assign(this, emitter());
  }
  static isSupported() {
    return false;
  }
}
Notification.prototype.show = noop;
Notification.prototype.close = noop;

const defaultSession = {
  ...emitter(),
  clearCache: asyncNoop,
  clearStorageData: asyncNoop,
  setPermissionRequestHandler: noop,
  setPermissionCheckHandler: noop,
  webRequest: { ...emitter() },
  cookies: { ...emitter(), get: async () => [], set: asyncNoop, remove: asyncNoop, flushStore: asyncNoop },
};

export const session = fallback({
  defaultSession,
  fromPartition: () => defaultSession,
  fromPath: () => defaultSession,
});

export const powerMonitor = fallback({
  ...emitter(),
  getSystemIdleTime: () => 0,
  getSystemIdleState: () => "active",
  isOnBatteryPower: () => false,
});

export const powerSaveBlocker = fallback({ start: () => 1, stop: noop, isStarted: () => false });

export const safeStorage = fallback({
  isEncryptionAvailable: () => false,
  encryptString: (value) => Buffer.from(String(value)),
  decryptString: (value) => Buffer.from(value).toString(),
  getSelectedStorageBackend: () => "unknown",
});

export const systemPreferences = fallback({
  getMediaAccessStatus: () => "not-determined",
  askForMediaAccess: async () => false,
  isDarkMode: () => false,
  getAccentColor: () => "0000ff",
  getColor: () => ({ red: 0, green: 0, blue: 0, alpha: 255 }),
  getUserDefault: () => undefined,
  setUserDefault: noop,
});

export const webContents = fallback({ getAllWebContents: () => [], getFocusedWebContents: () => null });

export const utilityProcess = fallback({
  fork: () => ({ ...emitter(), postMessage: noop, kill: noop }),
});

export const contextBridge = fallback({
  exposeInMainWorld: noop,
  exposeInIsolatedWorld: noop,
  executeInMainWorld: noop,
});

export const ipcRenderer = fallback({ ...emitter(), invoke: asyncNoop, send: noop, sendSync: () => undefined });

export const protocol = fallback({
  registerSchemesAsPrivileged: noop,
  handle: noop,
  unhandle: noop,
  registerFileProtocol: noop,
  registerStringProtocol: noop,
  registerBufferProtocol: noop,
  registerStreamProtocol: noop,
  unregisterProtocol: noop,
  isProtocolHandled: () => false,
});

export const net = fallback({
  request: () => ({ ...emitter(), end: noop, write: noop, abort: noop, setHeader: noop }),
  fetch: asyncNoop,
  isOnline: () => true,
  resolveHost: async () => ({ endpoints: [] }),
});

export const crashReporter = fallback({
  start: noop,
  getLastCrashReport: () => null,
  getUploadedReports: () => [],
  addExtraParameter: noop,
  removeExtraParameter: noop,
  getParameters: () => ({}),
});

export const inAppPurchase = fallback({
  canMakePayments: () => false,
  getProducts: async () => [],
  purchaseProduct: asyncNoop,
  finishAllTransactions: asyncNoop,
});

export const desktopCapturer = fallback({ getSources: async () => [] });

export default {
  app,
  BrowserWindow,
  Menu,
  MenuItem,
  ipcMain,
  clipboard,
  shell,
  dialog,
  nativeTheme,
  nativeImage,
  globalShortcut,
  screen,
  Tray,
  Notification,
  session,
  powerMonitor,
  powerSaveBlocker,
  safeStorage,
  systemPreferences,
  webContents,
  utilityProcess,
  contextBridge,
  ipcRenderer,
  protocol,
  net,
  crashReporter,
  inAppPurchase,
  desktopCapturer,
};
