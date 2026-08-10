/**
 * Pure workspace path identity + recent dedupe.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  canonicalizeWorkspacePathKey,
  sameWorkspacePath,
  dedupeRecentWorkspaceEntries,
  looksLikeDesktopRuntimePath,
} from "../electron/lib/workspace-path-id.mjs";
import { dedupeRecentWorkspaces, workspacePathKey } from "../src/lib/workspace-recent.ts";

test("canonicalize collapses trailing slash and case on darwin/win", () => {
  const a = canonicalizeWorkspacePathKey("/tmp/Ws/foo/");
  const b = canonicalizeWorkspacePathKey("/tmp/Ws/foo");
  if (process.platform === "darwin" || process.platform === "win32") {
    assert.equal(a, b);
    assert.equal(a, a.toLowerCase());
  } else {
    assert.equal(path.resolve("/tmp/Ws/foo"), path.resolve("/tmp/Ws/foo/"));
  }
  assert.equal(sameWorkspacePath("/tmp/Ws/foo", "/tmp/Ws/foo/"), true);
});

test("dedupeRecentWorkspaceEntries keeps newest timestamp", () => {
  const out = dedupeRecentWorkspaceEntries([
    { rootPath: "/tmp/a", lastOpenedAt: "2026-01-01T00:00:00.000Z" },
    { rootPath: "/tmp/a/", lastOpenedAt: "2026-07-01T00:00:00.000Z" },
    { rootPath: "/tmp/b", lastOpenedAt: "2026-06-01T00:00:00.000Z" },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].rootPath, path.resolve("/tmp/a/"));
  assert.equal(out[0].lastOpenedAt, "2026-07-01T00:00:00.000Z");
});

test("looksLikeDesktopRuntimePath flags app package name", () => {
  assert.equal(looksLikeDesktopRuntimePath("/opt/apps/topmind-desktop"), true);
  assert.equal(looksLikeDesktopRuntimePath("/data/notes-vault"), false);
});

test("client dedupeRecentWorkspaces matches key semantics", () => {
  const out = dedupeRecentWorkspaces([
    { rootPath: "/Users/me/Notes", lastOpenedAt: "2026-01-01T00:00:00.000Z" },
    { rootPath: "/Users/me/Notes/", lastOpenedAt: "2026-02-01T00:00:00.000Z" },
  ]);
  assert.equal(out.length, 1);
  assert.equal(workspacePathKey(out[0].rootPath), workspacePathKey("/Users/me/Notes"));
});
