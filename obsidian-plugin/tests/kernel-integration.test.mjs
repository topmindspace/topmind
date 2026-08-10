// ── Live Kernel integration tests for shipped Obsidian write paths ─────────
//
// Calls the **shipped** pure ops (src/services/kernel-workspace-ops.ts) against
// the real Kernel (lib/kernel-api.mjs) in a temp workspace. Not string greps.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const pluginSrc = path.join(__dirname, "..", "src");
// engineRoot must expose templates/ for resolveWorkspaceModel + init
const engineRoot = path.join(__dirname, "..", "dist");
const monorepoEngine = repoRoot; // fallback templates at repo templates/

async function importShipped(rel) {
  return import(pathToFileURL(path.join(pluginSrc, rel)).href);
}

function resolveEngineRoot() {
  // Prefer plugin dist (templates copied by build); fall back to monorepo root
  if (fs.existsSync(path.join(engineRoot, "templates", "stream.json"))) {
    return engineRoot;
  }
  return monorepoEngine;
}

describe("Kernel integration — shipped capture / list / reconcile", () => {
  /** @type {string} */
  let tmp;
  /** @type {import('../src/bridge/kernel-loader').KernelApi} */
  let kernel;
  let captureToWorkspace;
  let listStreamPeriodsForWorkspace;
  let reconcilePeriodNote;
  let initWorkspaceStructure;
  let eng;

  before(async () => {
    // Real Kernel surface (same module the plugin bundles)
    kernel = await import(pathToFileURL(path.join(repoRoot, "lib", "kernel-api.mjs")).href);
    const ops = await importShipped("services/kernel-workspace-ops.ts");
    captureToWorkspace = ops.captureToWorkspace;
    listStreamPeriodsForWorkspace = ops.listStreamPeriodsForWorkspace;
    reconcilePeriodNote = ops.reconcilePeriodNote;
    initWorkspaceStructure = ops.initWorkspaceStructure;
    eng = resolveEngineRoot();
  });

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tm-obs-int-"));
  });

  after(() => {
    if (tmp && fs.existsSync(tmp)) {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("initWorkspaceStructure seeds 10-动态 + topmind.yaml", () => {
    const result = initWorkspaceStructure(kernel, tmp, eng, "stream");
    assert.equal(result.ok, true, result.error);
    assert.ok(fs.existsSync(path.join(tmp, "topmind.yaml")), "topmind.yaml");
    assert.ok(
      fs.existsSync(path.join(tmp, "10-动态")) ||
        fs.readdirSync(tmp).some((d) => d.startsWith("10-")),
      "stream category dir",
    );
  });

  test("resolveStreamTarget returns periodRelPath (not relPath)", () => {
    const target = kernel.resolveStreamTarget({
      workspaceRoot: tmp,
      engineRoot: eng,
    });
    assert.ok(target.periodRelPath, "periodRelPath must be set");
    assert.ok(target.periodAbsPath, "periodAbsPath must be set");
    assert.equal(target.relPath, undefined, "legacy relPath must not exist on Kernel result");
    assert.ok(
      target.periodRelPath.includes("10-") || target.periodRelPath.endsWith(".md"),
      `unexpected path ${target.periodRelPath}`,
    );
  });

  test("captureToWorkspace writes via appendToPeriodBody + executeWrite", () => {
    const r = captureToWorkspace(kernel, tmp, eng, "integration capture note #urgent", {
      target: "stream",
      tags: ["urgent"], // already in body — must not double
      writebackMode: "auto",
    });
    assert.equal(r.ok, true, r.error);
    assert.ok(r.path, "path returned");
    const abs = path.join(tmp, r.path);
    assert.ok(fs.existsSync(abs), "period file exists");
    const content = fs.readFileSync(abs, "utf-8");
    assert.ok(content.includes("integration capture note"), "body has text");
    // Tag appears once (mergeCaptureTags)
    const urgentCount = (content.match(/#urgent/g) || []).length;
    assert.equal(urgentCount, 1, `expected single #urgent, got ${urgentCount}`);
  });

  test("listStreamPeriodsForWorkspace awaits Kernel and maps periods", async () => {
    const { periods, current } = await listStreamPeriodsForWorkspace(kernel, tmp, eng);
    assert.ok(periods.length >= 1, "at least one period after capture");
    assert.ok(current, "current period set");
    assert.ok(current.relPath, "relPath mapped");
    assert.ok(current.period, "period stem mapped");
    assert.equal(typeof current.mtime, "number");
  });

  test("reconcilePeriodNote uses reconcilePeriodBody(body, opts).changed", async () => {
    const { current } = await listStreamPeriodsForWorkspace(kernel, tmp, eng);
    assert.ok(current?.relPath);
    // Call twice — second should be changed:false (no-op ok)
    const first = reconcilePeriodNote(kernel, tmp, eng, current.relPath, {
      writebackMode: "auto",
    });
    assert.equal(first.ok, true, first.error);
    const second = reconcilePeriodNote(kernel, tmp, eng, current.relPath, {
      writebackMode: "auto",
    });
    assert.equal(second.ok, true, second.error);
    assert.equal(second.reconciled, false, "second reconcile should not rewrite");
  });

  test("capture rejects empty text", () => {
    const r = captureToWorkspace(kernel, tmp, eng, "   \n  ");
    assert.equal(r.ok, false);
    assert.equal(r.error, "empty-text");
  });
});

// ── Pure mapApplySuggestionResult / mergeCaptureTags (shipped) ─────────────

describe("mapApplySuggestionResult + mergeCaptureTags (shipped)", () => {
  test("mergeCaptureTags does not double existing tags", async () => {
    const { mergeCaptureTags, extractTags } = await importShipped("utils.ts");
    const text = "hello #urgent";
    const tags = extractTags(text);
    const merged = mergeCaptureTags(text, tags);
    assert.equal((merged.match(/#urgent/g) || []).length, 1);
    assert.equal(mergeCaptureTags("plain", ["a", "b"]), "plain #a #b");
    assert.equal(mergeCaptureTags("has #a", ["a", "b"]), "has #a #b");
  });

  test("mapApplySuggestionResult fails on skip / ok:false / no-write", async () => {
    const { mapApplySuggestionResult } = await importShipped("utils.ts");
    assert.equal(
      mapApplySuggestionResult(
        { ok: false, operation: "skip", reason: "no-usable-digest", wroteFiles: false },
        { kind: "stream_digest" },
      ).ok,
      false,
    );
    assert.equal(
      mapApplySuggestionResult(
        { wroteFiles: false, note: "nothing to write" },
        { kind: "promote_memory" },
      ).ok,
      false,
    );
    assert.equal(
      mapApplySuggestionResult(
        { ok: true, wroteFiles: true, operation: "promote" },
        { kind: "promote_memory" },
      ).ok,
      true,
    );
  });

  test("mapApplySuggestionResult open_profile open-only is success with openPath", async () => {
    const { mapApplySuggestionResult } = await importShipped("utils.ts");
    const r = mapApplySuggestionResult(
      {
        operation: "open",
        wroteFiles: false,
        targetPath: "memory/profile.md",
        note: "open only",
      },
      { kind: "open_profile" },
    );
    assert.equal(r.ok, true);
    assert.equal(r.openPath, "memory/profile.md");
  });

  test("mapApplySuggestionResult pending is failure", async () => {
    const { mapApplySuggestionResult } = await importShipped("utils.ts");
    const r = mapApplySuggestionResult(
      { pending: true, wroteFiles: false },
      { kind: "inbox_review" },
    );
    assert.equal(r.ok, false);
    assert.equal(r.error, "pending-confirmation");
  });
});
