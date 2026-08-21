import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

// WORKSPACE-SPEC.md was merged into PROJECT-MODEL / TOOLS / SKILL-ARCHITECTURE / DESIGN
const files = {
  readme: "README.md",
  design: "DESIGN.md",
  projectModel: "PROJECT-MODEL.md",
  skillArchitecture: "SKILL-ARCHITECTURE.md",
  tools: "TOOLS.md",
  claude: "CLAUDE.md",
  agEnts: "AGENTS.md",
  utrReadme: "utr/README.md",
  utrRoadmap: "utr/ROADMAP.md",
  desktopReadme: "topmind-desktop/README.md",
  desktopDesign: "topmind-desktop/DESIGN.md",
  desktopArchitecture: "topmind-desktop/ARCHITECTURE.md",
  skillsReadme: "skills/README.md",
  topmindSkill: "skills/topmind/SKILL.md",
};

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function fail(message) {
  console.error(`redesign-contract: ${message}`);
  process.exitCode = 1;
}

function expectMatch(label, source, pattern, message) {
  if (!pattern.test(source)) {
    fail(`${label}: missing ${message}`);
  }
}

function expectNoMatch(label, source, pattern, message) {
  if (pattern.test(source)) {
    fail(`${label}: forbidden ${message}`);
  }
}

const WORKFLOW_TEXT = "收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整";
const EXTENSION_FLOW_TEXT = "Source Connector -> Object Adapter -> Action Registry -> Tool Contract -> Surface Placement";

const workflow = /收进来\s*(?:->|→)\s*继续做\s*(?:->|→)\s*交付[\/／]沉淀\s*(?:->|→)\s*找回[\/／]调整/u;
const extensionFlow = /Source Connector[\s\S]{0,160}Object Adapter[\s\S]{0,160}Action Registry[\s\S]{0,160}Tool Contract[\s\S]{0,160}Surface Placement/u;
const globalRootCopy = /global `(?:references|sources|library)\/?` root|global `references\/`, `sources\/`, or `library\/` roots|top-level roots such as `references\/`, `sources\/`, or `library\/`/u;

const activeLegacyProductCopy = /Quick Capture -> Projects|Home -> Projects|Capture -> Receipt|visible state model|returns 19/u;
const foregroundWorkflowConsoleCopy = /workflow console|工作流控制台/u;
const foregroundAutomationJargon = /搜索项目、章节、资料、自动化|应用到 AI 自动化和手动操作|自动化审阅|自动化操作|自动化能力|自动化执行|自动化流程/u;

// v3.4 architecture drift defenses — any of these in the active core docs is a P0 failure
const v3ProjectPath = /topmind-workspace\/projects\//u;
const v3ProjectTypeField = /\bproject_type:\s/u;
const v3YyyyKindName = /\bYYYY-类型-项目名\b/u;
const v3DeprecatedCommands = /\b(create-project|inspect-project|list-projects|list-project-files|append-project-memory|update-project|check-project|normalize-project|archive-project|repair-project-index)\b/u;
const v3DefaultAnchorsRequired = /(outline\.md|setting\.md|style\.md)[\s\S]{0,80}(?:必须|默认|会自动)(?:创建|生成|建立|新增)/u;
const v3ProjectMd = /\bproject\.md\b/u;

// v4 architecture command count: 8 域 / 28 commands (or 8 domains / 28 commands)
const v4CommandCount = /8\s*(?:域|tools|道|工具|domains)\s*[\/／]\s*28\s*(?:commands|命令)/iu;

const requiredWorkflowDocs = [
  files.readme,
  "README.zh-CN.md",
  files.design,
  files.projectModel,
  "PRODUCT-BOUNDARIES.md",
  "docs/README.md",
  files.desktopReadme,
  files.desktopDesign,
  files.desktopArchitecture,
  files.claude,
  files.agEnts,
];

const foregroundJargonSurfaces = [
  "topmind-desktop/src/components/overlays/CommandPalette.tsx",
  "topmind-desktop/src/components/overlays/SettingsDialog.tsx",
  "topmind-desktop/src/components/shell/StatusBar.tsx",
  "topmind-desktop/src/components/ai/ChatInput.tsx",
];

for (const relativePath of requiredWorkflowDocs) {
  expectMatch(relativePath, read(relativePath), workflow, "simple workbench workflow");
}

const design = read(files.design);
const tools = read(files.tools);
const desktopArchitecture = read(files.desktopArchitecture);
const projectModel = read(files.projectModel);
const readme = read(files.readme);

