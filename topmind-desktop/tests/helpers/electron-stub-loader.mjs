/**
 * Module hooks that redirect the `electron` specifier to an inert stub.
 *
 * ## Why
 *
 * The main process is plain JS, loaded directly by Electron. Loading it under
 * Node is the only way to exercise it without a display, and it is worth doing:
 * the 4.2.0 build died in `wireApplicationMenu` before any window existed, and
 * nothing in the suite ever *ran* that path — the tests read the file and
 * asserted on its text.
 *
 * Two things block a plain under-Node load, and neither is a defect:
 *
 *  1. `require("electron")` resolves to the package's `index.js`, whose export
 *     *is* the path to the binary. Destructuring yields `undefined`, so modules
 *     that only touch that API inside functions load fine — which is exactly
 *     why the failure was invisible until a function ran.
 *  2. `import { clipboard } from "electron"` fails outright: Node's CJS
 *     named-export detection cannot see names on a module that exports a
 *     string.
 *
 * ## Both loader kinds, deliberately
 *
 * `registerHooks` is the synchronous, same-realm API and is the one that
 * catches `createRequire` — which is how most of this codebase reaches Electron.
 * It is registered first and alone: the async `register()` worker cannot see
 * `require` calls at all, so adding it would only duplicate the resolve.
 *
 * ## Use
 *
 *   node --import ./tests/helpers/electron-stub-loader.mjs some-script.mjs
 *
 * The file registers its own hooks, so `--import` needs nothing else. The stub
 * itself lives in `./electron-stub.mjs` as real code so the ordinary checks
 * cover it.
 */
import { registerHooks } from "node:module";

const STUB_URL = new URL("./electron-stub.mjs", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "electron") {
      return { url: STUB_URL, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
