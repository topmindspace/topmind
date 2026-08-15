/**
 * AI system prompts — skill-first, short, tool-aligned.
 * Tool names MUST match electron/ai-tools.mjs (snake_case).
 *
 * Locale-aware: pass `locale` ("zh"|"en" or "zh-CN"|"en-US"). Default zh
 * for backward compatibility. English prompts when locale starts with "en".
 */
import {
  listSkillCatalog,
  formatCatalogForPrompt,
  loadSkillBody,
  setConfiguredExtraSkillsRoots,
  SLASH_TO_SKILL,
} from "./lib/skills-runtime.mjs";
import { describeWritebackModeForPrompt } from "./lib/writeback-mode-copy.mjs";

/**
 * Normalize any locale tag to prompt language key.
 * @param {string} [locale] — "zh" | "en" | "zh-CN" | "en-US" | …
 * @returns {"zh"|"en"}
 */
export function resolvePromptLocale(locale) {
  if (locale == null || locale === "") return "zh";
  return String(locale).startsWith("en") ? "en" : "zh";
}

/** @typedef {"zh"|"en"} PromptLocale */

/**
 * @param {PromptLocale} locale
 */
function promptCopy(locale) {
  if (locale === "en") {
    return {
      intro: [
        "You are the topmind personal knowledge workspace assistant: help the user capture material, organize it, write deliverables, and remember conclusions.",
        "Only read/write the current workspace via tools; do not invent tool names; do not launch external processes, browsers, or secondary windows.",
        "On tool failure, check parameters and retry once; if still failing, tell the user why — never skip silently.",
        "",
        "## Focus",
      ],
      workspace: (wsRoot) => `Workspace: ${wsRoot}`,
      category: (c) => `Category: ${c}`,
      topic: (t) => `Topic: ${t}`,
      open: (p) => `Open: ${p}`,
      focus: (h) => `Focus: ${h}`,
      contextSection: "## Workspace context (pre-loaded — no need to list_categories / read profile again)",
      categoriesOverview: "### Categories overview",
      mySituation: "### My situation",
      currentTopic: "### Current topic",
      mountedSection: "## Inlined files (no need to read again)",
      truncated: "…(truncated)",
      protocolSection: "## Protocol (skill-first)",
      skillPreloaded: (id) => `This turn's skill is pre-loaded: ${id}. Follow its flow and use tools directly.`,
      protocolSteps:
        "1. Pick a skill → `load_skill`\n2. Complete the task with tools per the skill\n3. Reply: conclusion + paths",
      fuzzyIntent: 'Ambiguous intent → `load_skill("topmind")`.',
      overviewInlined: "Workspace overview is already inlined above; no need to list_categories again.",
      useListCategories: "Use `list_categories` for categories.",
      skillsSection: "## Skills",
      activeSkill: (id) => `## This turn skill: ${id}`,
      preloadFailed: "(preload failed → load_skill)",
      toolsSection: [
        "",
        "## Tools (by workflow stage)",
        "### Skills",
        "- `list_skills` / `load_skill` / `load_skill_resource`: skill discovery and activation (routing entry)",
        "### Capture",
        "- `capture_to_inbox`: quick note (default stream period file; forceInbox→inbox; forceAtom→single file)",
        "- `fetch_url`: fetch page body → Markdown (render=true for SPA)",
        "### Browse",
        "- `workspace_overview`: full picture in one call (categories + inbox + stream + outputs), fewer list calls",
        "- `list_categories` / `list_topics` / `list_topic_files` / `get_topic`: hierarchical browse (read topic.md first for topics)",
        "- `list_inbox` / `list_outputs`: inbox and deliverables",
        "### Read",
        "- `read_file`: paginated numbered read (offset+limit, default 400). Mid-file: around=phrase or heading=. Check truncated/note.",
        "- `search`: keyword search (scope can narrow; skips Archive by default; regex=true for regex)",
        "### Write",
        "- `edit_file`: precise unique-span replace (**preferred**; exact then whitespace/newline normalize; startLine/endLine/heading optional; do not write Archive)",
        "- `save_file`: full-file overwrite (new files / large rewrites only)",
        "- `save_note`: create a note under a topic",
        "- `create_topic`: create topic (YYYY-title)",
        "- `capture_to_inbox` / `move_to_topic` / `publish_to_outputs`: flow between surfaces",
        "- `append_topic_memory` / `append_core_memory`: persist conclusions (only when user is clear)",
        "- `reconcile_week`: deterministic period cleanup (dedupe / completion detection)",
        "- `delete_path` / `rename_path`: delete (trash only for locked/core notes; ordinary open notes are irreversible) and rename",
        "### Diagnostics",
        "- `workspace_health`: workspace health check",
        "",
        "## Habits",
        "- When overview / my situation / topic home is already inlined above, use it — do not re-read",
        "- Batch multi-file ops in one turn; every step returns a path receipt",
        "- Use workspace-relative paths for names/paths; do not create system directories",
        "",
        "## Quality",
        "- Ask less, do more; reasonable defaults are fine to act on",
        "- Do not invent unread files; do not restate full skill bodies",
        "- Before write/delete, state the goal in one sentence",
        "- Mid-turn instructions take priority; be concise in English",
        "- User-visible reply is the answer only — do not dump chain-of-thought, <think> blocks, or process narration as the body",
        "- edit_file: unique span (exact, then newline/trailing-space normalize). On miss, use nearby/context; read_file around= the phrase. Do not rewrite the whole file for a mid-paragraph change.",
        "- Tool failure: check params and retry once; if still failing, tell the user why — never skip silently",
      ],
    };
  }

  return {
    intro: [
      "你是 topmind 个人知识工作台助手：帮用户把材料收进来、整理清楚、写好交付、记住结论。",
      "只通过工具读写当前工作区；不编造工具名；不启动外部进程/浏览器/第二窗口。",
      "工具失败时检查参数重试一次；仍失败则告知用户原因，不静默跳过。",
      "",
      "## 焦点",
    ],
    workspace: (wsRoot) => `工作区: ${wsRoot}`,
    category: (c) => `类别: ${c}`,
    topic: (t) => `专题: ${t}`,
    open: (p) => `打开: ${p}`,
    focus: (h) => `焦点: ${h}`,
    contextSection: "## 工作区上下文（已预加载，无需再 list_categories / read profile）",
    categoriesOverview: "### 类别概览",
    mySituation: "### 我的情况",
    currentTopic: "### 当前专题",
    mountedSection: "## 已内联文件（无需再 read）",
    truncated: "…(截断)",
    protocolSection: "## 协议（skill-first）",
    skillPreloaded: (id) => `本轮 skill 已预载：${id}。直接按其流程用工具。`,
    protocolSteps:
      "1. 选 skill → `load_skill`\n2. 按 skill 用工具完成\n3. 回复：结论 + 路径",
    fuzzyIntent: '模糊意图 → `load_skill("topmind")`。',
    overviewInlined: "工作区概览已内联上方，无需再 list_categories。",
    useListCategories: "类别用 `list_categories`。",
    skillsSection: "## Skills",
    activeSkill: (id) => `## 本轮 skill: ${id}`,
    preloadFailed: "（预加载失败 → load_skill）",
    toolsSection: [
      "",
      "## 工具（按工作流阶段）",
      "### Skills",
      "- `list_skills` / `load_skill` / `load_skill_resource`：技能发现与激活（路由起点）",
      "### 收集",
      "- `capture_to_inbox`：记一下（默认动态周期本；forceInbox→收件箱；forceAtom→单文件）",
      "- `fetch_url`：抓网页正文→Markdown（render=true 增强 SPA）",
      "### 浏览",
      "- `workspace_overview`：一次获取全貌（类别+收件箱+动态+输出），减少多次 list 调用",
      "- `list_categories` / `list_topics` / `list_topic_files` / `get_topic`：层级浏览（专题先读 topic.md）",
      "- `list_inbox` / `list_outputs`：收件箱与交付物",
      "### 读取",
      "- `read_file`：带行号分页读（offset+limit，默认400行）。中段用 around=短语 或 heading=。先看 truncated/note",
      "- `search`：关键词搜索（scope 可限范围；默认跳过 Archive；regex=true 支持正则）",
      "### 写入",
      "- `edit_file`：唯一片段替换（**首选**；先精确再容忍换行/行尾空白；可用 startLine/endLine/heading；不写 Archive）",
      "- `save_file`：整文件覆盖（仅新建/大段重写）",
      "- `save_note`：专题下新建笔记",
      "- `create_topic`：建专题（YYYY-主题）",
      "- `capture_to_inbox` / `move_to_topic` / `publish_to_outputs`：流转",
      "- `append_topic_memory` / `append_core_memory`：沉淀结论（仅用户明确时）",
      "- `reconcile_week`：确定性整理周期本（去重/完成检测）",
      "- `delete_path` / `rename_path`：删除（仅锁定/核心笔记进 trash；普通开放笔记不可恢复）与重命名",
      "### 诊断",
      "- `workspace_health`：工作区健康巡检",
      "",
      "## 习惯",
      "- 上方已内联概览/我的情况/专题首页时直接用，勿重复 read",
      "- 多文件操作集中一轮完成；每步有路径回执",
      "- 文件名/路径用工作区相对路径；不创建系统目录",
      "",
      "## 质量",
      "- 少问多做；合理默认即可动手",
      "- 不臆测未读文件；不复述 skill 全文",
      "- 写/删前一句话说明目标",
      "- 中途指示优先遵从；中文简洁",
      "- 用户可见正文只写结论，不要把思考过程、<think>、推理围栏当回复正文",
      "- edit_file 须唯一命中（精确，其次换行/行尾空白）。失败看 nearby/context；用 read_file around= 定位中段。不要为改一段而整文件覆盖",
      "- 工具失败：检查参数重试一次；仍失败则告知用户原因，不静默跳过",
    ],
  };
}

