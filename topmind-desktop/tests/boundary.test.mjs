/**
 * Product boundary tests — Desktop must not hard-depend on UTR for core paths.
 * See PRODUCT-BOUNDARIES.md.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electron = path.join(root, "electron");
const src = path.join(root, "src");

test("Desktop AI tools module is native (WorkspaceService), not UTR executeTool", () => {
  const aiTools = readFileSync(path.join(electron, "ai-tools.mjs"), "utf8");
  assert.match(aiTools, /WorkspaceService/);
  assert.match(aiTools, /buildDesktopAiTools/);
  assert.doesNotMatch(aiTools, /executeTool|loadContractRegistry|utr\/core/);
});

test("ToolService.buildAiTools delegates to Desktop-native builder", () => {
  const tool = readFileSync(path.join(electron, "tool-service.mjs"), "utf8");
  assert.match(tool, /buildDesktopAiTools/);
  assert.match(tool, /utr-not-installed|tryLoadUtr|optional/i);
  // Packaged: load from engineRoot/utr via pathToFileURL — never monorepo ../../utr
  assert.match(tool, /pathToFileURL|importUtrModule/);
  assert.doesNotMatch(tool, /from\s+["']\.\.\/\.\.\/utr\//);
  assert.doesNotMatch(tool, /import\s*\(\s*["']\.\.\/\.\.\/utr\//);
});

test("Engine root does not require utr/ subdirectory", () => {
  const pathModel = readFileSync(path.join(electron, "lib/path-model.mjs"), "utf8");
  assert.match(pathModel, /ENGINE_REQUIRED_SUBDIRS/);
  assert.doesNotMatch(
    pathModel,
    /ENGINE_REQUIRED_SUBDIRS\s*=\s*\[[^\]]*["']utr["']/,
  );
  assert.match(pathModel, /utr\/ optional|optional/i);
  // Portable packaged engine accepted via templates/
  assert.match(pathModel, /portable|templates/i);
});

test("engine-root helper documents packaged topmind-engine layout", () => {
  const src = readFileSync(path.join(electron, "lib/engine-root.mjs"), "utf8");
  assert.match(src, /topmind-engine/);
  assert.match(src, /isPackaged|resourcesPath/);
  assert.match(src, /templates/);
});
test("Skills dock and QuickCapture memory do not call tool.run", () => {
  const skills = readFileSync(path.join(src, "plugins/topmind-workspace/skills.ts"), "utf8");
  assert.doesNotMatch(skills, /tool\.run|workspace-transform|doctor-workspace/);
  assert.match(skills, /workspace\.workspaceHealth|workspace\.getTopic/);

  const qc = readFileSync(path.join(src, "components/overlays/CaptureForm.tsx"), "utf8");
  assert.doesNotMatch(qc, /tool\.run|append-topic-memory/);
  assert.match(qc, /appendMemory/);
});

test("WorkspaceService exposes appendTopicMemory and workspaceHealth", () => {
  const ws = readFileSync(path.join(electron, "workspace-service.mjs"), "utf8");
  // Facade re-exports modular ops (bodies live in lib/workspace-*-ops.mjs)
  assert.match(ws, /appendTopicMemory/);
  assert.match(ws, /workspaceHealth/);
  const pathOps = readFileSync(path.join(electron, "lib/workspace-path-ops.mjs"), "utf8");
  const scanOps = readFileSync(path.join(electron, "lib/workspace-scan-ops.mjs"), "utf8");
  assert.match(pathOps, /async appendTopicMemory/);
  assert.match(scanOps, /async workspaceHealth/);
});

test("PRODUCT-BOUNDARIES.md exists at repo root", () => {
  const doc = path.resolve(root, "../PRODUCT-BOUNDARIES.md");
  assert.ok(existsSync(doc), "PRODUCT-BOUNDARIES.md should exist");
  const text = readFileSync(doc, "utf8");
  assert.match(text, /Skills Pack|Portable Skills/);
  assert.match(text, /无强制运行时绑定|不硬依赖 UTR|optional/i);
});
