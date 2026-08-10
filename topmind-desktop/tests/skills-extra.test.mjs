import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  isSkillsPackRoot,
  installSkillsPackLocal,
  normalizeExtraSkillsRoots,
  resolveSkillsPackRoot,
  readSkillsExtraReceipt,
  summarizeSkillsPack,
} from "../electron/lib/skills-extra.mjs";
import {
  setConfiguredExtraSkillsRoots,
  resolveExtraSkillsRoots,
  listSkillCatalog,
  invalidateSkillsCache,
} from "../electron/lib/skills-runtime.mjs";

test("isSkillsPackRoot detects SKILL.md dirs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mh-sk-"));
  await fs.mkdir(path.join(root, "demo-skill"));
  await fs.writeFile(path.join(root, "demo-skill", "SKILL.md"), "---\nname: demo-skill\ndescription: d\n---\n", "utf8");
  assert.equal(await isSkillsPackRoot(root), true);
  assert.equal(await isSkillsPackRoot(path.join(root, "nope")), false);
});

test("installSkillsPackLocal copies skill + shared", async () => {
  const pack = await fs.mkdtemp(path.join(os.tmpdir(), "mh-pack-"));
  const dest = await fs.mkdtemp(path.join(os.tmpdir(), "mh-dest-"));
  await fs.mkdir(path.join(pack, "demo-skill"));
  await fs.writeFile(
    path.join(pack, "demo-skill", "SKILL.md"),
    "---\nname: demo-skill\ndescription: hello\n---\nbody\n",
    "utf8",
  );
  await fs.mkdir(path.join(pack, "shared"));
  await fs.writeFile(path.join(pack, "shared", "note.md"), "n", "utf8");
  await fs.writeFile(path.join(pack, "topmind-pack.json"), JSON.stringify({ version: "0.0.1", name: "demo" }), "utf8");

  const r = await installSkillsPackLocal(pack, { dest });
  assert.equal(r.ok, true);
  assert.ok(r.installed.includes("demo-skill"));
  assert.ok(r.installed.includes("shared"));
  const body = await fs.readFile(path.join(dest, "demo-skill", "SKILL.md"), "utf8");
  assert.match(body, /hello/);
});

test("resolveExtraSkillsRoots merges configured + exists filter", async () => {
  invalidateSkillsCache();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mh-extra-"));
  setConfiguredExtraSkillsRoots([dir, "/nonexistent/path/zzz"]);
  const roots = resolveExtraSkillsRoots();
  assert.ok(roots.includes(path.resolve(dir)));
  assert.equal(roots.some((r) => r.includes("nonexistent")), false);
  setConfiguredExtraSkillsRoots([]);
});

test("listSkillCatalog includes configured extra root skills", async () => {
  const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const extra = await fs.mkdtemp(path.join(os.tmpdir(), "mh-cat-"));
  await fs.mkdir(path.join(extra, "extra-demo"));
  await fs.writeFile(
    path.join(extra, "extra-demo", "SKILL.md"),
    "---\nname: extra-demo\ndescription: from extra root\n---\n",
    "utf8",
  );
  setConfiguredExtraSkillsRoots([extra]);
  invalidateSkillsCache();
  const catalog = listSkillCatalog({ engineRoot });
  const hit = catalog.find((s) => s.id === "extra-demo");
  assert.ok(hit, "expected extra-demo in catalog");
  assert.equal(hit.source, "external");
  setConfiguredExtraSkillsRoots([]);
  invalidateSkillsCache();
});

test("normalizeExtraSkillsRoots unique absolute paths", () => {
  const home = os.homedir();
  const a = normalizeExtraSkillsRoots([`${home}`, `${home}/`, home], { checkExists: true });
  assert.equal(a.length, 1);
  assert.equal(normalizeExtraSkillsRoots(null).length, 0);
});

test("resolveSkillsPackRoot finds nested skills/", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mh-nested-"));
  await fs.mkdir(path.join(root, "skills", "x"), { recursive: true });
  await fs.writeFile(path.join(root, "skills", "x", "SKILL.md"), "---\nname: x\ndescription: d\n---\n", "utf8");
  const resolved = await resolveSkillsPackRoot(root);
  assert.equal(resolved, path.join(root, "skills"));
});

test("install writes receipt with version; summarizeSkillsPack reads it", async () => {
  const pack = await fs.mkdtemp(path.join(os.tmpdir(), "mh-pack2-"));
  const dest = await fs.mkdtemp(path.join(os.tmpdir(), "mh-dest2-"));
  await fs.mkdir(path.join(pack, "s1"));
  await fs.writeFile(path.join(pack, "s1", "SKILL.md"), "---\nname: s1\ndescription: d\n---\n", "utf8");
  await fs.writeFile(
    path.join(pack, "topmind-pack.json"),
    JSON.stringify({ version: "9.9.9", name: "demo-pack" }),
    "utf8",
  );
  const r = await installSkillsPackLocal(pack, { dest });
  assert.equal(r.ok, true);
  assert.equal(r.version, "9.9.9");
  const receipt = await readSkillsExtraReceipt(dest);
  assert.ok(receipt);
  assert.equal(receipt.version, "9.9.9");
  assert.ok(receipt.entries.includes("s1"));
  const sum = await summarizeSkillsPack(dest);
  assert.equal(sum.ok, true);
  assert.equal(sum.version, "9.9.9");
  assert.equal(sum.skillCount, 1);
});

test("reinstall parks previous skill under skills-extra/.trash", async () => {
  const pack = await fs.mkdtemp(path.join(os.tmpdir(), "mh-pack-re-"));
  const dest = await fs.mkdtemp(path.join(os.tmpdir(), "mh-dest-re-"));
  await fs.mkdir(path.join(pack, "s1"));
  await fs.writeFile(path.join(pack, "s1", "SKILL.md"), "---\nname: s1\ndescription: v1\n---\n", "utf8");
  const first = await installSkillsPackLocal(pack, { dest });
  assert.equal(first.ok, true);
  await fs.writeFile(path.join(pack, "s1", "SKILL.md"), "---\nname: s1\ndescription: v2\n---\n", "utf8");
  const second = await installSkillsPackLocal(pack, { dest });
  assert.equal(second.ok, true);
  const body = await fs.readFile(path.join(dest, "s1", "SKILL.md"), "utf8");
  assert.match(body, /v2/);
  const trashEntries = await fs.readdir(path.join(dest, ".trash"));
  assert.ok(trashEntries.some((n) => n.startsWith("s1-")));
});
