import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "..");

/* ── WCAG contrast helpers (pure JS, no deps) ────────────────────────────────
   Token stops are the single source of contrast truth in this design system, so
   the tests assert the *stops*, not screenshots. Composite values matter: a
   status color is nearly always painted on its own `-bg` wash, which shifts the
   effective background. */

function parseColor(value) {
  const v = String(value).trim();
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1);
  }
  const rgba = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (rgba) return [+rgba[1], +rgba[2], +rgba[3], rgba[4] === undefined ? 1 : +rgba[4]];
  return null;
}

/** Composite a possibly-translucent color over an opaque one. */
function over(fg, bg) {
  const a = fg[3];
  return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1);
}

function luminance(c) {
  const ch = (x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Nearest `{…}` block for a selector, brace-balanced. */
function cssBlock(css, selector) {
  const at = css.indexOf(selector);
  if (at < 0) return "";
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return "";
}

function cssVars(text) {
  const out = {};
  for (const m of text.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

/** Resolve a token through `var(--x)` chains against a palette. */
function resolve(palette, name, seen = new Set()) {
  const raw = palette[name];
  if (raw === undefined || seen.has(name)) return raw;
  const ref = raw.match(/^var\(\s*(--[a-z0-9-]+)\s*\)$/);
  if (!ref) return raw;
  seen.add(name);
  return resolve(palette, ref[1], seen);
}

function readTokenPalettes() {
  const css = fs.readFileSync(path.join(desktopRoot, "src", "styles", "tokens.css"), "utf-8");
  const light = cssVars(cssBlock(css, "@theme {"));
  const dark = { ...light, ...cssVars(cssBlock(css, "\n  .dark {")) };
  const inbox = { ...light, ...cssVars(cssBlock(css, "body[data-mode='inbox']")) };
  const darkInbox = { ...dark, ...cssVars(cssBlock(css, ".dark body[data-mode='inbox']")) };
  return { light, dark, inbox, darkInbox };
}

test("UI Token & Modernization Compliance", async (t) => {
  await t.test("v4.css has modern flexible tab width without 9.5rem hardcode", () => {
    const v4CssPath = path.join(desktopRoot, "src", "styles", "v4.css");
    const content = fs.readFileSync(v4CssPath, "utf-8");

    // .v4-recent-tab must NOT hardcode width: 9.5rem
    assert.doesNotMatch(content, /\.v4-recent-tab\s*\{[^}]*width:\s*9\.5rem/);
    assert.match(content, /\.v4-recent-tab\s*\{[^}]*min-width:\s*6rem/);
    assert.match(content, /\.v4-recent-tab\s*\{[^}]*max-width:\s*14rem/);
    assert.match(content, /\.v4-recent-tab\s*\{[^}]*flex:\s*0 1 auto/);
  });

  await t.test("Numeric badges route through CountBadge and stay >=11px", () => {
    const aiPanel = fs.readFileSync(path.join(desktopRoot, "src", "components", "ai", "AiPanel.tsx"), "utf-8");
    const chatInput = fs.readFileSync(path.join(desktopRoot, "src", "components", "ai", "ChatInput.tsx"), "utf-8");
    const aiWorkspace = fs.readFileSync(path.join(desktopRoot, "src", "components", "ai", "AiWorkspace.tsx"), "utf-8");

    // 2026-09: TitleBar SuggestBadge removed — suggest count lives in AI workspace tab + StatusBar.

    // TitleBar center track: min-w-0 + flex-1 so crumbs can shrink
    const titleBar = fs.readFileSync(path.join(desktopRoot, "src", "components", "shell", "TitleBar.tsx"), "utf-8");
    assert.match(titleBar, /flex min-w-0 flex-1 items-center gap-1\.5/);

    // One badge component, three call sites. Until 2026-09-14 each site spelled
    // out its own span with its own radius, offset, and fill — and the AI
    // workspace one referenced `bg-skill-loop`, a token deleted during a design
    // system pass, so it painted with no background: white-on-chrome (~1.1:1)
    // in light mode, near-black-on-graphite in dark. Both invisible.
    assert.match(aiPanel, /<CountBadge\b/);
    assert.match(chatInput, /<CountBadge\b/);
    assert.match(aiWorkspace, /<CountBadge\b/);

    assert.doesNotMatch(aiPanel, /active\.length[\s\S]*?text-5xs/);
    assert.doesNotMatch(chatInput, /sessionLoadedSkills\.length[\s\S]*?text-5xs/);

    // The implementation itself: 11px floor, filled from the --color-badge axis
    // rather than accent-color (which flips hue in inbox mode and only reaches
    // 4.1:1 with white).
    const countBadge = fs.readFileSync(path.join(desktopRoot, "src", "components", "ui", "CountBadge.tsx"), "utf-8");
    assert.match(countBadge, /text-4xs font-bold/);
    assert.doesNotMatch(countBadge, /text-5xs/);
    assert.match(countBadge, /bg-badge\b/);
    assert.match(countBadge, /bg-badge-alert\b/);
  });

  await t.test("every color utility resolves to a defined --color-* token", () => {
    // Guards the class of bug behind the 2026-09-14 badge: `bg-skill-loop` and
    // `text-accent` were referenced in components while no such token existed,
    // so Tailwind emitted no rule at all and the element silently kept whatever
    // it inherited. Nothing failed — the UI just went quietly wrong.
    const styleDir = path.join(desktopRoot, "src", "styles");
    let css = "";
    for (const f of fs.readdirSync(styleDir)) {
      if (f.endsWith(".css")) css += fs.readFileSync(path.join(styleDir, f), "utf-8");
    }
    const defined = new Set([...css.matchAll(/(--color-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));

    // Project semantic namespaces only — Tailwind's built-in palette (white,
    // transparent, red-500, …) is out of scope.
    const NAMESPACES = [
      "surface", "text", "accent", "status", "success", "warning", "error", "info",
      "badge", "brand", "ink", "border", "chrome", "skill", "scrim", "kbd", "dialog",
      "focus", "danger", "card", "popover", "primary", "secondary", "muted",
      "destructive", "input", "ring", "foreground", "sidebar", "app",
    ];
    const UTILITIES = [
      "bg", "text", "border", "ring", "fill", "stroke", "from", "to", "via",
      "outline", "divide", "decoration", "caret", "accent",
    ];
    // Utilities that share a prefix with color ones but are not colors.
    const NOT_COLOR = new Set([
      "xs", "sm", "base", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "3xs",
      "4xs", "5xs", "2xs", "center", "left", "right", "justify", "start", "end",
      "ellipsis", "clip", "wrap", "nowrap", "balance", "pretty",
    ]);

    const srcDir = path.join(desktopRoot, "src");
    const files = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) files.push(p);
      }
    })(srcDir);

    // `(?<![\w-])` rather than a bare match: without it `bg-accent-muted` also
    // yields an `accent` + `muted` reading and reports `--color-muted` missing.
    const utilRe = new RegExp(`(?<![\\w-])(?:${UTILITIES.join("|")})-([a-z0-9][a-z0-9-]*)`, "g");
    const offenders = [];
    for (const file of files) {
      // Strip comments: prose and docs may name a deleted class on purpose.
      const raw = fs
        .readFileSync(file, "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/^\s*\/\/.*$/gm, " ");
      for (const m of raw.matchAll(utilRe)) {
        const name = m[1];
        if (!NAMESPACES.includes(name.split("-")[0])) continue;
        if (NOT_COLOR.has(name)) continue;
        if (!defined.has(`--color-${name}`)) {
          offenders.push(`${path.relative(srcDir, file)} → ${m[0]}`);
        }
      }
      // Arbitrary-value escape hatch: `bg-[var(--color-dialog-header)]` bypasses
      // the utility-name check entirely — that is how a token deleted as "unused"
      // left `SettingsLayout` painting an invalid background. Same rule applies.
      for (const m of raw.matchAll(/var\(\s*(--color-[a-z0-9-]+)/g)) {
        if (!defined.has(m[1])) {
          offenders.push(`${path.relative(srcDir, file)} → var(${m[1]})`);
        }
      }
    }
    assert.deepEqual(offenders, [], `undefined color tokens:\n${offenders.join("\n")}`);
  });

  await t.test("semantic color stops clear WCAG AA on every surface plane", () => {
    // 2026-09-14: the light axis had drifted into fill-only values that were also
    // being used as text ~160x (text-success / text-warning / text-error, nearly
    // always on the role's own wash). Measured then, worst plane: success 2.64:1,
    // warning 2.42:1, error 3.49:1; accent 3.59:1. All unreadable, none reported
    // by any other gate because CSS contrast failures are silent.
    const { light, dark, inbox, darkInbox } = readTokenPalettes();
    const failures = [];
    const get = (palette, name) => {
      const raw = resolve(palette, name);
      if (raw === undefined) failures.push(`missing token ${name}`);
      return raw;
    };
    const check = (label, fgRaw, bgRaw, min = 4.5) => {
      const label1 = (x) => (Array.isArray(x) ? `rgb(${x.slice(0, 3).map(Math.round).join(",")})` : x);
      const fg = Array.isArray(fgRaw) ? fgRaw : parseColor(fgRaw);
      const bg = Array.isArray(bgRaw) ? bgRaw : parseColor(bgRaw);
      if (!fg || !bg) {
        failures.push(`${label}: unparseable (${label1(fgRaw)} / ${label1(bgRaw)})`);
        return;
      }
      const bgOpaque = bg[3] < 1 ? over(bg, [255, 255, 255, 1]) : bg;
      const fgOpaque = fg[3] < 1 ? over(fg, bgOpaque) : fg;
      const r = contrast(fgOpaque, bgOpaque);
      if (r < min) failures.push(`${label}: ${r.toFixed(2)}:1 < ${min} — ${label1(fgRaw)} on ${label1(bgRaw)}`);
    };

    // Worst plane per mode: the darkest light plane for dark text, and the
    // lightest dark plane for light text. A stop that clears these clears all.
    const PLANES = {
      light: ["--color-app-chrome", "--color-surface-elevated", "--color-surface", "--color-background"],
      dark: ["--color-surface-elevated", "--color-background", "--color-surface", "--color-app-chrome"],
    };
    const ROLES = [
      ["accent", "--color-accent-color", null],
      ["success", "--color-status-success", "--color-status-success-bg"],
      ["warning", "--color-status-warning", "--color-status-warning-bg"],
      ["error", "--color-status-error", "--color-status-error-bg"],
      ["info", "--color-status-info", "--color-status-info-bg"],
    ];

    for (const mode of ["light", "dark"]) {
      const palette = mode === "light" ? light : dark;
      for (const [role, fgToken, washToken] of ROLES) {
        for (const plane of PLANES[mode]) {
          check(`${mode} ${role} on ${plane}`, get(palette, fgToken), get(palette, plane));
        }
        // Text sits on the role's own wash far more often than on bare paper.
        if (washToken) {
          const worst = parseColor(get(palette, PLANES[mode][0]));
          check(
            `${mode} ${role} on own wash`,
            get(palette, fgToken),
            over(parseColor(get(palette, washToken)), worst),
          );
        }
      }
      // Default accent also carries an 8% selection wash (tree rows, nav pills).
      const worst = parseColor(get(palette, PLANES[mode][0]));
      check(
        `${mode} accent on accent-bg-subtle wash`,
        get(palette, "--color-accent-color"),
        over(parseColor(get(palette, "--color-accent-bg-subtle")), worst),
      );
    }

    // Inbox mode swaps the accent hue; it must clear the same bar.
    for (const plane of PLANES.light) {
      check(`inbox accent on ${plane}`, get(inbox, "--color-accent-color"), get(inbox, plane));
    }
    check(
      "inbox accent on own wash",
      get(inbox, "--color-accent-color"),
      over(parseColor(get(inbox, "--color-accent-bg-subtle")), parseColor(get(inbox, "--color-app-chrome"))),
    );
    for (const plane of PLANES.dark) {
      check(`dark inbox accent on ${plane}`, get(darkInbox, "--color-accent-color"), get(darkInbox, plane));
    }

    // Badge pairs — solid fill + foreground, both directions matter.
    for (const [mode, palette] of [["light", light], ["dark", dark]]) {
      check(
        `${mode} badge fg on fill`,
        get(palette, "--color-badge-foreground"),
        get(palette, "--color-badge"),
      );
      check(
        `${mode} badge-alert fg on fill`,
        get(palette, "--color-badge-alert-foreground"),
        get(palette, "--color-badge-alert"),
      );
    }

    assert.deepEqual(failures, [], `contrast failures:\n${failures.join("\n")}`);
  });

  await t.test("every defined --color-* token is referenced somewhere", () => {
    // The other half of the ghost-token problem. A stop that stays defined after
    // its last consumer disappears is what a future author greps for, finds, and
    // re-wires a component to — then the design system moves again and the
    // reference silently dies. 15 such tokens were pruned on 2026-09-14.
    const styleDir = path.join(desktopRoot, "src", "styles");
    const css = fs
      .readdirSync(styleDir)
      .filter((f) => f.endsWith(".css"))
      .map((f) => fs.readFileSync(path.join(styleDir, f), "utf-8"))
      .join("\n");

    const srcDir = path.join(desktopRoot, "src");
    let source = "";
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) {
          source += fs
            .readFileSync(p, "utf-8")
            .replace(/\/\*[\s\S]*?\*\//g, " ")
            .replace(/^\s*\/\/.*$/gm, " ");
        }
      }
    })(srcDir);

    // CSS counts as a consumer too — `@apply bg-surface-muted` in v4.css is real
    // usage even though no .tsx names it.
    const haystack = `${css}\n${source}`;
    const UTILITIES = [
      "bg", "text", "border", "ring", "fill", "stroke", "from", "to", "via",
      "outline", "divide", "decoration", "caret", "accent", "shadow", "placeholder",
    ];

    const dead = [];
    for (const m of css.matchAll(/(--color-[a-z0-9-]+)\s*:/g)) {
      const token = m[1];
      if (dead.includes(token)) continue;
      const body = token.slice("--color-".length);
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // `var()` counts wherever it appears — CSS *and* TSX. A token reached only
      // through an arbitrary value (`bg-[var(--color-x)]`) is in use; scanning CSS
      // alone would report it dead and invite its deletion.
      const varUsed = new RegExp(`var\\(\\s*${escaped}\\b`).test(haystack);
      const utilUsed = UTILITIES.some((u) =>
        new RegExp(`(?:^|[\\s"'\`:@])${u}-${body.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9-])`, "m").test(haystack),
      );
      if (!varUsed && !utilUsed) dead.push(token);
    }

    assert.deepEqual(dead, [], `tokens defined but never referenced:\n${dead.join("\n")}`);
  });

  await t.test("semantic color utilities carry no alpha modifier", () => {
    // `text-accent-color/70` looks harmless but silently re-opens the contrast gap
    // the token stops were tuned to close: sky-700 at 70% is 3.27:1, at 60% is
    // 2.70:1. The stop *is* the contrast budget — if a muted treatment is wanted,
    // use a muted token (text-text-tertiary), not an alpha on a semantic one.
    // 30 sites were flattened on 2026-09-14.
    const NAMES = [
      "accent-color", "success", "warning", "error", "status-info", "status-error",
      "status-success", "status-warning", "badge", "badge-alert",
    ];
    const re = new RegExp(`text-(?:${NAMES.join("|")})/\\d+`, "g");

    const srcDir = path.join(desktopRoot, "src");
    const offenders = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) {
          const raw = fs
            .readFileSync(p, "utf-8")
            .replace(/\/\*[\s\S]*?\*\//g, " ")
            .replace(/^\s*\/\/.*$/gm, " ");
          for (const m of raw.matchAll(re)) offenders.push(`${path.relative(srcDir, p)} → ${m[0]}`);
        }
      }
    })(srcDir);

    assert.deepEqual(offenders, [], `alpha-diluted semantic text colors:\n${offenders.join("\n")}`);
  });

  await t.test("Obsidian styles.css supports focus-within and hover:none for delete and abort buttons", () => {
    const obsCss = fs.readFileSync(path.join(repoRoot, "obsidian-plugin", "styles.css"), "utf-8");
    assert.match(obsCss, /\.tm-todo-item:focus-within\s+\.tm-todo-delete/);
    assert.match(obsCss, /\.tm-history-item-active:focus-within\s+\.tm-history-abort/);
    assert.match(obsCss, /@media\s*\(hover:\s*none\)\s*\{\s*\.tm-todo-item\s+\.tm-todo-delete/);
  });

  await t.test("Obsidian KernelService provides non-blocking async reading", () => {
    const ks = fs.readFileSync(path.join(repoRoot, "obsidian-plugin", "src", "services", "kernel-service.ts"), "utf-8");
    assert.match(ks, /readPeriodNoteAsync\(relPath:\s*string\)/);
    assert.match(ks, /memoryDirRel\(\):\s*string/);
    assert.match(ks, /private\s+async\s+loadRecentReflections\(\)/);
  });
});
