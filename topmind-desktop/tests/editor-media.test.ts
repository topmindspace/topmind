import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeRemoteAssetUrl,
  mediaUrlsForDisk,
  mediaUrlsForEditor,
  remoteAssetUrl,
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
});

test("rewritePreviewHtmlMedia proxies remote images via topmind-asset remote", () => {
  const remote = '<img src="https://cdn.example/x.png" alt="r">';
  const out = rewritePreviewHtmlMedia(remote, "00-收件箱/a.md");
  assert.match(out, /topmind-asset:\/\/remote\//);
  assert.doesNotMatch(out, /src="https:\/\/cdn\.example/);
  assert.equal(
    decodeRemoteAssetUrl(out.match(/src="([^"]+)"/)![1]),
    "https://cdn.example/x.png",
  );
});

test("mediaUrlsForEditor proxies remote urls for CSP-safe display", () => {
  const md = "![r](https://pbs.twimg.com/media/a.jpg)";
  const view = mediaUrlsForEditor(md, "00-收件箱/a.md");
  assert.match(view, /topmind-asset:\/\/remote\//);
  assert.doesNotMatch(view, /https:\/\/pbs\.twimg\.com\/media\/a\.jpg\)/);
  // Disk form keeps the original remote URL (localize step downloads later).
  // Round-trip only maps local assets — remote stays remote on disk.
  assert.equal(view.includes("topmind-asset://remote/"), true);
});

test("remoteAssetUrl encodes and decodeRemoteAssetUrl restores", () => {
  const url = "https://pbs.twimg.com/media/HTOFnUubgAALzw8.jpg";
  const proxied = remoteAssetUrl(url);
  assert.match(proxied, /^topmind-asset:\/\/remote\//);
  assert.equal(decodeRemoteAssetUrl(proxied), url);
});

test("mediaUrlsForEditor / ForDisk round-trip HTML <img src>", () => {
  const note = "00-收件箱/clip.md";
  const disk = 'Hello\n\n<img src="images/slug/img-abc.png" alt="a">\n';
  const view = mediaUrlsForEditor(disk, note);
  assert.match(view, /topmind-asset:\/\/local\/00-收件箱\/images\/slug\/img-abc\.png/);
  const back = mediaUrlsForDisk(view, note);
  assert.equal(back, disk);
});

test("mediaUrlsForDisk survives literal % in the asset path", () => {
  // Renderer percent-encodes `%` as `%25`; a bare `%` must not throw either.
  const note = "20-研究/100%-方案/note.md";
  const encoded = "![a](topmind-asset://local/20-研究/100%25-方案/images/s/a.png)";
  assert.equal(mediaUrlsForDisk(encoded, note), "![a](images/s/a.png)");
  const bare = "![a](topmind-asset://local/20-研究/100%-方案/images/s/a.png)";
  assert.equal(mediaUrlsForDisk(bare, note), "![a](images/s/a.png)");
});

test("mediaUrlsForDisk leaves remote proxy urls untouched (not local assets)", () => {
  const note = "00-收件箱/a.md";
  const view = "![r](topmind-asset://remote/https%3A%2F%2Fcdn.example%2Fx.png)";
  const back = mediaUrlsForDisk(view, note);
  assert.equal(back, view);
});
