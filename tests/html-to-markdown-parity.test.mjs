/**
 * Clip and Desktop must run the same htmlToMarkdown (no Lite fork).
 * Drives both shipped entry points on the same HTML fixture.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { htmlToMarkdown as desktopMd } from "../topmind-desktop/electron/lib/html-to-markdown.mjs";
import { htmlToMarkdown as clipMd } from "../browser-extension/lib/html-to-markdown.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FIXTURE = `<article>
  <h1>Title</h1>
  <p>Hello <strong>world</strong> and <a href="/x">link</a>.</p>
  <pre><code class="language-js">const x = 1;</code></pre>
  <table><tr><th>A</th></tr><tr><td>1</td></tr></table>
</article>`;

test("Desktop and Clip htmlToMarkdown produce the same markdown", () => {
  const a = desktopMd(FIXTURE, { alreadyIsolated: true, baseUrl: "https://ex.test/p" });
  const b = clipMd(FIXTURE, { alreadyIsolated: true, baseUrl: "https://ex.test/p" });
  assert.equal(a, b);
  assert.match(a, /# Title/);
  assert.match(a, /\*\*world\*\*/);
  assert.match(a, /\[link\]\(\/x\)/);
});

test("htmlToMarkdownLite is deleted from Clip simple-md", () => {
  const src = fs.readFileSync(path.join(root, "browser-extension/lib/simple-md.js"), "utf8");
  assert.doesNotMatch(src, /htmlToMarkdownLite/);
  const ws = fs.readFileSync(path.join(root, "browser-extension/lib/workspace-fs.js"), "utf8");
  assert.match(ws, /from "\.\/html-to-markdown\.mjs"/);
  assert.doesNotMatch(ws, /htmlToMarkdownLite/);
});

test("Clip html-to-markdown.mjs is a byte copy of the Desktop converter", () => {
  const desktop = fs.readFileSync(
    path.join(root, "topmind-desktop/electron/lib/html-to-markdown.mjs"),
    "utf8",
  );
  const clip = fs.readFileSync(
    path.join(root, "browser-extension/lib/html-to-markdown.mjs"),
    "utf8",
  );
  assert.equal(clip, desktop, "pack-extension must keep Clip converter identical to Desktop");
});

test("pack-extension refuses to ship when Desktop converter cannot be synced", () => {
  const src = fs.readFileSync(path.join(root, "scripts/pack-extension.mjs"), "utf8");
  assert.match(src, /refusing to pack: could not sync html-to-markdown/u);
  assert.doesNotMatch(src, /warn: could not sync html-to-markdown/u);
});
