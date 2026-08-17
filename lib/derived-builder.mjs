// ── topmind Derived Builder (Kernel 7/8) ───────────────────────────────────
// Authoritative engine for derived layer generation and rebuild: topic summaries,
// item histories, period digests, and workspace digests.

import fs from "node:fs";
import path from "node:path";
import { resolveWorkspaceModel, findCategoryByRole as findCategoryByRoleFromModel } from "./workspace-model.mjs";
import { buildFrontmatter } from "./yaml-writer.mjs";
import { validateAiOutput, resolveOutputLanguage } from "./ai-content-sanitize.mjs";

/**
 * AI provider interface for derived content generation.
 * Surface layer (Desktop/UTR/Skills) injects concrete implementation.
 *
 * @typedef {object} AiProvider
 * @property {(prompt: string, context: object) => Promise<string>} generate
 */

/**
 * Default no-op AI provider (fallback when no AI is configured).
 * Returns empty string so callers skip writing pollution into .derived /
 * memory paths. Product path must inject a real provider for durable AI text.
 */
const defaultAiProvider = {
  generate: async () => {
    return "";
  },
};

let aiProvider = defaultAiProvider;

/**
 * Resolve the effective provider for a call: explicit per-call injection wins;
 * falls back to the module-level provider configured via setAiProvider().
 * Per-call injection is the concurrency-safe path (multi-workspace Surfaces).
 * @param {AiProvider} [provider]
 * @returns {AiProvider}
 */
function resolveProvider(provider) {
  if (provider && typeof provider.generate === "function") return provider;
  return aiProvider;
}

/**
 * Configure AI provider for derived content generation.
 * @param {AiProvider} provider
 */
export function setAiProvider(provider) {
  if (provider && typeof provider.generate === "function") {
    aiProvider = provider;
  } else {
    aiProvider = defaultAiProvider;
  }
}

/**
 * Get current AI provider.
 * @returns {AiProvider}
 */
export function getAiProvider() {
  return aiProvider;
}

/**
 * Generate derived content for a topic (summary, item history).
 * Derived files live in {topic}/.derived/ subdirectory.
 *
 * @param {object} options
 * @param {string} options.topicPath - absolute path to topic directory
 * @param {string} options.workspaceRoot - absolute path to workspace root
 * @param {AiProvider} [options.aiProvider] - per-call provider (concurrency-safe)
 * @param {string} [options.localeOverride] - ignored (UI is not a content force)
 * @param {object} [options.contract] - v4 contract for locale resolution
 * @param {string} [options.userText] - explicit language request this turn
 * @returns {object} generated derived files
 */
export async function buildTopicDerived({ topicPath, workspaceRoot, aiProvider: provider, localeOverride, contract, userText }) {
  void localeOverride;
  const derivedDir = path.join(topicPath, ".derived");
  fs.mkdirSync(derivedDir, { recursive: true });

  const generated = {
    summary: null,
    itemHistory: null,
  };

  // Read all markdown files in topic
  const files = fs
    .readdirSync(topicPath)
    .filter((f) => f.endsWith(".md") && f !== "topic.md")
    .map((f) => path.join(topicPath, f));
  const samplePaths = [...files];
  const topicHome = path.join(topicPath, "topic.md");
  if (fs.existsSync(topicHome)) samplePaths.unshift(topicHome);
  const locale = resolveOutputLanguage({
    sourceText: peekFilesForLocale(samplePaths),
    contract,
    userText,
  });

  // Generate topic summary
  const summaryPath = path.join(derivedDir, "topic-summary.md");
  const summary = await generateTopicSummary(topicPath, files, workspaceRoot, resolveProvider(provider), locale);
  fs.writeFileSync(summaryPath, summary, "utf8");
  generated.summary = summaryPath;

  // Item history — deterministic FS inventory (rebuildable; not a second truth store)
  const historyPath = path.join(derivedDir, "item-history.md");
  const history = await generateItemHistory(topicPath, files, workspaceRoot, locale);
  fs.writeFileSync(historyPath, history, "utf8");
  generated.itemHistory = historyPath;

  return generated;
}

