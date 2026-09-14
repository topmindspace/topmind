/**
 * Per-platform window shell policy — single source of truth for OS chrome.
 *
 * | Platform | Frame           | Title bar                      | In-window menu bar      |
 * |----------|-----------------|--------------------------------|-------------------------|
 * | macOS    | frameless inset | traffic lights inside our 44px | no (system menu bar)    |
 * | Windows  | native frame    | OS title bar                   | yes (native)            |
 * | Linux    | native frame    | DE title bar                   | yes (native)            |
 *
 * Why macOS keeps `hiddenInset`: its traffic lights sit at x≈12 and we already
 * own the whole header row, so inset chrome reads as one integrated bar.
 *
 * Why Windows/Linux do NOT use an overlay: overlay caption buttons are painted
 * *over* app content and permanently reserve a corner of the rightmost column —
 * a standing tax on the AI workspace tab row, and a class of bug that only shows
 * up visually (a green quality gate never notices a clipped tab). A native frame
 * costs ~31px of OS title bar and deletes the entire failure mode.
 *
 * macOS returns `frame: null` (not `false`) on purpose: `titleBarStyle` and an
 * explicit `frame` flag are not meant to be combined, and shipping a behaviour
 * change to the one platform that already looks right would be churn.
 */

/** @typedef {{ frame: boolean|null, titleBarStyle: 'default'|'hiddenInset', autoHideMenuBar: boolean, trafficLightPosition?: { x: number, y: number } }} WindowShell */

/**
 * @param {{ platform?: string, forFloat?: boolean }} [opts]
 * @returns {WindowShell}
 */
export function resolveWindowShell(opts = {}) {
  const platform = opts.platform ?? process.platform;
  const forFloat = Boolean(opts.forFloat);

  if (platform === "darwin") {
    return {
      frame: null,
      titleBarStyle: "hiddenInset",
      // macOS renders the app menu in the system bar; nothing to auto-hide.
      autoHideMenuBar: false,
      ...(forFloat ? { trafficLightPosition: { x: 12, y: 10 } } : {}),
    };
  }

  return {
    frame: true,
    titleBarStyle: "default",
    // Main window: keep the native menu bar visible — it is now the discoverable
    // home for theme / language / view / workspace actions (see menu-spec.mjs).
    // Float capture window: the application menu bar is global on Windows/Linux
    // and would otherwise be drawn across a 480px sticky note, so keep it hidden.
    autoHideMenuBar: forFloat,
  };
}

/**
 * Spreadable BrowserWindow subset. Omits `frame` on macOS instead of sending a
 * value that would fight `titleBarStyle`.
 * @param {{ platform?: string, forFloat?: boolean }} [opts]
 */
export function windowShellOptions(opts = {}) {
  const shell = resolveWindowShell(opts);
  const { frame, ...rest } = shell;
  return { ...(frame === null ? {} : { frame }), ...rest };
}

/** True when the OS draws the window frame (so the app must not fake one). */
export function usesNativeFrame(opts = {}) {
  return resolveWindowShell(opts).frame === true;
}