// v3.4: workspaceSpec merged into PROJECT-MODEL/TOOLS/SKILL-ARCHITECTURE/DESIGN
// Extension flow contract is in SKILL-ARCHITECTURE.md §11 (canonical) and TOOLS.md
// PROJECT-MODEL.md and Desktop docs reference it but may not contain the full flow text
for (const [label, source] of [
  [files.skillArchitecture, read(files.skillArchitecture)],
  [files.tools, tools],
]) {
  expectMatch(label, source, extensionFlow, "extension layering contract");
}

for (const [label, source] of Object.entries(files).map(([, relativePath]) => [relativePath, read(relativePath)])) {
  expectNoMatch(label, source, activeLegacyProductCopy, "retired active product flow or stale command count");
  expectNoMatch(label, source, foregroundWorkflowConsoleCopy, "foreground workflow console copy");
}

for (const relativePath of foregroundJargonSurfaces) {
  if (fs.existsSync(path.join(repoRoot, relativePath))) {
    expectNoMatch(relativePath, read(relativePath), foregroundAutomationJargon, "foreground automation jargon");
  }
}

// v3.4: PROJECT-MODEL.md merged WORKSPACE-SPEC content; pending rule may be in DESIGN or desktopArchitecture
expectMatch(files.design, design, /pending[\s\S]{0,80}不是目录或(项目状态|类别)/u, "pending is UI/runtime only");

// archive is not a daily workspace — v3.4 compatible
expectMatch(files.design, design, /archive\s*=\s*历史安全层|99-归档.*历史安全层|99 Archive.*历史安全层/u, "archive safety layer");

expectMatch(files.projectModel, projectModel, /不新增全局 `references\/`、`sources\/`、`library\/`/u, "no global roots in project model");

for (const [label, source] of [
  [files.design, design],
  [files.tools, tools],
]) {
  expectMatch(label, source, /target path|target_path/u, "target path evidence");
  expectMatch(label, source, /affected files|affected_files/u, "affected files evidence");
  expectMatch(label, source, /receipt|回执/u, "receipt evidence");
}

// current v4 UTR command count: 8 域 / 28 commands
expectMatch(files.tools, tools, v4CommandCount, "current UTR command count (8 域 / 28 commands)");
expectMatch(files.utrReadme, read(files.utrReadme), v4CommandCount, "current UTR README command count (8 域 / 28 commands)");

expectMatch(files.tools, tools, /restore-safety-receipt/u, "restore command in tools");

// v3.4 architecture drift defenses in core docs
const driftSensitiveDocs = [
  files.readme,
  files.projectModel,
  files.skillArchitecture,
  files.tools,
  files.design,
  files.utrReadme,
  files.utrRoadmap,
  files.skillsReadme,
  files.topmindSkill,
];

for (const relativePath of driftSensitiveDocs) {
  const source = read(relativePath);
  // topmind-maintain/SKILL.md and topmind-loop/* are exempt from the deprecated-commands check
  // because their job is to enumerate the forbidden patterns as drift signals.
  if (!relativePath.includes("topmind-maintain") && !relativePath.includes("topmind-loop")) {
    expectNoMatch(relativePath, source, v3DeprecatedCommands, "active v2.x UTR command name");
  }
  expectNoMatch(relativePath, source, v3ProjectPath, "v2.x projects/ root path");
  expectNoMatch(relativePath, source, v3ProjectTypeField, "v2.x project_type frontmatter field");
  expectNoMatch(relativePath, source, v3YyyyKindName, "v2.x YYYY-类型-项目名 naming");
  expectNoMatch(relativePath, source, v3DefaultAnchorsRequired, "v2.x outline/setting/style default anchor (must-create)");
  expectNoMatch(relativePath, source, v3ProjectMd, "v2.x project.md topic home file");
}

// 6 条规约 must appear in core docs (v3.4: PROJECT-MODEL is single source; others reference it)
// Full 6 规约 text required only in PROJECT-MODEL and SKILL-ARCHITECTURE (canonical sources).
// Other docs need at least a "6 条规约" declaration + reference to PROJECT-MODEL.md §2.
for (const [label, source] of [
  [files.projectModel, projectModel],
  [files.skillArchitecture, read(files.skillArchitecture)],
]) {
  expectMatch(label, source, /(6 条核心规约|6 条规约|六大核心规约)/u, "6 条核心规约 declaration");
  expectMatch(label, source, /大类不重叠/u, "rule 1: 大类不重叠");
  expectMatch(label, source, /专题自然涌现/u, "rule 2: 专题自然涌现");
  expectMatch(label, source, /(动态类特殊|50 其他清理|60 参考资料定位|类别命名稳定)/u, "rule 3-6: at least one of category slot rules");
}

