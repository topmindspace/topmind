/**
 * Clip image localization helpers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  clipImageSlug,
  localizeMarkdownImages,
  resolveMediaUrl,
  findMarkdownImages,
} from "../electron/lib/clip-images.mjs";
import { pickImgSrc, resolveMarkdownMediaUrls } from "../electron/lib/html-to-markdown.mjs";

test("clipImageSlug sanitizes title", () => {
  assert.equal(clipImageSlug("Hello World"), "Hello-World");
  assert.doesNotMatch(clipImageSlug("a/b:c"), /[/:]/);
  assert.ok(clipImageSlug("").length > 0);
});

test("resolveMediaUrl handles absolute, protocol-relative, relative", () => {
  assert.equal(
    resolveMediaUrl("https://cdn.example/a.png"),
    "https://cdn.example/a.png",
  );
  assert.equal(
    resolveMediaUrl("//cdn.example/a.png", "https://blog.example/post"),
    "https://cdn.example/a.png",
  );
  assert.equal(
    resolveMediaUrl("/img/x.jpg", "https://blog.example/a/b"),
    "https://blog.example/img/x.jpg",
  );
  assert.equal(
    resolveMediaUrl("../x.png", "https://blog.example/a/b/"),
    "https://blog.example/a/x.png",
  );
  assert.equal(resolveMediaUrl("data:image/png;base64,xx"), null);
  assert.equal(resolveMediaUrl("/x.png"), null); // no base
});

test("findMarkdownImages finds multiple forms", () => {
  const md = [
    "![a](https://x/a.png)",
    "![b](//cdn/b.jpg)",
    '![c](/rel/c.webp "title")',
  ].join("\n");
  const hits = findMarkdownImages(md);
  assert.equal(hits.length, 3);
  assert.equal(hits[0].url, "https://x/a.png");
  assert.equal(hits[1].url, "//cdn/b.jpg");
  assert.equal(hits[2].url, "/rel/c.webp");
});

test("pickImgSrc prefers data-src / srcset over empty placeholder src", () => {
  const tag =
    '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-src="https://cdn.example/real.png" alt="x">';
  assert.equal(pickImgSrc(tag), "https://cdn.example/real.png");
  const ss =
    '<img srcset="https://cdn.example/s.jpg 480w, https://cdn.example/l.jpg 1200w" alt="">';
  assert.equal(pickImgSrc(ss), "https://cdn.example/l.jpg");
});

test("resolveMarkdownMediaUrls rewrites relative images", () => {
  const md = "![a](/static/a.png)\n![b](//cdn/b.png)";
  const out = resolveMarkdownMediaUrls(md, "https://news.example/p/1");
  assert.match(out, /https:\/\/news\.example\/static\/a\.png/);
  assert.match(out, /https:\/\/cdn\/b\.png/);
});

test("localizeMarkdownImages no-op without remote images", async () => {
  const r = await localizeMarkdownImages("# hi\n\nno images", {
    imagesDirAbs: path.join(os.tmpdir(), "mh-clip-empty"),
    relPrefix: "00-收件箱/images/x",
  });
  assert.equal(r.downloaded, 0);
  assert.equal(r.failed, 0);
  assert.match(r.markdown, /no images/);
});

test("localizeMarkdownImages rewrites downloaded png (mock fetch)", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mh-clip-img-"));
  const png1x1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(png1x1, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  try {
    const md = "See ![a](https://cdn.example/a.png) and again ![b](https://cdn.example/a.png)";
    const r = await localizeMarkdownImages(md, {
      imagesDirAbs: dir,
      relPrefix: "images/demo",
      baseUrl: "https://blog.example/post",
      referer: "https://blog.example/post",
    });
    assert.equal(r.downloaded, 1);
    assert.equal(r.failed, 0);
    assert.match(r.markdown, /images\/demo\/img-/);
    assert.doesNotMatch(r.markdown, /cdn\.example/);
    const files = await fs.readdir(dir);
    assert.equal(files.length, 1);
  } finally {
    globalThis.fetch = origFetch;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("localizeMarkdownImages resolves relative URL with baseUrl", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mh-clip-rel-"));
  const png1x1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const origFetch = globalThis.fetch;
  /** @type {string[]} */
  const fetched = [];
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    return new Response(png1x1, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  };
  try {
    const md = "![r](/assets/pic.png)";
    const r = await localizeMarkdownImages(md, {
      imagesDirAbs: dir,
      relPrefix: "images/rel",
      baseUrl: "https://site.example/article/1",
    });
    assert.equal(r.downloaded, 1);
    assert.ok(fetched.some((u) => u === "https://site.example/assets/pic.png"));
    assert.match(r.markdown, /images\/rel\/img-/);
  } finally {
    globalThis.fetch = origFetch;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
