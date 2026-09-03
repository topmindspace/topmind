import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "..");

test("UI Token & Modernization Compliance", async (t) => {
  await t.test("v4.css has modern flexible tab width without 9.5rem hardcode", () => {
    const v4CssPath = path.join(desktopRoot, "src", "styles", "v4.css");
    const content = fs.readFileSync(v4CssPath, "utf-8");

    // .v4-recent-tab must NOT hardcode width: 9.5rem
    assert.doesNotMatch(content, /\.v4-recent-tab\s*\{[^}]*width:\s*9\.5rem/);
    assert.match(content, /\.v4-recent-tab\s*\{[^}]*min-width:\s*6rem/);
    assert.match(content, /\.v4-recent-tab\s*\{[^}]*max-width:\s*14rem/);
    assert.match(content, /\.v4-recent-tab\s*\{[^}]*flex:\s*0 1 auto/);
  });

  await t.test("Badges in TitleBar, AiPanel and ChatInput use compliant >=11px text-4xs", () => {
    const titleBar = fs.readFileSync(path.join(desktopRoot, "src", "components", "shell", "TitleBar.tsx"), "utf-8");
    const aiPanel = fs.readFileSync(path.join(desktopRoot, "src", "components", "ai", "AiPanel.tsx"), "utf-8");
    const chatInput = fs.readFileSync(path.join(desktopRoot, "src", "components", "ai", "ChatInput.tsx"), "utf-8");

    // TitleBar SuggestBadge
    assert.doesNotMatch(titleBar, /data-suggest-header-badge[\s\S]*?text-5xs/);
    assert.match(titleBar, /text-4xs font-bold leading-none tabular-nums text-text-on-accent/);

    // TitleBar center track allows shrink
    assert.match(titleBar, /flex min-w-0 shrink items-center gap-1\.5/);

    // AiPanel active tasks badge
    assert.doesNotMatch(aiPanel, /active\.length[\s\S]*?text-5xs/);
    assert.match(aiPanel, /text-4xs font-bold leading-none text-primary-foreground/);

    // ChatInput skills badge
    assert.doesNotMatch(chatInput, /sessionLoadedSkills\.length[\s\S]*?text-5xs/);
  });

  await t.test("Obsidian styles.css supports focus-within and hover:none for delete and abort buttons", () => {
    const obsCss = fs.readFileSync(path.join(repoRoot, "obsidian-plugin", "styles.css"), "utf-8");
    assert.match(obsCss, /\.tm-todo-item:focus-within\s+\.tm-todo-delete/);
    assert.match(obsCss, /\.tm-history-item-active:focus-within\s+\.tm-history-abort/);
    assert.match(obsCss, /@media\s*\(hover:\s*none\)\s*\{\s*\.tm-todo-item\s+\.tm-todo-delete/);
  });

  await t.test("Obsidian KernelService provides non-blocking async reading", () => {
    const ks = fs.readFileSync(path.join(repoRoot, "obsidian-plugin", "src", "services", "kernel-service.ts"), "utf-8");
    assert.match(ks, /readPeriodNoteAsync\(relPath:\s*string\)/);
    assert.match(ks, /memoryDirRel\(\):\s*string/);
    assert.match(ks, /private\s+async\s+loadRecentReflections\(\)/);
  });
});