/**
 * Generate period digest for a stream category.
 * Derived files live in {streamCategory}/.derived/ subdirectory.
 *
 * Supports yearDir: when true (default), period notes live under
 * {streamPath}/{year}/{periodStem}.md; falls back to flat {streamPath}/{periodStem}.md.
 *
 * @param {object} options
 * @param {string} options.streamPath - absolute path to stream category directory
 * @param {string} options.periodStem - period stem (e.g., "2026-W30")
 * @param {string} options.workspaceRoot - absolute path to workspace root
 * @param {AiProvider} [options.aiProvider] - per-call provider (concurrency-safe)
 * @param {string} [options.localeOverride] - ignored (UI is not a content force)
 * @param {object} [options.contract] - v4 contract for locale + stream config
 * @param {string} [options.userText] - explicit language request this turn
 * @returns {object} generated derived files
 */
export async function buildPeriodDerived({ streamPath, periodStem, workspaceRoot, aiProvider: provider, localeOverride, contract, userText }) {
  void localeOverride;
  const derivedDir = path.join(streamPath, ".derived");
  fs.mkdirSync(derivedDir, { recursive: true });

  // Resolve period file path: try year subdir first (yearDir default), then flat
  const periodFile = resolvePeriodFilePath(streamPath, periodStem);
  if (!periodFile) {
    return { digest: null };
  }
  let periodSource = "";
  try {
    periodSource = fs.readFileSync(periodFile, "utf8");
  } catch {
    periodSource = "";
  }
  const locale = resolveOutputLanguage({
    sourceText: periodSource,
    contract,
    userText,
  });

  const digestPath = path.join(derivedDir, `period-digest-${periodStem}.md`);
  const digest = await generatePeriodDigest(periodFile, periodStem, workspaceRoot, resolveProvider(provider), locale);
  fs.writeFileSync(digestPath, digest, "utf8");

  return { digest: digestPath };
}

/**
 * Resolve the period note file path, checking year subdir first (yearDir default),
 * then falling back to flat layout for legacy workspaces.
 * @param {string} streamPath - absolute stream category dir
 * @param {string} periodStem - e.g., "2026-W30"
 * @returns {string|null} absolute path if file exists, null otherwise
 */
function resolvePeriodFilePath(streamPath, periodStem) {
  // Try year subdir: extract year from stem (e.g., "2026-W30" → "2026")
  const yearMatch = String(periodStem || "").match(/^(\d{4})-/u);
  if (yearMatch) {
    const yearSubPath = path.join(streamPath, yearMatch[1], `${periodStem}.md`);
    if (fs.existsSync(yearSubPath)) return yearSubPath;
  }
  // Fall back to flat: {streamPath}/{periodStem}.md
  const flatPath = path.join(streamPath, `${periodStem}.md`);
  if (fs.existsSync(flatPath)) return flatPath;
  return null;
}

/**
 * Rebuild all derived files from source (full rebuild).
 *
 * @param {object} options
 * @param {string} options.workspaceRoot - absolute path to workspace root
 * @param {object} options.contract - v4 contract object
 * @param {AiProvider} [options.aiProvider] - per-call provider (concurrency-safe)
 * @param {string} [options.localeOverride] - ignored (UI is not a content force)
 * @returns {object} rebuild statistics
 */
export async function rebuildAllDerived({ workspaceRoot, contract, aiProvider: provider, localeOverride, userText }) {
  void localeOverride;
  const stats = {
    topicsProcessed: 0,
    periodsProcessed: 0,
    errors: [],
  };

  // Find all topics (deep-work categories)
  const deepWorkDirs = findAllCategoriesByRole(workspaceRoot, contract, "deep-work");
  for (const dir of deepWorkDirs) {
    const topics = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d{4}-/.test(e.name))
      .map((e) => path.join(dir, e.name));

    for (const topicPath of topics) {
      try {
        await buildTopicDerived({ topicPath, workspaceRoot, aiProvider: provider, contract, userText });
        stats.topicsProcessed++;
      } catch (err) {
        stats.errors.push({ path: topicPath, error: err.message });
      }
    }
  }

  // Find all stream periods — support weekly, daily, monthly packing + yearDir
  const streamDir = findCategoryByRole(workspaceRoot, contract, "loose-stream");
  if (streamDir) {
    const periodPattern = /^\d{4}-(?:W\d{2}|\d{2}-\d{2}|\d{2})\.md$/u;
    const periods = collectPeriodStems(streamDir, periodPattern);

    for (const periodStem of periods) {
      try {
        await buildPeriodDerived({ streamPath: streamDir, periodStem, workspaceRoot, aiProvider: provider, contract, userText });
        stats.periodsProcessed++;
      } catch (err) {
        stats.errors.push({ path: periodStem, error: err.message });
      }
    }
  }

  return stats;
}

// ── Bilingual prompt helpers ──────────────────────────────────────────────

