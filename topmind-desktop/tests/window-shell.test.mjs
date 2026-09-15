/**
 * OS window-chrome policy contracts.
 *
 * The accident these lock down: Windows once drew native caption buttons *over*
 * our own 44px column chrome via `titleBarOverlay`, and the CSS class reserving
 * the corner for them was declared above `.v4-column-chrome { padding: 0 8px }` —
 * at equal specificity the later shorthand won on source order, so the reservation
 * silently did nothing and the AI workspace's 4th tab and the AI panel toggle sat
 * under 最小化/最大化/关闭.
 *
 * The overlay is back on Windows on purpose (Electron cannot merge the native menu
 * bar into the caption row, so a visible native menu bar costs a second ~20px row
 * on top of ours). What must never come back is the *unmeasured* reservation, so
 * the contract now is:
 *
 *   1. macOS keeps inset traffic lights; Windows owns its title bar row with the
 *      OS overlaying the caption buttons; Linux keeps its native frame + menu bar.
 *   1b. The float capture window draws its own header on every platform, so Windows
 *      makes it frameless too; Linux keeps the DE's decoration.
 *   2. The reserved width is measured at runtime (`getTitlebarAreaRect`), never a
 *      literal pixel value, and the rule consuming it outranks `.v4-column-chrome`.
 *   3. The overlay's strip height equals the header row it sits in.
 *   4. Both halves of the policy (main + renderer) agree on which platforms apply.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHROME_ROW_HEIGHT,
  resolveWindowShell,
  windowShellOptions,
  usesNativeFrame,
  usesCaptionOverlay,
} from "../electron/lib/window-shell.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

test("macOS keeps inset traffic lights; Windows owns its title bar row", () => {
  const mac = resolveWindowShell({ platform: "darwin" });
  assert.equal(mac.titleBarStyle, "hiddenInset");
  // null (not false): titleBarStyle and an explicit frame flag must not fight
  assert.equal(mac.frame, null);
  assert.equal(mac.titleBarOverlay, null);
  assert.equal(usesNativeFrame({ platform: "darwin" }), false);
  assert.equal(usesCaptionOverlay({ platform: "darwin" }), false);

  // Windows: the app draws icon / name / menu / breadcrumb in the 44px row and the
  // OS paints min/max/close over its right end (titleBarOverlay).
  const win = resolveWindowShell({ platform: "win32" });
  assert.equal(win.titleBarStyle, "hidden");
  assert.equal(win.frame, null, "frame must be omitted, or it fights titleBarStyle");
  assert.ok(win.titleBarOverlay, "Windows must keep the native caption buttons");
  assert.equal(win.titleBarOverlay.height, CHROME_ROW_HEIGHT);
  assert.equal(usesCaptionOverlay({ platform: "win32" }), true);
  // Hidden, not removed: the application menu stays installed, so the accelerators
  // it owns (F11 / Ctrl+R / Ctrl+Z …) keep working and Alt still reveals it.
  assert.equal(win.autoHideMenuBar, true);
});

test("Linux keeps the native frame and its native menu bar", () => {
  // Electron's overlay depends on the DE and on X11 vs Wayland, and a reservation
  // we cannot measure is exactly the failure being removed — so Linux is untouched.
  const linux = resolveWindowShell({ platform: "linux" });
  assert.equal(linux.frame, true);
  assert.equal(linux.titleBarStyle, "default");
  assert.equal(linux.titleBarOverlay, null);
  assert.equal(linux.autoHideMenuBar, false);
  assert.equal(usesNativeFrame({ platform: "linux" }), true);
  assert.equal(usesCaptionOverlay({ platform: "linux" }), false);
});

test("the float capture window drops the redundant native title bar", () => {
  // The float draws its own header — title text, an explicit ✕, and a drag region —
  // on every platform, so an OS title bar above it is a second bar repeating the
  // same identity. macOS never had one (hiddenInset); Windows now matches. Linux
  // keeps the desktop environment's decoration, for the same reason the main window
  // does: the DE owns chrome there and an unmeasurable reservation is the bug.
  const macFloat = resolveWindowShell({ platform: "darwin", forFloat: true });
  assert.deepEqual(macFloat.trafficLightPosition, { x: 12, y: 10 });
  assert.equal(macFloat.titleBarStyle, "hiddenInset");
  assert.equal(macFloat.frame, null);

  const winFloat = resolveWindowShell({ platform: "win32", forFloat: true });
  assert.equal(winFloat.frame, false, "the Windows float must not add a native title bar");
  assert.equal(
    usesNativeFrame({ platform: "win32", forFloat: true }),
    false,
    "usesNativeFrame must agree — the app draws the float's chrome",
  );

  assert.equal(
    resolveWindowShell({ platform: "linux", forFloat: true }).frame,
    true,
    "the DE keeps owning the float's decoration on Linux",
  );

  for (const platform of ["darwin", "win32", "linux"]) {
    const float = resolveWindowShell({ platform, forFloat: true });
    assert.equal(float.titleBarOverlay, null, `${platform} float must not overlay`);
    assert.equal(
      usesCaptionOverlay({ platform, forFloat: true }),
      false,
      `${platform} float must not reserve a corner of a 480px note`,
    );
  }

  // The application menu bar is global on Windows/Linux — it must not be drawn
  // across the top edge of a sticky note. macOS has no window menu bar at all, so
  // there is nothing to hide there.
  for (const platform of ["win32", "linux"]) {
    assert.equal(
      resolveWindowShell({ platform, forFloat: true }).autoHideMenuBar,
      true,
      `${platform} float must hide the global menu bar`,
    );
  }
  assert.equal(resolveWindowShell({ platform: "darwin", forFloat: true }).autoHideMenuBar, false);

  // `frame: false` is only safe because the renderer supplies what the frame took
  // away: a drag region to move the window and a close button to dismiss it.
  const capture = read(join("src", "components", "overlays", "QuickCapture.tsx"));
  assert.match(capture, /v4-drag/u, "the float header must carry a drag region");
  assert.match(capture, /closeQuickCapture/u, "the float header must offer its own close");
});

test("windowShellOptions omits `frame` whenever titleBarStyle decides", () => {
  for (const platform of ["darwin", "win32"]) {
    assert.equal(
      "frame" in windowShellOptions({ platform }),
      false,
      `${platform} must not send an explicit frame alongside titleBarStyle`,
    );
  }
  assert.equal(windowShellOptions({ platform: "linux" }).frame, true);
  // Spreadable straight into `new BrowserWindow({...})`
  assert.equal(windowShellOptions({ platform: "win32" }).titleBarStyle, "hidden");
  // The helper strips `null` only — an explicit frameless policy must survive it,
  // or the float silently gets its title bar back.
  assert.equal(windowShellOptions({ platform: "win32", forFloat: true }).frame, false);
});

/**
 * `titleBarOverlay` is allowed in exactly two places: the policy that decides it,
 * and the theming that repaints it. Anywhere else it is a second copy of the
 * chrome policy — the seed of the next platform regression.
 */
