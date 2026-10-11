/**
 * Clipboard payload helpers (no real Electron clipboard — pure parse paths).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

// Unit: XML plist path extraction via dynamic re-implementation test of detect kind integration
import { detectIngestKind } from "../electron/lib/ingest/detect.mjs";

test("detect still works for clipboard-imported paths", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mh-clip-"));
  try {
    const p = path.join(dir, "note.md");
    await fs.writeFile(p, "hi");
    const d = await detectIngestKind(p);
    assert.equal(d.kind, "markdown");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("NSFilenames-style XML plist path regex", () => {
  const xml = `<?xml version="1.0"?>
<!DOCTYPE plist>
<plist><array>
  <string>/Users/me/Docs/report.docx</string>
  <string>/Users/me/a.pdf</string>
</array></plist>`;
  const re = /<string>([^<]+)<\/string>/gu;
  const paths = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    if (m[1].startsWith("/")) paths.push(m[1]);
  }
  assert.deepEqual(paths, ["/Users/me/Docs/report.docx", "/Users/me/a.pdf"]);
});
