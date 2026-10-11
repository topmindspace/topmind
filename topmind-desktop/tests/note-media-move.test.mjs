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
import { scanOps } from "../electron/lib/workspace-scan-ops.mjs";
import { mediaUrlsForEditor } from "../src/lib/editor-media.ts";
import {
  findLocalMediaRefs,
  listWorkspaceImageFiles,
  planNoteMedia,
  transferNoteMedia,
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

test("planNoteMedia includes wikilink and spaced image refs", async () => {
  const noteRel = "00-收件箱/embed-plan.md";
  const noteAbs = path.join(workspace.userWorkspaceRoot, noteRel);
  const touch = (rel, body = "x") => {
    const abs = path.join(workspace.userWorkspaceRoot, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  touch("00-收件箱/Pasted image 20241010120000.png");
  touch("00-收件箱/Pasted image x.png");
  touch("attachments/foo.png");
  touch("20-研究/deep/only-deep-embed.png");
  touch("z/dup-embed.png");
  touch("a/b/c/dup-embed.png");
  touch("Attachments/PhotoCase.PNG");
  touch("00-收件箱/secret-fenced.png");
  touch("docs/other-note.md", "# note");
  touch("docs/clip.pdf", "%PDF");
  const md = [
    "![[Pasted image 20241010120000.png]]",
    "![](<Pasted image x.png>)",
    "![[attachments/foo.png|300]]",
    "![[only-deep-embed.png]]",
    "![[dup-embed.png]]",
    "![[photocase.png]]",
    "```",
    "![[secret-fenced.png]]",
    "```",
    "![[other-note.md]]",
    "![[clip.pdf]]",
    "![[missing-embed.png|caption]]",
  ].join("\n");
  writeFileSync(noteAbs, md, "utf8");
  const plan = await planNoteMedia(noteRel, md, ctx());
  assert.ok(plan.referencedImages.includes("00-收件箱/Pasted image 20241010120000.png"));
  assert.ok(plan.referencedImages.includes("00-收件箱/Pasted image x.png"));
  assert.ok(plan.referencedImages.includes("attachments/foo.png"));
  assert.ok(plan.referencedImages.includes("20-研究/deep/only-deep-embed.png"));
  assert.ok(plan.referencedImages.includes("z/dup-embed.png"));
  assert.ok(!plan.referencedImages.includes("a/b/c/dup-embed.png"));
  assert.ok(
    plan.referencedImages.some((p) => p.toLowerCase() === "attachments/photocase.png"),
  );
  assert.ok(!plan.referencedImages.some((p) => p.endsWith("secret-fenced.png")));
  assert.ok(!plan.referencedImages.some((p) => p.endsWith("missing-embed.png")));
  assert.ok(!plan.referencedImages.some((p) => /\.(md|pdf)$/iu.test(p)));
  assert.ok(plan.mediaFiles.includes("Pasted image 20241010120000.png"));
  assert.ok(plan.mediaFiles.includes("Pasted image x.png"));
  assert.ok(!plan.mediaFiles.some((f) => f.includes("attachments/")));
  assert.ok(!plan.mediaFiles.some((f) => f.includes("only-deep-embed")));
});

test("moveToTopic moves a sibling wikilink image and keeps the embed text", async () => {
  const noteRel = "00-收件箱/wiki-move.md";
  const noteAbs = path.join(workspace.userWorkspaceRoot, noteRel);
  const imgAbs = path.join(
    workspace.userWorkspaceRoot,
    "00-收件箱",
    "Pasted image wiki-move.png",
  );
  const sharedAbs = path.join(workspace.userWorkspaceRoot, "attachments", "stay-shared.png");
  mkdirSync(path.dirname(sharedAbs), { recursive: true });
  const md = [
    "---",
    "title: wiki-move",
    "---",
    "",
    "![[Pasted image wiki-move.png]]",
    "",
    "![[attachments/stay-shared.png]]",
    "",
    "![](<Pasted image wiki-spaced.png>)",
    "",
  ].join("\n");
  writeFileSync(noteAbs, md, "utf8");
  writeFileSync(imgAbs, Buffer.from("png"));
  writeFileSync(
    path.join(workspace.userWorkspaceRoot, "00-收件箱", "Pasted image wiki-spaced.png"),
    Buffer.from("png2"),
  );
  writeFileSync(sharedAbs, Buffer.from("shared"));

  const moved = await inboxOps.moveToTopic(
    { relativePath: noteRel, targetTopicId: "20-研究/2026-目标专题" },
    ctx(),
  );
  assert.equal(moved.ok, true);
  assert.ok(moved.mediaMoved >= 1);
  const destDir = path.join(workspace.userWorkspaceRoot, "20-研究", "2026-目标专题");
  assert.ok(existsSync(path.join(destDir, "Pasted image wiki-move.png")));
  assert.ok(existsSync(path.join(destDir, "Pasted image wiki-spaced.png")));
  assert.ok(!existsSync(imgAbs));
  assert.ok(existsSync(sharedAbs), "vault-root attachment stays put");
  const body = readFileSync(path.join(workspace.userWorkspaceRoot, moved.newPath), "utf8");
  assert.match(body, /!\[\[Pasted image wiki-move\.png\]\]/);
  assert.match(body, /!\[\[attachments\/stay-shared\.png\]\]/);
  assert.match(body, /!\[]\(<Pasted image wiki-spaced\.png>\)/);
  assert.doesNotMatch(body, /!\[[^\]]*\]\(Pasted image wiki-move/);
});

test("image path list drops a moved basename without a fresh walk", async () => {
  const wsRoot = path.join(root, "cache-ws");
  mkdirSync(path.join(wsRoot, "00-收件箱"), { recursive: true });
  mkdirSync(path.join(wsRoot, "20-研究", "2026-目标专题"), { recursive: true });
  const localWs = { engineRoot: root, userWorkspaceRoot: wsRoot };
  const localCtx = () => ({ workspaceRoot: localWs });
  const noteRel = "00-收件箱/cache-move.md";
  const oldImg = "00-收件箱/Pasted image.png";
  const md = "![[Pasted image.png]]\n";
  writeFileSync(path.join(wsRoot, noteRel), md, "utf8");
  writeFileSync(path.join(wsRoot, "00-收件箱", "Pasted image.png"), Buffer.from("png"));

  const filled = await listWorkspaceImageFiles(wsRoot);
  assert.ok(filled.includes(oldImg));

  const moved = await transferNoteMedia(
    {
      noteRelativePath: noteRel,
      destNoteDir: "20-研究/2026-目标专题",
      markdown: md,
      mode: "move",
    },
    localCtx(),
  );
  assert.ok(moved.count >= 1);
  const destImg = "20-研究/2026-目标专题/Pasted image.png";
  assert.ok(existsSync(path.join(wsRoot, destImg)));
  assert.ok(!existsSync(path.join(wsRoot, oldImg)));

  const again = await listWorkspaceImageFiles(wsRoot);
  assert.ok(!again.includes(oldImg));
  assert.ok(again.includes(destImg));
  const viaRpc = await scanOps.listImagePaths({}, localCtx());
  assert.ok(!viaRpc.paths.includes(oldImg));
  assert.ok(viaRpc.paths.includes(destImg));

  const view = mediaUrlsForEditor(
    "![[Pasted image.png]]",
    "20-研究/2026-目标专题/cache-move.md",
    again,
  );
  const src = view.match(/\((topmind-asset:\/\/local\/[^)\s]+)/u)?.[1] || "";
  assert.match(src, /20-研究\/2026-目标专题\/Pasted%20image\.png/);
  assert.doesNotMatch(src, /00-收件箱/);
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
