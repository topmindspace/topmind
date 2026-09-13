/**
 * Pi-native FS tools must stay inside the workspace fence.
 * Drives shipped electron/lib/pi-fenced-fs.mjs (not a reconstructed helper).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  resolvePiToolPath,
  mapPiToolNameToDesktop,
  normalizePiEditArgs,
  PI_NATIVE_FS_TOOLS,
  PI_BASH_ENABLED_BY_DEFAULT,
  PI_READ_DEFAULT_LIMIT,
} from "../electron/lib/pi-fenced-fs.mjs";

const root = path.resolve("/tmp/topmind-pi-fence-ws");

describe("pi-fenced-fs", () => {
  it("maps Pi native names to Desktop tools and keeps bash off by default", () => {
    assert.deepEqual([...PI_NATIVE_FS_TOOLS], ["read", "write", "edit"]);
    assert.equal(PI_BASH_ENABLED_BY_DEFAULT, false);
    assert.equal(PI_READ_DEFAULT_LIMIT, 2000);
    assert.equal(mapPiToolNameToDesktop("read"), "read_file");
    assert.equal(mapPiToolNameToDesktop("write"), "save_file");
    assert.equal(mapPiToolNameToDesktop("edit"), "edit_file");
    assert.equal(mapPiToolNameToDesktop("grep"), "search");
    assert.equal(mapPiToolNameToDesktop("bash"), null);
    assert.equal(mapPiToolNameToDesktop("list_topics"), null);
  });

  it("resolves relative paths inside the workspace", () => {
    const r = resolvePiToolPath(root, "10-动态/2026-W30.md");
    assert.equal(r.ok, true);
    assert.equal(r.relativePath, "10-动态/2026-W30.md");
    assert.equal(r.abs, path.resolve(root, "10-动态/2026-W30.md"));
  });

  it("denies parent, sibling-prefix, empty, and workspace-root paths", () => {
    assert.equal(resolvePiToolPath(root, "../secret.md").ok, false);
    assert.equal(resolvePiToolPath(root, "../secret.md").reason, "outside-workspace");
    const sibling = `${root}-evil/leak.md`;
    assert.equal(resolvePiToolPath(root, sibling).ok, false);
    assert.equal(resolvePiToolPath(root, "").ok, false);
    assert.equal(resolvePiToolPath(root, ".").ok, false);
    assert.equal(resolvePiToolPath("", "a.md").reason, "no-workspace");
  });

  it("accepts absolute paths only when they resolve inside the root", () => {
    const inside = path.join(root, "memory/todo.md");
    const ok = resolvePiToolPath(root, inside);
    assert.equal(ok.ok, true);
    assert.equal(ok.relativePath, "memory/todo.md");
    assert.equal(resolvePiToolPath(root, "/etc/passwd").ok, false);
  });

  it("normalizes Pi edit args from both Desktop and coding-agent field names", () => {
    const a = normalizePiEditArgs({ path: "n.md", old_string: "a", new_string: "b" });
    assert.deepEqual(a, { path: "n.md", oldText: "a", newText: "b", replaceAll: false });
    const b = normalizePiEditArgs({ relativePath: "n.md", oldText: "x", newText: "y", replaceAll: true });
    assert.equal(b.oldText, "x");
    assert.equal(b.replaceAll, true);
  });
});
