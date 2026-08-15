/**
 * Mid-file unique-span edit through the shipped Desktop pathOps.editPath.
 * Fixture is longer than the default 400-line / 14k read window.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const electronLib = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../electron/lib");

let tmpRoot;
let workspace;
let pathOps;

function ctx() {
  return { workspaceRoot: workspace };
}

function largeBody() {
  const lines = [];
  for (let i = 1; i <= 800; i++) {
    if (i === 450) {
      lines.push("UNIQUE_MIDDLE_PARAGRAPH_TARGET: the original middle thought.");
    } else {
      lines.push(
        `Padding line ${i} with enough characters so the default 400-line window plus a 14k summary cannot see the middle of this note.`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

before(async () => {
  pathOps = (await import(pathToFileURL(path.join(electronLib, "workspace-path-ops.mjs")).href)).pathOps;
});

beforeEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = mkdtempSync(path.join(tmpdir(), "topmind-midfile-"));
  workspace = {
    engineRoot: path.join(tmpRoot, "engine"),
    userWorkspaceRoot: path.join(tmpRoot, "ws"),
  };
  mkdirSync(path.join(workspace.userWorkspaceRoot, "20-研究", "2026-中段"), { recursive: true });
  mkdirSync(workspace.engineRoot, { recursive: true });
});

after(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

test("editPath exact unique middle paragraph past default read window", async () => {
  const rel = "20-研究/2026-中段/long.md";
  const body = largeBody();
  await pathOps.savePath({ relativePath: rel, content: body }, ctx());

  const once = await pathOps.editPath({
    relativePath: rel,
    oldText: "UNIQUE_MIDDLE_PARAGRAPH_TARGET: the original middle thought.",
    newText: "UNIQUE_MIDDLE_PARAGRAPH_TARGET: the revised middle thought.",
  }, ctx());
  assert.equal(once.ok, true);
  assert.equal(once.replacements, 1);
  assert.equal(once.operation, "edit");
  const next = readFileSync(path.join(workspace.userWorkspaceRoot, rel), "utf8");
  assert.match(next, /revised middle thought/);
  assert.doesNotMatch(next, /original middle thought/);
  assert.match(next, /Padding line 1 /);
  assert.match(next, /Padding line 800 /);
});

test("editPath applies unique middle span despite newline/trailing-space drift", async () => {
  const rel = "20-研究/2026-中段/drift.md";
  const body = largeBody().replace(
    "UNIQUE_MIDDLE_PARAGRAPH_TARGET: the original middle thought.",
    "UNIQUE_MIDDLE_PARAGRAPH_TARGET: the original middle thought.  \r\n",
  );
  await pathOps.savePath({ relativePath: rel, content: body }, ctx());

  const once = await pathOps.editPath({
    relativePath: rel,
    oldText: "UNIQUE_MIDDLE_PARAGRAPH_TARGET: the original middle thought.\n",
    newText: "UNIQUE_MIDDLE_PARAGRAPH_TARGET: drift-tolerant middle.\n",
  }, ctx());
  assert.equal(once.ok, true, JSON.stringify(once));
  assert.equal(once.matchMode, "normalized");
  const next = readFileSync(path.join(workspace.userWorkspaceRoot, rel), "utf8");
  assert.match(next, /drift-tolerant middle/);
  assert.match(next, /Padding line 449 /);
  assert.match(next, /Padding line 451 /);
});

test("editPath refuses ambiguous oldText and writes nothing", async () => {
  const rel = "20-研究/2026-中段/ambig.md";
  await pathOps.savePath({
    relativePath: rel,
    content: "# Title\n\nhello world\n\nhello again\n",
  }, ctx());
  const before = readFileSync(path.join(workspace.userWorkspaceRoot, rel), "utf8");
  await assert.rejects(
    () => pathOps.editPath({ relativePath: rel, oldText: "hello", newText: "hi" }, ctx()),
    /匹配 2 处|replaceAll|matched 2/u,
  );
  assert.equal(readFileSync(path.join(workspace.userWorkspaceRoot, rel), "utf8"), before);
});

test("editPath no-match diagnostic includes nearby/context", async () => {
  const rel = "20-研究/2026-中段/miss.md";
  await pathOps.savePath({ relativePath: rel, content: largeBody() }, ctx());
  const before = readFileSync(path.join(workspace.userWorkspaceRoot, rel), "utf8");
  await assert.rejects(
    () => pathOps.editPath({
      relativePath: rel,
      oldText: "UNIQUE_MIDDLE_PARAGRAPH_TARGET: slightly wrong wording.",
      newText: "nope",
    }, ctx()),
    (err) => {
      const msg = String(err?.message || err);
      assert.match(msg, /nearby\/context/u);
      assert.match(msg, /450\|/u);
      return true;
    },
  );
  assert.equal(readFileSync(path.join(workspace.userWorkspaceRoot, rel), "utf8"), before);
});

test("readPathWindow around= exposes the mid-file paragraph with line numbers", async () => {
  const rel = "20-研究/2026-中段/read.md";
  await pathOps.savePath({ relativePath: rel, content: largeBody() }, ctx());
  const win = await pathOps.readPathWindow({
    relativePath: rel,
    around: "UNIQUE_MIDDLE_PARAGRAPH_TARGET",
    contextLines: 3,
  }, ctx());
  assert.equal(win.empty, false);
  assert.ok(win.startLine > 400);
  assert.match(win.numbered, /450\|UNIQUE_MIDDLE_PARAGRAPH_TARGET/);
});
