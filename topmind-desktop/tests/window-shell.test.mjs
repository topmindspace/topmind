/**
 * OS window-chrome policy contracts.
 *
 * The bug these lock down: Windows used to draw native caption buttons *over*
 * our own 44px column chrome via `titleBarOverlay`. The CSS class reserving the
 * corner for them (`.v4-win-titlebar-pad`) was declared above
 * `.v4-column-chrome { padding: 0 8px }`, so at equal specificity the shorthand
 * won on source order and the reservation silently did nothing — the AI
 * workspace's 4th tab and the AI panel toggle sat under 最小化/最大化/关闭.
 *
 * Two invariants now:
 *   1. macOS keeps inset traffic lights; Windows/Linux get a real native frame.
 *   2. No caption overlay anywhere, so no reserved corner to forget about.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveWindowShell,
  windowShellOptions,
  usesNativeFrame,
} from "../electron/lib/window-shell.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

test("macOS keeps inset traffic lights, Windows/Linux get a native frame", () => {
  const mac = resolveWindowShell({ platform: "darwin" });
  assert.equal(mac.titleBarStyle, "hiddenInset");
  // null (not false): titleBarStyle and an explicit frame flag must not fight
  assert.equal(mac.frame, null);
  assert.equal(usesNativeFrame({ platform: "darwin" }), false);

  for (const platform of ["win32", "linux"]) {
    const shell = resolveWindowShell({ platform });
    assert.equal(shell.frame, true, `${platform} must own its frame`);
    assert.equal(shell.titleBarStyle, "default");
    // Native menu bar is the discoverable home for the quick actions
    assert.equal(shell.autoHideMenuBar, false);
    assert.equal(usesNativeFrame({ platform }), true);
  }
});

test("float capture window follows the same policy, plus mac traffic-light offset", () => {
  const macFloat = resolveWindowShell({ platform: "darwin", forFloat: true });
  assert.deepEqual(macFloat.trafficLightPosition, { x: 12, y: 10 });
  const winFloat = resolveWindowShell({ platform: "win32", forFloat: true });
  assert.equal(winFloat.frame, true);
  assert.equal(winFloat.trafficLightPosition, undefined);
  // The application menu bar is global on Windows/Linux — a 480px sticky note
  // must not inherit 文件/编辑/工作区 across its top edge.
  assert.equal(winFloat.autoHideMenuBar, true);
  assert.equal(resolveWindowShell({ platform: "win32" }).autoHideMenuBar, false);
});

test("windowShellOptions never sends `frame` on macOS", () => {
  assert.equal("frame" in windowShellOptions({ platform: "darwin" }), false);
  assert.equal(windowShellOptions({ platform: "win32" }).frame, true);
  // Spreadable straight into `new BrowserWindow({...})`
  assert.equal(windowShellOptions({ platform: "win32" }).autoHideMenuBar, false);
});

/** Drop block + line comments so docs explaining the old approach don't trip the scan. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^\s*\/\/.*$/gmu, "");
}

test("no caption overlay remains anywhere in the app", () => {
  const forbidden = [
    "titleBarOverlay",
    "resolveWindowsTitleBarOverlay",
    "updateWindowsTitleBarOverlay",
    "v4-win-titlebar-pad",
    "v4-win-float-caption-pad",
    "titlebar-area-width",
  ];
  const files = [
    ...walk(join(root, "src")),
    ...walk(join(root, "electron")),
  ].filter((f) => /\.(ts|tsx|css|mjs|cjs)$/u.test(f));

  const hits = [];
  for (const file of files) {
    const src = stripComments(readFileSync(file, "utf8"));
    for (const needle of forbidden) {
      if (src.includes(needle)) hits.push(`${relative(root, file)} → ${needle}`);
    }
  }
  assert.deepEqual(
    hits,
    [],
    `caption-overlay leftovers found (nothing may reserve a corner for native buttons):\n${hits.join("\n")}`,
  );
});

test("column chrome uses padding longhands, not the shorthand", () => {
  // The shorthand is what silently reset the reservation in the first place.
  const css = readFileSync(join(root, "src/styles/v4.css"), "utf8");
  const rule = css.match(/^\.v4-column-chrome \{[\s\S]*?\n\}/mu)?.[0] || "";
  assert.ok(rule, ".v4-column-chrome rule must exist");
  assert.match(rule, /padding-left:\s*8px;/);
  assert.match(rule, /padding-right:\s*8px;/);
  assert.doesNotMatch(rule, /\n\s*padding:\s/u);
});

test("both window factories take their chrome from the one policy", () => {
  // The float capture window used to carry its own `titleBarStyle` branch and its
  // own Windows caption overlay — a second copy of the same policy, which is how
  // the float kept the very bug the main window had just dropped. These three
  // keys now live in exactly one file; a stray copy is the seed of the next
  // platform-specific regression.
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
  for (const rel of ["electron/main.mjs", join("electron", "lib", "quick-capture-window.mjs")]) {
    assert.match(
      stripComments(readFileSync(join(root, rel), "utf8")),
      /windowShellOptions\(/u,
      `${rel} must spread the shared shell options`,
    );
  }
});