// Reference docs: need at least "6 条规约" declaration (may reference PROJECT-MODEL.md §2)
for (const [label, source] of [
  [files.readme, readme],
  [files.tools, tools],
  [files.design, design],
  [files.utrReadme, read(files.utrReadme)],
  [files.skillsReadme, read(files.skillsReadme)],
  [files.topmindSkill, read(files.topmindSkill)],
]) {
  expectMatch(label, source, /(6 条核心规约|6 条规约|六大核心规约)/u, "6 条核心规约 declaration (reference to PROJECT-MODEL.md §2)");
}

// Architecture reset lock (2026-07-25) — must stay the single implementation plan
const architectureResetPath = "docs/ARCHITECTURE-RESET.md";
const architectureReset = read(architectureResetPath);
expectMatch(
  architectureResetPath,
  architectureReset,
  /最低摩擦个人动态流/u,
  "north-star: 最低摩擦个人动态流",
);
expectMatch(
  architectureResetPath,
  architectureReset,
  /Target vs Done|Partial/u,
  "honest Target/Done inventory",
);
expectMatch(
  architectureResetPath,
  architectureReset,
  /writeback-engine|唯一写闸/u,
  "write-gate unification strategy",
);
expectMatch(
  architectureResetPath,
  architectureReset,
  /建议.*确认|确认后再/u,
  "suggestion-first proactive AI",
);
expectMatch(
  architectureResetPath,
  architectureReset,
  /Phase A/u,
  "phased implementation (Phase A)",
);

// Forbidden overclaim in living truth docs
const honestyDocs = [
  files.readme,
  files.projectModel,
  "PRODUCT-BOUNDARIES.md",
  "docs/ARCHITECTURE-RESET.md",
];
for (const relativePath of honestyDocs) {
  expectNoMatch(
    relativePath,
    read(relativePath),
    /八引擎[^\n]{0,40}已全面落地|架构设计已全面落地/u,
    "false fully-landed Kernel claim",
  );
}

// Model A confirm residues forbidden in Desktop AI prompt path (Model B only)
const modelAConfirm = /写回:\s*只读|只读\s*[—\-–]\s*只分析|给可粘贴草稿/u;
for (const relativePath of [
  "topmind-desktop/electron/ai-prompts.mjs",
  "topmind-desktop/electron/ai-tools.mjs",
  "topmind-desktop/electron/ai-service.mjs",
]) {
  expectNoMatch(
    relativePath,
    read(relativePath),
    modelAConfirm,
    "Model A confirm prompt (read-only paste draft) — use 保存前问我 + 待确认写入",
  );
}
expectMatch(
  "topmind-desktop/electron/lib/writeback-mode-copy.mjs",
  read("topmind-desktop/electron/lib/writeback-mode-copy.mjs"),
  /待确认写入|保存前问我/u,
  "single writeback policy copy source",
);

// ---------------------------------------------------------------------------
// Phase A/B Done-key underclaim blocklist (ARCHITECTURE-RESET §2.2)
// Forbid re-labeling shipped capabilities as Partial/Target in living docs.
// Intentional Partial (contract UI / Phase C Ask / converters-local) is OK.
// ---------------------------------------------------------------------------
const underclaimSurfaces = [
  "docs/adr/2026-07-19-knowledge-ingest-pipeline.md",
  "docs/adr/2026-07-22-stream-packing-and-core-memory.md",
  "docs/README.md",
  "docs/ARCHITECTURE-RESET.md",
  "topmind-desktop/ARCHITECTURE.md",
  "topmind-desktop/DESIGN.md",
  "topmind-desktop/README.md",
  "PRODUCT-BOUNDARIES.md",
  "PROJECT-MODEL.md",
  "DESIGN.md",
  "TOOLS.md",
  "README.md",
  "README.zh-CN.md",
  "AGENTS.md",
  "CLAUDE.md",
  "skills/shared/writeback-receipt.md",
  "utr/README.md",
];

