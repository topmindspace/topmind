/**
 * Per-platform window shell policy — single source of truth for OS chrome.
 *
 * | Platform    | Frame           | Title bar row                    | Menu                  |
 * |-------------|-----------------|----------------------------------|-----------------------|
 * | macOS       | frameless inset | traffic lights inside our 44px   | system menu bar       |
 * | Windows     | native frame    | app-owned 44px; OS draws min/max | in-row strip → native |
 * |             |                 | /close over its right end        | popups                |
 * | Linux       | native frame    | DE title bar                     | native menu bar       |
 * | float mac   | frameless inset | traffic lights inside our 32px   | system menu bar       |
 * | float win   | frameless       | app-owned 32px header            | hidden (global)       |
 * | float linux | native frame    | DE title bar                     | hidden (global)       |
 *
 * **Why Windows became one row.** Windows draws the HMENU in its own strip
 * *below* the caption, and Electron exposes no API that merges the two. A visible
 * native menu bar therefore always costs a second ~20px row stacked on top of the
 * app's own 44px column chrome — 95px of chrome before any content, against 44px
 * on macOS, and it repeats identity the breadcrumb already carries. Owning the
 * title bar (`titleBarStyle: 'hidden'`) collapses icon / name / menu / breadcrumb
 * into that one row while the OS keeps drawing minimize / maximize / close through
 * `titleBarOverlay` — the caption buttons stay native, so snapping, resize borders
 * and hit-testing are unchanged. The menu becomes an app-drawn strip whose items
 * pop up the *real* native menu (`Menu.popup`), so no menu content is reimplemented.
 *
 * **Why that is safe now when the first attempt was not.** The earlier overlay
 * reserved a guessed width and lost the reservation to a `padding` shorthand
 * declared later in the stylesheet. The width is no longer guessed: the renderer
 * reads it from `navigator.windowControlsOverlay.getTitlebarAreaRect()` and
 * republishes it as `--wc-inset-right` on every `geometrychange` (see
 * `src/lib/window-controls.ts`), so DPI, scale factor and RTL take care of
 * themselves; and the reservation rule is a compound selector, so source order
 * cannot reset it. Both halves are asserted in `tests/window-shell.test.mjs`.
 *
 * **Why Linux stays native.** Decorations there belong to the desktop
 * environment, and whether an overlay is drawn at all depends on the DE and on
 * X11 vs Wayland. A reservation we cannot measure is exactly the failure mode
 * being removed here, so Linux keeps the frame — and the native menu bar — it has
 * always had.
 *
 * macOS keeps `hiddenInset`: its traffic lights sit inside our own header row and
 * read as one integrated bar already. It returns `frame: null` (not `false`) on
 * purpose — `titleBarStyle` and an explicit `frame` flag are not meant to be
 * combined, and shipping a behaviour change to the one platform that already
 * looks right would be churn.
 */

/**
 * Height of the app-owned title bar row, in DIP.
 *
 * MUST equal `--density-chrome-y` in `src/styles/tokens.css`: the overlay strip
 * the OS paints the caption buttons into is the *same* row our header occupies,
 * so a mismatch shows up as buttons floating above or below the header baseline.
 * `tests/window-shell.test.mjs` asserts the two never drift apart.
 */
export const CHROME_ROW_HEIGHT = 44;

/** @typedef {'hiddenInset'|'hidden'|'default'} TitleBarStyle */
/** @typedef {{ frame: boolean|null, titleBarStyle: TitleBarStyle, autoHideMenuBar: boolean, titleBarOverlay: { height: number }|null, trafficLightPosition?: { x: number, y: number } }} WindowShell */

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
      titleBarOverlay: null,
      ...(forFloat ? { trafficLightPosition: { x: 12, y: 10 } } : {}),
    };
  }

  // The float capture window is a 480px sticky note that draws its own header row
  // on *every* platform — title text, an explicit close button, and a `v4-drag`
  // region that moves the window (see `src/components/overlays/QuickCapture.tsx`).
  // A native title bar stacked above that row is a second bar repeating identity
  // the row already carries ("topmind" over 快速捕获 + ✕).
  //
  // The application menu bar is global on Windows/Linux and would be drawn
  // straight across the note, so it stays hidden there.
  if (forFloat) {
    if (platform === "win32") {
      return {
        // `frame: false`, not `titleBarStyle: 'hidden'`: the note wants no caption
        // buttons either — the app's own ✕ is the only close affordance, and a
        // minimize button on a `skipTaskbar` sticky note would hide it with no way
        // back. Electron keeps `thickFrame` on for frameless Windows windows, so
        // the resize border and drop shadow survive.
        frame: false,
        titleBarStyle: "default",
        autoHideMenuBar: true,
        titleBarOverlay: null,
      };
    }
    // Linux keeps the desktop environment's decoration: the DE owns window chrome
    // there, and a frameless utility window is at the mercy of whatever the WM
    // chooses to do with it — the same reasoning as the main window below.
    return {
      frame: true,
      titleBarStyle: "default",
      autoHideMenuBar: true,
      titleBarOverlay: null,
    };
  }

  if (platform === "win32") {
    return {
      // `null` = omit the flag and let `titleBarStyle` decide; the native frame
      // (resize borders, shadow, snapping) is still there.
      frame: null,
      titleBarStyle: "hidden",
      // Hidden, not removed. The application menu stays installed, so every
      // accelerator it owns (F11 / Ctrl+R / Ctrl+Z…, see menu-spec.mjs) keeps
      // working; Alt still reveals the native bar as a keyboard-only fallback for
      // a menu whose visible form is app-drawn.
      autoHideMenuBar: true,
      titleBarOverlay: { height: CHROME_ROW_HEIGHT },
    };
  }

  return {
    frame: true,
    titleBarStyle: "default",
    autoHideMenuBar: false,
    titleBarOverlay: null,
  };
}

/**
 * Spreadable BrowserWindow subset. Omits `frame` when the policy is `null`
 * (macOS, and Windows' `titleBarStyle: 'hidden'`) instead of sending a value
 * that would fight `titleBarStyle`.
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

/**
 * True when the OS paints the caption buttons *over* our own header row, so the
 * renderer must reserve the space it reports. Windows-only by design — see the
 * Linux note above.
 * @param {{ platform?: string, forFloat?: boolean }} [opts]
 */
export function usesCaptionOverlay(opts = {}) {
  const shell = resolveWindowShell(opts);
  return shell.titleBarOverlay !== null;
}
