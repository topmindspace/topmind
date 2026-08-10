/**
 * Focus a markdown heading inside a TipTap editor (stream entry → period note).
 * Best-effort: matches heading node text; falls back to text search.
 */
import type { Editor } from "@tiptap/react";

export function focusEditorHeading(editor: Editor | null | undefined, heading: string | undefined | null): boolean {
  if (!editor || editor.isDestroyed || !heading?.trim()) return false;
  const want = heading.trim();

  let foundPos: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (foundPos != null) return false;
    if (node.type.name === "heading") {
      const text = node.textContent.trim();
      if (text === want || text.startsWith(want) || want.startsWith(text)) {
        foundPos = pos + 1;
        return false;
      }
    }
    return true;
  });

  // Fallback: search plain text for "## heading" residue or raw heading line
  if (foundPos == null) {
    const full = editor.state.doc.textContent;
    const idx = full.indexOf(want);
    if (idx >= 0) {
      // Map approximate text offset → doc pos via nodesBetween is heavy; scan again for textblock containing want
      editor.state.doc.descendants((node, pos) => {
        if (foundPos != null) return false;
        if (node.isTextblock && node.textContent.includes(want)) {
          foundPos = pos + 1;
          return false;
        }
        return true;
      });
    }
  }

  if (foundPos == null) return false;

  try {
    editor.chain().focus().setTextSelection(foundPos).run();
    // Scroll the caret into view (ProseMirror)
    const view = editor.view;
    const coords = view.coordsAtPos(foundPos);
    const scroller =
      view.dom.closest(".v4-content-scroll, .overflow-auto, [data-editor-scroll]") ||
      view.dom.parentElement;
    if (scroller instanceof HTMLElement && coords) {
      const rect = scroller.getBoundingClientRect();
      const offset = coords.top - rect.top - rect.height * 0.25;
      scroller.scrollTop += offset;
    } else {
      view.dispatch(view.state.tr.scrollIntoView());
    }
    return true;
  } catch {
    return false;
  }
}