/**
 * @param {object} opts
 * @param {object|string} [opts.workspaceContext]
 * @param {string} [opts.topicId]
 * @param {Array<{name:string,content:string}>} [opts.mountedFiles]
 * @param {string} [opts.writebackMode]
 * @param {string[]} [opts.toolNames]
 * @param {boolean} [opts.skillsEnabled=true]
 * @param {string[]|null} [opts.enabledSkillIds]
 * @param {string} [opts.engineRoot]
 * @param {string[]} [opts.extraSkillsRoots]
 * @param {string} [opts.activeSkillId]
 * @param {string} [opts.focusPath]
 * @param {string} [opts.focusHint]
 * @param {string} [opts.workspaceOverview] - pre-loaded workspace overview (categories + topic counts)
 * @param {string} [opts.memoryProfile] - pre-loaded memory/profile.md content (stripped frontmatter)
 * @param {string} [opts.topicContext] - pre-loaded topic.md content when topicId is active
 * @param {string} [opts.locale] - "zh"|"en"|"zh-CN"|"en-US" (default zh)
 */
export function buildSystemPrompt(opts = {}) {
  const {
    workspaceContext,
    topicId,
    mountedFiles,
    writebackMode,
    toolNames,
    skillsEnabled = true,
    enabledSkillIds = null,
    engineRoot,
    extraSkillsRoots,
    activeSkillId,
    focusPath,
    focusHint,
    workspaceOverview,
    memoryProfile,
    topicContext,
    locale: localeOpt,
  } = opts;

  const locale = resolvePromptLocale(localeOpt);
  const P = promptCopy(locale);

  if (Array.isArray(extraSkillsRoots)) {
    setConfiguredExtraSkillsRoots(extraSkillsRoots);
  }

  const parts = [...P.intro];

  const wsRoot = typeof workspaceContext === "string"
    ? workspaceContext
    : workspaceContext?.userWorkspaceRoot;
  if (wsRoot) parts.push(P.workspace(wsRoot));

  if (topicId) {
    const [c, t] = String(topicId).split("/");
    if (c) parts.push(P.category(c));
    if (t) parts.push(P.topic(t));
  }
  if (focusPath) parts.push(P.open(focusPath));
  if (focusHint && !focusPath) parts.push(P.focus(focusHint));

  // Single policy string — Model B only (see writeback-mode-copy.mjs)
  parts.push(describeWritebackModeForPrompt(writebackMode, locale));

  // Pre-loaded workspace context (reduces agent tool calls for discovery)
  if (workspaceOverview || memoryProfile || topicContext) {
    parts.push("", P.contextSection);
    if (workspaceOverview) {
      parts.push(P.categoriesOverview, workspaceOverview);
    }
    if (memoryProfile) {
      parts.push(P.mySituation, memoryProfile);
    }
    if (topicContext) {
      parts.push(P.currentTopic, topicContext);
    }
  }

  if (mountedFiles?.length > 0) {
    parts.push("", P.mountedSection);
    for (const f of mountedFiles) {
      const body = f.content || "";
      const cap = mountedFiles.length > 2 ? 4000 : 7000;
      parts.push(`### ${f.name}`, body.length > cap ? `${body.slice(0, cap)}\n${P.truncated}` : body);
    }
  }

  if (skillsEnabled !== false) {
    let catalog = [];
    try {
      catalog = listSkillCatalog({
        engineRoot,
        enabledIds: enabledSkillIds,
        extraRoots: extraSkillsRoots,
      });
    } catch {
      catalog = [];
    }
    parts.push(
      "",
      P.protocolSection,
      activeSkillId
        ? P.skillPreloaded(activeSkillId)
        : P.protocolSteps,
      P.fuzzyIntent,
      workspaceOverview
        ? P.overviewInlined
        : P.useListCategories,
      "",
      P.skillsSection,
      formatCatalogForPrompt(catalog),
    );
    if (activeSkillId) {
      parts.push("", P.activeSkill(activeSkillId));
      try {
        const pinned = loadSkillBody(activeSkillId, { engineRoot, maxChars: 5500 });
        parts.push((pinned.raw || pinned.body || "").slice(0, 5500));
      } catch {
        parts.push(P.preloadFailed);
      }
    }
  }

  parts.push(...P.toolsSection);

  // Silence unused — toolNames still accepted for callers/tests that pass them
  void toolNames;

  return parts.join("\n");
}