test("the caption overlay is declared in the policy and painted in the theming only", () => {
  const allowed = new Set([
    join("electron", "lib", "window-shell.mjs"),
    join("electron", "lib", "window-theme.mjs"),
  ]);
  const files = [...walk(join(root, "src")), ...walk(join(root, "electron"))].filter((f) =>
    /\.(ts|tsx|css|mjs|cjs)$/u.test(f),
  );

  const hits = [];
  for (const file of files) {
    const rel = relative(root, file);
    if (allowed.has(rel)) continue;
    const src = stripComments(readFileSync(file, "utf8"));
    if (src.includes("titleBarOverlay")) hits.push(rel);
  }
  assert.deepEqual(hits, [], `titleBarOverlay outside the policy:\n${hits.join("\n")}`);

  // …and it really is wired on both ends.
  assert.match(read(join("electron", "lib", "window-theme.mjs")), /setTitleBarOverlay\(/u);
});

test("the overlay strip height matches the header row it sits in", () => {
  // Both numbers describe the same physical row: the OS paints the caption buttons
  // into the strip while we draw the header there. A drift shows up as buttons
  // floating above or below the header baseline, and no quality gate would see it.
  const tokens = read(join("src", "styles", "tokens.css"));
  const match = /--density-chrome-y:\s*(\d+)px/u.exec(tokens);
  assert.ok(match, "--density-chrome-y must be declared in tokens.css");
  assert.equal(
    Number(match[1]),
    CHROME_ROW_HEIGHT,
    `CHROME_ROW_HEIGHT (${CHROME_ROW_HEIGHT}px) must equal --density-chrome-y (${match[1]}px)`,
  );
});

test("the reserved corner is measured, never a literal width", () => {
  const controls = read(join("src", "lib", "window-controls.ts"));
  assert.match(controls, /getTitlebarAreaRect/u, "the inset must come from the OS geometry");
  assert.match(controls, /geometrychange/u, "and must follow the OS when it changes");
  assert.match(controls, /--wc-inset-right/u, "and must be published for CSS to consume");
  // A hardcoded caption width is the exact bug this replaced.
  assert.doesNotMatch(
    controls.replace(/\/\*[\s\S]*?\*\//gu, ""),
    /--wc-inset-(left|right)",\s*"\d+px/u,
    "no literal caption width may be published",
  );

  // The consuming rule must reference the measured variable and outrank
  // `.v4-column-chrome`, which declares `padding-right: 8px` ~850 lines later.
  const css = read(join("src", "styles", "v4.css"));
  const reservation = css.match(/html\[data-wc-inset[^{]*\{[^}]*\}/u)?.[0] || "";
  assert.ok(reservation, "the caption reservation rule must exist");
  assert.match(reservation, /padding-right:\s*max\(\s*8px,\s*var\(--wc-inset-right/u);
  assert.doesNotMatch(reservation, /padding-right:\s*\d+px/u);
  assert.match(
    css,
    /html\[data-wc-inset="ai"\] \[data-column-chrome="right"\]/u,
    "a compound selector, so source order cannot reset it",
  );
});

test("main and renderer agree on where the caption overlay applies", () => {
  // Two halves of one policy: if only one side flips, Windows either reserves space
  // for buttons that are not there or paints a strip nowhere to be seen.
  const renderer = read(join("src", "lib", "platform.ts"));
  assert.match(
    renderer,
    /export const usesCaptionOverlay = platform === "win32"/u,
    "renderer must mirror the Windows-only overlay rule",
  );
  for (const platform of ["darwin", "win32", "linux"]) {
    assert.equal(
      usesCaptionOverlay({ platform }),
      platform === "win32",
      `${platform} disagrees between window-shell.mjs and platform.ts`,
    );
  }
});

test("the title bar's app name matches the OS window title main sets", () => {
  // The row replaced the native title bar; the window title still feeds the
  // taskbar. If the two literals drift, the app answers to two different names.
  const identity = /export const APP_NAME = "([^"]+)"/u.exec(
    read(join("src", "lib", "app-identity.ts")),
  )?.[1];
  assert.ok(identity, "APP_NAME must be declared in src/lib/app-identity.ts");
  const main = read(join("electron", "main.mjs"));
  assert.match(
    main,
    new RegExp(`setTitle\\(name \\? \`${identity} — |setTitle\\("${identity}"\\)`, "u"),
    `main.mjs must title the window "${identity}" too`,
  );
});

/** Drop block + line comments so docs explaining the old approach don't trip the scan. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^\s*\/\/.*$/gmu, "");
}

test("column chrome uses padding longhands, not the shorthand", () => {
  // The shorthand is what silently reset the reservation in the first place.
  const css = read(join("src", "styles", "v4.css"));
  const rule = css.match(/^\.v4-column-chrome \{[\s\S]*?\n\}/mu)?.[0] || "";
  assert.ok(rule, ".v4-column-chrome rule must exist");
  assert.match(rule, /padding-left:\s*8px;/);
  assert.match(rule, /padding-right:\s*8px;/);
  assert.doesNotMatch(rule, /\n\s*padding:\s/u);
});

test("no single-class caption reservation survives", () => {
  // The old reservation was one class declared before `.v4-column-chrome`, so it
  // lost on source order. Names of that shape must not come back.
  const files = [...walk(join(root, "src"))].filter((f) => /\.(ts|tsx|css)$/u.test(f));
  const hits = [];
  for (const file of files) {
    const src = stripComments(readFileSync(file, "utf8"));
    for (const needle of ["v4-win-titlebar-pad", "v4-win-float-caption-pad", "titlebar-area-width"]) {
      if (src.includes(needle)) hits.push(`${relative(root, file)} → ${needle}`);
    }
  }
  assert.deepEqual(hits, [], `unmeasured caption reservations found:\n${hits.join("\n")}`);
});

test("both window factories take their chrome from the one policy", () => {
  // The float capture window used to carry its own `titleBarStyle` branch and its
  // own Windows caption overlay — a second copy of the same policy, which is how
  // the float kept the very bug the main window had just dropped. These keys now
  // live in exactly one file; a stray copy is the seed of the next regression.
  const POLICY = join("electron", "lib", "window-shell.mjs");
  const files = [...walk(join(root, "src")), ...walk(join(root, "electron"))].filter(
    (f) => /\.(ts|tsx|mjs|cjs)$/u.test(f) && relative(root, f) !== POLICY,
  );

  const strays = [];
  for (const file of files) {
    const src = stripComments(readFileSync(file, "utf8"));
    for (const key of ["titleBarStyle", "trafficLightPosition", "autoHideMenuBar"]) {
      if (new RegExp(`\\b${key}\\b`, "u").test(src)) strays.push(`${relative(root, file)} → ${key}`);
    }
  }
  assert.deepEqual(
    strays,
    [],
    `OS-chrome keys outside ${POLICY} (import windowShellOptions instead):\n${strays.join("\n")}`,
  );

  // …and both windows actually consume the policy rather than omitting chrome keys.
  for (const rel of [join("electron", "main.mjs"), join("electron", "lib", "quick-capture-window.mjs")]) {
    assert.match(
      stripComments(read(rel)),
      /windowShellOptions\(/u,
      `${rel} must spread the shared shell options`,
    );
  }
});
