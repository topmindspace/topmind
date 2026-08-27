#!/usr/bin/env node
/**
 * Dead-code / regression scanner — flags v3 leftovers that must not reappear.
 *
 * Guards architecture boundaries (not a general unused-export detector):
 * v3 IPC channels, v3 store names, v3 CSS classes, monorepo packaged-import bans.
 * Runs in CI / `npm run check:quality`.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");

const DEAD_PATTERNS = [
  {
    id: "v3-ipc-channels",
    description: "v4 uses single RPC bridge (rpc:invoke) — no v3 IPC channels",
    // Channel-style ids (inbox:list) — not object props like `inbox: true` or mode: "inbox"
    regex: /\b(document:[a-zA-Z]|inbox:[a-zA-Z]|project:[a-zA-Z]|workflow:[a-zA-Z]|preset:[a-zA-Z]|ai:inline-transform)/u,
    scope: ["electron/**/*.mjs", "src/**/*.ts", "src/**/*.tsx"],
    allowIn: ["scripts/check-dead-code.mjs", "services/api.ts"],
  },
  {
    id: "v3-zustand-stores",
    description: "v4 has 7 stores (view-store, ai-store, action-store, plugin-store, task-store, ingest-staging-store, todo-store) — no v3 store names",
    regex: /\b(useTopicStore|useInboxStore|useSessionStore|useMessageStore|useEditorStore|useNavStore|useContextStore|useStreamingStore|useArtifactStore|useMemoryStore|useLoopStore|useTopicTimelineStore|useUIStore|useErrorStore)\b/u,
    scope: ["src/**/*.ts", "src/**/*.tsx"],
    allowIn: ["scripts/check-dead-code.mjs", "stores/ai-store.ts"],
  },
  {
    id: "v3-tm-css-classes",
    description: "v4 uses Tailwind + shadcn/ui — no tm-* CSS classes",
    regex: /\btm-[a-z][a-z0-9-]*\b/u,
    scope: ["src/**/*.ts", "src/**/*.tsx"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "v3-view-router",
    description: "v4 uses registry.resolveView — no ViewRouter",
    regex: /\b(ViewRouter|currentView|navigationGuard)\b/u,
    scope: ["src/**/*.ts", "src/**/*.tsx"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "v3-handlers-dir",
    description: "v4 has 4 services — no handlers/ directory references",
    regex: /(?:\.\.\/|\.\/)handlers\//u,
    scope: ["electron/**/*.mjs"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "v3-ipc-validators",
    description: "v4 has no ipc-validators.mjs — service-layer validation only",
    regex: /\bipc-validators\b/u,
    scope: ["electron/**/*.mjs"],
    allowIn: ["scripts/check-dead-code.mjs", "settings.mjs"],
  },
  {
    id: "v3-preload-bridge-multi-channel",
    description: "v4 preload exposes only invoke+subscribe — no multi-channel bridge",
    regex: /\bipcRenderer\.(on|send|invoke)\(('|")(?!(rpc:invoke|ai:stream|workspace:file-changed))/u,
    scope: ["electron/**/*.cjs"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "v4-duplicate-min-ctx",
    description: "v4 has a shared makeMinCtx in src/plugins/min-ctx.ts — no inline createCtx/minCtx copies elsewhere",
    regex: /\b(const|let|function)\s+(minCtx|createCtx)\b/u,
    scope: ["src/**/*.ts", "src/**/*.tsx"],
    allowIn: ["scripts/check-dead-code.mjs", "plugins/min-ctx.ts"],
  },
  {
    id: "v2.x-projects-data-subdir",
    description: "v4 topic structure uses {NN Name}/{YYYY-主题}/ — no projects/ data subdir",
    regex: /['"](?:projects|projects\/data)['"]/u,
    scope: ["electron/**/*.mjs", "src/**/*.ts", "src/**/*.tsx"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "v3.5.30-removed-ipc-bindings",
    description: "v4 uses workspace.moveToTopic — no moveTopicFile / document:move-project-file bindings",
    regex: /\b(?:moveTopicFile|document:move-project-file)\b/u,
    scope: ["electron/**/*.mjs", "src/**/*.ts", "src/**/*.tsx"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "legacy-sidebar-localstorage",
    description: "sidebar view mode persists via settings.ui.sidebarView — no dual localStorage key",
    regex: /topmind:sidebar-view-mode/u,
    scope: ["src/**/*.ts", "src/**/*.tsx"],
    allowIn: ["scripts/check-dead-code.mjs", "components/shell/useShellSettingsSync.ts"],
  },
  {
    id: "legacy-feed-layout-localstorage",
    description: "feed layout persists via settings.ui.feedLayout — no dual localStorage key",
    regex: /topmind:feed-layout/u,
    scope: ["src/**/*.ts", "src/**/*.tsx"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "clip-bridge-token-in-logs",
    description: "never log clip bridge bearer tokens",
    regex: /log(?:Info|Warn|Error)\([^)]*clip[^)]*token/iu,
    scope: ["electron/**/*.mjs"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "packaged-monorepo-lib-import",
    description:
      "electron/ must not static-import monorepo ../../lib (missing in app.asar — Windows/mac packaged crash)",
    regex: /from\s+["'](?:\.\.\/)+lib\//u,
    scope: ["electron/**/*.mjs"],
    allowIn: ["scripts/check-dead-code.mjs", "scripts/verify-pack.mjs"],
  },
  {
    id: "packaged-monorepo-utr-import",
    description:
      "electron/ must not static-import monorepo ../../utr — load via engineRoot pathToFileURL (packaged topmind-engine/utr)",
    regex: /from\s+["'](?:\.\.\/)+utr\/|import\s*\(\s*["'](?:\.\.\/)+utr\//u,
    scope: ["electron/**/*.mjs"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "removed-suggestion-cards",
    description: "SuggestionCards was removed in Phase 6 — AiPanel + TaskPanel dual-panel is the architecture",
    regex: /\bSuggestionCards\b/u,
    scope: ["src/**/*.ts", "src/**/*.tsx"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "removed-suggestion-strip",
    description: "SuggestionStrip was replaced by ActionBar + ActionStore — no separate suggestion strip component",
    regex: /\bSuggestionStrip\b/u,
    scope: ["src/**/*.ts", "src/**/*.tsx"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "removed-pending-write-strip",
    description: "PendingWriteStrip was replaced by ActionBar + ActionStore — no separate pending write strip component",
    regex: /\bPendingWriteStrip\b/u,
    scope: ["src/**/*.ts", "src/**/*.tsx"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "removed-ambient-context",
    description: "AmbientContext was removed — focus info is inlined into Composer placeholder",
    regex: /\bAmbientContext\b/u,
    scope: ["src/**/*.ts", "src/**/*.tsx"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "removed-batch-evidence-banner",
    description: "BatchEvidenceBanner was removed — writeback receipts are inlined into ChatMessage tool cards",
    regex: /\bBatchEvidenceBanner\b/u,
    scope: ["src/**/*.ts", "src/**/*.tsx"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "removed-ai-task-dock",
    description: "AiTaskDock was replaced by compact TaskBadge in AiPanel header",
    regex: /\bAiTaskDock\b/u,
    scope: ["src/**/*.ts", "src/**/*.tsx"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "mock-task-store",
    description: "task-store must call real engine APIs — no mock tasks or mock data",
    regex: /\b(mockTask|MOCK_TASKS|createMockTask)\b/u,
    scope: ["src/**/*.ts", "src/**/*.tsx"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "removed-memory-view",
    description:
      "Old MemoryView component must not return — 我的情况 is MemoryBrowseView (read projection of the memory plane), not a parallel store",
    regex: /\bMemoryView\b/u,
    scope: ["src/**/*.ts", "src/**/*.tsx"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "removed-contract-editor",
    description: "ContractEditor was removed — workspace config editing is via SettingsDialog → WorkspacePanel, not a separate ContractEditor component",
    regex: /\bContractEditor\b/u,
    scope: ["src/**/*.ts", "src/**/*.tsx"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "removed-home-view",
    description: "HomeView was deleted — default surface is StreamDetailView; no living home product",
    regex: /\bHomeView\b/u,
    scope: ["src/**/*.ts", "src/**/*.tsx"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "no-living-home-selection",
    description: "Selection must not reintroduce kind:home product surface",
    regex: /kind:\s*['"]home['"]/u,
    scope: ["src/**/*.ts", "src/**/*.tsx"],
    allowIn: [
      "scripts/check-dead-code.mjs",
      // soft-heal migration only
      "src/types.ts",
    ],
  },
  {
    id: "no-duplicate-goto-home-action",
    description: "Command palette uses single goto.stream — not parallel goto.home",
    regex: /topmind-workspace\.goto\.home\b/u,
    scope: ["src/**/*.ts", "src/**/*.tsx"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "no-workspace-home-i18n-namespace",
    description: "Use workspace:shared.* for shared actions — home.* product namespace is deleted",
    regex: /workspace:home\./u,
    scope: ["src/**/*.ts", "src/**/*.tsx"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "removed-todo-strip",
    description: "TodoStrip was removed — todo access is via TodoPopover floating panel (TitleBar icon / ⌘⇧T), not an embedded strip in StreamDetailView",
    regex: /\bTodoStrip\b/u,
    scope: ["src/**/*.ts", "src/**/*.tsx"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "removed-todo-view",
    description: "TodoView sidebar component was removed — todo UI is via TodoPopover, not a sidebar view tab",
    regex: /\bTodoView\b/u,
    scope: ["src/**/*.ts", "src/**/*.tsx"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "settings-core-is-pure",
    description:
      "settings-core.mjs must stay pure (no fs I/O) — persistence stays in settings.mjs",
    regex: /from\s+["']node:fs["']|promises as fs|fs\.(readFile|writeFile|mkdir)/u,
    scope: ["electron/lib/settings-core.mjs"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "high-impact-suggestion-gate",
    description:
      "WorkspaceService.applySuggestion must use blockUnconfirmedHighImpact (no weaker inline gate)",
    regex: /async applySuggestion\s*\([^)]*\)[\s\S]{0,400}impact\s*===\s*["']high["']/u,
    scope: ["electron/workspace-service.mjs"],
    allowIn: ["scripts/check-dead-code.mjs", "electron/lib/suggestion-gate.mjs"],
  },
  {
    id: "no-monorepo-dynamic-lib-import-electron",
    description:
      "electron must not dynamic-import monorepo ../../../lib (use loadKernelApi / engine root)",
    regex: /import\s*\(\s*["'](?:\.\.\/){2,}lib\//u,
    scope: ["electron/**/*.mjs"],
    allowIn: ["scripts/check-dead-code.mjs", "scripts/verify-pack.mjs"],
  },
  {
    id: "stream-first-no-home-selection-product",
    description: "Product selection must not revive kind:home as a living view",
    regex: /kind:\s*["']home["']/u,
    scope: ["src/**/*.ts", "src/**/*.tsx"],
    allowIn: [
      "scripts/check-dead-code.mjs",
      "src/types.ts", // normalizeSelection may mention home for migration only
      "tests/**",
    ],
  },
  {
    id: "stream-no-pre-only-entry-rest",
    description: "Stream cards must use MD preview helper — not pre-only for entry.rest body",
    regex: /<pre className="whitespace-pre-wrap font-sans">\{entry\.rest\}<\/pre>/u,
    scope: ["src/plugins/topmind-workspace/views/StreamDetailView.tsx"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "stream-no-second-actionbar-list",
    description: "Stream canvas must not mount full ActionBar list (suggestion count in StatusBar only)",
    regex: /<ActionBar[\s/>]/u,
    scope: ["src/plugins/topmind-workspace/views/StreamDetailView.tsx"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "no-local-fileExt-canvas-router",
    description: "Primary canvas and split pane must route .md via isMarkdownNotePath (lib/file-preview) — no local fileExt copies",
    regex: /function fileExt\s*\(/u,
    scope: ["src/**/*.ts", "src/**/*.tsx"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "no-suggest-entry-strip-in-canvas",
    description: "SuggestEntryStrip removed from canvas — suggestion count unified in StatusBar; must not reappear in EditorArea or StreamDetailView",
    regex: /SuggestEntryStrip/u,
    scope: [
      "src/components/shell/EditorArea.tsx",
      "src/plugins/topmind-workspace/views/StreamDetailView.tsx",
    ],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "actionbar-no-unified-todo-product-word",
    description: "ActionBar product vocabulary is 建议 / 待确认写入 — not 统一待办条",
    regex: /统一待办条|用户概念：「待办」|统一「待办」/u,
    scope: [
      "src/components/ai/ActionBar.tsx",
      "src/stores/action-store.ts",
      "DESIGN.md",
      "ARCHITECTURE.md",
    ],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "contract-engine-no-v3-alias-injection",
    description:
      "loadContract() must return clean v4 (only VALID_CONTRACT_TOP_KEYS) — no v3 flat alias injection (categoryExtensions/categoryOverrides/template/categorySeparator as top-level keys breaks validateContract)",
    regex: /contract\.(categoryExtensions|categoryOverrides|template|categorySeparator)\s*=/u,
    scope: ["../lib/contract-engine.mjs"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "desktop-no-private-contract-seed-blob",
    description:
      "Desktop must not reintroduce private topmind.yaml seed blobs — contract lifecycle is Kernel ensureContract/writeContract only",
    regex: /contract_version:\s*4[\s\S]{0,200}categories:\s*\{\s*extensions:\s*\{\}/u,
    scope: ["electron/lib/workspace-home.mjs"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "no-project-config-aliases",
    description: "Desktop must not reintroduce projectConfigAliases flat v3 projection",
    regex: /export function projectConfigAliases/u,
    scope: ["electron/lib/workspace-home.mjs"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "no-cycle-writeback-mode",
    description: "view-store must not reintroduce cycleWritebackMode (silent AI policy flip)",
    regex: /cycleWritebackMode/u,
    scope: ["src/stores/view-store.ts"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "no-html-to-markdown-lite",
    description: "Clip must not reintroduce htmlToMarkdownLite (second converter)",
    regex: /htmlToMarkdownLite/u,
    scope: [
      "../browser-extension/lib/simple-md.js",
      "../browser-extension/lib/workspace-fs.js",
    ],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "no-flat-periodic-nav-template",
    description: "Desktop must not hardcode flat memory/periodic/${period}.md for apply/nav",
    regex: /memory\/periodic\/\$\{period\}\.md/u,
    scope: ["src/**/*.ts", "src/**/*.tsx"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "no-recent-activity-period-stem",
    description: "Must not use locale labels as period stems",
    regex: /primaryPeriod \|\| \(locale === "en" \? "Recent Activity"/u,
    scope: ["../lib/suggest-engine.mjs"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
  {
    id: "connector-category-nested-v4-only",
    description: "resolveConnectorSyncCategory must read workspace.template / ingest.connectors, not deleted flat aliases",
    regex: /config\.(template|categorySeparator|connectorDefaults)\b/u,
    scope: ["electron/lib/connector-category.mjs"],
    allowIn: ["scripts/check-dead-code.mjs"],
  },
];

/**
 * Cross-platform file finder — replaces Unix `find` with Node.js fs APIs.
 * Recursively scans a directory and returns files matching the given extensions.
 */
async function findFiles(dir, extensions) {
  const results = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
      results.push(...await findFiles(fullPath, extensions));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (extensions.includes(ext)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

async function checkPattern(pattern) {
  // Collect candidate files from scope globs:
  // - "electron/**/*.mjs" / "src/**/*.ts" → recursive under top dir by extension
  // - exact relative path "electron/lib/settings-core.mjs" → that file only
  const allFiles = [];
  const scanDirs = new Map(); // dir -> Set(ext)
  for (const scope of pattern.scope) {
    const isGlob = scope.includes("*");
    if (!isGlob) {
      allFiles.push(path.resolve(desktopRoot, scope));
      continue;
    }
    const topDir = scope.split("/")[0];
    const dir = path.resolve(desktopRoot, topDir);
    const ext = path.extname(scope);
    if (!scanDirs.has(dir)) scanDirs.set(dir, new Set());
    if (ext) scanDirs.get(dir).add(ext);
  }

  for (const [dir, extensions] of scanDirs) {
    try {
      allFiles.push(...await findFiles(dir, [...extensions]));
    } catch {
      // directory might not exist
    }
  }

  const violations = [];
  for (const file of allFiles) {
    const relPath = path.relative(desktopRoot, file).replace(/\\/g, "/");

    if (pattern.allowIn?.some((a) => relPath.includes(a))) continue;

    let content;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }

    const match = content.match(pattern.regex);
    if (match) {
      violations.push({ file: relPath, match: match[0] });
    }
  }
  return violations;
}

async function main() {
  let failed = false;
  for (const pattern of DEAD_PATTERNS) {
    const violations = await checkPattern(pattern);
    if (violations.length > 0) {
      failed = true;
      console.error(`\n✗ ${pattern.id}: ${pattern.description}`);
      for (const v of violations.slice(0, 10)) {
        console.error(`  ${v.file}: ${v.match}`);
      }
      if (violations.length > 10) console.error(`  ... and ${violations.length - 10} more`);
    } else {
      console.log(`✓ ${pattern.id}`);
    }
  }
  if (failed) {
    console.error("\nDead code patterns detected. Remove v3 leftovers.");
    process.exit(1);
  }
  console.log("\nAll dead-code checks passed.");
}

main().catch((err) => {
  console.error("Dead-code scanner error:", err);
  process.exit(1);
});