/** Per-line ban: Done-key underclaim without co-located intentional exception. */
const underclaimLineBans = [
  {
    id: "ingest-route-partial",
    // Kernel/ingest 路由 labeled Partial|Target — allow only if line also says 转换器/本地 and Done
    re: /(?:Kernel\s*)?(?:ingest\s*)?路由[^\n]{0,40}\*\*(?:Partial|Target)\*\*/u,
    allowIf: /(?:转换器|converters|本地队列).{0,40}\*\*Done\*\*|\*\*Done\*\*.{0,60}(?:转换器|converters|本地)/u,
    msg: "ingest/Kernel 路由 must not be Partial/Target (Done via resolveIngestRoute; Partial only for converters-local)",
  },
  {
    id: "ingest-route-partial-plain",
    re: /Kernel 路由对齐 \*\*Partial\*\*|Kernel 路由 \*\*Target\*\*|Kernel 路由 Partial|Kernel 路由 Target/u,
    allowIf: null,
    msg: "Kernel 路由 Partial/Target underclaim",
  },
  {
    id: "writeback-status-partial",
    re: /现状写闸 \*\*Partial\*\*|写路径尚未全部合闸|目标全部经 Kernel `writeback-engine`（\*\*Partial\*\*）|写回目标经 writeback-engine[^\n]{0,40}\*\*现状写闸 Partial\*\*/u,
    allowIf: null,
    msg: "writeback main path underclaim (Done §2.2)",
  },
  {
    id: "memory-product-partial",
    re: /Memory 产品面 \*\*Partial\*\*|Memory UX Partial|产品面状态\*\*：\*\*Partial|「我的情况」入口[^\n]{0,40}Target/u,
    allowIf: null,
    msg: "Memory product face underclaim (Done §2.2)",
  },
  {
    id: "suggest-strip-target",
    re: /建议条[^\n]{0,30}\*\*Target\*\*|副驾建议条 \*\*Target\*\*|审阅抽屉 \*\*Target\*\*/u,
    allowIf: null,
    msg: "建议条/审阅 underclaim (Done §2.2)",
  },
];

for (const relativePath of underclaimSurfaces) {
  let source;
  try {
    source = read(relativePath);
  } catch {
    continue;
  }
  for (const line of source.split(/\r?\n/u)) {
    for (const ban of underclaimLineBans) {
      if (!ban.re.test(line)) continue;
      if (ban.allowIf && ban.allowIf.test(line)) continue;
      fail(`${relativePath}: forbidden underclaim (${ban.id}): ${ban.msg}\n  → ${line.slice(0, 160)}`);
    }
  }
}

// Desktop DESIGN / ARCHITECTURE: target IA must be 动态-default, not legacy 工作台 triad as sole present-tense PrimaryNav
const desktopDesign = read(files.desktopDesign);
const desktopArch = read(files.desktopArchitecture);
expectMatch(
  files.desktopDesign,
  desktopDesign,
  /动态（默认）/u,
  "Desktop DESIGN target IA: 动态（默认）",
);
expectMatch(
  files.desktopDesign,
  desktopDesign,
  /PrimaryNav[^\n]{0,80}动态|中间[^\n]{0,40}动态（默认）/u,
  "Desktop DESIGN PrimaryNav targets 动态",
);
// Living design must not present 工作台·收件箱·输出 as the only unlabeled present-tense primary anchors
// (allowed only when adjacent to 现状 / 代码 / 实现)
expectNoMatch(
  files.desktopDesign,
  desktopDesign,
  /(?:中间|PrimaryNav)[^\n]{0,40}三个主锚点：`工作台`/u,
  "legacy 工作台 triad as unlabeled PrimaryNav target",
);
expectMatch(
  files.desktopArchitecture,
  desktopArch,
  /动态（默认）/u,
  "Desktop ARCHITECTURE target IA includes 动态（默认）",
);
expectMatch(
  files.desktopArchitecture,
  desktopArch,
  /现状[^\n]{0,40}工作台|工作台[^\n]{0,40}现状|代码债/u,
  "Desktop ARCHITECTURE labels legacy 工作台 triad as 现状/代码债",
);
expectMatch(
  files.desktopDesign,
  desktopDesign,
  /标题栏主锚点：动态（默认）· 收件箱 · 写出来 · 搜索/u,
  "Desktop DESIGN UIX-401 PrimaryNav includes 搜索 not 归档",
);
expectNoMatch(
  files.desktopDesign,
  desktopDesign,
  /标题栏主锚点：动态（默认）· 收件箱 · 写出来 · 归档/u,
  "archive as PrimaryNav peer in UIX-401",
);
expectMatch(
  files.desktopArchitecture,
  desktopArch,
  /PrimaryNav[^\n]{0,120}搜索/u,
  "Desktop ARCHITECTURE PrimaryNav includes 搜索",
);
expectNoMatch(
  files.desktopArchitecture,
  desktopArch,
  /PrimaryNav[^\n]{0,120}归档图标/u,
  "archive icon as PrimaryNav peer",
);
expectMatch(
  files.desktopDesign,
  desktopDesign,
  /getEditorHtml\(\)|静态 HTML/u,
  "Desktop DESIGN editor preview is static HTML",
);
expectNoMatch(
  files.desktopDesign,
  desktopDesign,
  /编辑与预览共用同一 Tiptap 实例/u,
  "preview taught as live TipTap instance",
);