/** @returns {string} topic summary prompt */
function topicSummaryPrompt(topicName, fileList, locale) {
  if (locale === "en") {
    return `Generate a concise summary for the following topic.

Topic: ${topicName}

---
${fileList}
---

Output in Markdown only (no preamble, no thinking tags, no code fences):

## Key Themes
- List 3-5 core themes

## Main Content
- Briefly describe each file's main content and connections

## Follow-ups
- List potential todos or unfinished items (if any)`;
  }
  return `请为以下专题生成一份简洁的摘要。

专题：${topicName}

---
${fileList}
---

请按以下格式输出（只用 Markdown，不要加前缀后缀语、思考过程或 thinking 标签，不要使用 markdown 代码围栏）：

## 关键主题
- 列出 3-5 条核心主题

## 主要内容
- 简述各文件的主要内容和关联

## 待跟进
- 列出可能的待办或未完成事项（如有）`;
}

/** @returns {string} period reflection prompt */
function periodReflectionPrompt(trimmed, locale) {
  if (locale === "en") {
    return `Generate a period reflection for the following period note.

Not "what happened this week" but "what this week reveals" — focus on:
- Themes and patterns (what recurring topics emerge?)
- Knowledge and insights (what did the user learn or realize?)
- Behavioral signals (what habits, preferences, or work patterns are visible?)
- Preference shifts (what changed in what the user cares about?)
- Leads and threads (what open questions or future directions appeared?)

Analyze the full semantic context of the note — do not just list events.
Identify the *meaning* behind the activity, not just the activity itself.

---
${trimmed}
---

Output in Markdown only (no preamble, no thinking tags, no code fences):

## Highlights
- Extract 3-5 most important items this period (what mattered most, not just what happened)

## In Progress
- List items currently being pursued (with status signals if visible)

## Worth Remembering
- List preferences, goals, or important info worth retaining (focus on *new* discoveries about the user)

## Patterns & Insights
- What recurring themes or behavioral patterns emerge from this period's activity?`;
  }
  return `请为以下周期笔记生成一份深度的周期反思。

不是「本周发生了什么」，而是「本周揭示了什么」——关注：
- 焦点与模式（什么反复出现的话题？）
- 知识与见解（用户学到了什么、意识到了什么？）
- 行为信号（什么习惯、偏好、工作模式可见？）
- 偏好变化（用户关注的东西有什么变化？）
- 线索与伏笔（出现了什么开放性问题或未来方向？）

分析笔记的完整语义上下文——不要只罗列事件。
识别活动背后的「意义」，而不只是活动本身。

---
${trimmed}
---

请按以下格式输出（只用 Markdown，不要加前缀后缀语、思考过程或 thinking 标签，不要使用 markdown 代码围栏）：

## 本周要点
- 提取 3-5 条本周最重要的内容（什么最关键，而非仅仅发生了什么）

## 进行中的事
- 列出正在推进的事项（如有状态信号则标注）

## 值得记住的
- 列出可能需要沉淀的偏好、目标或重要信息（重点关注关于用户的「新发现」）

## 模式与洞察
- 本周活动中浮现了什么反复出现的主题或行为模式？`;
}

// ── AI generation internals ───────────────────────────────────────────────

/**
 * Generate topic summary from markdown files.
 * @param {string} topicPath
 * @param {string[]} files
 * @param {string} workspaceRoot
 * @param {AiProvider} provider
 * @param {string} [locale] - "zh" | "en"
 * @returns {Promise<string>} summary markdown
 */
