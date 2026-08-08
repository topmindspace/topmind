/**
 * Living entry docs: four product cores via ⊕; Clip is companion distribution only.
 * Guards F3 surface-counting consistency (PRODUCT-BOUNDARIES / AGENTS / README).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ENTRY_DOCS = ["README.md", "README.en.md", "AGENTS.md", "CLAUDE.md"];

/** First ```text fenced block that introduces the topmind = Portable Skills formula. */
function heroFormulaBlock(src) {
  const re = /```text\n([\s\S]*?Portable Skills[\s\S]*?)```/;
  const m = src.match(re);
  return m ? m[1] : "";
}

test("entry docs: four cores via ⊕, Clip is companion not equal ⊕ peer", () => {
  for (const rel of ENTRY_DOCS) {
    const src = readFileSync(path.join(repo, rel), "utf8");
    const block = heroFormulaBlock(src);
    assert.ok(block.length > 0, `${rel}: missing Portable Skills formula block`);

    for (const core of [
      "Portable Skills",
      "Optional Desktop",
      "Optional UTR",
      "Optional Obsidian",
    ]) {
      assert.ok(block.includes(core), `${rel}: missing core ${core}`);
    }

    // Forbidden historical five-peer formulas
    assert.doesNotMatch(
      block,
      /⊕\s*Optional Clip\s*⊕/u,
      `${rel}: Clip must not sit as middle ⊕ peer`,
    );
    assert.doesNotMatch(
      block,
      /Optional Obsidian\s*⊕\s*Optional Clip/u,
      `${rel}: Clip must not follow Obsidian as ⊕ peer`,
    );
    assert.doesNotMatch(
      block,
      /Optional Clip\s*⊕\s*Optional UTR/u,
      `${rel}: Clip must not precede UTR as ⊕ peer`,
    );

    if (/Clip/i.test(block)) {
      assert.match(
        block,
        /\+\s*Optional Clip|companion|分发/iu,
        `${rel}: Clip must be framed as + companion/distribution`,
      );
    }
  }
});

test("README matrix sections use four-cores + Clip distribution wording", () => {
  const zh = readFileSync(path.join(repo, "README.md"), "utf8");
  const en = readFileSync(path.join(repo, "README.en.md"), "utf8");
  assert.match(zh, /四体核心\s*\+\s*Clip/);
  assert.doesNotMatch(zh, /## 🧩 五大表面/);
  assert.match(en, /four cores \+ Clip distribution/i);
  assert.doesNotMatch(en, /## 🧩 Five Surfaces/);
});
