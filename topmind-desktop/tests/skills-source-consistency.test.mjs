import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listSkillCatalog, loadSkillBody, loadSkillResource,
  invalidateSkillsCache, formatCatalogForPrompt,
} from "../electron/lib/skills-runtime.mjs";
import { buildSystemPrompt } from "../electron/ai-prompts.mjs";

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

test("resource windows preserve complete Unicode characters and mark oversized references", (t) => {
  const f = fixture(t);
  const copy = "文".repeat(999);
  f.write(f.external, "sample/references/large.md", `${copy}🙂${"文".repeat(60000)}`);
  const scope = { ...f.opts, skillId: "sample" };
  const limited = loadSkillResource("references/large.md", { ...scope, maxChars: 1000 });
  assert.equal(limited.truncated, true);
  assert.equal(limited.content, `${copy}\n\n…(truncated)`);
  f.write(f.external, "sample/references/exact.md", "文".repeat(1000));
  assert.equal(loadSkillResource("references/exact.md", { ...scope, maxChars: 1000 }).truncated, false);
});

test("resource discovery excludes hidden pack files", (t) => {
  const f = fixture(t);
  f.write(f.external, "sample/.scratch.md", "draft");
  assert.throws(() => loadSkillResource(".scratch.md", { ...f.opts, skillId: "sample" }), /Invalid resource path/);
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

test("the same selection applies to discovery, direct activation, resource paths and prompt preloads", (t) => {
  const f = fixture(t);
  const opts = { ...f.opts, enabledIds: ["topmind-format"] };
  assert.deepEqual(listSkillCatalog(opts).map(skill => skill.id), ["topmind-format"]);
  assert.deepEqual(listSkillCatalog({ ...opts, enabledIds: [] }), []);
  assert.throws(() => loadSkillBody("sample", opts), /not enabled/);
  assert.throws(() => loadSkillResource("references/detail.md", { ...opts, skillId: "sample" }), /not enabled/);
  assert.throws(() => loadSkillResource("sample/SKILL.md", opts), /not enabled/);
  assert.throws(() => loadSkillResource("../topmind-revise/SKILL.md", { ...opts, skillId: "topmind-format" }), /not enabled/);
  const promptOpts = { ...f.opts, extraSkillsRoots: f.opts.extraRoots, enabledSkillIds: opts.enabledIds, activeSkillId: "sample", locale: "en" };
  t.after(() => buildSystemPrompt({ extraSkillsRoots: [] }));
  assert.doesNotMatch(buildSystemPrompt(promptOpts), /skill is pre-loaded: sample|load_skill\("topmind"\)/);
  assert.doesNotMatch(buildSystemPrompt({ ...promptOpts, documentTask: true }), /Host-preloaded skill: sample/);
  assert.doesNotMatch(buildSystemPrompt({ ...promptOpts, enabledSkillIds: [] }), /load_skill/);
  assert.match(buildSystemPrompt({ ...promptOpts, documentTask: true, activeSkillId: "topmind-format" }), /Host-preloaded skill: topmind-format/);
});

test("writing guidance and resource paths use the selected pack", (t) => {
  const f = fixture(t);
  assert.match(loadSkillResource("topmind-wechat-post/references/workspace.md", f.opts).content, /源稿/u);
  f.write(f.external, "topmind-pack.json", JSON.stringify({ name: "topmind-writing-skills" }));
  f.write(f.external, "sample/SKILL.md", `---\nname: sample\ndescription: Writing\n---\n${"a".repeat(3000)}`);
  f.write(f.external, "runtime/host-guide.md", "selected-pack-guide");
  invalidateSkillsCache();
  const body = loadSkillBody("sample", { ...f.opts, maxChars: 2000 });
  assert.ok(body.truncated);
  assert.ok(body.raw.startsWith("selected-pack-guide"));
  assert.equal(loadSkillResource("runtime/host-guide.md", { ...f.opts, skillId: "sample" }).content, "selected-pack-guide");
});
