/**
 * Find-in-note for the TipTap editor (⌘F) — case-insensitive, decorations
 * rendered by a ProseMirror plugin so highlights live in the doc layer
 * (they re-map automatically across edits).
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";

export interface FindMatch {
  from: number;
  to: number;
}

export interface FindState {
  search: string;
  activeIdx: number;
  matches: FindMatch[];
}

export const findPluginKey = new PluginKey<FindState>("topmindFind");

/** All case-insensitive occurrences of `search` in single text nodes. */
function computeMatches(doc: PMNode, search: string): FindMatch[] {
  const q = search.toLowerCase();
  if (!q) return [];
  const matches: FindMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true;
    const text = node.text.toLowerCase();
    let idx = text.indexOf(q);
    while (idx >= 0 && matches.length < 2000) {
      matches.push({ from: pos + idx, to: pos + idx + q.length });
      idx = text.indexOf(q, idx + q.length);
    }
    return true;
  });
  return matches;
}

function clampActive(active: number, total: number): number {
  if (total === 0) return 0;
  return Math.min(Math.max(active, 0), total - 1);
}

export function createFindExtension() {
  return Extension.create({
    name: "topmindFind",
    addProseMirrorPlugins() {
      return [
        new Plugin<FindState>({
          key: findPluginKey,
          state: {
            init: () => ({ search: "", activeIdx: 0, matches: [] }),
            apply(tr, prev) {
              const meta = tr.getMeta(findPluginKey) as Partial<FindState> | undefined;
              if (meta) {
                return { ...prev, ...meta };
              }
              if (tr.docChanged) {
                const matches = computeMatches(tr.doc, prev.search);
                return {
                  ...prev,
                  matches,
                  activeIdx: clampActive(prev.activeIdx, matches.length),
                };
              }
              return prev;
            },
          },
          props: {
            decorations(state) {
              const st = findPluginKey.getState(state);
              if (!st || !st.search || st.matches.length === 0) return DecorationSet.empty;
              return DecorationSet.create(
                state.doc,
                st.matches.map((m, i) =>
                  Decoration.inline(m.from, m.to, {
                    class: i === st.activeIdx ? "v4-find-hit v4-find-hit-active" : "v4-find-hit",
                  }),
                ),
              );
            },
          },
        }),
      ];
    },
  });
}

/** Set the search term; decorations + count update immediately. */
export function findSetSearch(editor: Editor | null, search: string): FindState {
  if (!editor || editor.isDestroyed) return { search: "", activeIdx: 0, matches: [] };
  const matches = computeMatches(editor.state.doc, search);
  const state: FindState = { search, activeIdx: 0, matches };
  editor.view.dispatch(editor.state.tr.setMeta(findPluginKey, state));
  if (matches.length > 0) scrollToMatch(editor, matches[0]);
  return state;
}

/** Step the active match (1 = next, -1 = previous, wrapping). */
export function findStep(editor: Editor | null, dir: 1 | -1): FindState {
  if (!editor || editor.isDestroyed) return { search: "", activeIdx: 0, matches: [] };
  const st = findPluginKey.getState(editor.state) ?? { search: "", activeIdx: 0, matches: [] };
  if (st.matches.length === 0) return st;
  const activeIdx = (st.activeIdx + dir + st.matches.length) % st.matches.length;
  editor.view.dispatch(editor.state.tr.setMeta(findPluginKey, { activeIdx }));
  scrollToMatch(editor, st.matches[activeIdx]);
  return { ...st, activeIdx };
}

/** Scroll the editor viewport to a match position. */
function scrollToMatch(editor: Editor, match: FindMatch): void {
  requestAnimationFrame(() => {
    if (editor.isDestroyed) return;
    try {
      const dom = editor.view.domAtPos(match.from);
      const el = dom.node instanceof Element ? dom.node : dom.node.parentElement;
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch {
      /* position may be stale after concurrent edits */
    }
  });
}

/** Clear search + decorations (called on bar close). */
export function findClear(editor: Editor | null): void {
  if (!editor || editor.isDestroyed) return;
  editor.view.dispatch(
    editor.state.tr.setMeta(findPluginKey, { search: "", activeIdx: 0, matches: [] }),
  );
}

/** Current find state (for count display). */
export function findGetState(editor: Editor | null): FindState {
  if (!editor || editor.isDestroyed) return { search: "", activeIdx: 0, matches: [] };
  return findPluginKey.getState(editor.state) ?? { search: "", activeIdx: 0, matches: [] };
}