expectMatch(
  files.desktopDesign,
  desktopDesign,
  /语料预算：extract 16K \/ maintain 12K/u,
  "Desktop DESIGN todo corpus budgets match Kernel 16K/12K",
);
expectNoMatch(
  files.desktopDesign,
  desktopDesign,
  /语料预算：extract 12K \/ maintain 8K/u,
  "stale extract 12K / maintain 8K corpus claim",
);
expectMatch(
  files.desktopDesign,
  desktopDesign,
  /状态栏(?:建议)?计数 chip/u,
  "Desktop DESIGN suggestion count lives in StatusBar",
);
expectNoMatch(
  files.desktopDesign,
  desktopDesign,
  /有 `items` 时画布顶 `SuggestEntryStrip`/u,
  "canvas SuggestEntryStrip taught as living chrome",
);
expectMatch(
  files.desktopArchitecture,
  desktopArch,
  /maxMessages 60 \/ keepRecent 24 \/ maxChars 240K/u,
  "Desktop ARCHITECTURE session compact defaults",
);
expectNoMatch(
  files.desktopArchitecture,
  desktopArch,
  /maxMessages 40 \/ keepRecent 16 \/ maxChars 80K/u,
  "stale session-compact 40/16/80K claim",
);
expectMatch(
  files.desktopArchitecture,
  desktopArch,
  /PrimaryNav 文案与默认 selection 为 \*\*动态 · 收件箱 · 写出来 · 搜索\*\*/u,
  "ARCHITECTURE 现状 PrimaryNav includes 搜索",
);
expectNoMatch(
  files.desktopArchitecture,
  desktopArch,
  /EditorArea（SuggestEntryStrip/u,
  "ARCHITECTURE 现状 still mounting canvas SuggestEntryStrip",
);
expectNoMatch(
  "docs/stream-first-optimization-scheme.md",
  read("docs/stream-first-optimization-scheme.md"),
  /画布顶 strip（空则隐藏）/u,
  "stream-first teaching canvas strip as living entry",
);
expectNoMatch(
  files.desktopDesign,
  desktopDesign,
  /AI 轨 `ActionBar` 仅为计数跳转/u,
  "DESIGN teaching ActionBar as always-on count jump",
);
expectMatch(
  files.desktopDesign,
  desktopDesign,
  /AI 轨 `ActionBar` \*\*仅专注模式\*\*/u,
  "DESIGN ActionBar is focus-mode fallback only",
);

const suggestEngine = read("lib/suggest-engine.mjs");
expectNoMatch(
  "lib/suggest-engine.mjs",
  suggestEngine,
  /period \|\| "period"/u,
  "suggest-engine period fallback token",
);
expectNoMatch(
  "lib/suggest-engine.mjs",
  suggestEngine,
  /"Recent Activity"/u,
  "suggest-engine locale label as period stem",
);
expectNoMatch(
  "lib/suggest-engine.mjs",
  suggestEngine,
  /targetPath:\s*`memory\/periodic\/\$\{period\}\.md`/u,
  "suggest-engine flat periodic apply receipt",
);

const streamWorkbench = read("obsidian-plugin/src/views/stream-workbench-view.ts");
expectNoMatch(
  "obsidian-plugin/src/views/stream-workbench-view.ts",
  streamWorkbench,
  /adapter\.write/u,
  "Obsidian new-note bypassing Kernel writeback",
);

const clipReadme = read("browser-extension/README.md");
const clipMatrix = read("docs/capture-clip-matrix.md");
expectNoMatch(
  "browser-extension/README.md",
  clipReadme,
  /lite HTML→MD|lite MD|扩展内 lite 转换/u,
  "Clip README teaching a second lite HTML→MD algorithm",
);
expectNoMatch(
  "docs/capture-clip-matrix.md",
  clipMatrix,
  /lite MD|lite HTML/u,
  "capture-clip-matrix teaching lite MD as workspace converter",
);

if (process.exitCode) {
  process.exit();
}

console.log("redesign-contract: ok");