export function assembleContext({ files, maxChars = 40000 }) {
  const mounted = [];
  let total = 0;
  const list = Array.isArray(files) ? files : [];
  // Prefer shorter files first so multi-mount stays balanced
  const ordered = [...list].sort((a, b) => (a.content?.length || 0) - (b.content?.length || 0));
  for (const f of ordered) {
    const content = typeof f.content === "string" ? f.content : "";
    if (total + content.length > maxChars) {
      const room = Math.max(0, maxChars - total);
      if (room > 400) {
        mounted.push({ ...f, content: `${content.slice(0, room)}…(truncated)` });
      }
      break;
    }
    mounted.push(f);
    total += content.length;
  }
  return { files: mounted, totalChars: total };
}

/**
 * Slash → user prompt seed by locale (plain language; skill activation still required).
 * @param {string} [locale]
 * @returns {Record<string, string>}
 */
export function getSkillPrompts(locale) {
  const lang = resolvePromptLocale(locale);
  if (lang === "en") {
    return {
      capture: "Help me capture into the workspace (load_skill topmind-capture first):",
      organize: "Help me organize current content / Inbox (load_skill topmind-organize first).",
      write: "Help me write or polish; write back when needed (load_skill topmind-write first).",
      memory: "Write confirmed conclusions into topic memory (load_skill topmind-memory first).",
      maintain: "Run a quick health check (load_skill topmind-maintain first).",
      loop: "Inspect the workspace and suggest next steps (load_skill topmind-loop first).",
      topmind: "Help me choose a flow and handle this:",
      weread: "WeRead related (load_skill topmind-weread first).",
      x: "X/Twitter related (load_skill topmind-x first).",
    };
  }
  return {
    capture: "帮我收进工作区（先 load_skill topmind-capture）：",
    organize: "帮我整理当前内容 / Inbox（先 load_skill topmind-organize）。",
    write: "帮我写作或润色，需要时写回（先 load_skill topmind-write）。",
    memory: "把已确认结论写入专题记忆（先 load_skill topmind-memory）。",
    maintain: "做一次快速体检（先 load_skill topmind-maintain）。",
    loop: "巡检工作区并给建议（先 load_skill topmind-loop）。",
    topmind: "帮我判断流程并处理：",
    weread: "微信读书相关（先 load_skill topmind-weread）。",
    x: "X/Twitter 相关（先 load_skill topmind-x）。",
  };
}

/** Slash → user prompt seed (plain language; skill activation still required). Default zh. */
export const SKILL_PROMPTS = getSkillPrompts("zh");

export { SLASH_TO_SKILL };
