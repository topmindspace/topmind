import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mediaUrlsForDisk,
  mediaUrlsForEditor,
  resolveNoteMediaPath,
} from "../src/lib/editor-media.ts";

test("resolveNoteMediaPath joins note dir", () => {
  assert.equal(
    resolveNoteMediaPath("00-收件箱/foo.md", "images/s/a.png"),
    "00-收件箱/images/s/a.png",
  );
  assert.equal(
    resolveNoteMediaPath("20-研究/2026-主题/note.md", "./images/x/y.png"),
    "20-研究/2026-主题/images/x/y.png",
  );
});

test("mediaUrlsForEditor / ForDisk round-trip", () => {
  const note = "00-收件箱/clip.md";
  const disk = "Hello\n\n![a](images/slug/img-abc.png)\n";
  const view = mediaUrlsForEditor(disk, note);
  assert.match(view, /topmind-asset:\/\/local\/00-收件箱\/images\/slug\/img-abc\.png/);
  const back = mediaUrlsForDisk(view, note);
  assert.equal(back, disk);
});

test("mediaUrlsForEditor leaves remote urls alone", () => {
  const md = "![r](https://cdn.example/x.png)";
  assert.equal(mediaUrlsForEditor(md, "00-收件箱/a.md"), md);
});
