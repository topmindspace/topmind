/**
 * Conversion policy — preferred engine, fallbacks, anydoc kind coverage.
 * Drives shipped convert-policy.mjs; wrong-ext case also drives detectIngestKind.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ANYDOC_KINDS,
  BUILTIN_KINDS,
  CONVERTIBLE_KINDS,
  DEFAULT_PREFERRED_CONVERTER,
  anydocFormatForKind,
  classifyAnydocFailure,
  filterAvailableEngines,
  isConvertibleKind,
  normalizePreferredConverter,
  resolveConverterChain,
} from "../electron/lib/ingest/convert-policy.mjs";
import { detectIngestKind } from "../electron/lib/ingest/detect.mjs";

test("defaults: anydoc is the default preference", () => {
  assert.equal(DEFAULT_PREFERRED_CONVERTER, "auto");
  assert.equal(normalizePreferredConverter(undefined, true), "auto");
  assert.equal(normalizePreferredConverter(undefined, false), "builtin");
  assert.equal(normalizePreferredConverter("markitdown", true), "markitdown");
  assert.equal(normalizePreferredConverter("nope", true), "auto");
});

test("anydoc kind set covers Office / ODF / RTF / EPUB / CSV / PDF and not HTML/EML", () => {
  for (const k of ["doc", "docx", "ppt", "pptx", "xls", "xlsx", "csv", "odt", "ods", "odp", "rtf", "epub", "pdf", "ole"]) {
    assert.ok(ANYDOC_KINDS.has(k), k);
    assert.ok(isConvertibleKind(k), k);
  }
  assert.ok(!ANYDOC_KINDS.has("html"));
  assert.ok(!ANYDOC_KINDS.has("eml"));
  assert.ok(!ANYDOC_KINDS.has("markdown"));
  assert.ok(BUILTIN_KINDS.has("html"));
  assert.ok(BUILTIN_KINDS.has("eml"));
  assert.ok(CONVERTIBLE_KINDS.includes("rtf"));
  assert.ok(CONVERTIBLE_KINDS.includes("odt"));
});

test("auto chain prefers anydoc then markitdown/pandoc/builtin for docx", () => {
  assert.deepEqual(resolveConverterChain({ kind: "docx", preference: "auto" }), [
    "anydoc",
    "markitdown",
    "pandoc",
    "builtin",
  ]);
});

test("auto chain does not send HTML/EML/md through anydoc", () => {
  assert.deepEqual(resolveConverterChain({ kind: "html", preference: "auto" }), [
    "markitdown",
    "pandoc",
    "builtin",
  ]);
  assert.deepEqual(resolveConverterChain({ kind: "eml", preference: "auto" }), ["builtin"]);
  assert.deepEqual(resolveConverterChain({ kind: "markdown", preference: "auto" }), ["builtin"]);
  assert.deepEqual(resolveConverterChain({ kind: "text", preference: "auto" }), ["builtin"]);
});

test("explicit preference is tried first then remaining capable engines", () => {
  assert.deepEqual(resolveConverterChain({ kind: "docx", preference: "markitdown" }), [
    "markitdown",
    "anydoc",
    "pandoc",
    "builtin",
  ]);
  assert.deepEqual(resolveConverterChain({ kind: "docx", preference: "pandoc" }), [
    "pandoc",
    "anydoc",
    "markitdown",
    "builtin",
  ]);
  assert.deepEqual(resolveConverterChain({ kind: "docx", preference: "builtin" }), ["builtin"]);
});

test("rtf/odt/epub are convertible via anydoc (and pandoc when it owns them) without builtin", () => {
  const rtf = resolveConverterChain({ kind: "rtf", preference: "auto" });
  assert.equal(rtf[0], "anydoc");
  assert.ok(rtf.includes("pandoc"));
  assert.ok(!rtf.includes("builtin"));
  const odt = resolveConverterChain({ kind: "odt", preference: "auto" });
  assert.equal(odt[0], "anydoc");
});

test("missing preferred engine falls through instead of emptying the chain", () => {
  const chain = resolveConverterChain({ kind: "docx", preference: "anydoc" });
  const available = filterAvailableEngines(chain, {
    anydoc: false,
    markitdown: true,
    pandoc: false,
  });
  assert.deepEqual(available, ["markitdown", "builtin"]);
});

test("anydoc --format names CSV; kind wins over extension aliases", () => {
  assert.equal(anydocFormatForKind("csv", "csv"), "csv");
  assert.equal(anydocFormatForKind("csv", "txt"), "csv");
  assert.equal(anydocFormatForKind("docx", "docm"), "docx");
  assert.equal(anydocFormatForKind("pptx", "ppsx"), "pptx");
  assert.equal(anydocFormatForKind("xlsx", "xls"), "xlsx");
  // Wrong extension must not force OOXML — anydoc then fails as malformed zip.
  assert.equal(anydocFormatForKind("rtf", "docx"), "rtf");
  assert.equal(anydocFormatForKind("pdf", "docx"), "pdf");
  assert.equal(anydocFormatForKind("", "docx"), null);
});

test("detectIngestKind + anydocFormatForKind: RTF/PDF bytes named .docx do not send --format docx", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tm-fmt-magic-"));
  try {
    const rtfAsDocx = path.join(dir, "notes.docx");
    await fs.writeFile(rtfAsDocx, "{\\rtf1\\ansi Hello RTF ingest paragraph}");
    const rtfDet = await detectIngestKind(rtfAsDocx);
    assert.equal(rtfDet.kind, "rtf");
    const rtfExt = (rtfDet.ext || path.extname(rtfAsDocx)).replace(/^\./u, "");
    assert.equal(rtfExt.toLowerCase(), "docx");
    const rtfFmt = anydocFormatForKind(rtfDet.kind, rtfExt);
    assert.notEqual(rtfFmt, "docx");
    assert.equal(rtfFmt, "rtf");

    const pdfAsDocx = path.join(dir, "scan.docx");
    await fs.writeFile(pdfAsDocx, "%PDF-1.4\n1 0 obj\n");
    const pdfDet = await detectIngestKind(pdfAsDocx);
    assert.equal(pdfDet.kind, "pdf");
    const pdfExt = (pdfDet.ext || path.extname(pdfAsDocx)).replace(/^\./u, "");
    assert.equal(pdfExt.toLowerCase(), "docx");
    const pdfFmt = anydocFormatForKind(pdfDet.kind, pdfExt);
    assert.notEqual(pdfFmt, "docx");
    assert.equal(pdfFmt, "pdf");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("classifyAnydocFailure names encrypted / unsupported / empty", () => {
  assert.equal(classifyAnydocFailure("document is encrypted").code, "encrypted");
  assert.equal(classifyAnydocFailure("unsupported: image-only PDF").code, "unsupported");
  assert.equal(classifyAnydocFailure("输出为空").code, "empty");
  assert.match(classifyAnydocFailure("password protected").message, /anydoc: encrypted/);
});
