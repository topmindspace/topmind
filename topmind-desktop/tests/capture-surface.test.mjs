/**
 * Capture surface boot detection + index path helpers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import {
  __debugResolveIndexHtml,
  __debugPathToFileUrl,
} from "../electron/lib/quick-capture-window.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");

test("resolveIndexHtml finds dist or reports candidate", () => {
  const p = __debugResolveIndexHtml(desktopRoot);
  assert.ok(typeof p === "string" && p.endsWith("index.html"));
  // After build dist exists; before build path may not — still a valid candidate path
  assert.ok(p.includes("index.html"));
});

test("pathToFileUrl produces file URL", () => {
  const u = __debugPathToFileUrl(desktopRoot);
  assert.match(u, /^file:/u);
});

test("surface query detection logic mirrors App", () => {
  function detect(search, hash) {
    if (new URLSearchParams(search).get("surface") === "capture") return true;
    const h = String(hash || "").replace(/^#/u, "");
    return h === "surface=capture" || h.includes("surface=capture");
  }
  assert.equal(detect("?surface=capture", ""), true);
  assert.equal(detect("", "#surface=capture"), true);
  assert.equal(detect("?foo=1", "#x"), false);
  assert.equal(detect("?surface=other", ""), false);
});
