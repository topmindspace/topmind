/**
 * Platform-correct chord labels — the one place `⌘` becomes `Ctrl`.
 *
 * Chords are *declared* in their canonical macOS form (`⌘⇧I`), because that is the
 * form the bindings are written against (`e.metaKey || e.ctrlKey`) and the form the
 * doc comments quote. This module is what turns such a chord into something the
 * user of a given platform can actually read:
 *
 *   macOS           ⌘⇧I
 *   Windows/Linux   Ctrl+Shift+I
 *
 * Three consumers, deliberately:
 *
 *  1. `formatChord()` — called where a chord is a literal in markup: `<kbd>⌘↵</kbd>`,
 *     a context menu's `shortcut=`, a plugin action's `shortcut`.
 *  2. The i18next post-processor in `locales/index.ts` — translation values quote
 *     chords too (`"设置 · ⌘,"`, `"（⏎ 发送，⇧⏎ 换行）"`). Running every rendered
 *     string through this same function is what keeps those honest without copying
 *     the mapping into ~60 JSON values, which would drift the moment a chord moves.
 *  3. `formatChordFor` is the pure half, so tests can cover both platforms without
 *     stubbing a global.
 *
 * The failure this prevents is quiet rather than loud: a Windows user reads `⌘⇧I`
 * on a keyboard that has no ⌘, concludes the shortcut does not exist, and never
 * presses `Ctrl+Shift+I` — which has worked the entire time.
 *
 * Blanket application is safe because these glyphs are unambiguous in this app:
 * `⇧`/`⌥` only ever mean Shift/Alt, and `⏎`/`↵` only ever mean Enter.
 */
import { isMacOS } from "./platform";

/** macOS modifier / key glyph → the label Windows and Linux users read. */
const GLYPH_LABELS: Record<string, string> = {
  "\u2318": "Ctrl", // ⌘ command
  "\u2303": "Ctrl", // ⌃ control
  "\u2325": "Alt", // ⌥ option / alt
  "\u21e7": "Shift", // ⇧ shift
  "\u21b5": "Enter", // ↵ return
  "\u23ce": "Enter", // ⏎ return
  "\u232b": "Backspace", // ⌫ delete
};

/** Fast reject — most strings carry no chord at all. */
const HAS_GLYPH = /[\u2318\u2303\u2325\u21e7\u21b5\u23ce\u232b]/u;

/**
 * Platform-agnostic core of {@link formatChord}.
 *
 * Modifier runs are joined with `+` and glued to the key they modify, so `⌘⇧I`
 * reads `Ctrl+Shift+I`. A glyph followed by a gap keeps the gap (`⌘ ` stays
 * `Ctrl `) so multi-chord strings never grow a dangling `+`. Groups separated by
 * `/` or spaces are left as groups: `⌘⇧I / O / A` becomes `Ctrl+Shift+I / O / A`
 * — expanding the shorthand would be inventing text the source never claimed.
 *
 * @param chord Canonical chord, macOS glyph form.
 * @param mac True to leave glyphs alone (macOS), false to spell them out.
 */
export function formatChordFor(chord: string, mac: boolean): string {
  if (mac || !chord || !HAS_GLYPH.test(chord)) return chord;

  let out = "";
  /** Modifier labels waiting for the key they modify. */
  let pending: string[] = [];

  for (const ch of chord) {
    const label = GLYPH_LABELS[ch];
    if (label) {
      pending.push(label);
      continue;
    }
    if (pending.length > 0) {
      const glue = ch === " " || ch === "/" ? "" : "+";
      out += `${pending.join("+")}${glue}${ch}`;
      pending = [];
      continue;
    }
    out += ch;
  }
  if (pending.length > 0) out += pending.join("+");

  return out;
}

/**
 * Rewrite a canonical chord for the current platform.
 *
 * @param chord Canonical chord, macOS glyph form.
 * @returns The same chord on macOS; a readable label elsewhere.
 */
export function formatChord(chord: string): string {
  return formatChordFor(chord, isMacOS);
}
