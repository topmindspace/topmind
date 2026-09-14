/**
 * Style compliance for styles.css.
 *
 * These two rules are cheap to check and both regressed silently before: a
 * stylesheet with a dead `--tm-*` token or a `transition: all` still builds,
 * still renders, and only shows up as sluggish hover or a drifting token set
 * months later.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(pluginRoot, "styles.css"), "utf-8");

test("styles.css: no `transition: all`", async (t) => {
  await t.test("every transition names its properties", () => {
    // Obsidian's own style guidance rules `all` out: it animates whatever
    // happens to change (including properties a user's theme adds) and costs a
    // style recalc per attribute change. Interactive surfaces use
    // --tm-transition-ui instead.
    const offenders = [];
    css.split("\n").forEach((line, i) => {
      // Ignore prose — the rule is explained in a comment near --tm-transition-ui.
      if (/^\s*(\/\*|\*)/.test(line)) return;
      if (/transition:\s*all\b/.test(line)) offenders.push(`L${i + 1}: ${line.trim()}`);
    });
    assert.deepEqual(offenders, [], `transition: all found:\n${offenders.join("\n")}`);
    assert.match(css, /--tm-transition-ui:/);
  });
});

test("styles.css: every --tm-* token is defined once and used", async (t) => {
  await t.test("no duplicate definitions", () => {
    const defRe = /^\s*(--tm-[a-z0-9-]+)\s*:/gm;
    const counts = new Map();
    for (const m of css.matchAll(defRe)) {
      counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
    }
    const dupes = [...counts].filter(([, n]) => n > 1).map(([name, n]) => `${name} ×${n}`);
    assert.deepEqual(dupes, [], `duplicate --tm-* definitions:\n${dupes.join("\n")}`);
  });

  await t.test("no dead tokens", () => {
    // A token nothing consumes is either a leftover from a refactor or a typo
    // in the definition itself — both worth failing on. Tokens a user may set
    // from a snippet are consumed through var(--x, fallback) and therefore
    // still count as used.
    const defined = [...css.matchAll(/^\s*(--tm-[a-z0-9-]+)\s*:/gm)].map((m) => m[1]);
    const dead = defined.filter((name) => {
      const uses = [...css.matchAll(new RegExp(`var\\(\\s*${name}\\s*[,)]`, "g"))].length;
      return uses === 0;
    });
    assert.deepEqual(dead, [], `unreferenced --tm-* tokens:\n${dead.join("\n")}`);
  });
});

test("styles.css: accent-colored text uses Obsidian's text accent", async (t) => {
  await t.test("no text painted with the control accent", () => {
    // Obsidian maintains two accents and the split is deliberate:
    // --interactive-accent is the *control* accent (fills, focus borders,
    // underlines) and themes are not obliged to keep it readable as body text;
    // --text-accent is the *readable* accent themes tune for contrast. Painting
    // text with the control accent is why plugins go unreadable on a deep or
    // neon theme accent, so text routes through --tm-text-accent instead.
    // Border and background declarations may still use --interactive-accent.
    const offenders = [];
    css.split("\n").forEach((line, i) => {
      if (/^\s*(\/\*|\*)/.test(line)) return;
      if (/(?<![\w-])color:\s*var\(--interactive-accent\)/.test(line)) {
        offenders.push(`L${i + 1}: ${line.trim()}`);
      }
    });
    assert.deepEqual(offenders, [], `text using the control accent:\n${offenders.join("\n")}`);
    assert.match(css, /--tm-text-accent:\s*var\(--text-accent/);
  });
});

test("styles.css: no hardcoded colors", async (t) => {
  await t.test("every color resolves through an Obsidian or --tm-* variable", () => {
    // The plugin ships into arbitrary user themes. A literal hex or rgb() is a
    // color that cannot adapt to light/dark and that no theme can override.
    const offenders = [];
    css.split("\n").forEach((line, i) => {
      if (/^\s*(\/\*|\*)/.test(line)) return;
      const literals = line.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/g);
      if (literals) offenders.push(`L${i + 1}: ${line.trim()}`);
    });
    assert.deepEqual(offenders, [], `hardcoded colors:\n${offenders.join("\n")}`);
  });
});
