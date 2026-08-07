/**
 * AI system prompts — skill-first, short, tool-aligned.
 * Tool names MUST match electron/ai-tools.mjs (snake_case).
 *
 * NOTE: System prompt strings are intentionally Chinese-first. The workspace
 * content model is Chinese-default, and AI models perform equally well with
 * Chinese system prompts. Future i18n (locale parameter) would require
 * translating all hardcoded strings — currently a non-goal per ARCHITECTURE-RESET.
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
  } = opts;

  if (Array.isArray(extraSkillsRoots)) {
    setConfiguredExtraSkillsRoots(extraSkillsRoots);
  }

  const parts = [
    "你是 topmind 个人知识工作台助手：帮用户把材料收进来、整理清楚、写好交付、记住结论。",
    "只通过工具读写当前工作区；不编造工具名；不启动外部进程/浏览器/第二窗口。",
    "工具失败时检查参数重试一次；仍失败则告知用户原因，不静默跳过。",
    "",
    "## 焦点",
  ];

  const wsRoot = typeof workspaceContext === "string"
    ? workspaceContext
    : workspaceContext?.userWorkspaceRoot;
  if (wsRoot) parts.push(`工作区: ${wsRoot}`);

  if (topicId) {
    const [c, t] = String(topicId).split("/");
    if (c) parts.push(`类别: ${c}`);
    if (t) parts.push(`专题: ${t}`);
  }
  if (focusPath) parts.push(`打开: ${focusPath}`);
  if (focusHint && !focusPath) parts.push(`焦点: ${focusHint}`);

  // Single policy string — Model B only (see writeback-mode-copy.mjs)
  parts.push(describeWritebackModeForPrompt(writebackMode));

  // Pre-loaded workspace context (reduces agent tool calls for discovery)
  if (workspaceOverview || memoryProfile || topicContext) {
    parts.push("", "## 工作区上下文（已预加载，无需再 list_categories / read profile）");
    if (workspaceOverview) {
      parts.push("### 类别概览", workspaceOverview);
    }
    if (memoryProfile) {
      parts.push("### 我的情况", memoryProfile);
    }
    if (topicContext) {
      parts.push("### 当前专题", topicContext);
    }
  }

  if (mountedFiles?.length > 0) {
    parts.push("", "## 已内联文件（无需再 read）");
    for (const f of mountedFiles) {
      const body = f.content || "";
      const cap = mountedFiles.length > 2 ? 4000 : 7000;
      parts.push(`### ${f.name}`, body.length > cap ? `${body.slice(0, cap)}\n…(截断)` : body);
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
      "## 协议（skill-first）",
      activeSkillId
        ? `本轮 skill 已预载：${activeSkillId}。直接按其流程用工具。`
        : "1. 选 skill → `load_skill`\n2. 按 skill 用工具完成\n3. 回复：结论 + 路径",
      "模糊意图 → `load_skill(\"topmind\")`。",
      workspaceOverview
        ? "工作区概览已内联上方，无需再 list_categories。"
        : "类别用 `list_categories`。",
      "",
      "## Skills",
      formatCatalogForPrompt(catalog),
    );
    if (activeSkillId) {
      parts.push("", `## 本轮 skill: ${activeSkillId}`);
      try {
        const pinned = loadSkillBody(activeSkillId, { engineRoot, maxChars: 5500 });
        parts.push((pinned.raw || pinned.body || "").slice(0, 5500));
      } catch {
        parts.push("（预加载失败 → load_skill）");
      }
    }
  }

  parts.push(
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
    "- `read_file`：分页读（offset+limit，默认400行）；先看 truncated/note",
    "- `search`：关键词搜索（scope 可限范围；默认跳过 Archive；regex=true 支持正则）",
    "### 写入",
    "- `edit_file`：精确局部替换（**首选**；oldText 须唯一匹配；不写 Archive）",
    "- `save_file`：整文件覆盖（仅新建/大段重写）",
    "- `save_note`：专题下新建笔记",
    "- `create_topic`：建专题（YYYY-主题）",
    "- `capture_to_inbox` / `move_to_topic` / `publish_to_outputs`：流转",
    "- `append_topic_memory` / `append_core_memory`：沉淀结论（仅用户明确时）",
    "- `reconcile_week`：确定性整理周期本（去重/完成检测）",
    "- `delete_path` / `rename_path`：删除（可逆）与重命名",
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
    "- edit_file 的 oldText 必须精确匹配文件内容（含缩进/换行）；不确定时先 read_file",
    "- 工具失败：检查参数重试一次；仍失败则告知用户原因，不静默跳过",
  );

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

/** Slash → user prompt seed (plain language; skill activation still required). */
export const SKILL_PROMPTS = {
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

export { SLASH_TO_SKILL };
