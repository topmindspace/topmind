#!/usr/bin/env node
/**
 * Undeclared-identifier guard for plain-JS ESM.
 *
 * ## Why this exists
 *
 * `popupSink = sink` compiled, linted, type-checked and tested clean, and then
 * killed the 4.2.0 build before its window opened. Every guard we had was blind
 * to it, for a reason worth writing down:
 *
 * - `node --check` (`check:electron`) parses. Assigning to a name that was never
 *   declared is *valid syntax* — it is a runtime ReferenceError, not a parse
 *   error, so a parser will never see it.
 * - `tsc --noEmit` never reads `.mjs` here. The main process is plain JS by
 *   design (Electron loads it directly), so the one tier that does name
 *   resolution does not apply to the one tier that is untyped.
 * - The suite asserted on *text* (`readFileSync().includes("export function
 *   setMenuPopupSink")`) rather than loading the module, so a function that
 *   cannot be called still satisfied its own test.
 *
 * The failure mode generalizes: **an identifier that is only ever assigned in
 * one unreached branch stays invisible until the branch runs.** ESM is always
 * strict mode, so this is never a silent global — it is an immediate
 * `ReferenceError` at the moment of assignment, which in a `ready` handler means
 * no window at all.
 *
 * ## What it checks
 *
 * Parses each module and walks its scopes. A bare identifier on the left of an
 * assignment or update expression must resolve to a binding in an enclosing
 * scope, to a real global, or to an explicit entry in ALLOWED below. Everything
 * else is a `ReferenceError` waiting for its branch to execute.
 *
 * Scope analysis is the point: a regex would flag every local, and only a real
 * parser knows that `popupOpenId` (declared, fine) and `popupSink` (not
 * declared, fatal) are different in a file where they appear side by side.
 *
 * Unresolved *reads* are reported separately as warnings — a read cannot be
 * silenced by the engine the way a write cannot either, but globals injected by
 * the host (Electron preload, browser) would make that list noisy, so it stays
 * advisory. ERRORs alone decide the exit code.
 *
 * ## Running
 *
 *   node scripts/check-undeclared-idents.mjs           # exit 1 on any ERROR
 *   node scripts/check-undeclared-idents.mjs --all     # include warnings
 *
 * Parsing uses `@babel/parser`, which arrives with the Vite toolchain. If it is
 * ever pruned the check skips loudly rather than failing the gate — a missing
 * dependency must not be reported as a clean scan.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "..");
const repoRoot = resolve(desktopRoot, "..");

/**
 * Scanned roots, as `[absolute path, label]`. The main process, the engine and
 * the repo scripts are the trees that run outside the type checker; `lib/` is
 * loaded by all three hosts, so a throw there is an app that never opens.
 */
const ROOTS = [
  [desktopRoot, "desktop"],
  [repoRoot, "repo"],
];

/**
 * Never worth parsing, or generated rather than authored.
 */
const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  "resources",
  "release",
  "out",
  ".workbuddy",
  ".codegraph",
  "templates",
]);

function collectFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      collectFiles(full, out);
    } else if (entry.isFile() && /\.m?js$/u.test(entry.name) && !entry.name.endsWith(".cjs")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Names a module may assign to without declaring. These are host-injected
 * globals that the scope model cannot know about, plus the deliberate escape
 * hatches. Keep this list short — every entry is a hole.
 *
 * Only the assignment check consults it. Notably absent are real globals like
 * `console` / `Math`: those are read-only in practice, and a bare `JSON = x`
 * would be a bug worth flagging, not a name worth whitelisting.
 */
const ALLOWED = new Set([
  // Injected by the Electron or Node host rather than declared in the module.
  "process",
  "Buffer",
  "globalThis",
]);

/**
 * Read-only globals that a plain read check would otherwise drown in. Advisory
 * tier only — nothing here can hide a fatal assignment, so the list may be
 * generous. Sourced from the JS language builtins plus the Node and browser
 * surfaces these modules actually touch.
 */
const KNOWN_GLOBALS = new Set([
  // Language builtins
  "Object", "Function", "Boolean", "Symbol", "Error", "TypeError", "RangeError",
  "SyntaxError", "ReferenceError", "EvalError", "URIError", "AggregateError",
  "Number", "BigInt", "Math", "Date", "String", "RegExp", "Array",
  "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
  "Int32Array", "Uint32Array", "Float32Array", "Float64Array", "BigInt64Array",
  "BigUint64Array", "ArrayBuffer", "SharedArrayBuffer", "DataView", "Atomics",
  "JSON", "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "FinalizationRegistry",
  "Promise", "Proxy", "Reflect", "Intl", "Iterator", "AsyncIterator",
  "parseInt", "parseFloat", "isNaN", "isFinite", "decodeURI", "decodeURIComponent",
  "encodeURI", "encodeURIComponent", "escape", "unescape", "eval", "undefined",
  "NaN", "Infinity", "arguments",
  // Node
  "process", "Buffer", "global", "globalThis", "require", "module", "exports",
  "__dirname", "__filename", "console", "setTimeout", "clearTimeout",
  "setInterval", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask",
  "structuredClone", "fetch", "Response", "Request", "Headers", "FormData",
  "AbortController", "AbortSignal", "Blob", "File", "URL", "URLSearchParams",
  "TextEncoder", "TextDecoder", "ReadableStream", "WritableStream", "TransformStream",
  "performance", "crypto", "navigator", "WebSocket", "EventSource", "Event",
  "EventTarget", "CustomEvent", "MessageChannel", "MessagePort", "BroadcastChannel",
  "atob", "btoa", "reportError", "Iterator",
  // Browser / renderer
  "window", "document", "self", "top", "parent", "frames", "location", "history",
  "localStorage", "sessionStorage", "indexedDB", "requestAnimationFrame",
  "cancelAnimationFrame", "getComputedStyle", "matchMedia", "alert", "confirm",
  "prompt", "open", "close", "postMessage", "addEventListener", "removeEventListener",
  "HTMLElement", "Element", "Node", "NodeList", "MutationObserver",
  "ResizeObserver", "IntersectionObserver", "CustomElementRegistry", "customElements",
  "CSS", "DOMParser", "XMLSerializer", "Image", "Audio", "Worker",
  "requestIdleCallback", "cancelIdleCallback", "scrollTo", "scrollBy",
  // Electron preload bridges these in; they are not module-level bindings.
  "electron", "ipcRenderer", "contextBridge", "webFrame",
]);

/** `[start, end]` byte offsets of an `eslint-disable` pragma, if present. */
function disabledRanges(code) {
  const ranges = [];
  const re = /\/\*\s*eslint-disable(?:-next-line)?\s+([^*]*?)\*\//gu;
  for (const match of code.matchAll(re)) {
    if (/\bno-undef\b/u.test(match[1])) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  return ranges;
}

/**
 * `@babel/traverse` is CJS and arrives doubly wrapped under ESM interop
 * (`ns.default.default` is the callable), so unwrap until something is callable
 * rather than assuming a fixed depth.
 */
function unwrapDefault(mod) {
  let current = mod;
  while (current && typeof current !== "function" && current.default) {
    current = current.default;
  }
  return current;
}

async function loadBabel() {
  try {
    const [parserMod, traverseMod] = await Promise.all([
      import("@babel/parser"),
      import("@babel/traverse"),
    ]);
    const traverse = unwrapDefault(traverseMod);
    const parse = parserMod.parse ?? unwrapDefault(parserMod)?.parse;
    if (typeof traverse !== "function" || typeof parse !== "function") return null;
    return { parse, traverse };
  } catch {
    return null;
  }
}

function scan(file, { parse, traverse }) {
  const code = readFileSync(file, "utf8");
  const suppressed = disabledRanges(code);
  const errors = [];
  const warnings = [];

  let ast;
  try {
    ast = parse(code, {
      sourceType: "module",
      errorRecovery: false,
      plugins: ["importAttributes", "topLevelAwait"],
    });
  } catch (err) {
    // A file we cannot parse is a hole in the scan, and it is also a file that
    // cannot execute. Reported on its own line so it is never mistaken for the
    // undeclared-assignment count.
    return { errors: [], warnings: [], parseError: err.message, parseLine: err.loc?.line ?? 0 };
  }

  const lineOf = (node) => node.loc?.start.line ?? 0;
  const suppressedAt = (node) => {
    const offset = node.start ?? 0;
    return suppressed.some(([from, to]) => offset >= from && offset <= to);
  };

  /**
   * True when the name resolves to a binding in this scope or any enclosing one.
   *
   * Deliberately *not* `scope.hasBinding()` / `scope.hasGlobal()`. `hasGlobal()`
   * is the trap that made the first version of this check pass the very bug it
   * was written for: Babel models sloppy-mode implicit globals, so an
   * undeclared assignment registers the name as a global and `hasGlobal`
   * returns true for it. `hasOwnBinding` walks the binding tables only, which is
   * the question actually being asked — "was this ever declared?".
   */
  const isDeclared = (path, name) => {
    for (let scope = path.scope; scope; scope = scope.parent) {
      if (scope.hasOwnBinding(name)) return true;
    }
    return false;
  };

  traverse(ast, {
    // `x = v` and `x++` on a name with no binding: ReferenceError in strict mode.
    AssignmentExpression(path) {
      const left = path.get("left");
      if (!left.isIdentifier()) return;
      const name = left.node.name;
      if (isDeclared(left, name) || ALLOWED.has(name) || suppressedAt(left.node)) return;
      errors.push({ line: lineOf(left.node), name, detail: "assigned but never declared" });
    },
    UpdateExpression(path) {
      const arg = path.get("argument");
      if (!arg.isIdentifier()) return;
      const name = arg.node.name;
      if (isDeclared(arg, name) || ALLOWED.has(name) || suppressedAt(arg.node)) return;
      errors.push({ line: lineOf(arg.node), name, detail: "updated but never declared" });
    },
    // Reads: advisory only. The host injects names we cannot enumerate, so a
    // miss here is noise while a miss in the two checks above is a dead app.
    ReferencedIdentifier(path) {
      const name = path.node.name;
      if (path.parentPath.isAssignmentExpression({ left: path.node })) return;
      if (path.parentPath.isUpdateExpression({ argument: path.node })) return;
      if (isDeclared(path, name) || KNOWN_GLOBALS.has(name) || suppressedAt(path.node)) return;
      warnings.push({ line: lineOf(path.node), name, detail: "read but never declared" });
    },
  });

  return { errors, warnings };
}

const withWarnings = process.argv.includes("--all");
const babel = await loadBabel();

if (!babel) {
  // The gate is only skippable in a pristine tree with no node_modules. Once
  // dependencies are installed, a missing parser is a broken quality gate —
  // silent exit 0 would hide an unaudited electron/ surface.
  const hasNodeModules = (() => {
    try {
      statSync(join(repoRoot, "node_modules"));
      return true;
    } catch {
      return false;
    }
  })();
  console.error("check-undeclared-idents: @babel/parser + @babel/traverse unavailable");
  console.error("  npm install --save-dev @babel/parser @babel/traverse @babel/types");
  if (hasNodeModules) {
    console.error("  FAIL — node_modules is present but the parser cannot load.");
    process.exit(1);
  }
  console.log("check-undeclared-idents: SKIPPED — no node_modules yet");
  process.exit(0);
}

const files = ROOTS.flatMap(([dir]) => collectFiles(dir));
const seen = new Set();
let errorCount = 0;
let warningCount = 0;
let parseCount = 0;

for (const file of files) {
  if (seen.has(file)) continue;
  seen.add(file);
  const { errors, warnings, parseError, parseLine } = scan(file, babel);
  const label = relative(repoRoot, file);

  if (parseError) {
    console.error(`PARSE ${label}:${parseLine}  ${parseError}`);
    parseCount += 1;
    continue;
  }
  for (const entry of errors) {
    console.error(`ERROR ${label}:${entry.line}  ${entry.name} — ${entry.detail}`);
    errorCount += 1;
  }
  if (withWarnings) {
    for (const entry of warnings) {
      console.error(`WARN  ${label}:${entry.line}  ${entry.name} — ${entry.detail}`);
      warningCount += 1;
    }
  }
}

if (errorCount > 0 || parseCount > 0) {
  const parts = [];
  if (errorCount > 0) parts.push(`${errorCount} undeclared assignment(s)`);
  if (parseCount > 0) parts.push(`${parseCount} unparseable module(s)`);
  console.error(`\ncheck-undeclared-idents: ${parts.join(" + ")} across ${seen.size} modules.`);
  console.error("ESM is strict mode — an undeclared assignment is a ReferenceError when its branch runs.");
  process.exit(1);
}

const suffix = withWarnings ? `, ${warningCount} advisory read(s)` : "";
console.log(`check-undeclared-idents: ${seen.size} modules, 0 undeclared assignments${suffix}.`);
