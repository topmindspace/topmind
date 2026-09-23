/**
 * Loads every main-process module for real, under Node, with `electron`
 * stubbed. Run through the stub loader:
 *
 *   node --import ./tests/helpers/electron-stub-loader.mjs \
 *        ./tests/helpers/load-main-process-modules.mjs
 *
 * Exists because "the suite is green" and "the app opens" are different
 * claims, and 4.2.0 shipped with the first one true and the second one false.
 * Every module the main process can reach is imported here, so a bad import, a
 * top-level throw, or a circular dependency that lands in the temporal dead
 * zone fails the gate instead of failing at launch.
 *
 * Imports are sequential rather than parallel: a failure should name the module
 * that caused it, and concurrent imports blur that.
 */
import { readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "../..");
const electronDir = join(desktopRoot, "electron");

const IGNORED_DIRS = new Set(["node_modules", "dist", "resources"]);

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      collect(full, out);
    } else if (entry.name.endsWith(".mjs")) {
      out.push(full);
    }
  }
  return out;
}

const files = collect(electronDir).sort();
const failures = [];
/** Import order matters only for readability; boot order is the app's business. */
let mainLoaded = false;

for (const file of files) {
  try {
    await import(pathToFileURL(file).href);
    if (file.endsWith("/electron/main.mjs")) mainLoaded = true;
  } catch (err) {
    failures.push({ file: relative(desktopRoot, file), message: err?.message ?? String(err) });
  }
}

/**
 * `main.mjs` does its wiring inside `app.whenReady().then(...)`. The stub
 * resolves that promise, so draining the queue lets the real boot sequence run
 * against stubbed Electron — which is where 4.2.0 threw. Loading the module and
 * stopping there would have left `wireApplicationMenu` unexecuted and the bug
 * undetected, so the drain is the part that makes this a boot test rather than
 * an import test.
 */
if (mainLoaded) {
  for (let tick = 0; tick < 20; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * A boot failure is not a thrown exception: `showBootError` logs it and opens a
 * native error box, so the process still exits 0. Asserting on the box is what
 * makes the difference between "the app loaded its modules" and "the app got as
 * far as a window". This is the exact shape of the 4.2.0 failure — the user saw
 * an error dialog, not a stack trace in CI.
 */
const { bootDiagnostics } = await import(new URL("./electron-stub.mjs", import.meta.url).href);

for (const box of bootDiagnostics.errorBoxes) {
  console.error(`FAIL boot error dialog: ${box.title}`);
  for (const line of box.detail.split("\n").slice(0, 6)) {
    console.error(`     ${line}`);
  }
}

if (failures.length > 0 || bootDiagnostics.errorBoxes.length > 0) {
  for (const { file, message } of failures) {
    console.error(`FAIL ${file}\n     ${message.split("\n")[0]}`);
  }
  const parts = [];
  if (failures.length > 0) parts.push(`${failures.length} module(s) failed to load`);
  if (bootDiagnostics.errorBoxes.length > 0) {
    parts.push(`${bootDiagnostics.errorBoxes.length} boot error dialog(s)`);
  }
  console.error(`\n${parts.join(" + ")} out of ${files.length} modules.`);
  process.exit(1);
}

console.log(
  `${files.length}/${files.length} main-process modules loaded${mainLoaded ? " (boot sequence drained)" : ""}.`,
);

// Modules under test may install timers or listeners that never release; the
// point of this process is the load itself, so exit deliberately rather than
// hanging the runner.
process.exit(0);
