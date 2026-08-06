/**
 * Unified workspace model — FS ⊕ config v3 ⊕ templates
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import {
  parseCategoryDirName,
  discoverCategoryDirs,
  resolveWorkspaceModel,
  ensureRequiredStructure,
  addCategory,
  updateCategoryAttributes,
  renameCategory,
  writeWorkspaceMap,
  suggestNextSlot,
  normalizeConfig,
  resolveSystemRoot,
  CATEGORY_PATTERN,
} from "../lib/workspace-model.mjs";

const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("parseCategoryDirName", () => {
  it("parses hyphen and space forms", () => {
    assert.deepEqual(parseCategoryDirName("00-收件箱"), {
      slot: "00",
      separator: "-",
      name: "收件箱",
    });
    assert.deepEqual(parseCategoryDirName("10 动态"), {
      slot: "10",
      separator: " ",
      name: "动态",
    });
  });

  it("rejects invalid names", () => {
    assert.equal(parseCategoryDirName("收件箱"), null);
    assert.equal(parseCategoryDirName("AI研究"), null);
    assert.ok(CATEGORY_PATTERN.test("11-健康"));
  });
});

describe("resolveWorkspaceModel", () => {
  /** @type {string} */
  let tmp;

  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-wm-"));
    for (const d of ["00-收件箱", "20-研究", "11-健康与运动", "88-输出", "99-归档"]) {
      await fs.mkdir(path.join(tmp, d));
    }
    await fs.writeFile(
      path.join(tmp, "topmind.yaml"),
      [
        "contract_version: 4",
        "workspace:",
        "  template: balanced",
        "  category_separator: \"-\"",
        "categories:",
        "  extensions:",
        "    \"11\":",
        "      name: 健康与运动",
        "      role: loose-stream",
        "      specialBehavior: flat-default",
      ].join("\n") + "\n",
      "utf8",
    );
  });

  after(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("discovers custom dirs and applies extension roles", () => {
    const dirs = discoverCategoryDirs(tmp);
    assert.ok(dirs.includes("11-健康与运动"));
    const model = resolveWorkspaceModel({ workspaceRoot: tmp, engineRoot });
    const health = model.categories.find((c) => c.slot === "11");
    assert.ok(health);
    assert.equal(health.role, "loose-stream");
    assert.equal(health.specialBehavior, "flat-default");
    assert.equal(health.source, "fs+config");
    const research = model.categories.find((c) => c.slot === "20");
    assert.equal(research.role, "deep-work");
    assert.ok(research.source.includes("template") || research.source === "fs+template");
  });

  it("resolves system roots by role", () => {
    const inbox = resolveSystemRoot(tmp, "buffer", { engineRoot });
    assert.ok(inbox.endsWith("00-收件箱"));
    const out = resolveSystemRoot(tmp, "delivery", { engineRoot });
    assert.ok(out.endsWith("88-输出"));
  });
});

