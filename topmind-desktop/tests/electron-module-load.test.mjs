/**
 * The app must survive its own boot.
 *
 * ## Why this file exists
 *
 * 4.2.0 shipped with a green suite and could not open a window on any platform.
 * `popupSink = sink` in `app-menu.mjs` assigned to a name that was never
 * declared; ESM is always strict mode, so `wireApplicationMenu()` threw a
 * `ReferenceError` during the ready handler and the process died before any
 * window existed. Every existing guard was blind to it, for reasons that were
 * each individually reasonable:
 *
 *  - `check:electron` runs `node --check`, which only parses. Assigning to an
 *    undeclared name is valid syntax; the failure is a runtime one.
 *  - `tsc --noEmit` never reads `.mjs`, which is exactly what the main process
 *    is written in.
 *  - The app-menu test asserted on the *text* of the file — it checked that the
 *    string `export function setMenuPopupSink` was present. A function nobody
 *    can call passed its own test.
 *
 * So the suite tested that the code was *written*, not that it *ran*. These two
 * tests close that gap:
 *
 *  1. **Boot.** Every module the main process can reach is imported for real,
 *     with `electron` stubbed, and the ready handler is then allowed to run to
 *     completion. A throw anywhere in that path — a bad import, a top-level
 *     error, a name that was never declared, a circular dependency landing in
 *     the temporal dead zone — fails here. This is the test that would have
 *     caught 4.2.0, and it is verified to fail when the declaration is removed.
 *  2. **Stub coverage.** The stub is what makes (1) possible, so a gap in it
 *     would look like a product bug. Every name the codebase imports from
 *     `electron` must exist on the stub.
 *
 * What this does *not* do is simulate Electron. Behaviour belongs in a focused
 * test with a double scoped to one module; this is the smoke alarm.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const electronDir = join(root, "electron");

const IGNORED_DIRS = new Set(["node_modules", "dist", "resources"]);

function collectModules(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      collectModules(full, out);
    } else if (entry.name.endsWith(".mjs")) {
      out.push(full);
    }
  }
  return out;
}

test("every main-process module loads and the boot sequence runs to a window", () => {
  // A child process, not an import: the loader hooks are process-global, and the
  // boot sequence installs timers and listeners that would outlive the test.
  const run = () =>
    execFileSync(
      process.execPath,
      [
        "--import",
        join(here, "helpers", "electron-stub-loader.mjs"),
        join(here, "helpers", "load-main-process-modules.mjs"),
      ],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );

  let stdout = "";
  try {
    stdout = run();
  } catch (err) {
    const detail = [err.stdout, err.stderr].filter(Boolean).join("\n");
    assert.fail(
      `the main process failed to boot under a stubbed Electron:\n${detail}\n` +
        "A throw in the ready handler means no window exists — the user sees an error dialog, not a stack trace.",
    );
  }

  assert.match(
    stdout,
    /modules loaded \(boot sequence drained\)/u,
    "the boot helper must report that the ready handler completed",
  );
});

test("the electron stub covers every name the codebase pulls from electron", async () => {
  // A missing export is indistinguishable from a missing API until the host
  // calls it. `nativeImage` was absent on the first draft of the stub, and the
  // symptom was a `TypeError` inside the tray code — a product-looking failure
  // caused entirely by the test double.
  const stub = await import(pathToFileURL(join(here, "helpers", "electron-stub.mjs")).href);
  const provided = new Set(Object.keys(stub));

  const imported = new Map();
  const patterns = [
    // import { a, b } from "electron"
    /import\s*\{([^}]*)\}\s*from\s*["']electron["']/gu,
    // const { a, b } = require("electron")
    /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*["']electron["']\s*\)/gu,
  ];

  for (const file of collectModules(electronDir)) {
    const source = readFileSync(file, "utf8");
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        for (const part of match[1].split(",")) {
          const name = part.trim().split(/\s+as\s+/u)[0].trim();
          if (!name) continue;
          if (!imported.has(name)) imported.set(name, new Set());
          imported.get(name).add(file.slice(root.length + 1));
        }
      }
    }
  }

  assert.ok(imported.size > 0, "expected the main process to import something from electron");

  const missing = [...imported.entries()]
    .filter(([name]) => !provided.has(name))
    .map(([name, files]) => `${name} (used by ${[...files].join(", ")})`);

  assert.deepEqual(
    missing,
    [],
    `electron-stub.mjs is missing exports the codebase relies on:\n  ${missing.join("\n  ")}`,
  );
});
