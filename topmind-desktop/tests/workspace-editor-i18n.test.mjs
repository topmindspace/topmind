/**
 * workspace:editor.* keys used by FileEditorView / format bar must resolve
 * in both locales (usability / no raw key leakage).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (/\.(tsx|ts)$/.test(ent.name)) acc.push(p);
  }
  return acc;
}

describe("workspace:editor i18n completeness", () => {
  it("every workspace:editor.* key used in src exists in zh-CN and en-US", () => {
    const files = walk(path.join(root, "src"));
    const used = new Set();
    const re = /workspace:editor\.([a-zA-Z0-9_]+)/g;
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      let m;
      while ((m = re.exec(text))) used.add(m[1]);
    }
    assert.ok(used.size >= 15, `expected many editor keys, got ${used.size}`);
    const zh = JSON.parse(fs.readFileSync(path.join(root, "src/locales/zh-CN/workspace.json"), "utf8"));
    const en = JSON.parse(fs.readFileSync(path.join(root, "src/locales/en-US/workspace.json"), "utf8"));
    for (const key of used) {
      assert.equal(typeof zh.editor?.[key], "string", `zh editor.${key}`);
      assert.equal(typeof en.editor?.[key], "string", `en editor.${key}`);
      assert.ok(zh.editor[key].length > 0);
      assert.ok(en.editor[key].length > 0);
      // en must not be Chinese
      assert.doesNotMatch(en.editor[key], /[\u4e00-\u9fff]/);
    }
  });
});