describe("ensureRequiredStructure does not revive optional categories", () => {
  it("only ensures required roles on existing partial workspace", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-ensure-"));
    try {
      await fs.mkdir(path.join(tmp, "00-收件箱"));
      await fs.mkdir(path.join(tmp, "88-输出"));
      await fs.mkdir(path.join(tmp, "99-归档"));
      await fs.writeFile(
        path.join(tmp, "topmind.yaml"),
        [
          "contract_version: 4",
          "workspace:",
          "  template: balanced",
          "  category_separator: \"-\"",
        ].join("\n") + "\n",
        "utf8",
      );
      const { created } = ensureRequiredStructure(tmp, { engineRoot });
      // Should not create 50-其他 etc.
      const dirs = discoverCategoryDirs(tmp);
      assert.ok(!dirs.some((d) => d.includes("其他")));
      assert.ok(dirs.includes("00-收件箱"));
      assert.ok(Array.isArray(created));
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("addCategory + updateCategoryAttributes", () => {
  it("creates dir and config extension", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-add-"));
    try {
      await fs.mkdir(path.join(tmp, "00-收件箱"));
      await fs.mkdir(path.join(tmp, "88-输出"));
      await fs.mkdir(path.join(tmp, "99-归档"));
      const { directory, category } = addCategory(tmp, {
        slot: "21",
        name: "工作项目",
        role: "deep-work",
        engineRoot,
      });
      assert.equal(directory, "21-工作项目");
      assert.equal(category.role, "deep-work");
      // v4: topmind.yaml is the single source of truth (no .topmind-config.json)
      const yamlPath = path.join(tmp, "topmind.yaml");
      assert.ok(await fs.stat(yamlPath).then(() => true).catch(() => false));
      const updated = updateCategoryAttributes(tmp, "21", {
        role: "loose-stream",
        specialBehavior: "flat-default",
        engineRoot,
      });
      assert.equal(updated.category.role, "loose-stream");
      const slots = suggestNextSlot(["00", "21", "88", "99"]);
      assert.equal(slots, "10");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("normalizeConfig", () => {
  it("normalizes to v4 contract shape with flat aliases", () => {
    const n = normalizeConfig({ template: "minimal" });
    assert.equal(n.contract_version, 4);
    assert.deepEqual(n.categoryExtensions, {});
    assert.deepEqual(n.categoryOverrides, {});
    assert.equal(n.template, "minimal");
    assert.equal(n.categorySeparator, "-");
    assert.equal(n.locale, "zh-CN");
  });
});

describe("renameCategory + hidden + workspace-map", () => {
  it("rewriteCategoryFrontmatter is gated (source uses executeWrite, not writeFileSync)", () => {
    const src = fsSync.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../lib/workspace-model.mjs"),
      "utf8",
    );
    const fnStart = src.indexOf("function rewriteCategoryFrontmatter");
    assert.ok(fnStart >= 0);
    const fnBody = src.slice(fnStart, src.indexOf("\nexport function writeWorkspaceMap", fnStart));
    assert.match(fnBody, /executeWrite\s*\(/);
    assert.doesNotMatch(fnBody, /writeFileSync\s*\(/);
  });

  it("renames dir, updates frontmatter category, and honors hidden", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-rename-"));
    try {
      await fs.mkdir(path.join(tmp, "00-收件箱"));
      await fs.mkdir(path.join(tmp, "88-输出"));
      await fs.mkdir(path.join(tmp, "99-归档"));
      // Create via addCategory so extensions are registered
      addCategory(tmp, { slot: "21", name: "工作", role: "deep-work", engineRoot });
      await fs.writeFile(
        path.join(tmp, "21-工作", "note.md"),
        ["---", "title: N", "category: 21-工作", "---", "", "body", ""].join("\n"),
        "utf8",
      );
      const ren = renameCategory(tmp, { slot: "21", newName: "工作项目", engineRoot });
      assert.equal(ren.to, "21-工作项目");
      assert.ok(ren.frontmatterUpdated >= 1);
      assert.ok(discoverCategoryDirs(tmp).includes("21-工作项目"));
      assert.ok(!discoverCategoryDirs(tmp).includes("21-工作"));
      const body = await fs.readFile(path.join(tmp, "21-工作项目", "note.md"), "utf8");
      assert.match(body, /category:\s*21-工作项目/);

      updateCategoryAttributes(tmp, "21", { hidden: true, engineRoot });
      const model = resolveWorkspaceModel({ workspaceRoot: tmp, engineRoot });
      const cat = model.categories.find((c) => c.slot === "21");
      assert.equal(cat.hidden, true);

      const map = writeWorkspaceMap(tmp, { engineRoot });
      assert.ok(map.path.endsWith(".topmind/workspace-map.json"));
      const raw = JSON.parse(await fs.readFile(map.path, "utf8"));
      assert.equal(raw.derived, true);
      assert.ok(raw.categories.some((c) => c.slot === "21" && c.hidden === true));
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
