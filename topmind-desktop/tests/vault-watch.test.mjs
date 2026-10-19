import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, utimesSync, realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as kernel from "../../lib/vault-walk.mjs";
import {
  HEAVY_DIR_NAMES,
  OPAQUE_PACKAGE_EXTENSIONS,
  isHeavyDirName,
  isOpaquePackageName,
  shouldSkipDirName,
  shouldSkipVaultDirName,
} from "../electron/lib/file-filter.mjs";
import { isEscapingSymlinkSync as desktopEscape, resolvesOutsideVaultSync as desktopOutside } from "../electron/lib/path-safety.mjs";
import { createWorkspaceContext } from "../electron/lib/path-model.mjs";
import {
  closeWorkspaceWatcher,
  createWorkspaceWatchIgnored,
  emitWatcherErrorForTest,
  isRecoverableWatcherError,
  startWorkspaceWatcher,
} from "../electron/watchers.mjs";

test("desktop vault names stay locked to the kernel fence", () => {
  assert.deepEqual([...OPAQUE_PACKAGE_EXTENSIONS], [...kernel.OPAQUE_PACKAGE_EXTENSIONS]);
  assert.deepEqual([...HEAVY_DIR_NAMES], [...kernel.HEAVY_DIR_NAMES]);
  for (const name of ["Blender.app", "EquationKit.framework", "note.md", "My.app.notes", "images", "node_modules", "dist", ""]) {
    assert.equal(isOpaquePackageName(name), kernel.isOpaquePackageName(name), name);
    assert.equal(isHeavyDirName(name), kernel.isHeavyDirName(name), name);
    assert.equal(shouldSkipVaultDirName(name), kernel.shouldSkipVaultDirName(name), name);
  }
  assert.equal(shouldSkipDirName("Blender.app"), true);
  assert.equal(shouldSkipDirName("images"), false);
});