async function generateTopicSummary(topicPath, files, workspaceRoot, provider, locale = "zh") {
  const topicName = path.basename(topicPath);
  const relativePath = path.relative(workspaceRoot, topicPath).replace(/\\/g, "/");

  const frontmatter = buildFrontmatter({
    title: `${topicName} ${locale === "en" ? "Summary" : "摘要"}`,
    source_type: "ai-derived",
    derived_from: files.map((f) => path.relative(workspaceRoot, f).replace(/\\/g, "/")),
    generated_at: new Date().toISOString(),
  });

  // Collect file contents for AI context — smart truncation: distribute budget across files
  const MAX_TOPIC_CONTEXT = 48000;
  const perFile = Math.max(800, Math.floor(MAX_TOPIC_CONTEXT / Math.max(files.length, 1)));
  const truncLabel = locale === "en" ? "(truncated)" : "(截断)";
  const fileContents = files.map((f) => {
    try {
      const text = fs.readFileSync(f, "utf8");
      if (text.length <= perFile) return text;
      // Keep frontmatter + head + tail for structure context
      const fmEnd = text.indexOf("\n---", 3);
      const fm = fmEnd > 0 ? text.slice(0, fmEnd + 4) : "";
      const body = text.slice(fm.length);
      const headRoom = perFile - fm.length - 20;
      return fm + "\n" + body.slice(0, Math.floor(headRoom * 0.7)) + `\n…${truncLabel}\n` + body.slice(-Math.floor(headRoom * 0.3));
    } catch {
      return "";
    }
  }).filter(Boolean);

  const fileLabel = locale === "en" ? "File" : "文件";
  const fileList = fileContents.map((c, i) => `### ${fileLabel} ${i + 1}\n${c}`).join("\n\n");
  const prompt = topicSummaryPrompt(topicName, fileList, locale);
  const rawSummary = await provider.generate(prompt, { topicPath, files, workspaceRoot, operation: "topic_summary" });
  const usable = validateAiOutput(rawSummary, "derived");
  // Honest scaffold when AI missing/failed — never dump "待 AI 生成" placeholders
  const fallbackNote = locale === "en"
    ? "_(Summary not generated: AI not configured or failed; rebuildable)_"
    : "_（摘要未生成：未配置 AI 或生成失败；可重建）_";
  const aiSummary = usable.ok ? usable.text : fallbackNote;

  const lines = [
    frontmatter,
    ``,
    `# ${topicName} ${locale === "en" ? "Summary" : "摘要"}`,
    ``,
    `> ${locale === "en" ? "AI-generated topic summary, rebuildable." : "AI 生成的专题摘要，可重建。"}`,
    ``,
    `## ${locale === "en" ? "Files" : "文件列表"}`,
    ``,
  ];

  for (const file of files) {
    const fileName = path.basename(file);
    lines.push(`- [[${fileName}]]`);
  }

  lines.push(``, `## ${locale === "en" ? "Key Themes" : "关键主题"}`, ``, aiSummary, ``);

  return lines.join("\n");
}

/**
 * Deterministic item history for a topic (mtime + size inventory).
 * Rebuildable under `.derived/`; never pretends to be user-authored content.
 *
 * @param {string} topicPath
 * @param {string[]} files
 * @param {string} workspaceRoot
 * @param {string} [locale] - "zh" | "en"
 * @returns {Promise<string>}
 */
async function generateItemHistory(topicPath, files, workspaceRoot, locale = "zh") {
  const topicName = path.basename(topicPath);
  const relativePath = path.relative(workspaceRoot, topicPath).replace(/\\/g, "/");
  const rows = files
    .map((f) => {
      try {
        const st = fs.statSync(f);
        return {
          name: path.basename(f),
          rel: path.relative(workspaceRoot, f).replace(/\\/g, "/"),
          mtime: st.mtime.toISOString(),
          size: st.size,
        };
      } catch {
        return {
          name: path.basename(f),
          rel: path.relative(workspaceRoot, f).replace(/\\/g, "/"),
          mtime: null,
          size: 0,
        };
      }
    })
    .sort((a, b) => String(b.mtime || "").localeCompare(String(a.mtime || "")));

  const frontmatter = buildFrontmatter({
    title: `${topicName} ${locale === "en" ? "Item History" : "条目历史"}`,
    source_type: "ai-derived",
    derived_from: rows.map((r) => r.rel),
    generated_at: new Date().toISOString(),
  });

  const lines = [
    frontmatter,
    ``,
    `# ${topicName} ${locale === "en" ? "Item History" : "条目历史"}`,
    ``,
    `> ${locale === "en" ? "Rebuildable projection (.derived) · not user-authored · sorted by mtime desc" : "可重建投影（.derived）· 非用户原文 · 按修改时间倒序"}`,
    ``,
    `| ${locale === "en" ? "File" : "文件"} | ${locale === "en" ? "Modified" : "修改时间"} | ${locale === "en" ? "Size" : "大小"} |`,
    `| --- | --- | ---: |`,
  ];
  for (const r of rows) {
    lines.push(`| [[${r.name}]] | ${r.mtime || "—"} | ${r.size} |`);
  }
  lines.push(``, `${locale === "en" ? "Topic path" : "专题路径"}：\`${relativePath}\``, ``);
  return lines.join("\n");
}

