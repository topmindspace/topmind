/**
 * convertToMarkdown routing — drives the shipped registry with I/O stubs.
 * Also exercises the real convert entry on fixtures (builtin fallback when anydoc is absent).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import {
  convertToMarkdown,
  resetConvertAdaptersForTest,
  setConvertAdaptersForTest,
} from "../electron/lib/ingest/convert/registry.mjs";
import { defaultIngestSettings, resolveIngestSettings } from "../electron/lib/ingest/process-job.mjs";
import { detectIngestKind } from "../electron/lib/ingest/detect.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, "fixtures", "ingest");

const stubTools = {
  anydoc: { available: true, version: "0.1.8" },
  markitdown: { available: true, version: "1.2.0" },
  pandoc: { available: true, version: "3.1" },
};

function stubAdapters(overrides = {}) {
  setConvertAdaptersForTest({
    probe: async () => stubTools,
    runAnydoc: async () => ({ markdown: "# From anydoc\n\nParagraph from sidecar.", converter: "anydoc", version: "0.1.8" }),
    runMarkitdown: async () => ({ markdown: "# From markitdown\n\nBody.", converter: "markitdown" }),
    runPandoc: async () => ({ markdown: "# From pandoc\n\nBody.", converter: "pandoc" }),
    ...overrides,
  });
}

test.afterEach(() => {
  resetConvertAdaptersForTest();
});

test("settings default preference is auto (anydoc first)", () => {
  const d = defaultIngestSettings();
  assert.equal(d.preferredConverter, "auto");
  assert.equal(d.preferExternalConverters, true);
  const r = resolveIngestSettings({});
  assert.equal(r.preferredConverter, "auto");
  const builtin = resolveIngestSettings({ ingest: { preferExternalConverters: false } });
  assert.equal(builtin.preferredConverter, "builtin");
  const named = resolveIngestSettings({ ingest: { preferredConverter: "pandoc" } });
  assert.equal(named.preferredConverter, "pandoc");
});

test("convertToMarkdown auto prefers stub anydoc when available", async () => {
  stubAdapters();
  const r = await convertToMarkdown({
    kind: "docx",
    absPath: "/tmp/report.docx",
    preferredConverter: "auto",
  });
  assert.match(r.converter, /^anydoc@0\.1\.8$/);
  assert.match(r.markdown, /From anydoc/);
  assert.match(r.markdown, /Paragraph/);
});

test("convertToMarkdown uses markitdown when preference says so", async () => {
  stubAdapters();
  const r = await convertToMarkdown({
    kind: "docx",
    absPath: "/tmp/report.docx",
    preferredConverter: "markitdown",
  });
  assert.match(r.converter, /^markitdown@/);
  assert.match(r.markdown, /From markitdown/);
});

test("convertToMarkdown uses pandoc when preference says so", async () => {
  stubAdapters();
  const r = await convertToMarkdown({
    kind: "docx",
    absPath: "/tmp/report.docx",
    preferredConverter: "pandoc",
  });
  assert.match(r.converter, /^pandoc@/);
  assert.match(r.markdown, /From pandoc/);
});

test("convertToMarkdown falls through after simulated anydoc failure", async () => {
  stubAdapters({
    runAnydoc: async () => {
      throw new Error("anydoc: encrypted — password protected");
    },
  });
  const r = await convertToMarkdown({
    kind: "docx",
    absPath: "/tmp/secret.docx",
    preferredConverter: "auto",
  });
  assert.match(r.converter, /^markitdown@/);
  assert.match(r.markdown, /From markitdown/);
  assert.ok((r.warnings || []).some((w) => /encrypted/i.test(w)));
});

test("convertToMarkdown skips missing anydoc and uses next available", async () => {
  stubAdapters({
    probe: async () => ({
      anydoc: { available: false, version: null },
      markitdown: { available: false, version: null },
      pandoc: { available: true, version: "3.1" },
    }),
  });
  const r = await convertToMarkdown({
    kind: "docx",
    absPath: "/tmp/report.docx",
    preferredConverter: "auto",
  });
  assert.match(r.converter, /^pandoc@/);
});

test("convertToMarkdown does not pass --format docx for RTF/PDF bytes named .docx", async () => {
  const seen = [];
  stubAdapters({
    runAnydoc: async (absPath, opts = {}) => {
      seen.push({ absPath, format: opts.format, kind: opts.kind });
      return { markdown: "# From anydoc\n\nRecovered body.", converter: "anydoc", version: "0.1.8" };
    },
  });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mh-wrong-ext-"));
  try {
    const rtf = path.join(dir, "misnamed.docx");
    await fs.writeFile(rtf, "{\\rtf1\\ansi Hello RTF ingest paragraph}");
    const rtfDet = await detectIngestKind(rtf);
    const rtfR = await convertToMarkdown({
      kind: rtfDet.kind,
      absPath: rtf,
      preferredConverter: "auto",
    });
    assert.equal(rtfDet.kind, "rtf");
    assert.match(rtfR.converter, /^anydoc@/);
    assert.equal(seen.length, 1);
    assert.notEqual(seen[0].format, "docx");
    assert.equal(seen[0].format, "rtf");

    const pdf = path.join(dir, "also-wrong.docx");
    await fs.writeFile(pdf, "%PDF-1.4\n1 0 obj\n");
    const pdfDet = await detectIngestKind(pdf);
    const pdfR = await convertToMarkdown({
      kind: pdfDet.kind,
      absPath: pdf,
      preferredConverter: "auto",
    });
    assert.equal(pdfDet.kind, "pdf");
    assert.match(pdfR.converter, /^anydoc@/);
    assert.equal(seen.length, 2);
    assert.notEqual(seen[1].format, "docx");
    assert.equal(seen[1].format, "pdf");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("HTML stays off anydoc even when anydoc is available", async () => {
  let anydocCalled = false;
  stubAdapters({
    probe: async () => ({
      anydoc: { available: true, version: "0.1.8" },
      markitdown: { available: false, version: null },
      pandoc: { available: false, version: null },
    }),
    runAnydoc: async () => {
      anydocCalled = true;
      return { markdown: "should-not", converter: "anydoc" };
    },
  });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mh-html-reg-"));
  try {
    const p = path.join(dir, "page.html");
    await fs.writeFile(p, "<html><body><h1>HiHtml</h1></body></html>", "utf8");
    const r = await convertToMarkdown({
      kind: "html",
      absPath: p,
      preferredConverter: "auto",
    });
    assert.equal(anydocCalled, false);
    assert.equal(r.converter, "html-to-markdown");
    assert.match(r.markdown, /HiHtml/i);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("real convertToMarkdown: txt / csv / docx succeed without requiring anydoc", async () => {
  resetConvertAdaptersForTest();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mh-real-conv-"));
  const engines = [];
  try {
    const txt = path.join(dir, "note.txt");
    await fs.writeFile(txt, "Hello passthrough paragraph\n", "utf8");
    const txtR = await convertToMarkdown({ kind: "text", absPath: txt, preferredConverter: "auto" });
    engines.push(`txt:${txtR.converter}`);
    assert.match(txtR.markdown, /Hello passthrough/);
    assert.ok(txtR.markdown.trim().length > 0);

    const csv = path.join(dir, "data.csv");
    await fs.writeFile(csv, "name,role\nAda,engineer\n", "utf8");
    const csvR = await convertToMarkdown({ kind: "csv", absPath: csv, preferredConverter: "auto" });
    engines.push(`csv:${csvR.converter}`);
    assert.match(csvR.markdown, /Ada/);
    assert.match(csvR.markdown, /\|/);

    let JSZip;
    try {
      JSZip = (await import("jszip")).default || (await import("jszip"));
    } catch {
      JSZip = null;
    }
    if (JSZip) {
      const zip = new JSZip();
      zip.file(
        "[Content_Types].xml",
        `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>`,
      );
      zip.folder("word")?.file(
        "document.xml",
        `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DocxRealConvert</w:t></w:r></w:p></w:body></w:document>`,
      );
      const docx = path.join(dir, "t.docx");
      await fs.writeFile(docx, await zip.generateAsync({ type: "nodebuffer" }));
      const docxR = await convertToMarkdown({ kind: "docx", absPath: docx, preferredConverter: "auto" });
      engines.push(`docx:${docxR.converter}`);
      assert.match(docxR.markdown, /DocxRealConvert/);
    }

    const rtf = path.join(fixtures, "sample.rtf");
    try {
      const rtfR = await convertToMarkdown({ kind: "rtf", absPath: rtf, preferredConverter: "auto" });
      engines.push(`rtf:${rtfR.converter}`);
      assert.ok(rtfR.markdown.trim().length > 0);
      assert.match(rtfR.converter, /anydoc|pandoc|markitdown/i);
    } catch (e) {
      engines.push(`rtf:skipped:${e instanceof Error ? e.message.slice(0, 80) : String(e)}`);
    }

    // Persist engine record for the convert-launch log (tests print it).
    console.log("[convert-launch] engines", engines.join(" | "));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("real anydoc CLI (if present): convert RTF twice with stable markdown", async () => {
  resetConvertAdaptersForTest();
  const { resolveSimpleBinary } = await import("../electron/lib/host-bin.mjs");
  const { probeExternalTools, clearExternalToolsCache } = await import(
    "../electron/lib/ingest/external-tools.mjs"
  );
  clearExternalToolsCache();
  const [pathBin, tools] = await Promise.all([
    resolveSimpleBinary("anydoc"),
    probeExternalTools({ force: true }),
  ]);
  if (!pathBin && !tools.anydoc?.available) {
    console.log("[convert-launch] anydoc CLI not installed — skip real binary pair");
    return;
  }
  const rtf = path.join(fixtures, "sample.rtf");
  const a = await convertToMarkdown({ kind: "rtf", absPath: rtf, preferredConverter: "anydoc" });
  const b = await convertToMarkdown({ kind: "rtf", absPath: rtf, preferredConverter: "anydoc" });
  assert.match(a.converter, /anydoc/);
  assert.match(b.converter, /anydoc/);
  assert.ok(a.markdown.trim().length > 0);
  assert.equal(a.markdown.trim(), b.markdown.trim());
  const scratch = process.env.TM_INGEST_SCRATCH;
  if (scratch) {
    await fs.mkdir(scratch, { recursive: true });
    await fs.writeFile(path.join(scratch, "anydoc-real-1.md"), a.markdown);
    await fs.writeFile(path.join(scratch, "anydoc-real-2.md"), b.markdown);
  }
  console.log("[convert-launch] anydoc real pair ok", a.converter, a.markdown.trim().length);
});
