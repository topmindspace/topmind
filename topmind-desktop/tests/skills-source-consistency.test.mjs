import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadSkillBody, loadSkillResource,
  invalidateSkillsCache, formatCatalogForPrompt,
} from "../electron/lib/skills-runtime.mjs";

function fixture(t) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "tm-skill-source-"));
  const engineRoot = path.join(tmp, "engine");
  const bundled = path.join(engineRoot, "skills");
  const external = path.join(tmp, "extra");
  function write(root, rel, text) {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  for (const [root, text] of [[bundled, "bundled"], [external, "external"]]) {
    write(root, "topmind-pack.json", "{}");
    write(root, "sample/SKILL.md", `---\nname: sample\ndescription: Use when source-specific task.\n---\n\n${text}`);
    write(root, "shared/rule.md", text);
    write(root, "sample/references/detail.md", `${text} detail`);
  }
  invalidateSkillsCache();
  t.after(() => { invalidateSkillsCache(); rmSync(tmp, { recursive: true, force: true }); });
  return { tmp, engineRoot, bundled, external, write, opts: { engineRoot, extraRoots: [external] } };
}

test("activation and shared references follow the selected extension source", (t) => {
  const f = fixture(t);
  assert.match(loadSkillBody("sample", f.opts).body, /external/);
  assert.equal(loadSkillResource("../shared/rule.md", { ...f.opts, skillId: "sample" }).content, "external");
  assert.equal(loadSkillResource("references/detail.md", { ...f.opts, skillId: "sample" }).content, "external detail");
  assert.equal(loadSkillResource("shared/rule.md", f.opts).content, "external");
  assert.match(loadSkillBody("sample", { engineRoot: f.engineRoot }).body, /bundled/);
  f.write(f.external, "sample/SKILL.md", "---\nname: sample\ndescription: Updated.\n---\nnew version");
  assert.match(loadSkillBody("sample", f.opts).body, /new version/);
  assert.match(loadSkillBody("sample", { engineRoot: f.engineRoot }).body, /bundled/);
});

test("resources never silently fall back to a different skill pack", (t) => {
  const f = fixture(t);
  f.write(f.bundled, "sample/references/bundled-only.md", "wrong pack");
  assert.throws(() => loadSkillResource("references/bundled-only.md", { ...f.opts, skillId: "sample" }), /not found/);
});

test("skill resources fence traversal and escaping symlinks", (t) => {
  const f = fixture(t);
  f.write(f.tmp, "outside.md", "outside marker");
  const link = path.join(f.external, "shared", "escape.md");
  try { symlinkSync(path.join(f.tmp, "outside.md"), link); }
  catch (err) {
    if (err.code === "EPERM") { t.skip("symlink privilege unavailable"); return; }
    throw err;
  }
  for (const resource of ["../../outside.md", "/outside.md", "C:/outside.md", "../shared/escape.md"]) {
    assert.throws(() => loadSkillResource(resource, { ...f.opts, skillId: "sample" }), /Invalid resource path/);
  }
});

test("discovery includes each skill description once", () => {
  const catalog = [{ id: "sample", description: "UNIQUE_DISCOVERY_TEXT", path: "/skills/sample/SKILL.md" }];
  const prompt = formatCatalogForPrompt(catalog);
  assert.equal(prompt.split("UNIQUE_DISCOVERY_TEXT").length - 1, 1);
  assert.equal(prompt.split("<name>sample</name>").length - 1, 1);
});
