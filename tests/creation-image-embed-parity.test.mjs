import test from "node:test";
import assert from "node:assert/strict";
import { parseCreationImageEmbed } from "../lib/creation-image-embed.mjs";
import {
  buildImageIndex, collectImageEmbeds, resolveEmbedTarget,
} from "../topmind-desktop/electron/lib/embed-images.mjs";

test("Kernel and Desktop accept the same ordinary Obsidian raster embeds", () => {
  const index = buildImageIndex([
    "attachments/one.png", "20-研究/unique.png", "20-研究/Pasted image.png", "Attachments/Photo.PNG",
  ]);
  for (const [inner, expected] of [
    ["attachments/one.png|300", "attachments/one.png"],
    ["unique.png|说明", "20-研究/unique.png"],
    ["Pasted%20image.png", "20-研究/Pasted image.png"],
    ["photo.png", "Attachments/Photo.PNG"],
  ]) {
    const kernel = parseCreationImageEmbed(inner);
    const desktop = collectImageEmbeds(`![[${inner}]]`)[0];
    assert.ok(kernel, inner);
    assert.ok(desktop, inner);
    assert.equal(resolveEmbedTarget(desktop.target, index), expected);
  }
  for (const inner of ["docs/file.pdf", "../outside.png", "https://example.invalid/a.png"]) {
    assert.equal(parseCreationImageEmbed(inner), null);
    assert.deepEqual(collectImageEmbeds(`![[${inner}]]`), []);
  }
  assert.equal(parseCreationImageEmbed("..%2Foutside.png"), null);
  assert.equal(resolveEmbedTarget("..%2Foutside.png", index), null);
});

test("Desktop does not choose a file for an ambiguous basename", () => {
  const index = buildImageIndex(["z/dup.png", "a/b/dup.png"]);
  assert.equal(resolveEmbedTarget("dup.png", index), null);
});
