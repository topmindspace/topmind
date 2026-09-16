/**
 * Settings durability — unreadable primary is parked, never silently destroyed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const electron = new URL("../electron/", import.meta.url);
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, electron)), "utf8");

test("loadAppSettings parks corrupt primary before rewriting defaults", () => {
  const src = read("settings.mjs");
  assert.match(src, /parked unreadable app-settings\.json/);
  assert.match(src, /\.corrupt-/);
  // Park must happen before the defaults rewrite, not after.
  const park = src.indexOf("parked unreadable app-settings.json");
  const rewrite = src.indexOf("rewriting empty/corrupt app-settings.json");
  assert.ok(park > 0 && rewrite > park, "park log must precede rewrite log");
  // Parks rotate — never unbounded next to app-settings.json.
  assert.match(src, /SETTINGS_CORRUPT_PARK_KEEP/);
  assert.match(src, /pruneCorruptSettingsParks/);
});

test("decrypt failure blanks key in memory but preserves ciphertext on save", () => {
  const core = read("lib/settings-core.mjs");
  assert.match(core, /secureStorage\.manual\[key\] = ""/);
  // Empty plaintext + previous blob → keep previous ciphertext.
  assert.match(
    core,
    /else if \(typeof prevManual\[key\] === "string" && prevManual\[key\]\) \{\s*secureStorage\.manual\[key\] = prevManual\[key\];/,
  );
});
