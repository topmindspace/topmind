import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectCreationCoverImageBytes, sniffCreationCoverFormat } from "../lib/creation-image-metadata.mjs";
import { coverFixture } from "./helpers/creation-cover-fixtures.mjs";

test("cover metadata reads real PNG, JPEG and WebP containers", () => {
  for (const [fixture, format] of [["a", "png"], ["jpeg", "jpeg"], ["webp", "webp"]]) {
    assert.deepEqual(inspectCreationCoverImageBytes(coverFixture(fixture)), { format, width: 4, height: 4 });
    assert.equal(sniffCreationCoverFormat(coverFixture(fixture)), format);
  }
});

test("cover metadata rejects magic-only, truncated and damaged containers", () => {
  assert.equal(inspectCreationCoverImageBytes(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])), null);
  for (const fixture of ["a", "jpeg", "webp"]) {
    const valid = coverFixture(fixture);
    assert.equal(inspectCreationCoverImageBytes(valid.subarray(0, valid.length - 1)), null);
  }
  const png = coverFixture("a");
  png[20] ^= 1;
  assert.equal(inspectCreationCoverImageBytes(png), null, "PNG dimensions cannot bypass IHDR CRC");
  const webp = coverFixture("webp");
  webp.writeUInt32LE(1, 4);
  assert.equal(inspectCreationCoverImageBytes(webp), null, "WebP RIFF length must match file bytes");
});
