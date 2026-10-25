/** Document fidelity and ordered saves shared by the file editor and regressions. */
import { isWorkspaceImageName } from "../../electron/lib/embed-images.mjs";
export type EditorSaveSnapshot = { path: string; documentId: number; revision: number; content: string };
export type EditorPersistenceState = "saving" | "saved" | "dirty" | "error";

export function editorSaveFailureReason(error: unknown): "permission" | "space" | "missing" | "unavailable" {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const detail = `${code} ${message}`;
  if (/\b(?:EACCES|EPERM)\b/u.test(detail)) return "permission";
  if (/\bENOSPC\b/u.test(detail)) return "space";
  if (/\bENOENT\b/u.test(detail)) return "missing";
  return "unavailable";
}

export function createEditorSaveQueue(options: {
  write: (snapshot: EditorSaveSnapshot) => Promise<unknown>;
  current: () => { path: string; documentId: number; revision: number };
  onState: (state: EditorPersistenceState) => void;
  onSaved: (snapshot: EditorSaveSnapshot) => void;
  onError: (error: unknown) => void;
}) {
  let chain = Promise.resolve();
  let activeWrite: Promise<unknown> | null = null;
  const isCurrent = (snapshot: EditorSaveSnapshot) => {
    const current = options.current();
    return current.path === snapshot.path && current.documentId === snapshot.documentId;
  };
  return {
    settled: () => chain,
    activeWrite: () => activeWrite,
    save(input: EditorSaveSnapshot) {
      const snapshot = { ...input };
      const run = async () => {
        if (isCurrent(snapshot)) options.onState("saving");
        let writing: Promise<unknown> | undefined;
        try {
          writing = options.write(snapshot);
          activeWrite = writing;
          await writing;
          if (isCurrent(snapshot)) {
            options.onSaved(snapshot);
            options.onState(options.current().revision === snapshot.revision ? "saved" : "dirty");
          }
        } catch (error) {
          if (isCurrent(snapshot)) { options.onError(error); options.onState("error"); }
          throw error;
        } finally {
          if (activeWrite === writing) activeWrite = null;
        }
      };
      const pending = chain.then(run);
      chain = pending.then(() => {}, () => {});
      return pending;
    },
  };
}

/** Keep unsupported syntax in source mode rather than serialize a lossy schema. */
export function markdownProseLines(markdown: string): Array<{ text: string; offset: number }> {
  let fence: { char: string; length: number } | null = null;
  let offset = 0;
  return markdown.split("\n").map((line) => {
    const start = offset;
    offset += line.length + 1;
    const marker = line.replace(/\r$/u, "").match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    if (fence) {
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return { text: "", offset: start };
    }
    if (marker) { fence = { char: marker[1][0], length: marker[1].length }; return { text: "", offset: start }; }
    return { text: line, offset: start };
  });
}

export function markdownNeedsSource(markdown: string): boolean {
  const prose = markdownProseLines(markdown).map((line) => line.text).join("\n").replace(/(`+)[\s\S]*?\1/gu, "");
  // Image wikilinks already round-trip through editor-media's original-title marker.
  const text = prose.replace(/!\[\[([^\]\n]+)\]\]/gu, (original, target: string) => isWorkspaceImageName(target.split("|")[0]) ? "" : original)
    .replace(/<\/?u>|<(?:https?:\/\/|mailto:)[^<>\s]+>/giu, "");
  return /\[\[|\[\^[^\]\n]+\]|^ {0,3}\[[^\]\n]+\]:\s|%%|==[^=\n]+==|^ {0,3}>\s*\[![^\]\n]+\]|\^[\w-]+\s*$|(?:^|[^\\])\$[^$\n]+\$|^\s*\$\$|^\s*(?:\|\s*)?:?-+:?\s*\||^\s*[-+*]\s+\[[^ xX\]]\]|<\/?[a-z!][^>]*>/gimu.test(text);
}

export function sourceBodyFromInput(input: string, original: string): string {
  return original.includes("\r\n") && !/(?:^|[^\r])\n/u.test(original) ? input.replace(/\r?\n/gu, "\r\n") : input;
}

/** Source body includes its own leading whitespace; preserve YAML/BOM/line endings. */
export function assembleSourceDocument(original: string, body: string): string {
  const bom = original.startsWith("\uFEFF") ? "\uFEFF" : "";
  const source = original.slice(bom.length);
  const frontmatter = source.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u)?.[0] || "";
  return `${bom}${frontmatter}${body}`;
}

export function findSourceRanges(body: string, query: string): Array<{ from: number; to: number }> {
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "giu");
  const matches = [];
  for (const match of body.matchAll(pattern)) {
    matches.push({ from: match.index, to: match.index + match[0].length });
    if (matches.length === 2000) break;
  }
  return matches;
}
