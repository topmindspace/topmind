/**
 * Platform-correct chord labels.
 *
 * The bug this locks down is a silent one: chords used to be written straight into
 * markup and translation values in their macOS form (`⌘⇧I`). On Windows that told
 * the user to press a key their keyboard does not have, so the shortcut looked
 * broken while `Ctrl+Shift+I` worked the whole time. Three things must stay true:
 *
 *   1. `formatChordFor` rewrites glyphs on Windows/Linux and leaves macOS alone.
 *   2. Locale files keep the canonical chord — they must not spell out "Ctrl",
 *      which would give the same chord two sources of truth.
 *   3. Nothing renders a bare chord without going through the formatter.
 *
 * The mapping itself is pure (`formatChordFor`), so both platforms are asserted
 * without stubbing `navigator`; only the one-line `formatChord` binding reads it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { formatChordFor } from "../src/lib/chord.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** macOS glyphs that must never reach a Windows/Linux user. */
const GLYPHS = /[\u2318\u2303\u2325\u21e7\u21b5\u23ce\u232b]/u;

test("macOS keeps the glyphs it declares", () => {
  assert.equal(formatChordFor("⌘⇧I", true), "⌘⇧I");
  assert.equal(formatChordFor("⌘⌥F", true), "⌘⌥F");
  assert.equal(formatChordFor("⌘,", true), "⌘,");
  assert.equal(formatChordFor("Esc", true), "Esc");
});

test("Windows and Linux get spelled-out modifiers", () => {
  assert.equal(formatChordFor("⌘N", false), "Ctrl+N");
  assert.equal(formatChordFor("⌘⇧I", false), "Ctrl+Shift+I");
  assert.equal(formatChordFor("⌘⌥F", false), "Ctrl+Alt+F");
  assert.equal(formatChordFor("⌘⌥W", false), "Ctrl+Alt+W");
  // Punctuation keys must not grow an extra separator.
  assert.equal(formatChordFor("⌘,", false), "Ctrl+,");
  assert.equal(formatChordFor("⌘[", false), "Ctrl+[");
  assert.equal(formatChordFor("⌘\\", false), "Ctrl+\\");
  assert.equal(formatChordFor("⌘↵", false), "Ctrl+Enter");
  assert.equal(formatChordFor("⇧⏎", false), "Shift+Enter");
});

test("multi-chord strings translate every group and keep their shape", () => {
  // The `⌘⇧I / O / A` shorthand must not be expanded into three chords the source
  // never claimed — only the glyphs it does spell out get rewritten.
  assert.equal(formatChordFor("⌘⇧I / O / A", false), "Ctrl+Shift+I / O / A");
  assert.equal(formatChordFor("⌘K / ⌘P", false), "Ctrl+K / Ctrl+P");
  assert.equal(formatChordFor("⌘[ / ⌘]", false), "Ctrl+[ / Ctrl+]");
  assert.equal(formatChordFor("设置 · ⌘,", false), "设置 · Ctrl+,");
  assert.equal(
    formatChordFor("（⏎ 发送，⇧⏎ 换行，⌘K 选项）", false),
    "（Enter 发送，Shift+Enter 换行，Ctrl+K 选项）",
  );
});

test("strings without chords are handed back untouched", () => {
  // The post-processor runs on *every* translated string, so a no-op must be a
  // no-op — a stray `+` in ordinary prose would be a very visible regression.
  for (const text of ["Esc", "F12", "设置", "Ctrl+S", "Enter 发送", "1 + 1 = 2", ""]) {
    assert.equal(formatChordFor(text, false), text);
    assert.equal(formatChordFor(text, true), text);
  }
});

test("the locale files keep canonical chords", () => {
  // Translation values are *allowed* to quote `⌘` — that is the single source form.
  // Spelling out "Ctrl" there would fork the truth and drift the moment a chord moves.
  const localeDir = join(root, "src", "locales");
  const offenders = [];
  for (const locale of readdirSync(localeDir)) {
    const dir = join(localeDir, locale);
    if (!statSync(dir).isDirectory()) continue;
    for (const ns of readdirSync(dir)) {
      if (!ns.endsWith(".json")) continue;
      const rel = join("src", "locales", locale, ns);
      if (/"Ctrl[+-]/.test(readFileSync(join(dir, ns), "utf8"))) offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], `locales must not hardcode Ctrl chords:\n${offenders.join("\n")}`);
});

test("the i18n runtime routes every translation through the formatter", () => {
  // Locale chords are only corrected because the post-processor runs on `t()`.
  // Removing it would leave all ~60 of them showing ⌘ on Windows, silently.
  const index = readFileSync(join(root, "src", "locales", "index.ts"), "utf8");
  assert.match(index, /name:\s*"chord"/u, "the chord post-processor must be registered");
  assert.match(index, /postProcess:\s*\["chord"\]/u, "and must be active in init()");
  assert.match(index, /formatChord\(/u, "and must delegate to the shared mapping");
});

test("no rendered chord bypasses the formatter", () => {
  // Legitimate shapes: `formatChord("…")` in code, or a canonical chord inside a
  // locale JSON quoted by `t()`. A bare glyph in markup would reach the UI
  // untranslated — exactly the `⌘⇧I` a Windows user cannot act on.
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/u.test(entry)) files.push(full);
    }
  };
  walk(join(root, "src"));

  const offenders = [];
  for (const file of files) {
    const rel = relative(root, file).replace(/\\/g, "/");
    // The declarations and the mapping itself legitimately hold raw glyphs.
    if (rel === "src/lib/chord.ts" || rel === "src/lib/shortcuts.ts") continue;
    for (const [index, raw] of readFileSync(file, "utf8").split("\n").entries()) {
      // Comments explaining the chord are documentation, not rendering. Block
      // comments keep their newlines so line numbers stay aligned.
      const line = raw
        .replace(/\/\*[\s\S]*?\*\//gu, "")
        .replace(/\/\/.*$/u, "")
        .replace(/^\s*\*.*$/u, "");
      if (!GLYPHS.test(line) || /formatChord\(/u.test(line)) continue;
      offenders.push(`${rel}:${index + 1}`);
    }
  }
  // Cap the message: a regression that touches every call site would otherwise
  // dump hundreds of lines and bury the actual cause.
  assert.ok(
    offenders.length === 0,
    `chords rendered without formatChord() (${offenders.length}):\n${offenders.slice(0, 20).join("\n")}`,
  );
});
