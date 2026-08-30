/**
 * Desktop / Obsidian suggestion surfaces must call Kernel generateSuggestions
 * and forward `force` on manual refresh (fingerprint skip otherwise no-ops).
 * Obsidian must ingest confirm-gated op cards (memory_organize / topic_classify).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("Desktop suggest force + Kernel-only path", () => {
  it("workspace-service forwards force into kernel generateSuggestions", () => {
    const src = read("topmind-desktop/electron/workspace-service.mjs");
    assert.match(src, /const force = p\?\.force === true/);
    assert.match(src, /kernelGenerateSuggestions\([\s\S]*force/);
  });

  it("ActionStore manual force refresh passes force: !decision.soft", () => {
    const store = read("topmind-desktop/src/stores/action-store.ts");
    assert.match(store, /generateSuggestions\(\s*\{\s*force:\s*!decision\.soft\s*\}\s*\)/);
  });
});

describe("Obsidian suggest force + op-card session", () => {
  it("kernel-service generateSuggestions forwards opts.force to Kernel", () => {
    const src = read("obsidian-plugin/src/services/kernel-service.ts");
    assert.match(src, /async generateSuggestions\(opts:\s*\{\s*force\?:\s*boolean/);
    assert.match(src, /generateSuggestions\(\{\s*force,\s*localeOverride:/);
    assert.doesNotMatch(src, /generateSuggestions\(\{\s*force:\s*false\s*\}\)/);
    assert.match(src, /mergeSoftSuggestionSession/);
    assert.match(src, /opSuggestionSession/);
    assert.match(src, /surfaceUiLocale/);
    assert.match(src, /settings\.localeOverride \|\| ""/);
  });

  it("manual refresh command and buttons pass force:true; idle does not", () => {
    const main = read("obsidian-plugin/src/main.ts");
    assert.match(main, /generateSuggestions\(\{\s*force:\s*true\s*\}\)/);

    const sidebar = read("obsidian-plugin/src/views/sidebar-dock-view.ts");
    // Refresh button re-enters the guarded tab path with force; the tab's own
    // paint is soft (force only when requested) so fingerprint skip + session
    // merge still apply.
    assert.match(sidebar, /renderSuggestionsTab\(container,\s*\{\s*force:\s*true\s*\}\)/);
    assert.match(sidebar, /force:\s*opts\.force === true/);
    // Re-entrancy guard: never two concurrent kernel suggestion passes
    assert.match(sidebar, /suggestionsInFlight/);

    const workbench = read("obsidian-plugin/src/views/stream-workbench-view.ts");
    assert.match(workbench, /refreshSuggestions\(\{\s*force:\s*true\s*\}\)/);
    assert.match(workbench, /async refreshSuggestions\(opts:\s*\{\s*force\?:\s*boolean/);
  });

  it("runOperation ingests confirm-gated suggestions into the session", () => {
    const src = read("obsidian-plugin/src/services/kernel-service.ts");
    assert.match(src, /async runOperation\(id:\s*string,\s*opts:\s*\{\s*force\?:\s*boolean/);
    assert.match(
      src,
      /opSuggestionSession\s*=\s*mergeSoftSuggestionSession\(\s*this\.opSuggestionSession/,
    );
  });

  it("chat writeback reads contract, not plugin settings.writebackMode", () => {
    const src = read("obsidian-plugin/src/services/kernel-service.ts");
    assert.match(src, /runWorkspaceChatTurn/);
    assert.doesNotMatch(src, /writebackMode:\s*this\.settings\.writebackMode/);
    const ops = read("obsidian-plugin/src/services/kernel-workspace-ops.ts");
    assert.match(ops, /resolveContractWritebackMode\(kernel, workspaceRoot\)/);
  });
});

describe("extractTodosFromStream force clears period hash", () => {
  it("force deletes hashes[period] not only processedPeriods", () => {
    const src = read("lib/todo-engine.mjs");
    assert.match(src, /delete hashes\[note\.period\]/);
    assert.match(
      src,
      /if \(force\) \{\s*processedPeriods = processedPeriods\.filter\(\(p\) => p !== note\.period\)/,
    );
  });
});

describe("suggestion kind parity (Kernel emitted kinds = Obsidian render kinds)", () => {
  /** Kinds the kernel actually emits (suggest-engine + ai-operation-engine). */
  function emittedKernelKinds() {
    const kinds = new Set();
    for (const rel of ["lib/suggest-engine.mjs", "lib/ai-operation-engine.mjs"]) {
      const src = read(rel);
      for (const m of src.matchAll(/kind:\s*"([a-z_]+)"/g)) {
        kinds.add(m[1]);
      }
    }
    return kinds;
  }

  /** Kinds the Obsidian SuggestionKind union declares. */
  function obsidianUnionKinds() {
    const src = read("obsidian-plugin/src/types.ts");
    const unionMatch = src.match(/export type SuggestionKind =\s*\|?\s*([^;]+);/s);
    assert.ok(unionMatch, "SuggestionKind union not found");
    return new Set([...unionMatch[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
  }

  it("union covers every emitted kernel kind (no unrenderable kind)", () => {
    const emitted = emittedKernelKinds();
    assert.ok(emitted.size >= 8, `expected a rich kind set, got: ${[...emitted].join(",")}`);
    const union = obsidianUnionKinds();
    for (const kind of emitted) {
      assert.ok(union.has(kind), `Obsidian SuggestionKind is missing emitted kind "${kind}"`);
    }
  });

  it("union declares no dead kind (kernel never emits it)", () => {
    const emitted = emittedKernelKinds();
    const union = obsidianUnionKinds();
    for (const kind of union) {
      assert.ok(emitted.has(kind), `SuggestionKind "${kind}" has no kernel producer (dead kind)`);
    }
    // Operation ids leaked into the kind union once — never again
    assert.ok(!union.has("todo_extract"));
    assert.ok(!union.has("topic_classify"));
  });

  it("META + ALL_SUGGESTION_KINDS cover exactly the union", () => {
    const union = obsidianUnionKinds();
    const utils = read("obsidian-plugin/src/utils.ts");
    const metaBlock = utils.match(/SUGGESTION_KIND_META[^=]+=\s*\{([\s\S]*?)\n\};/);
    assert.ok(metaBlock, "SUGGESTION_KIND_META not found");
    const metaKinds = new Set([...metaBlock[1].matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]));
    assert.deepEqual([...metaKinds].sort(), [...union].sort());

    const allBlock = utils.match(/ALL_SUGGESTION_KINDS[^=]+=\s*\[([\s\S]*?)\]/);
    assert.ok(allBlock, "ALL_SUGGESTION_KINDS not found");
    const allKinds = new Set([...allBlock[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
    assert.deepEqual([...allKinds].sort(), [...union].sort());
  });

  it("Obsidian CSS paints every union kind and not dead card kinds", () => {
    const css = read("obsidian-plugin/styles.css");
    for (const kind of obsidianUnionKinds()) {
      const cls = `tm-suggestion-${kind.replaceAll("_", "-")}`;
      assert.match(css, new RegExp(cls), `missing CSS class for kind ${kind}`);
    }
    assert.doesNotMatch(css, /tm-suggestion-todo-extract/);
    assert.doesNotMatch(css, /tm-suggestion-topic-classify/);
  });

  it("Desktop render entries stay dead-kind-free (archive_path removed)", () => {
    for (const rel of [
      "topmind-desktop/src/lib/suggest-apply-label.ts",
      "topmind-desktop/src/components/ai/SuggestPopover.tsx",
      "lib/suggest-engine.mjs",
    ]) {
      const src = read(rel);
      assert.ok(!src.includes("archive_path"), `${rel} still references dead kind archive_path`);
    }
  });
});
