/**
 * URL capture / article extraction tests (no network).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractArticle, cleanCaptureUrl } from "../electron/lib/fetch-article.mjs";
import { htmlToMarkdown, extractMeta } from "../electron/lib/html-to-markdown.mjs";
import { decodeBuffer, fetchOps } from "../electron/lib/workspace-fetch-ops.mjs";

test("cleanCaptureUrl strips utm and keeps path", () => {
  const clean = cleanCaptureUrl("https://example.com/a/b?utm_source=x&id=1&fbclid=zz#frag");
  assert.equal(clean, "https://example.com/a/b?id=1");
});

test("extractArticle uses Readability on article HTML", () => {
  const html = `<!DOCTYPE html><html><head>
    <title>Test Page Title</title>
    <meta property="og:title" content="OG Title" />
    <meta name="description" content="A short desc" />
  </head><body>
    <nav>Menu ignore me</nav>
    <article>
      <h1>Readable Heading</h1>
      <p>This is a long enough paragraph for readability to extract meaningful content about web capture quality and cleaning.</p>
      <p>Second paragraph continues with more words so charThreshold is satisfied for extraction engines.</p>
    </article>
    <aside class="ads">Buy now</aside>
  </body></html>`;
  const art = extractArticle(html, { url: "https://example.com/post" });
  assert.ok(art.text.length > 40);
  assert.ok(art.wordCount > 10);
  assert.match(art.text, /paragraph|Readable|content/i);
  // Should not keep nav/ads heavily
  assert.doesNotMatch(art.text, /Buy now/i);
  assert.ok(art.title);
  assert.ok(art.method === "readability" || art.method === "heuristic");
  assert.equal(typeof art.truncated, "boolean");
  assert.equal(typeof art.extractedChars, "number");
  assert.equal(art.truncated, false);
});

test("extractArticle marks truncated when maxLen is tiny", () => {
  const para = "Word ".repeat(200);
  const html = `<!DOCTYPE html><html><body><article><h1>Long</h1><p>${para}</p></article></body></html>`;
  const art = extractArticle(html, { url: "https://example.com/long", maxLen: 120 });
  assert.equal(art.truncated, true);
  assert.match(art.text, /内容已截断/);
  assert.ok(art.extractedChars <= 120 + 20);
});

test("buildFetchResult surfaces SPA warning for empty shells", async () => {
  const { buildFetchResult } = await import("../electron/lib/workspace-fetch-ops.mjs");
  const result = buildFetchResult(
    {
      title: "Shell",
      text: "tiny",
      method: "heuristic",
      wordCount: 1,
      truncated: false,
      extractedChars: 4,
      likelySpa: true,
      maxLen: 40_000,
    },
    { url: "https://example.com/app", maxLen: 40_000, rawBytes: 100 },
  );
  assert.match(String(result.warning || ""), /渲染|SPA|粘贴/i);
});

test("htmlToMarkdown strips script and collapses noise", () => {
  const md = htmlToMarkdown(
    `<html><body><script>evil()</script><article><h2>Hi</h2><p>Hello <strong>world</strong></p></article></body></html>`,
  );
  assert.match(md, /Hello/);
  assert.match(md, /\*\*world\*\*/);
  assert.doesNotMatch(md, /evil/);
});

test("htmlToMarkdown keeps fenced code language and figure caption", () => {
  const md = htmlToMarkdown(
    `<article>
      <pre class="language-python"><code>print(1)</code></pre>
      <figure><img src="https://ex.com/a.png" alt="pic"/><figcaption>图注 A</figcaption></figure>
      <div class="OpenInApp">打开 App</div>
    </article>`,
    { alreadyIsolated: true },
  );
  assert.match(md, /```python/);
  assert.match(md, /print\(1\)/);
  assert.match(md, /图注 A/);
  assert.doesNotMatch(md, /打开 App/);
});

test("htmlToMarkdown strips CN engagement chrome classes", () => {
  const md = htmlToMarkdown(
    `<article><p>正文段落</p><div class="reward_area">打赏</div><div id="js_tags">标签云</div></article>`,
    { alreadyIsolated: true },
  );
  assert.match(md, /正文段落/);
  assert.doesNotMatch(md, /打赏/);
  assert.doesNotMatch(md, /标签云/);
});

test("extractMeta reads og and title", () => {
  const meta = extractMeta(`<html><head>
    <title>T1</title>
    <meta property="og:title" content="OG1" />
    <meta name="author" content="Alice" />
  </head></html>`);
  assert.equal(meta.og_title, "OG1");
  assert.equal(meta.title, "T1");
  assert.equal(meta.author, "Alice");
});

// ── decodeBuffer ──

test("decodeBuffer handles plain utf-8", () => {
  const buf = Buffer.from("Hello 世界", "utf-8");
  assert.equal(decodeBuffer(buf, "utf-8"), "Hello 世界");
  assert.equal(decodeBuffer(buf, "utf8"), "Hello 世界");
  assert.equal(decodeBuffer(buf, ""), "Hello 世界");
  assert.equal(decodeBuffer(buf, null), "Hello 世界");
});

test("decodeBuffer decodes GBK via TextDecoder", () => {
  // "中文" encoded in GBK
  const buf = Buffer.from([0xD6, 0xD0, 0xCE, 0xC4]);
  assert.equal(decodeBuffer(buf, "gbk"), "中文");
});

test("decodeBuffer decodes GB2312 via TextDecoder", () => {
  // "测试" encoded in GB2312
  const buf = Buffer.from([0xB2, 0xE2, 0xCA, 0xD4]);
  assert.equal(decodeBuffer(buf, "gb2312"), "测试");
});

test("decodeBuffer falls back to utf-8 for bogus encoding", () => {
  const buf = Buffer.from("Hello", "utf-8");
  // Should not throw — falls back to utf-8
  assert.equal(decodeBuffer(buf, "totally-bogus-encoding"), "Hello");
});

test("fetchUrl rejects file:// and non-http schemes (no local outside read)", async () => {
  await assert.rejects(
    () => fetchOps.fetchUrl({ url: "file:///etc/passwd" }, {}),
    /scheme|invalid|url/i,
  );
  await assert.rejects(
    () => fetchOps.fetchUrl({ url: "/etc/passwd" }, {}),
    /scheme|invalid|url/i,
  );
});

test("decodeBuffer handles charset labels with trailing comma (from Content-Type)", () => {
  // Simulate what the regex used to capture: "utf-8," — now [\w-]+ prevents this,
  // but decodeBuffer should still be resilient if it receives garbage.
  const buf = Buffer.from("Hello", "utf-8");
  assert.doesNotThrow(() => decodeBuffer(buf, "utf-8,"));
  assert.equal(decodeBuffer(buf, "utf-8,"), "Hello");
});
