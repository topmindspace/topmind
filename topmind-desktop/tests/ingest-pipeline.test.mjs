/**
 * Knowledge ingest pipeline — detect + converters + commit (no Electron).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { detectIngestKind, detectKindFromBytes, isConvertibleKind } from "../electron/lib/ingest/detect.mjs";
import { convertPassthrough } from "../electron/lib/ingest/convert/passthrough-text.mjs";
import { convertHtmlFile } from "../electron/lib/ingest/convert/html.mjs";
import { convertSpreadsheet } from "../electron/lib/ingest/convert/spreadsheet.mjs";
import { convertEml } from "../electron/lib/ingest/convert/eml.mjs";
import { convertDocx } from "../electron/lib/ingest/convert/docx.mjs";
import { commitMarkdownNote } from "../electron/lib/ingest/commit.mjs";
import { createWorkspaceContext } from "../electron/lib/path-model.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, "fixtures", "ingest");

test("detectIngestKind maps common extensions", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mh-detect-"));
  try {
    const cases = [
      ["a.md", "markdown"],
      ["b.TXT", "text"],
      ["c.html", "html"],
      ["d.docx", "docx"],
      ["e.pdf", "pdf"],
      ["f.xlsx", "xlsx"],
      ["g.csv", "csv"],
      ["h.pptx", "pptx"],
      ["i.eml", "eml"],
      ["j.doc", "doc"],
      ["k.docm", "docx"],
      ["l.xls", "xls"],
      ["m.xlsm", "xlsx"],
      ["n.ppt", "ppt"],
      ["o.odt", "odt"],
      ["p.ods", "ods"],
      ["q.odp", "odp"],
      ["r.rtf", "rtf"],
      ["s.epub", "epub"],
    ];
    for (const [name, kind] of cases) {
      const p = path.join(dir, name);
      await fs.writeFile(p, "x");
      const d = await detectIngestKind(p);
      assert.equal(d.kind, kind, name);
      assert.ok(isConvertibleKind(d.kind) || kind === "msg");
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("detectKindFromBytes: PDF / RTF / OLE / ZIP markers", () => {
  assert.equal(detectKindFromBytes(Buffer.from("%PDF-1.4\n")), "pdf");
  assert.equal(detectKindFromBytes(Buffer.from("{\\rtf1\\ansi Hello}")), "rtf");
  const ole = Buffer.alloc(64, 0);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(ole);
  assert.equal(detectKindFromBytes(ole), "ole");
  const zipOdt = Buffer.from(`PK\x03\x04xxxxapplication/vnd.oasis.opendocument.textyyyy`);
  assert.equal(detectKindFromBytes(zipOdt), "odt");
});

test("detectIngestKind: missing/wrong extension uses magic; CSV needs extension", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mh-magic-"));
  try {
    const pdf = path.join(dir, "noext");
    await fs.writeFile(pdf, "%PDF-1.7\n1 0 obj\n");
    assert.equal((await detectIngestKind(pdf)).kind, "pdf");

    const rtf = path.join(dir, "notes.txt");
    await fs.writeFile(rtf, "{\\rtf1\\ansi Hello RTF}");
    assert.equal((await detectIngestKind(rtf)).kind, "rtf");

    const csv = path.join(dir, "plain");
    await fs.writeFile(csv, "a,b\n1,2\n");
    assert.equal((await detectIngestKind(csv)).kind, "binary");
    assert.equal(isConvertibleKind("binary"), false);

    const namedCsv = path.join(dir, "data.csv");
    await fs.writeFile(namedCsv, "a,b\n1,2\n");
    assert.equal((await detectIngestKind(namedCsv)).kind, "csv");
    assert.ok(isConvertibleKind("csv"));

    const fixtureRtf = path.join(fixtures, "sample.rtf");
    assert.equal((await detectIngestKind(fixtureRtf)).kind, "rtf");
    assert.ok(isConvertibleKind("rtf"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("passthrough markdown strips frontmatter body for re-inject", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mh-md-"));
  try {
    const p = path.join(dir, "note.md");
    await fs.writeFile(p, "---\ntitle: Hello\n---\n\n# Body\n\nworld\n", "utf8");
    const r = await convertPassthrough(p, "markdown");
    assert.match(r.markdown, /Body/);
    assert.equal(r.title, "Hello");
    assert.equal(r.converter, "passthrough");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("html file converts to markdown", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mh-html-"));
  try {
    const p = path.join(dir, "page.html");
    await fs.writeFile(
      p,
      "<html><head><title>T1</title></head><body><h1>Hi</h1><p>para</p></body></html>",
      "utf8",
    );
    const r = await convertHtmlFile(p);
    assert.match(r.markdown, /Hi|para/i);
    assert.ok(r.converter);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("csv converts to markdown table", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mh-csv-"));
  try {
    const p = path.join(dir, "data.csv");
    await fs.writeFile(p, "name,age\nAda,30\nBob,25\n", "utf8");
    const r = await convertSpreadsheet(p, "csv");
    assert.match(r.markdown, /Ada/);
    assert.match(r.markdown, /\|/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("eml converts with subject", async () => {
  await fs.mkdir(fixtures, { recursive: true });
  const p = path.join(fixtures, "sample.eml");
  await fs.writeFile(
    p,
    [
      "From: alice@example.com",
      "To: bob@example.com",
      "Subject: Hello Ingest",
      "Date: Mon, 1 Jan 2024 12:00:00 +0000",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "This is the body of the email.",
      "",
    ].join("\r\n"),
    "utf8",
  );
  const r = await convertEml(p);
  assert.match(r.title, /Hello Ingest/i);
  assert.match(r.markdown, /body of the email/i);
  assert.equal(r.converter, "mailparser");
});

test("docx converts via mammoth", async () => {
  // Minimal valid-ish docx is heavy; use mammoth's ability if we have a zip-built docx.
  // Skip if we can't create — instead build a tiny docx with jszip.
  let JSZip;
  try {
    JSZip = (await import("jszip")).default || (await import("jszip"));
  } catch {
    return;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mh-docx-"));
  try {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    );
    zip.folder("_rels")?.file(
      ".rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    );
    zip.folder("word")?.file(
      "document.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>DocxHelloWorld</w:t></w:r></w:p>
  </w:body>
</w:document>`,
    );
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const p = path.join(dir, "t.docx");
    await fs.writeFile(p, buf);
    const r = await convertDocx(p);
    assert.match(r.markdown, /DocxHelloWorld/);
    assert.equal(r.converter, "mammoth");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("pptx converts via pure-JS ooxml", async () => {
  let JSZip;
  try {
    JSZip = (await import("jszip")).default || (await import("jszip"));
  } catch {
    return;
  }
  const { convertPptx } = await import("../electron/lib/ingest/convert/pptx.mjs");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mh-pptx-"));
  try {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:t>PptxHelloSlide</a:t></a:p></p:sld>`,
    );
    zip.file(
      "ppt/slides/slide2.xml",
      `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:t>Second body content here</a:t></a:p></p:sld>`,
    );
    const p = path.join(dir, "deck.pptx");
    await fs.writeFile(p, await zip.generateAsync({ type: "nodebuffer" }));
    const r = await convertPptx(p);
    assert.match(r.markdown, /PptxHelloSlide/);
    assert.match(r.markdown, /幻灯片/);
    assert.equal(r.converter, "pptx-ooxml");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("processIngestJob missing file sets job.error (not silent failed)", async () => {
  const { processIngestJob } = await import("../electron/lib/ingest/process-job.mjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mh-ws-miss-"));
  try {
    await fs.mkdir(path.join(root, "00-收件箱"), { recursive: true });
    const ctx = {
      workspaceRoot: createWorkspaceContext({
        engineRoot: path.resolve(__dirname, "../.."),
        userWorkspaceRoot: root,
      }),
      appSettings: {},
    };
    const job = {
      id: "j1",
      status: "running",
      source: { path: path.join(root, "no-such.pptx"), name: "no-such.pptx" },
      dest: { mode: "inbox" },
      progress: 0,
    };
    await assert.rejects(() => processIngestJob(job, ctx));
    assert.equal(job.status, "failed");
    assert.ok(job.error && /无法读取|不存在|ENOENT/i.test(job.error), job.error);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("processIngestJob pptx succeeds with pure-JS even when external preferred", async () => {
  let JSZip;
  try {
    JSZip = (await import("jszip")).default || (await import("jszip"));
  } catch {
    return;
  }
  const { processIngestJob } = await import("../electron/lib/ingest/process-job.mjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mh-ws-pptx-"));
  const srcDir = await fs.mkdtemp(path.join(os.tmpdir(), "mh-src-pptx-"));
  try {
    await fs.mkdir(path.join(root, "00-收件箱"), { recursive: true });
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0"?><a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>PipelinePptxBody enough text here</a:t></a:p>`,
    );
    const pptx = path.join(srcDir, "pipeline.pptx");
    await fs.writeFile(pptx, await zip.generateAsync({ type: "nodebuffer" }));
    const ctx = {
      workspaceRoot: createWorkspaceContext({
        engineRoot: path.resolve(__dirname, "../.."),
        userWorkspaceRoot: root,
      }),
      appSettings: { ingest: { preferExternalConverters: true, autoConvert: true } },
    };
    const job = {
      id: "j2",
      status: "running",
      source: { path: pptx, name: "pipeline.pptx" },
      dest: { mode: "inbox" },
      progress: 0,
    };
    await processIngestJob(job, ctx);
    assert.ok(job.result?.targetPath, JSON.stringify(job));
    assert.match(job.result.targetPath, /00-收件箱/);
    assert.ok(
      job.result.converter === "pptx-ooxml" ||
        String(job.result.converter).startsWith("markitdown") ||
        String(job.result.converter).startsWith("anydoc") ||
        String(job.result.converter).startsWith("pandoc"),
      job.result.converter,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(srcDir, { recursive: true, force: true });
  }
});

test("default maxFileBytes is 80MB class (PPT-friendly)", async () => {
  const { defaultIngestSettings, INGEST_MAX_FILE_BYTES_DEFAULT, INGEST_MAX_FILE_BYTES_CAP } =
    await import("../electron/lib/ingest/process-job.mjs");
  const d = defaultIngestSettings();
  assert.equal(d.maxFileBytes, INGEST_MAX_FILE_BYTES_DEFAULT);
  assert.ok(d.maxFileBytes >= 80_000_000, "default should allow typical PPT with images");
  assert.ok(INGEST_MAX_FILE_BYTES_CAP >= 200_000_000);
});

test("processIngestJob oversize imports original instead of hard-fail", async () => {
  const { processIngestJob } = await import("../electron/lib/ingest/process-job.mjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mh-ws-over-"));
  const srcDir = await fs.mkdtemp(path.join(os.tmpdir(), "mh-src-over-"));
  try {
    await fs.mkdir(path.join(root, "00-收件箱"), { recursive: true });
    const big = path.join(srcDir, "big.pptx");
    // ~30KB is enough when maxFileBytes is tiny
    await fs.writeFile(big, Buffer.alloc(40_000, 1));
    const ctx = {
      workspaceRoot: createWorkspaceContext({
        engineRoot: path.resolve(__dirname, "../.."),
        userWorkspaceRoot: root,
      }),
      appSettings: { ingest: { maxFileBytes: 10_000, autoConvert: true } },
    };
    const job = {
      id: "over",
      status: "running",
      source: { path: big, name: "big.pptx" },
      dest: { mode: "inbox" },
      progress: 0,
    };
    await processIngestJob(job, ctx);
    assert.equal(job.status, "done");
    assert.equal(job.result?.fallback, true);
    assert.ok(job.result?.targetPath);
    assert.match(String(job.error || job.result?.warnings?.[0] || ""), /上限|过大|MB/i);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(srcDir, { recursive: true, force: true });
  }
});

test("commitMarkdownNote writes inbox with ingest frontmatter", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mh-ws-"));
  try {
    await fs.mkdir(path.join(root, "00-收件箱"), { recursive: true });
    await fs.mkdir(path.join(root, "99-归档"), { recursive: true });
    const ctx = {
      workspaceRoot: createWorkspaceContext({
        engineRoot: path.resolve(__dirname, "../.."),
        userWorkspaceRoot: root,
      }),
    };
    const r = await commitMarkdownNote(
      {
        markdown: "# Hello\n\nbody",
        title: "Test Note",
        sourceName: "a.docx",
        ingestKind: "docx",
        converter: "mammoth",
        warnings: [],
        dest: { mode: "inbox" },
      },
      ctx,
    );
    assert.ok(r.ok);
    assert.match(r.path, /00-收件箱/);
    const abs = path.join(root, r.path);
    const text = await fs.readFile(abs, "utf8");
    assert.match(text, /source_type: "external-capture"/);
    assert.match(text, /ingest_kind: "docx"/);
    assert.match(text, /ingest_converter: "mammoth"/);
    assert.match(text, /Hello/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
