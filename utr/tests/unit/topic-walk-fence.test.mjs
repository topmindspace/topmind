import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { walkMarkdown } from "../../core/topic-files.mjs";

test("walkMarkdown stays inside the vault and out of package bundles", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "utr-walk-"));
  const outside = mkdtempSync(path.join(tmpdir(), "utr-walk-out-"));
  try {
    const topic = path.join(root, "40-创作", "topic");
    mkdirSync(path.join(topic, "Fake.app", "Contents"), { recursive: true });
    writeFileSync(path.join(topic, "note.md"), "# note\n", "utf8");
    writeFileSync(path.join(topic, "Fake.app", "Contents", "hidden.md"), "# hidden\n", "utf8");
    writeFileSync(path.join(topic, "skipme.md"), "# skip\n", "utf8");
    writeFileSync(path.join(outside, "secret.md"), "# secret\n", "utf8");
    mkdirSync(path.join(root, ".obsidian"), { recursive: true });
    writeFileSync(
      path.join(root, ".obsidian", "app.json"),
      JSON.stringify({ userIgnoreFilters: ["skipme\\.md$"] }),
      "utf8",
    );
    try {
      symlinkSync(outside, path.join(topic, "escape"));
    } catch {
      /* symlink unavailable — the package and ignore assertions still hold */
    }

    const files = await walkMarkdown(topic, root, "note");
    const rels = files.map((file) => file.relativePath);
    assert.deepEqual(rels, ["40-创作/topic/note.md"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
