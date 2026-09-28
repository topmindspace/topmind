/**
 * GitHub URL semantics (pure, no network).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseGithubFileUrl,
  parseGithubRepoReadmeTarget,
  isGithubMarkdownFileUrl,
  githubRawUrl,
  githubBlobUrl,
  rewriteGithubMarkdownImages,
  rewriteGithubImageSrc,
  classifyCaptureUrl,
  preferGithubRawUrl,
  titleFromMarkdown,
  headingTitleFromMarkdown,
} from "../lib/github-md.mjs";

test("parseGithubFileUrl handles blob and raw markdown", () => {
  const blob = parseGithubFileUrl("https://github.com/acme/notes/blob/main/docs/a.md");
  assert.deepEqual(blob, { owner: "acme", repo: "notes", ref: "main", path: "docs/a.md" });

  const raw = parseGithubFileUrl("https://raw.githubusercontent.com/acme/notes/main/README.md");
  assert.deepEqual(raw, { owner: "acme", repo: "notes", ref: "main", path: "README.md" });

  assert.equal(parseGithubFileUrl("https://github.com/acme/notes/blob/main/img.png"), null);
  assert.equal(parseGithubFileUrl("https://github.com/acme/notes/issues/1"), null);
});

test("parseGithubRepoReadmeTarget handles root and tree", () => {
  assert.deepEqual(parseGithubRepoReadmeTarget("https://github.com/acme/notes"), {
    owner: "acme",
    repo: "notes",
  });
  assert.deepEqual(parseGithubRepoReadmeTarget("https://github.com/acme/notes/"), {
    owner: "acme",
    repo: "notes",
  });
  assert.deepEqual(parseGithubRepoReadmeTarget("https://github.com/acme/notes/tree/dev/docs"), {
    owner: "acme",
    repo: "notes",
    ref: "dev",
    subdir: "docs",
  });
  assert.equal(parseGithubRepoReadmeTarget("https://github.com/acme/notes/issues/2"), null);
  assert.equal(parseGithubRepoReadmeTarget("https://example.com/x"), null);
});

test("isGithubMarkdownFileUrl and preferGithubRawUrl", () => {
  assert.equal(isGithubMarkdownFileUrl("https://github.com/a/b"), true);
  assert.equal(isGithubMarkdownFileUrl("https://github.com/a/b/blob/main/x.md"), true);
  assert.equal(isGithubMarkdownFileUrl("https://github.com/a/b/pulls"), false);
  assert.equal(
    preferGithubRawUrl("https://github.com/a/b/blob/main/x.md"),
    "https://raw.githubusercontent.com/a/b/main/x.md",
  );
  assert.equal(preferGithubRawUrl("https://example.com/p"), "https://example.com/p");
});

test("rewriteGithubMarkdownImages resolves relative and blob links", () => {
  const ref = { owner: "a", repo: "b", ref: "main", path: "docs/guide.md" };
  const md = rewriteGithubMarkdownImages(
    "![logo](../assets/logo.png)\n\n![blob](https://github.com/a/b/blob/main/docs/pic.jpg)\n\n[text](https://example.com)",
    ref,
  );
  assert.match(md, /https:\/\/raw\.githubusercontent\.com\/a\/b\/main\/assets\/logo\.png/);
  assert.match(md, /https:\/\/raw\.githubusercontent\.com\/a\/b\/main\/docs\/pic\.jpg/);
  assert.match(md, /\[text\]\(https:\/\/example\.com\)/);
});

test("rewriteGithubImageSrc keeps absolute non-github urls", () => {
  const ref = { owner: "a", repo: "b", ref: "main", path: "x.md" };
  assert.equal(rewriteGithubImageSrc("https://cdn.example.com/i.png", ref), "https://cdn.example.com/i.png");
  assert.equal(rewriteGithubImageSrc("data:image/png;base64,xx", ref), "data:image/png;base64,xx");
  assert.match(rewriteGithubImageSrc("./pic.png", ref), /raw\.githubusercontent\.com\/a\/b\/main\/pic\.png/);
});

test("classifyCaptureUrl routes github / x / web", () => {
  assert.equal(classifyCaptureUrl("https://github.com/a/b/blob/main/x.md")?.kind, "github-file");
  assert.equal(classifyCaptureUrl("https://github.com/a/b")?.kind, "github-readme");
  assert.equal(classifyCaptureUrl("https://github.com/a/b/pulls")?.kind, "github-other");
  assert.equal(classifyCaptureUrl("https://x.com/u/status/123")?.kind, "x-status");
  assert.equal(classifyCaptureUrl("https://x.com/i/article/9")?.kind, "x-article");
  assert.equal(classifyCaptureUrl("https://example.com/post")?.kind, "web");
  assert.equal(classifyCaptureUrl("not a url"), null);
});

test("title helpers prefer H1", () => {
  assert.equal(headingTitleFromMarkdown("# Hello World\n\nbody"), "Hello World");
  assert.equal(titleFromMarkdown("# Hello\nbody", "docs/notes/guide.md"), "Hello");
  assert.equal(titleFromMarkdown("no heading", "docs/guide.md"), "guide");
});

test("githubRawUrl / githubBlobUrl shapes", () => {
  const ref = { owner: "a", repo: "b", ref: "v1", path: "docs/x.md" };
  assert.equal(githubRawUrl(ref), "https://raw.githubusercontent.com/a/b/v1/docs/x.md");
  assert.equal(githubBlobUrl(ref), "https://github.com/a/b/blob/v1/docs/x.md");
});
