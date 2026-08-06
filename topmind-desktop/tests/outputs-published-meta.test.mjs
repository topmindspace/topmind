/**
 * Outputs shelf honesty — listOutputsEnhanced attaches publishedAt from frontmatter.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { listOutputsEnhanced } from "../electron/lib/workspace-list-ops.mjs";
import { outputsRoot } from "../electron/lib/path-model.mjs";

test("listOutputsEnhanced sets publishedAt from published_at frontmatter", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-outputs-"));
  const workspace = {
    engineRoot: root,
    userWorkspaceRoot: path.join(root, "ws"),
  };
  const outDir = outputsRoot(workspace);
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, "shipped.md"),
    `---\ntitle: Ship Me\npublished_at: 2026-07-20T12:00:00.000Z\n---\n\n# body\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(outDir, "draft.md"),
    `---\ntitle: Draft Only\n---\n\n# not published\n`,
    "utf8",
  );
  await fs.writeFile(path.join(outDir, "notes.txt"), "plain\n", "utf8");

  const res = await listOutputsEnhanced(
    { recursiveFlat: true, filter: "all", limit: 50 },
    { workspaceRoot: workspace },
  );
  assert.ok(res.outputsName);
  const byName = Object.fromEntries((res.files || []).map((f) => [f.name, f]));
  assert.ok(byName["shipped.md"], `expected shipped.md in ${JSON.stringify(res.files)}`);
  assert.equal(byName["shipped.md"].publishedAt, "2026-07-20T12:00:00.000Z");
  assert.equal(byName["shipped.md"].title, "Ship Me");
  assert.ok(byName["draft.md"]);
  assert.equal(byName["draft.md"].publishedAt, null);
  assert.equal(byName["draft.md"].title, "Draft Only");
  assert.ok(byName["notes.txt"]);
  assert.equal(byName["notes.txt"].publishedAt, null);

  // Non-recursive path also enriches (regression: path.join on WorkspaceContext object)
  const flat = await listOutputsEnhanced(
    { recursiveFlat: false, filter: "all", limit: 50 },
    { workspaceRoot: workspace },
  );
  const flatBy = Object.fromEntries((flat.files || []).map((f) => [f.name, f]));
  assert.ok(flatBy["shipped.md"], "non-recursive must list shipped.md");
  assert.equal(flatBy["shipped.md"].publishedAt, "2026-07-20T12:00:00.000Z");

  await fs.rm(root, { recursive: true, force: true });
});
