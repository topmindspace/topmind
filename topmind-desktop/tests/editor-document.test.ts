import test from "node:test";
import assert from "node:assert/strict";
import { assembleSourceDocument, createEditorSaveQueue, editorSaveFailureReason, findSourceRanges, markdownNeedsSource, sourceBodyFromInput } from "../src/lib/editor-document.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture() {
  const current = { path: "a.md", documentId: 1, revision: 1 };
  const states: string[] = [], saved: string[] = [], errors: unknown[] = [];
  const writes: Array<{ content: string; resolve: () => void; reject: (error: Error) => void }> = [];
  const queue = createEditorSaveQueue({
    current: () => current,
    write: (snapshot) => new Promise<void>((resolve, reject) => writes.push({ content: snapshot.content, resolve, reject })),
    onState: (state) => states.push(state), onSaved: (snapshot) => saved.push(snapshot.content), onError: (error) => errors.push(error),
  });
  return { queue, current, states, saved, errors, writes, snapshot: () => ({ ...current, content: "first" }) };
}

test("a completed save does not mark newer edits as saved", async () => {
  const f = fixture(); const pending = f.queue.save(f.snapshot()); await tick();
  f.current.revision++;
  f.writes[0].resolve(); await pending;
  assert.deepEqual(f.states, ["saving", "dirty"]);
  assert.deepEqual(f.saved, ["first"]);
});

test("save errors classify actionable reasons without displaying transport details", () => {
  assert.equal(editorSaveFailureReason(new Error("Error invoking remote method rpc:invoke: EACCES: /private/path")), "permission");
  assert.equal(editorSaveFailureReason({ code: "ENOSPC" }), "space");
  assert.equal(editorSaveFailureReason(new Error("ENOENT: file moved")), "missing");
  assert.equal(editorSaveFailureReason(new Error("unexpected transport")), "unavailable");
});
test("failed saves retain the error and the same content can be retried", async () => {
  const f = fixture(); const first = f.queue.save(f.snapshot()); const rejection = assert.rejects(first, /disk full/); await tick();
  f.writes[0].reject(new Error("disk full")); await rejection;
  const retry = f.queue.save(f.snapshot()); await tick(); f.writes[1].resolve(); await retry;
  assert.equal(f.writes[1].content, "first");
  assert.deepEqual(f.states, ["saving", "error", "saving", "saved"]);
});
test("queued snapshots are captured before later document edits", async () => {
  const f = fixture(); const input = f.snapshot();
  const first = f.queue.save(input); const second = f.queue.save({ ...input, content: "second", revision: 2 }); input.content = "mutated";
  await tick(); assert.equal(f.writes.length, 1); assert.equal(f.writes[0].content, "first");
  f.writes[0].resolve(); await first; await tick(); assert.equal(f.writes[1].content, "second"); f.writes[1].resolve(); await second;
});
test("returning to the same path cannot revive an older document save", async () => {
  const f = fixture(); const first = f.queue.save(f.snapshot()); await tick();
  f.current.documentId += 2; f.states.length = 0; f.writes[0].resolve(); await first;
  assert.deepEqual(f.states, []); assert.deepEqual(f.saved, []);
});
test("Obsidian and GFM syntax that the visual schema cannot preserve uses source editing", () => {
  for (const body of ["| A | B |\n| --- | --- |\n| C | D |", "[[Note#Heading|Alias]]", "![[Note#^block]]", "Text ^block", "Text[^x]\n\n[^x]: note", "%%comment%%", "==highlight==", "> [!note]- Title\n> Body", "$x + y$", "$$\nx\n$$", "<div>body</div>", "<!-- comment -->"]) assert.equal(markdownNeedsSource(body), true, body);
});
test("ordinary Markdown, supported images and code examples retain visual editing", () => {
  for (const body of ["# Title\n\n**Text**\n\n- [ ] Task", "![[image.png|300]]", "![image](images/a.png)", "`[[literal]]`", "````md\n```\n[[literal]]\n```\n````", "~~~\n%%literal%%\n~~~"]) assert.equal(markdownNeedsSource(body), false, body);
});
test("source editing preserves YAML, BOM, CRLF and leading blank lines", () => {
  const original = "\uFEFF---\r\naliases: [A, B]\r\ncustom: untouched\r\n---\r\n\r\nBody\r\n";
  assert.equal(assembleSourceDocument(original, "\r\nBody changed\r\n"), original.replace("Body", "Body changed"));
  assert.equal(assembleSourceDocument("\uFEFFBody", "Changed"), "\uFEFFChanged");
  assert.equal(sourceBodyFromInput("Body\nChanged\n", original), "Body\r\nChanged\r\n");
  assert.equal(sourceBodyFromInput("Body\n", "Original\n"), "Body\n");
});

test("reference definitions and nonstandard task statuses remain intact in source", () => {
  for (const body of ["[target]: https://example.com", "- [/] In progress", "| A | B |\n| - | - |\n| C | D |", "A | B\n- | -\nC | D", "![[image.svg]]", "![[image.avif]]"]) assert.equal(markdownNeedsSource(body), true, body);
  for (const body of ["<u>Underline</u>", "<https://example.com>"]) assert.equal(markdownNeedsSource(body), false, body);
});

test("source search is literal, case insensitive, bounded and reports original text offsets", () => {
  const body = "😀 A.b / A.B / AxB";
  assert.deepEqual(findSourceRanges(body, "a.b"), [{ from: 3, to: 6 }, { from: 9, to: 12 }]);
  assert.deepEqual(findSourceRanges(body, ""), []);
  assert.equal(findSourceRanges("a ".repeat(2100), "a").length, 2000);
});
