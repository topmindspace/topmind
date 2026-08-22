/**
 * Desktop / Obsidian todo surfaces must call Kernel (not reimplement activity
 * gathering) and forward `force` into extract/maintain / runOperation.
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

describe("Desktop todo force + Kernel-only path", () => {
  it("kernel-api forwards options.force to extractTodosFromStream and maintainTodos", () => {
    const src = read("topmind-desktop/electron/lib/kernel-api.mjs");
    assert.match(src, /export async function kernelExtractTodosFromStream/);
    assert.match(src, /export async function kernelMaintainTodos/);
    assert.match(src, /kernel\.extractTodosFromStream\(\{[\s\S]*options:\s*\{[\s\S]*\.\.\.\(p\?\.options\s*\?\?\s*p/);
    assert.match(src, /kernel\.maintainTodos\(\{[\s\S]*options:\s*\{[\s\S]*\.\.\.\(p\?\.options\s*\?\?\s*p/);
    // No private activity corpus builder in Desktop kernel-api
    assert.doesNotMatch(src, /resolveActivityWindow|buildActivityCorpus/);
  });

  it("workspace-service delegates todo extract/maintain to kernel-api only", () => {
    const src = read("topmind-desktop/electron/workspace-service.mjs");
    assert.match(src, /kernelExtractTodosFromStream/);
    assert.match(src, /kernelMaintainTodos/);
    assert.doesNotMatch(src, /function findRecentPeriodNotes|buildTodoExtractionPrompt/);
  });

  it("renderer api + store pass force to maintain/extract IPC", () => {
    const api = read("topmind-desktop/src/services/api.ts");
    assert.match(api, /extractFromStream:\s*\(opts\?:\s*\{\s*force\?:\s*boolean/);
    assert.match(api, /maintain:\s*\(opts\?:\s*\{\s*force\?:\s*boolean/);
    assert.match(api, /workspace\.maintainTodos/);
    const store = read("topmind-desktop/src/stores/todo-store.ts");
    assert.match(store, /maintain:\s*async\s*\(opts\?:\s*\{\s*force\?:\s*boolean/);
    assert.match(store, /api\.todo\.maintain\(opts\)/);
    const body = read("topmind-desktop/src/components/todo/TodoListBody.tsx");
    assert.match(body, /maintain\(\{\s*force:\s*true\s*\}\)/);
  });

  it("manual ✨ surfaces progressive force when already-processed", () => {
    // After all-periods-processed, re-click ✨ must force (not only body force-retry CTA)
    for (const rel of [
      "topmind-desktop/src/components/todo/TodoPopover.tsx",
      "topmind-desktop/src/components/sidebar/StreamView.tsx",
      "topmind-desktop/src/plugins/topmind-workspace/views/StreamDetailView.tsx",
    ]) {
      const src = read(rel);
      assert.match(
        src,
        /maintainReason\s*===\s*["']all-periods-processed["']/,
        `${rel} must progressive-force after already-processed`,
      );
      assert.match(src, /force:\s*true/, `${rel} must pass force:true on progressive path`);
    }
    // Auto path must NOT always force
    const auto = read("topmind-desktop/src/components/shell/useAutoTodoMaintain.ts");
    assert.match(auto, /\.maintain\(\)/);
    assert.doesNotMatch(auto, /maintain\(\{\s*force:\s*true/);
  });
});

describe("Obsidian todo force + Kernel-only path", () => {
  it("manual maintainTodos routes through the shared queued lane with force:true", () => {
    const main = read("obsidian-plugin/src/main.ts");
    // All AI ops (command palette, sidebar buttons, boot auto-maintain) enqueue
    // on the shared serial lane — never a direct runOperation bypass.
    assert.match(main, /enqueueAiOperation\(\s*["']todo_maintain["']/);
    assert.match(main, /enqueueAiOperation\(\s*["']topic_classify["']/);
    assert.match(main, /enqueueAiOperation\(\s*["']memory_organize["']/);
    // The lane's executor forces reprocessing via the Kernel op (no surface-local todo writer)
    assert.match(main, /runOperation\(\s*operation,\s*\{\s*force:\s*true\s*\}\s*\)/);
    assert.doesNotMatch(main, /runOperation\(\s*["']todo_maintain["']\s*,?\s*\)/);
  });

  it("kernel-service runOperation forwards options to Kernel ctx.runOperation", () => {
    const src = read("obsidian-plugin/src/services/kernel-service.ts");
    assert.match(src, /async runOperation\(id:\s*string,\s*opts:\s*\{\s*force\?:\s*boolean/);
    // options spread + host UI localeOverride forwarding (surface parity with Desktop)
    assert.match(src, /ctx\.runOperation\(\{\s*id,\s*options:\s*\{\s*\.\.\.opts,\s*localeOverride/);
    assert.doesNotMatch(src, /findRecentPeriodNotes|buildTodoExtractionPrompt/);
  });

  it("ai-operation todo_maintain clearState clears processedHashes on force", () => {
    const src = read("lib/ai-operation-engine.mjs");
    assert.match(src, /id:\s*["']todo_maintain["']/);
    assert.match(src, /maintainTodos\(/);
    assert.match(src, /processedHashes\s*=\s*\{\}/);
  });
});

describe("Kernel single context path for todo AI", () => {
  it("todo-engine is the only notePromptCorpus / activity fold for todos", () => {
    const todo = read("lib/todo-engine.mjs");
    assert.match(todo, /export function notePromptCorpus/);
    assert.match(todo, /export function noteCorpusHash/);
    assert.match(todo, /resolveActivityWindow/);
    // Hash must use corpus helper, not raw-only
    assert.match(todo, /noteCorpusHash\(/);
    assert.doesNotMatch(
      todo,
      /contentHash\(n\.rawContent \|\| n\.content\)|contentHash\(note\.rawContent \|\| note\.content\)/,
    );
  });
});
