import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAssetPath } from "../electron/lib/embed-images.mjs";
import { registerMediaProtocolHandler } from "../electron/lib/media-protocol.mjs";
import {
  decodeRemoteAssetUrl,
  mediaUrlsForDisk,
  mediaUrlsForEditor,
  remoteAssetUrl,
  resolveNoteMediaPath,
  rewritePreviewHtmlMedia,
  wikiImageDomAttrs,
} from "../src/lib/editor-media.ts";
import { streamMarkdownToPreviewHtml } from "../src/lib/stream-md-preview.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOTE = "00-收件箱/clip.md";
const PATHS = [
  "attachments/foo.png",
  "attachments/Pasted image x.png",
  "20-研究/deep/Pasted image 20241010120000.png",
  "z/dup.png",
  "a/b/c/dup.png",
  "b/aa.png",
  "m/aa.png",
  "Attachments/Photo.PNG",
  "media/clip.mp3",
  "docs/other-note.md",
  "docs/file.pdf",
];

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

test("obsidian image embeds resolve on the editor path and round-trip as wikilinks", () => {
  const cases = [
    "![[Pasted image 20241010120000.png]]",
    "![[attachments/foo.png]]",
    "![[attachments/foo.png|300]]",
    "![[attachments/foo.png|300x200]]",
    "![[dup.png|caption]]",
    "![[foo.png|my caption]]",
  ];
  for (const disk of cases) {
    const view = mediaUrlsForEditor(disk, NOTE, PATHS);
    assert.match(view, /topmind-asset:\/\/local\//, disk);
    assert.doesNotMatch(view, /!\[\[/, disk);
    assert.equal(mediaUrlsForDisk(view, NOTE), disk, disk);
  }

  const pasted = mediaUrlsForEditor("![[Pasted image 20241010120000.png]]", NOTE, PATHS);
  const pastedSrc = pasted.match(/\((topmind-asset:\/\/local\/[^)\s]+)/u)?.[1] || "";
  assert.match(pastedSrc, /20-研究\/deep\/Pasted%20image%2020241010120000\.png/);
  assert.doesNotMatch(pastedSrc, / /u);

  const vault = mediaUrlsForEditor("![[attachments/foo.png]]", NOTE, PATHS);
  assert.match(vault, /topmind-asset:\/\/local\/attachments\/foo\.png/);

  const sized = mediaUrlsForEditor("![[attachments/foo.png|300]]", NOTE, PATHS);
  assert.match(sized, /"tmw:attachments%2Ffoo\.png%7C300"/);

  const box = wikiImageDomAttrs(`tmw:${encodeURIComponent("attachments/foo.png|300x200")}`);
  assert.equal(box.width, "300");
  assert.match(box.style, /max-width:100%/);
  assert.match(box.style, /height:auto/);
  assert.doesNotMatch(box.style, /height:\s*200/);

  const caption = wikiImageDomAttrs(`tmw:${encodeURIComponent("dup.png|caption")}`);
  assert.equal(caption.width, undefined);
  assert.match(caption.style, /max-width:100%/);

  const shortest = mediaUrlsForEditor("![[dup.png]]", NOTE, PATHS);
  assert.match(shortest, /topmind-asset:\/\/local\/z\/dup\.png/);
  assert.doesNotMatch(shortest, /a\/b\/c\/dup\.png/);

  const tie = mediaUrlsForEditor("![[aa.png]]", NOTE, PATHS);
  assert.match(tie, /topmind-asset:\/\/local\/b\/aa\.png/);

  const folded = mediaUrlsForEditor("![[photo.png]]", NOTE, PATHS);
  assert.match(folded, /topmind-asset:\/\/local\/Attachments\/Photo\.PNG/);
});

test("spaced and percent-encoded markdown images round-trip to the same relative path", () => {
  const spaced = "![](<Pasted image x.png>)";
  const spacedView = mediaUrlsForEditor(spaced, NOTE, []);
  assert.match(spacedView, /topmind-asset:\/\/local\/00-收件箱\/Pasted%20image%20x\.png/);
  assert.doesNotMatch(spacedView, /Pasted image x/);
  assert.equal(mediaUrlsForDisk(spacedView, NOTE), spaced);

  const encoded = "![](Pasted%20image%20x.png)";
  const encodedView = mediaUrlsForEditor(encoded, NOTE, PATHS);
  assert.match(encodedView, /topmind-asset:\/\/local\/00-收件箱\/Pasted%20image%20x\.png/);
  assert.doesNotMatch(encodedView, /Pasted image x/);
  const back = mediaUrlsForDisk(encodedView, NOTE);
  assert.equal(back, "![](<Pasted image x.png>)");
  assert.match(back, /Pasted image x\.png/);
});

test("fenced code, non-images, and missing targets stay text", () => {
  const fenced = "```\n![[attachments/foo.png]]\n```\n\n`![[attachments/foo.png]]`\n";
  assert.equal(mediaUrlsForEditor(fenced, NOTE, PATHS), fenced);

  const untouched = [
    "![[other-note.md]]",
    "![[docs/file.pdf]]",
    "![[clip.mp3]]",
    "![[other-note.md#^id]]",
  ];
  for (const disk of untouched) {
    assert.equal(mediaUrlsForEditor(disk, NOTE, PATHS), disk);
  }

  const missing = "![[gone.png|My caption]]";
  assert.equal(mediaUrlsForEditor(missing, NOTE, PATHS), missing);
  const html = streamMarkdownToPreviewHtml(missing, NOTE, PATHS);
  assert.doesNotMatch(html, /<img/i);
  assert.doesNotMatch(html, /src=""/);
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /file:/i);
  assert.match(html, /My caption|gone\.png/);

  const hostile = streamMarkdownToPreviewHtml(
    "![x](javascript:alert(1))\n\n![y](file:///tmp/a.png)",
    NOTE,
    PATHS,
  );
  assert.doesNotMatch(hostile, /<img/i);
  assert.doesNotMatch(hostile, /src=""/);
  assert.doesNotMatch(hostile, /javascript:/i);
  assert.doesNotMatch(hostile, /file:/i);
});

test("path list policy: optimistic pathed embeds, strict list, markdown always rewrites", () => {
  const open = mediaUrlsForEditor(
    "![[attachments/foo.png]]\n\n![[only-here.png]]",
    NOTE,
  );
  assert.match(open, /topmind-asset:\/\/local\/attachments\/foo\.png/);
  assert.match(open, /!\[\[only-here\.png\]\]/);

  const strict = mediaUrlsForEditor("![[attachments/foo.png]]", NOTE, ["z/dup.png"]);
  assert.equal(strict, "![[attachments/foo.png]]");

  const local = mediaUrlsForEditor("![a](images/slug/img-abc.png)", NOTE, []);
  assert.match(local, /topmind-asset:\/\/local\/00-收件箱\/images\/slug\/img-abc\.png/);
});

test("many embeds resolve from one path list and the rewrite does not walk the disk", () => {
  const md = Array.from({ length: 30 }, () => "![[attachments/foo.png]]").join("\n");
  const view = mediaUrlsForEditor(md, NOTE, PATHS);
  assert.equal(view.split("topmind-asset://local/attachments/foo.png").length - 1, 30);
  assert.doesNotMatch(view, /!\[\[/);
  const src = readFileSync(path.join(root, "electron/lib/embed-images.mjs"), "utf8");
  assert.doesNotMatch(src, /node:fs|node:fs\/promises|readdir|listDir|readFileSync/);
});

test("preview HTML renders resolved embeds as lazy capped images", () => {
  const sized = streamMarkdownToPreviewHtml("![[attachments/foo.png|300]]", NOTE, PATHS);
  assert.match(sized, /<img/i);
  assert.match(sized, /src="topmind-asset:\/\/local\/attachments\/foo\.png"/);
  assert.match(sized, /loading="lazy"/);
  assert.match(sized, /alt="foo\.png"/);
  assert.match(sized, /width="300"/);
  assert.match(sized, /max-width:100%/);
  assert.doesNotMatch(sized, /src=""/);
  assert.doesNotMatch(sized, /javascript:/i);
  assert.doesNotMatch(sized, /file:/i);

  const box = streamMarkdownToPreviewHtml("![[attachments/foo.png|300x200]]", NOTE, PATHS);
  assert.match(box, /width="300"/);
  assert.match(box, /max-width:100%/);
  assert.match(box, /height:auto/);
  assert.doesNotMatch(box, /height="200"/);

  const caption = streamMarkdownToPreviewHtml("![[dup.png|caption]]", NOTE, PATHS);
  assert.match(caption, /src="topmind-asset:\/\/local\/z\/dup\.png"/);
  assert.match(caption, /alt="caption"/);
  assert.match(caption, /loading="lazy"/);
  assert.doesNotMatch(caption, /width="/);

  const pasted = streamMarkdownToPreviewHtml(
    "![[Pasted image 20241010120000.png]]",
    NOTE,
    PATHS,
  );
  assert.match(
    pasted,
    /src="topmind-asset:\/\/local\/20-研究\/deep\/Pasted%20image%2020241010120000\.png"/,
  );
  assert.match(pasted, /alt="Pasted image 20241010120000\.png"/);
  assert.match(pasted, /loading="lazy"/);

  const mdImg = streamMarkdownToPreviewHtml("![](<Pasted image x.png>)", NOTE, PATHS);
  assert.match(mdImg, /src="topmind-asset:\/\/local\/00-收件箱\/Pasted%20image%20x\.png"/);
  assert.match(mdImg, /loading="lazy"/);

  const fenced = streamMarkdownToPreviewHtml(
    "```\n![[attachments/foo.png]]\n```\n\n![[attachments/foo.png]]",
    NOTE,
    PATHS,
  );
  assert.equal(fenced.split("topmind-asset://local/attachments/foo.png").length - 1, 1);
  assert.match(fenced, /!\[\[attachments\/foo\.png\]\]/);
});

test("html img with a wikilink title restores the original embed", () => {
  const html =
    '<img src="topmind-asset://local/attachments/foo.png" title="tmw:attachments%2Ffoo.png%7C300" alt="foo.png">';
  assert.equal(mediaUrlsForDisk(html, NOTE), "![[attachments/foo.png|300]]");
});

test("editor view applies width from the wikilink title and treats image nodes as content", () => {
  const view = readFileSync(
    path.join(root, "src/plugins/topmind-workspace/views/FileEditorView.tsx"),
    "utf8",
  );
  assert.match(view, /wikiImageDomAttrs/);
  assert.match(view, /editorDocumentHasContent/);
  assert.match(view, /ensureWorkspaceImagePaths/);
  assert.match(view, /invalidateWorkspaceImagePaths/);
  assert.match(view, /loading:\s*"lazy"/);
  const hook = readFileSync(
    path.join(root, "src/lib/use-workspace-image-paths.ts"),
    "utf8",
  );
  assert.match(hook, /workspace:file-changed/);
  assert.match(hook, /invalidateWorkspaceImagePaths/);
  const cache = readFileSync(
    path.join(root, "src/lib/workspace-image-paths.ts"),
    "utf8",
  );
  assert.doesNotMatch(cache, /plugins\/host|view-store/);
});

test("ampersand and percent in image paths survive preview and save", () => {
  const qa = mediaUrlsForEditor("![[Q&A.png]]", NOTE, ["Q&A.png"]);
  const qaSrc = qa.match(/\((topmind-asset:\/\/local\/[^)\s]+)/u)?.[1] || "";
  assert.match(qaSrc, /\/Q%26A\.png$/u);
  assert.doesNotMatch(qaSrc, /&/u);
  assert.equal(mediaUrlsForDisk(qa, NOTE), "![[Q&A.png]]");
  const qaHtml = streamMarkdownToPreviewHtml("![[Q&A.png]]", NOTE, ["Q&A.png"]);
  assert.match(qaHtml, /<img/i);
  assert.match(qaHtml, /src="topmind-asset:\/\/local\/Q%26A\.png"/);
  assert.match(qaHtml, /loading="lazy"/);
  assert.doesNotMatch(qaHtml, /<p>Q&amp;A\.png<\/p>/);

  const note = "20-研究/100%-方案/note.md";
  const view = mediaUrlsForEditor("![a](images/s/a.png)", note, []);
  assert.match(view, /topmind-asset:\/\/local\/20-研究\/100%25-方案\/images\/s\/a\.png/);
  assert.doesNotMatch(view, /100%-方案/);
  assert.match(view, /方案/);
  assert.equal(mediaUrlsForDisk(view, note), "![a](images/s/a.png)");
  const bare = "![a](topmind-asset://local/20-研究/100%-方案/images/s/a.png)";
  assert.equal(mediaUrlsForDisk(bare, note), "![a](images/s/a.png)");
  const encoded = "![a](topmind-asset://local/20-研究/100%25-方案/images/s/a.png)";
  assert.equal(mediaUrlsForDisk(encoded, note), "![a](images/s/a.png)");
  const html = streamMarkdownToPreviewHtml("![a](images/s/a.png)", note, []);
  assert.match(html, /src="topmind-asset:\/\/local\/20-研究\/100%25-方案\/images\/s\/a\.png"/);
  assert.match(html, /方案/);
  assert.match(html, /loading="lazy"/);
});

test("protocol handler serves literal percent paths instead of returning 500", async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "tm-asset-pct-"));
  const ws = path.join(tmp, "ws");
  const rel = "20-研究/100%-方案/images/s/a.png";
  const abs = path.join(ws, ...rel.split("/"));
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, Buffer.from("png"));
  const qaAbs = path.join(ws, "Q&A.png");
  writeFileSync(qaAbs, Buffer.from("qa"));
  const fetched: string[] = [];
  let handler: ((req: { url: string }) => Promise<Response>) | null = null;
  registerMediaProtocolHandler(
    {
      protocol: {
        handle: (_scheme: string, fn: (req: { url: string }) => Promise<Response>) => {
          handler = fn;
        },
      },
      net: {
        fetch: async (href: string) => {
          fetched.push(href);
          return new Response("ok", { status: 200 });
        },
      },
    },
    () => ({ userWorkspaceRoot: ws, engineRoot: tmp }),
  );
  assert.ok(handler);
  const encodedUrl = `topmind-asset://local/${encodeAssetPath(rel)}`;
  assert.match(encodedUrl, /100%25-方案/);
  const encodedRes = await handler!({ url: encodedUrl });
  assert.equal(encodedRes.status, 200);
  const rawRes = await handler!({
    url: `topmind-asset://local/${rel}`,
  });
  assert.equal(rawRes.status, 200);
  const qaRes = await handler!({
    url: `topmind-asset://local/${encodeAssetPath("Q&A.png")}`,
  });
  assert.equal(qaRes.status, 200);
  assert.ok(fetched.length >= 3);
  rmSync(tmp, { recursive: true, force: true });
});
