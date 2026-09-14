import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mediaUrlsForDisk,
  mediaUrlsForEditor,
  resolveNoteMediaPath,
  rewritePreviewHtmlMedia,
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

test("rewritePreviewHtmlMedia maps relative img src to topmind-asset", () => {
  const html = '<p>x</p><img src="images/slug/a.png" alt="a">';
  const out = rewritePreviewHtmlMedia(html, "00-收件箱/clip.md");
  assert.match(out, /topmind-asset:\/\/local\/00-收件箱\/images\/slug\/a\.png/);
  const remote = '<img src="https://cdn.example/x.png" alt="r">';
  assert.equal(rewritePreviewHtmlMedia(remote, "00-收件箱/a.md"), remote);
});

test("mediaUrlsForEditor leaves remote urls alone", () => {
  const md = "![r](https://cdn.example/x.png)";
  assert.equal(mediaUrlsForEditor(md, "00-收件箱/a.md"), md);
});

test("mediaUrlsForEditor / ForDisk round-trip HTML <img src>", () => {
  const note = "00-收件箱/clip.md";
  const disk = 'Hello\n\n<img src="images/slug/img-abc.png" alt="a">\n';
  const view = mediaUrlsForEditor(disk, note);
  assert.match(view, /topmind-asset:\/\/local\/00-收件箱\/images\/slug\/img-abc\.png/);
  const back = mediaUrlsForDisk(view, note);
  assert.equal(back, disk);
  const remote = '<img src="https://cdn.example/x.png" alt="r">';
  assert.equal(mediaUrlsForEditor(remote, note), remote);
});

test("mediaUrlsForDisk survives literal % in the asset path", () => {
  // Renderer percent-encodes `%` as `%25`; a bare `%` must not throw either.
  const note = "20-研究/100%-方案/note.md";
  const encoded = "![a](topmind-asset://local/20-研究/100%25-方案/images/s/a.png)";
  assert.equal(mediaUrlsForDisk(encoded, note), "![a](images/s/a.png)");
  const bare = "![a](topmind-asset://local/20-研究/100%-方案/images/s/a.png)";
  assert.equal(mediaUrlsForDisk(bare, note), "![a](images/s/a.png)");
});