test("desktop and kernel agree on escaping symlinks", () => {
  const root = mkdtempSync(path.join(tmpdir(), "desk-link-"));
  const outside = mkdtempSync(path.join(tmpdir(), "desk-out-"));
  try {
    mkdirSync(path.join(root, "inside"));
    try {
      symlinkSync(path.join(root, "inside"), path.join(root, "internal"));
      symlinkSync(outside, path.join(root, "escape"));
      symlinkSync(path.join(outside, "missing"), path.join(root, "dangling"));
    } catch (err) {
      throw new Error(`symlink required for the vault fence: ${err instanceof Error ? err.message : String(err)}`);
    }
    writeFileSync(path.join(outside, "marker.md"), "out\n", "utf8");
    for (const name of ["internal", "escape", "dangling", "inside"]) {
      const abs = path.join(root, name);
      assert.equal(desktopEscape(root, abs), kernel.isEscapingSymlinkSync(root, abs), name);
      assert.equal(desktopOutside(root, abs), kernel.resolvesOutsideVaultSync(root, abs), name);
    }
    const through = path.join(root, "escape", "marker.md");
    assert.equal(desktopOutside(root, through), kernel.resolvesOutsideVaultSync(root, through));
    assert.equal(desktopOutside(root, through), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("watch ignore uses vault-relative names and Obsidian userIgnoreFilters", () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "desk-ignore-")));
  try {
    const note = path.join(root, "40-创作", "topic", "note.md");
    const hidden = path.join(root, "40-创作", "topic", "Fake.app", "Contents", "x.md");
    mkdirSync(path.dirname(note), { recursive: true });
    mkdirSync(path.dirname(hidden), { recursive: true });
    writeFileSync(note, "note\n", "utf8");
    writeFileSync(hidden, "hidden\n", "utf8");
    mkdirSync(path.join(root, ".obsidian"), { recursive: true });
    writeFileSync(
      path.join(root, ".obsidian", "app.json"),
      JSON.stringify({ userIgnoreFilters: ["skip\\.md$"] }),
      "utf8",
    );
    const skip = path.join(root, "40-创作", "topic", "skip.md");
    writeFileSync(skip, "skip\n", "utf8");
    const ignored = createWorkspaceWatchIgnored(root);
    assert.equal(ignored(root), false);
    assert.equal(ignored(note), false);
    assert.equal(ignored(hidden), true);
    assert.equal(ignored(skip), true);
    assert.equal(ignored(path.resolve(root, "..")), true);
    const aliasRoot = mkdtempSync(path.join(tmpdir(), "desk-alias-"));
    const aliasReal = realpathSync(aliasRoot);
    try {
      if (aliasRoot !== aliasReal) {
        const aliasNote = path.join(aliasReal, "note.md");
        writeFileSync(aliasNote, "alias\n", "utf8");
        const aliasIgnored = createWorkspaceWatchIgnored(aliasRoot);
        assert.equal(aliasIgnored(aliasNote), false);
        assert.equal(aliasIgnored(path.join(aliasReal, "Fake.app", "Info.plist")), true);
      }
    } finally {
      rmSync(aliasRoot, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("EMFILE from the watcher is recoverable", () => {
  const error = Object.assign(new Error("EMFILE: too many open files"), { code: "EMFILE" });
  assert.equal(isRecoverableWatcherError(error), true);
  assert.equal(isRecoverableWatcherError(new Error("ENFILE: too many open files")), true);
  assert.equal(isRecoverableWatcherError(new Error("EPERM")), false);
});

test("workspace watcher does not follow an escaping symlink or enter .app", async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "desk-watch-")));
  const outside = realpathSync(mkdtempSync(path.join(tmpdir(), "desk-watch-out-")));
  const events = [];
  try {
    const topic = path.join(root, "40-创作", "topic");
    mkdirSync(topic, { recursive: true });
    const note = path.join(topic, "note.md");
    writeFileSync(note, "note\n", "utf8");
    const hidden = path.join(topic, "Fake.app", "Contents", "secret.md");
    mkdirSync(path.dirname(hidden), { recursive: true });
    writeFileSync(hidden, "secret\n", "utf8");
    const marker = path.join(outside, "marker.md");
    writeFileSync(marker, "marker\n", "utf8");
    try {
      symlinkSync(outside, path.join(topic, "escape"));
    } catch (err) {
      throw new Error(`symlink required for the vault fence: ${err instanceof Error ? err.message : String(err)}`);
    }

    const ctx = createWorkspaceContext({ engineRoot: root, userWorkspaceRoot: root });
    await startWorkspaceWatcher(ctx, (event) => {
      events.push(event.relativePath);
    }, { usePolling: true, interval: 50 });

    const stamp = new Date();
    writeFileSync(note, "note changed\n", "utf8");
    utimesSync(note, stamp, stamp);
    writeFileSync(hidden, "secret changed\n", "utf8");
    utimesSync(hidden, stamp, stamp);
    writeFileSync(marker, "marker changed\n", "utf8");
    utimesSync(marker, stamp, stamp);

    const started = Date.now();
    while (!events.includes("40-创作/topic/note.md") && Date.now() - started < 4000) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await new Promise((resolve) => setTimeout(resolve, 400));

    assert.ok(events.includes("40-创作/topic/note.md"), `events: ${events.join(", ")}`);
    assert.equal(events.some((rel) => rel.includes("Fake.app") || rel.includes("secret.md")), false);
    assert.equal(events.some((rel) => rel.includes("marker.md") || rel.includes("escape")), false);

    const unhandled = [];
    const onUnhandled = (err) => unhandled.push(err);
    process.on("unhandledRejection", onUnhandled);
    try {
      const boom = Object.assign(new Error("EMFILE: too many open files"), { code: "EMFILE" });
      assert.doesNotThrow(() => emitWatcherErrorForTest(boom));
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(unhandled.length, 0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  } finally {
    await closeWorkspaceWatcher();
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
