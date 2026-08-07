// ── topmind Derived Builder (Kernel 7/8) ───────────────────────────────────
// Authoritative engine for derived layer generation and rebuild: topic summaries,
// item histories, period digests, and workspace digests.

import fs from "node:fs";
import path from "node:path";
import { resolveWorkspaceModel, findCategoryByRole as findCategoryByRoleFromModel } from "./workspace-model.mjs";
import { buildFrontmatter } from "./yaml-writer.mjs";
import { validateAiOutput } from "./ai-content-sanitize.mjs";

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
 * @returns {object} generated derived files
 */
export async function buildTopicDerived({ topicPath, workspaceRoot, aiProvider: provider }) {
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

  // Generate topic summary
  const summaryPath = path.join(derivedDir, "topic-summary.md");
  const summary = await generateTopicSummary(topicPath, files, workspaceRoot, resolveProvider(provider));
  fs.writeFileSync(summaryPath, summary, "utf8");
  generated.summary = summaryPath;

  // Item history — deterministic FS inventory (rebuildable; not a second truth store)
  const historyPath = path.join(derivedDir, "item-history.md");
  const history = await generateItemHistory(topicPath, files, workspaceRoot);
  fs.writeFileSync(historyPath, history, "utf8");
  generated.itemHistory = historyPath;

  return generated;
}

/**
 * Generate period digest for a stream category.
 * Derived files live in {streamCategory}/.derived/ subdirectory.
 *
 * @param {object} options
 * @param {string} options.streamPath - absolute path to stream category directory
 * @param {string} options.periodStem - period stem (e.g., "2026-W30")
 * @param {string} options.workspaceRoot - absolute path to workspace root
 * @param {AiProvider} [options.aiProvider] - per-call provider (concurrency-safe)
 * @returns {object} generated derived files
 */
export async function buildPeriodDerived({ streamPath, periodStem, workspaceRoot, aiProvider: provider }) {
  const derivedDir = path.join(streamPath, ".derived");
  fs.mkdirSync(derivedDir, { recursive: true });

  const periodFile = path.join(streamPath, `${periodStem}.md`);
  if (!fs.existsSync(periodFile)) {
    return { digest: null };
  }

  const digestPath = path.join(derivedDir, `period-digest-${periodStem}.md`);
  const digest = await generatePeriodDigest(periodFile, periodStem, workspaceRoot, resolveProvider(provider));
  fs.writeFileSync(digestPath, digest, "utf8");

  return { digest: digestPath };
}

/**
 * Rebuild all derived files from source (full rebuild).
 *
 * @param {object} options
 * @param {string} options.workspaceRoot - absolute path to workspace root
 * @param {object} options.contract - v4 contract object
 * @param {AiProvider} [options.aiProvider] - per-call provider (concurrency-safe)
 * @returns {object} rebuild statistics
 */
export async function rebuildAllDerived({ workspaceRoot, contract, aiProvider: provider }) {
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
        await buildTopicDerived({ topicPath, workspaceRoot, aiProvider: provider });
        stats.topicsProcessed++;
      } catch (err) {
        stats.errors.push({ path: topicPath, error: err.message });
      }
    }
  }

  // Find all stream periods — support weekly, daily, and monthly packing
  const streamDir = findCategoryByRole(workspaceRoot, contract, "loose-stream");
  if (streamDir) {
    const periodPattern = /^\d{4}-(?:W\d{2}|\d{2}-\d{2}|\d{2})\.md$/u;
    const periods = fs
      .readdirSync(streamDir)
      .filter((f) => periodPattern.test(f))
      .map((f) => f.replace(/\.md$/, ""));

    for (const periodStem of periods) {
      try {
        await buildPeriodDerived({ streamPath: streamDir, periodStem, workspaceRoot, aiProvider: provider });
        stats.periodsProcessed++;
      } catch (err) {
        stats.errors.push({ path: periodStem, error: err.message });
      }
    }
  }

  return stats;
}

/**
 * Generate topic summary from markdown files.
 * @param {string} topicPath
 * @param {string[]} files
 * @param {string} workspaceRoot
 * @param {AiProvider} provider
 * @returns {Promise<string>} summary markdown
 */