/**
 * Generate period digest from period note.
 * @param {string} periodFile
 * @param {string} periodStem
 * @param {string} workspaceRoot
 * @param {AiProvider} provider
 * @param {string} [locale] - "zh" | "en"
 * @returns {Promise<string>} digest markdown
 */
async function generatePeriodDigest(periodFile, periodStem, workspaceRoot, provider, locale = "zh") {
  const content = fs.readFileSync(periodFile, "utf8");
  const relativePath = path.relative(workspaceRoot, periodFile).replace(/\\/g, "/");

  const frontmatter = buildFrontmatter({
    title: `${periodStem} ${locale === "en" ? "Reflection" : "周期反思"}`,
    source_type: "ai-derived",
    derived_from: [relativePath],
    generated_at: new Date().toISOString(),
  });

  const truncSuffix = locale === "en" ? "\n... (truncated)" : "\n...（截断）";
  const trimmed = content.length > 8000 ? content.slice(0, 8000) + truncSuffix : content;
  const prompt = periodReflectionPrompt(trimmed, locale);
  const rawDigest = await provider.generate(prompt, { periodFile, periodStem, workspaceRoot, operation: "period_digest" });
  const usable = validateAiOutput(rawDigest, "derived");
  const fallbackNote = locale === "en"
    ? "_(Reflection not generated: AI not configured or failed; rebuildable)_"
    : "_（摘要未生成：未配置 AI 或生成失败；可重建）_";
  const aiDigest = usable.ok ? usable.text : fallbackNote;

  const lines = [
    frontmatter,
    ``,
    `# ${periodStem} ${locale === "en" ? "Reflection" : "周期反思"}`,
    ``,
    `> ${locale === "en" ? "AI-generated period reflection, rebuildable." : "AI 生成的周期反思，可重建。"}`,
    ``,
    `## ${locale === "en" ? "Highlights" : "本周要点"}`,
    ``,
    aiDigest,
    ``,
  ];

  return lines.join("\n");
}

/**
 * Sample note bodies for script detection (no I/O policy beyond this peek).
 * @param {string[]} paths
 * @param {number} [max]
 */
function peekFilesForLocale(paths, max = 12000) {
  let out = "";
  for (const p of paths) {
    if (out.length >= max) break;
    try {
      out += `${fs.readFileSync(p, "utf8").slice(0, 4000)}\n`;
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

// ── FS helpers ────────────────────────────────────────────────────────────

/**
 * Collect period note stems from stream directory, scanning both root level
 * and year subdirectories (yearDir default true).
 * @param {string} streamDir - absolute path to stream category directory
 * @param {RegExp} periodPattern - pattern for period note filenames
 * @returns {string[]} period stems (e.g., ["2026-W30", "2025-W52"])
 */
function collectPeriodStems(streamDir, periodPattern) {
  const stems = [];
  let entries;
  try {
    entries = fs.readdirSync(streamDir, { withFileTypes: true });
  } catch {
    return stems;
  }
  for (const e of entries) {
    if (e.isFile() && periodPattern.test(e.name)) {
      stems.push(e.name.replace(/\.md$/u, ""));
    } else if (e.isDirectory() && /^\d{4}$/u.test(e.name)) {
      // Scan year subdirectory
      try {
        const yearEntries = fs.readdirSync(path.join(streamDir, e.name));
        for (const f of yearEntries) {
          if (periodPattern.test(f)) {
            stems.push(f.replace(/\.md$/u, ""));
          }
        }
      } catch {
        /* ignore year dir read errors */
      }
    }
  }
  return stems;
}

/**
 * Find category directory by role using workspace-model.
 * @param {string} workspaceRoot
 * @param {object} contract
 * @param {string} role
 * @param {string} [engineRoot]
 * @returns {string|null}
 */
function findCategoryByRole(workspaceRoot, contract, role, engineRoot) {
  const model = resolveWorkspaceModel({ workspaceRoot, engineRoot, config: contract });
  const category = findCategoryByRoleFromModel(model, role);
  return category ? path.join(workspaceRoot, category.directory) : null;
}

/**
 * Find all category directories by role using workspace-model.
 * @param {string} workspaceRoot
 * @param {object} contract
 * @param {string} role
 * @param {string} [engineRoot]
 * @returns {string[]}
 */
function findAllCategoriesByRole(workspaceRoot, contract, role, engineRoot) {
  const model = resolveWorkspaceModel({ workspaceRoot, engineRoot, config: contract });
  return model.categories
    .filter((c) => c.role === role)
    .map((c) => path.join(workspaceRoot, c.directory));
}
