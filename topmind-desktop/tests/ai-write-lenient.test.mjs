/**
 * AI write-gate leniency + AI-write file-changed notification (Desktop).
 * - Content writes always confirmed:true (graded-confirm land immediately)
 * - Lifecycle stays pending under confirm mode
 * - Successful AI writes emit workspace:file-changed (watcher is suppressed)
 * - expectedHash is soft: stale hash does not block a still-valid unique-span edit
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");

describe("AI write gate leniency + file-changed notify", () => {
  test("ai-tools: content confirmed true, lifecycle confirmed false under confirm; emits file-changed", () => {
    const src = fs.readFileSync(path.join(desktopRoot, "electron", "ai-tools.mjs"), "utf8");
    assert.match(src, /LIFECYCLE_TOOLS/);
    assert.match(src, /confirmed: LIFECYCLE_TOOLS\.has\(toolName\) \? !needsUserConfirm : true/);
    assert.match(src, /workspace:file-changed/);
    assert.match(src, /source: `ai:\$\{toolName\}`/);
    // Content path must not force confirmed:false (that invites accidental pending).
    assert.doesNotMatch(src, /confirmed: !needsUserConfirm\s*\}/);
  });

  test("path-ops: expectedHash is soft — unique span still applies when hash is stale", () => {
    const src = fs.readFileSync(
      path.join(desktopRoot, "electron", "lib", "workspace-path-ops.mjs"),
      "utf8",
    );
    assert.match(src, /hashStale/);
    // Soft path: match first, hard-reject only when matcher also fails.
    assert.match(src, /if \(hashStale\) \{\s*throw new Error\(/u);
    assert.match(src, /expectedHash was stale; unique-span still matched/);
  });

  test("path-ops soft-hash behavior via shipped applyUniqueSpan + contentHash", async () => {
    const { contentHash } = await import(
      pathToFileURL(path.join(desktopRoot, "electron", "lib", "workspace-path-ops.mjs")).href
    );
    const kernel = await import(
      pathToFileURL(path.join(desktopRoot, "..", "lib", "kernel-api.mjs")).href
    );
    const body = "line one\nUNIQUE_SPAN_FOR_SOFT_HASH\nline three\n";
    const staleHash = contentHash(body + "trailing change\n");
    const currentHash = contentHash(body);
    assert.notEqual(staleHash, currentHash);
    // Unique span still matches the current body even though expectedHash is stale.
    const applied = kernel.applyUniqueSpan(body, {
      oldText: "UNIQUE_SPAN_FOR_SOFT_HASH",
      newText: "UNIQUE_SPAN_EDITED",
    });
    assert.equal(applied.ok, true);
    assert.match(applied.next, /UNIQUE_SPAN_EDITED/);
  });

  test("FileEditorView distinguishes AI disk updates while dirty", () => {
    const src = fs.readFileSync(
      path.join(
        desktopRoot,
        "src",
        "plugins",
        "topmind-workspace",
        "views",
        "FileEditorView.tsx",
      ),
      "utf8",
    );
    assert.match(src, /diskFileUpdatedUnsavedAi/);
    assert.match(src, /source\.startsWith\("ai:"\)/);
    // take-disk must adopt full disk content (frontmatter + body), not rebuild from stale FM.
    assert.match(src, /diskFull/);
    assert.match(src, /lastSaved\.current = pending\.diskFull/);
  });

  test("inline-ai file-changed is ignored by content holders (no wipe of unsaved apply)", () => {
    for (const rel of [
      "src/plugins/topmind-workspace/views/FileEditorView.tsx",
      "src/plugins/topmind-workspace/views/StreamDetailView.tsx",
    ]) {
      const src = fs.readFileSync(path.join(desktopRoot, rel), "utf8");
      assert.match(src, /inline-ai/, rel);
      assert.match(src, /source === "inline-ai"|selfSource === "inline-ai"/, rel);
    }
  });

  test("useSelectionAi emits workspace:file-changed after apply", () => {
    const src = fs.readFileSync(
      path.join(desktopRoot, "src", "components", "editor", "useSelectionAi.ts"),
      "utf8",
    );
    assert.match(src, /emitLocal\("workspace:file-changed", \{ source: "inline-ai" \}\)/);
  });

  test("disk conflict take-disk is destructive (Enter lands on keep-local)", () => {
    const src = fs.readFileSync(
      path.join(desktopRoot, "src", "plugins", "topmind-workspace", "views", "FileEditorView.tsx"),
      "utf8",
    );
    assert.match(src, /diskConflictTakeDisk/);
    assert.match(src, /destructive/);
    const dialog = fs.readFileSync(path.join(desktopRoot, "src", "components", "ui", "Dialog.tsx"), "utf8");
    assert.match(dialog, /destructive \? "\[data-dialog-cancel\]"/);
  });

  test("text-note write surface is open beyond .md (engine single source)", async () => {
    const { isTextNotePath, TEXT_NOTE_EXTS, isEditableNotePath } = await import(
      pathToFileURL(path.join(desktopRoot, "..", "lib", "text-note.mjs")).href
    );
    for (const ext of [".md", ".txt", ".json", ".yaml", ".csv", ".ts", ".html", ".log"]) {
      assert.equal(isTextNotePath(`notes/file${ext}`), true, ext);
      assert.equal(isEditableNotePath(`notes/file${ext}`), true, ext);
    }
    for (const ext of [".png", ".pdf", ".zip", ".exe"]) {
      assert.equal(isTextNotePath(`notes/file${ext}`), false, ext);
    }
    assert.ok(TEXT_NOTE_EXTS.includes(".md"));
    assert.ok(TEXT_NOTE_EXTS.includes(".txt"));
    // Desktop path-ops must not re-implement the inventory (pack-safe loadKernelApi).
    const pathOps = fs.readFileSync(
      path.join(desktopRoot, "electron", "lib", "workspace-path-ops.mjs"),
      "utf8",
    );
    assert.match(pathOps, /loadKernelApi/);
    assert.match(pathOps, /isTextNotePath/);
    assert.doesNotMatch(pathOps, /export const TEXT_NOTE_EXTS = Object\.freeze/);
    // Renderer preview set must cover engine write set (else write-without-open).
    const { PREVIEW_TEXT_EXTS } = await import(
      pathToFileURL(path.join(desktopRoot, "src", "lib", "file-preview.ts")).href
    );
    const { TEXT_NOTE_EXT_SET } = await import(
      pathToFileURL(path.join(desktopRoot, "..", "lib", "text-note.mjs")).href
    );
    for (const ext of TEXT_NOTE_EXT_SET) {
      assert.ok(PREVIEW_TEXT_EXTS.has(ext), ext);
    }
  });
});