async function generateTopicSummary(topicPath, files, workspaceRoot, provider) {
  const topicName = path.basename(topicPath);
  const relativePath = path.relative(workspaceRoot, topicPath).replace(/\\/g, "/");

  const frontmatter = buildFrontmatter({
    title: `${topicName} 摘要`,
    source_type: "ai-derived",
    derived_from: files.map((f) => path.relative(workspaceRoot, f).replace(/\\/g, "/")),
    generated_at: new Date().toISOString(),
  });

  // Collect file contents for AI context — smart truncation: distribute budget across files
  const MAX_TOPIC_CONTEXT = 12000;
  const perFile = Math.max(800, Math.floor(MAX_TOPIC_CONTEXT / Math.max(files.length, 1)));
  const fileContents = files.map((f) => {
    try {
      const text = fs.readFileSync(f, "utf8");
      if (text.length <= perFile) return text;
      // Keep frontmatter + head + tail for structure context
      const fmEnd = text.indexOf("\n---", 3);
      const fm = fmEnd > 0 ? text.slice(0, fmEnd + 4) : "";
      const body = text.slice(fm.length);
      const headRoom = perFile - fm.length - 20;
      return fm + "\n" + body.slice(0, Math.floor(headRoom * 0.7)) + "\n…(截断)\n" + body.slice(-Math.floor(headRoom * 0.3));
    } catch {
      return "";
    }
  }).filter(Boolean);

  const fileList = fileContents.map((c, i) => `### 文件 ${i + 1}\n${c}`).join("\n\n");
  const prompt = `请为以下专题生成一份简洁的摘要。

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
  const rawSummary = await provider.generate(prompt, { topicPath, files, workspaceRoot, operation: "topic_summary" });
  const usable = validateAiOutput(rawSummary, "derived");
  // Honest scaffold when AI missing/failed — never dump "待 AI 生成" placeholders
  const aiSummary = usable.ok
    ? usable.text
    : `_（摘要未生成：未配置 AI 或生成失败；可重建）_`;

  const lines = [
    frontmatter,
    ``,
    `# ${topicName} 摘要`,
    ``,
    `> AI 生成的专题摘要，可重建。`,
    ``,
    `## 文件列表`,
    ``,
  ];

  for (const file of files) {
    const fileName = path.basename(file);
    lines.push(`- [[${fileName}]]`);
  }

  lines.push(``, `## 关键主题`, ``, aiSummary, ``);

  return lines.join("\n");
}

/**
 * Deterministic item history for a topic (mtime + size inventory).
 * Rebuildable under `.derived/`; never pretends to be user-authored content.
 *
 * @param {string} topicPath
 * @param {string[]} files
 * @param {string} workspaceRoot
 * @returns {Promise<string>}
 */
async function generateItemHistory(topicPath, files, workspaceRoot) {
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
    title: `${topicName} 条目历史`,
    source_type: "ai-derived",
    derived_from: rows.map((r) => r.rel),
    generated_at: new Date().toISOString(),
  });

  const lines = [
    frontmatter,
    ``,
    `# ${topicName} 条目历史`,
    ``,
    `> 可重建投影（.derived）· 非用户原文 · 按修改时间倒序`,
    ``,
    `| 文件 | 修改时间 | 大小 |`,
    `| --- | --- | ---: |`,
  ];
  for (const r of rows) {
    lines.push(`| [[${r.name}]] | ${r.mtime || "—"} | ${r.size} |`);
  }
  lines.push(``, `专题路径：\`${relativePath}\``, ``);
  return lines.join("\n");
}

/**
 * Generate period digest from period note.
 * @param {string} periodFile
 * @param {string} periodStem
 * @param {string} workspaceRoot
 * @param {AiProvider} provider
 * @returns {Promise<string>} digest markdown
 */
async function generatePeriodDigest(periodFile, periodStem, workspaceRoot, provider) {
  const content = fs.readFileSync(periodFile, "utf8");
  const relativePath = path.relative(workspaceRoot, periodFile).replace(/\\/g, "/");

  const frontmatter = buildFrontmatter({
    title: `${periodStem} 周期摘要`,
    source_type: "ai-derived",
    derived_from: [relativePath],
    generated_at: new Date().toISOString(),
  });

  const trimmed = content.length > 8000 ? content.slice(0, 8000) + "\n...（截断）" : content;
  const prompt = `请为以下周期笔记生成一份简洁的周期摘要。

---
${trimmed}
---

请按以下格式输出（只用 Markdown，不要加前缀后缀语、思考过程或 thinking 标签，不要使用 markdown 代码围栏）：

## 本周要点
- 提取 3-5 条本周最重要的内容

## 进行中的事
- 列出正在推进的事项

## 值得记住的
- 列出可能需要沉淀的偏好、目标或重要信息`;
  const rawDigest = await provider.generate(prompt, { periodFile, periodStem, workspaceRoot, operation: "period_digest" });
  const usable = validateAiOutput(rawDigest, "derived");
  const aiDigest = usable.ok
    ? usable.text
    : `_（摘要未生成：未配置 AI 或生成失败；可重建）_`;

  const lines = [
    frontmatter,
    ``,
    `# ${periodStem} 周期摘要`,
    ``,
    `> AI 生成的周期摘要，可重建。`,
    ``,
    `## 本周要点`,
    ``,
    aiDigest,
    ``,
  ];

  return lines.join("\n");
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
