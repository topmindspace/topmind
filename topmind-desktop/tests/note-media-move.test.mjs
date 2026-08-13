/**
 * Note-local media transfer with move / publish.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { createInboxOps } from "../electron/lib/workspace-inbox-ops.mjs";
import { pathOps } from "../electron/lib/workspace-path-ops.mjs";
import {
  findLocalMediaRefs,
  planNoteMedia,
} from "../electron/lib/workspace-note-media.mjs";

let root;
let workspace;
const inboxOps = createInboxOps({
  moveToTopic: (...args) => inboxOps.moveToTopic(...args),
});

function ctx() {
  return { workspaceRoot: workspace };
}

before(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "mh-media-move-"));
  workspace = {
    engineRoot: root,
    userWorkspaceRoot: path.join(root, "ws"),
  };
  mkdirSync(path.join(workspace.userWorkspaceRoot, "00-收件箱", "images", "clip-a"), {
    recursive: true,
  });
  mkdirSync(path.join(workspace.userWorkspaceRoot, "20-研究", "2026-目标专题"), {
    recursive: true,
  });
  mkdirSync(path.join(workspace.userWorkspaceRoot, "88-输出"), { recursive: true });
  mkdirSync(path.join(workspace.userWorkspaceRoot, "99-归档", "backups"), {
    recursive: true,
  });
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

test("findLocalMediaRefs ignores remote urls", () => {
  const md = [
    "![a](images/s/x.png)",
    "![b](https://cdn/x.png)",
    "![c](./images/s/y.webp)",
  ].join("\n");
  const refs = findLocalMediaRefs(md);
  assert.deepEqual(refs.sort(), ["images/s/x.png", "images/s/y.webp"].sort());
});

test("moveToTopic moves images/{slug} with the note", async () => {
  const noteRel = "00-收件箱/clip-a.md";
  const noteAbs = path.join(workspace.userWorkspaceRoot, noteRel);
  const imgAbs = path.join(
    workspace.userWorkspaceRoot,
    "00-收件箱",
    "images",
    "clip-a",
    "img-test.png",
  );
  writeFileSync(
    noteAbs,
    "---\ntitle: clip-a\n---\n\nBody\n\n![p](images/clip-a/img-test.png)\n",
    "utf8",
  );
  writeFileSync(imgAbs, Buffer.from("png"), "utf8");

  const moved = await inboxOps.moveToTopic(
    {
      relativePath: noteRel,
      targetTopicId: "20-研究/2026-目标专题",
    },
    ctx(),
  );
  assert.equal(moved.ok, true);
  assert.ok(moved.mediaMoved >= 1);
  assert.ok(moved.newPath.startsWith("20-研究/2026-目标专题/"));
  assert.ok(existsSync(path.join(workspace.userWorkspaceRoot, moved.newPath)));
  assert.ok(
    existsSync(
      path.join(
        workspace.userWorkspaceRoot,
        "20-研究",
        "2026-目标专题",
        "images",
        "clip-a",
        "img-test.png",
      ),
    ),
  );
  assert.ok(!existsSync(noteAbs));
  assert.ok(!existsSync(imgAbs));
  const body = readFileSync(
    path.join(workspace.userWorkspaceRoot, moved.newPath),
    "utf8",
  );
  assert.match(body, /images\/clip-a\/img-test\.png/);
  assert.match(body, /topic:\s*2026-目标专题|topic: "2026-目标专题"/);
});

test("publishPath copies media into 88-输出 and keeps original", async () => {
  const noteRel = "20-研究/2026-目标专题/pub-note.md";
  const noteAbs = path.join(workspace.userWorkspaceRoot, noteRel);
  mkdirSync(path.dirname(noteAbs), { recursive: true });
  mkdirSync(
    path.join(workspace.userWorkspaceRoot, "20-研究", "2026-目标专题", "images", "pub-note"),
    { recursive: true },
  );
  const imgAbs = path.join(
    workspace.userWorkspaceRoot,
    "20-研究",
    "2026-目标专题",
    "images",
    "pub-note",
    "img-p.png",
  );
  writeFileSync(
    noteAbs,
    "---\ntitle: pub\n---\n\n![i](images/pub-note/img-p.png)\n",
    "utf8",
  );
  writeFileSync(imgAbs, Buffer.from("png2"), "utf8");

  const pub = await pathOps.publishPath({ relativePath: noteRel }, ctx());
  assert.equal(pub.ok, true);
  assert.ok(pub.path.startsWith("88-输出/"));
  assert.ok(pub.mediaCopied >= 1);
  assert.ok(existsSync(noteAbs), "original remains");
  assert.ok(existsSync(imgAbs), "original media remains");
  assert.ok(
    existsSync(
      path.join(workspace.userWorkspaceRoot, "88-输出", "images", "pub-note", "img-p.png"),
    ),
  );
  const outBody = readFileSync(
    path.join(workspace.userWorkspaceRoot, pub.path),
    "utf8",
  );
  assert.match(outBody, /published_at/);
  assert.match(outBody, /source_path/);
  assert.match(outBody, /images\/pub-note\/img-p\.png/);
});

test("planNoteMedia includes convention stem folder", async () => {
  const noteRel = "20-研究/2026-目标专题/stem-only.md";
  const dir = path.join(
    workspace.userWorkspaceRoot,
    "20-研究",
    "2026-目标专题",
    "images",
    "stem-only",
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "x.png"), "x");
  writeFileSync(
    path.join(workspace.userWorkspaceRoot, noteRel),
    "---\ntitle: s\n---\n\nno img ref\n",
  );
  const plan = await planNoteMedia(noteRel, "no img ref", ctx());
  assert.ok(plan.mediaDirs.includes("images/stem-only"));
});

test("deletePath trashes note + images/{slug}", async () => {
  const noteRel = "20-研究/2026-目标专题/doomed-media.md";
  const noteAbs = path.join(workspace.userWorkspaceRoot, noteRel);
  const imgDir = path.join(
    workspace.userWorkspaceRoot,
    "20-研究",
    "2026-目标专题",
    "images",
    "doomed-media",
  );
  mkdirSync(imgDir, { recursive: true });
  writeFileSync(path.join(imgDir, "img.png"), "png");
  writeFileSync(
    noteAbs,
    "---\ntitle: d\n---\n\n![x](images/doomed-media/img.png)\n",
  );

  const del = await pathOps.deletePath({ relativePath: noteRel }, ctx());
  assert.equal(del.operation, "delete");
  assert.ok(!existsSync(noteAbs));
  assert.ok(!existsSync(path.join(imgDir, "img.png")));
  // Ordinary open note: media is removed, not parked in backups/trash
  assert.equal(del.mediaTrashed || 0, 0);
  assert.ok(
    !(del.affectedFiles || []).some((p) => /99-归档\/backups\/trash\//u.test(p)),
    "ordinary note media must not flood trash",
  );
});

test("renamePath renames images/{oldStem} and rewrites body", async () => {
  const noteRel = "20-研究/2026-目标专题/old-name.md";
  const noteAbs = path.join(workspace.userWorkspaceRoot, noteRel);
  const imgDir = path.join(
    workspace.userWorkspaceRoot,
    "20-研究",
    "2026-目标专题",
    "images",
    "old-name",
  );
  mkdirSync(imgDir, { recursive: true });
  writeFileSync(path.join(imgDir, "a.png"), "a");
  writeFileSync(
    noteAbs,
    "---\ntitle: old\n---\n\n![a](images/old-name/a.png)\n",
  );

  const ren = await pathOps.renamePath(
    { relativePath: noteRel, newName: "new-name.md" },
    ctx(),
  );
  assert.equal(ren.ok, true);
  assert.equal(ren.path, "20-研究/2026-目标专题/new-name.md");
  assert.ok(ren.mediaRenamed);
  assert.ok(!existsSync(noteAbs));
  assert.ok(
    existsSync(
      path.join(workspace.userWorkspaceRoot, "20-研究", "2026-目标专题", "new-name.md"),
    ),
  );
  assert.ok(
    existsSync(
      path.join(
        workspace.userWorkspaceRoot,
        "20-研究",
        "2026-目标专题",
        "images",
        "new-name",
        "a.png",
      ),
    ),
  );
  assert.ok(!existsSync(path.join(imgDir, "a.png")));
  const body = readFileSync(
    path.join(workspace.userWorkspaceRoot, "20-研究", "2026-目标专题", "new-name.md"),
    "utf8",
  );
  assert.match(body, /images\/new-name\/a\.png/);
  assert.doesNotMatch(body, /images\/old-name\//);
});

test("rewriteMediaSlug helper", async () => {
  const { rewriteMediaSlug } = await import("../electron/lib/workspace-note-media.mjs");
  const md = "![a](images/old/x.png) and ![b](./images/old/y.png)";
  const out = rewriteMediaSlug(md, "old", "new");
  assert.match(out, /images\/new\/x\.png/);
  assert.match(out, /images\/new\/y\.png/);
});
