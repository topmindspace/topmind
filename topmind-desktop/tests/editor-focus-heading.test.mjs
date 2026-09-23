/**
 * Stream entry → period note heading focus (Wave F polish).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("editor focusHeading / pending review / task in AI", () => {
  it("Selection file supports focusHeading and FileEditorView uses it", () => {
    const types = fs.readFileSync(path.join(root, "src/types.ts"), "utf8");
    assert.match(types, /focusHeading\?:/);
    const views = fs.readFileSync(
      path.join(root, "src/plugins/topmind-workspace/views.tsx"),
      "utf8",
    );
    assert.match(views, /focusHeading=\{sel\.focusHeading\}/);
    const editor = fs.readFileSync(
      path.join(root, "src/plugins/topmind-workspace/views/FileEditorView.tsx"),
      "utf8",
    );
    assert.match(editor, /focusEditorHeading/);
    const helper = fs.readFileSync(
      path.join(root, "src/lib/editor-focus-heading.ts"),
      "utf8",
    );
    assert.match(helper, /export function focusEditorHeading/);
    const stream = fs.readFileSync(
      path.join(root, "src/plugins/topmind-workspace/views/StreamDetailView.tsx"),
      "utf8",
    );
    assert.match(stream, /focusHeading/);
    // StreamDetailView delegates to StreamFeedRowView which calls onOpenPeriod(entry.heading…)
    assert.match(stream, /onOpenPeriod\(entry\.heading/);
  });

  it("SuggestPopover opens review dialog with full body", () => {
    const pop = fs.readFileSync(
      path.join(root, "src/components/ai/SuggestPopover.tsx"),
      "utf8",
    );
    const ai = fs.readFileSync(path.join(root, "src/components/ai/AiPanel.tsx"), "utf8");
    assert.match(pop, /ConfirmDialog/);
    assert.match(pop, /reviewItem|reviewId/);
    assert.match(ai, /task-panel:toggle/);
    assert.match(ai, /TaskBadge/);
  });

  it("Shell listens for task-panel and ai-panel events", () => {
    const shell = fs.readFileSync(path.join(root, "src/components/shell/Shell.tsx"), "utf8");
    assert.match(shell, /task-panel:toggle/);
    assert.match(shell, /task-panel:open/);
    assert.match(shell, /ai-panel:open/);
  });

  it("StreamView and Sidebar pass focusHeading", () => {
    const stream = fs.readFileSync(
      path.join(root, "src/components/sidebar/StreamView.tsx"),
      "utf8",
    );
    assert.match(stream, /handleOpenPeriod\(entry\.heading/);
    assert.match(stream, /focusHeading/);
    const sidebar = fs.readFileSync(
      path.join(root, "src/components/shell/Sidebar.tsx"),
      "utf8",
    );
    assert.match(sidebar, /focusHeading/);
  });

  it("command palette has organize/task actions", () => {
    const actions = fs.readFileSync(
      path.join(root, "src/plugins/topmind-workspace/actions.ts"),
      "utf8",
    );
    assert.match(actions, /task-panel:open/);
    assert.match(actions, /organizeWeek|organize-week/);
    assert.match(actions, /ai-panel:open/);
    const zh = JSON.parse(
      fs.readFileSync(path.join(root, "src/locales/zh-CN/overlays.json"), "utf8"),
    );
    assert.equal(typeof zh.command.actions.taskPanel, "string");
    assert.equal(typeof zh.command.actions.organizeWeek, "string");
    assert.match(zh.command.actions.organizeWeek, /整理/);
  });

  it("focus heading miss has i18n key", () => {
    const zh = JSON.parse(
      fs.readFileSync(path.join(root, "src/locales/zh-CN/workspace.json"), "utf8"),
    );
    const en = JSON.parse(
      fs.readFileSync(path.join(root, "src/locales/en-US/workspace.json"), "utf8"),
    );
    assert.match(zh.editor.focusHeadingMiss, /未找到标题/);
    assert.match(en.editor.focusHeadingMiss, /not found/i);
  });

  it("AI TaskBadge and shared TaskListBody exist; home i18n namespace gone", () => {
    const ai = fs.readFileSync(path.join(root, "src/components/ai/AiPanel.tsx"), "utf8");
    assert.match(ai, /function TaskBadge/);
    const body = fs.readFileSync(
      path.join(root, "src/components/ai/task-list-body.tsx"),
      "utf8",
    );
    assert.match(body, /export function TaskListBody/);
    const panel = fs.readFileSync(
      path.join(root, "src/components/ai/TaskPanel.tsx"),
      "utf8",
    );
    assert.match(panel, /TaskListBody/);
    const stream = fs.readFileSync(
      path.join(root, "src/components/sidebar/StreamView.tsx"),
      "utf8",
    );
    assert.match(stream, /groupEntriesByDay/);
    // Sidebar StreamView uses accent-color in quiet list styling
    assert.match(stream, /accent-color/);
    const zh = JSON.parse(
      fs.readFileSync(path.join(root, "src/locales/zh-CN/workspace.json"), "utf8"),
    );
    assert.equal(zh.home, undefined);
    assert.ok(zh.shared);
  });
});
