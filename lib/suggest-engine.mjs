// ── topmind Suggest Engine ─────────────────────────────────────────────────
// Scan → structured suggestion cards. Never mutates memory/content until
// applySuggestion runs through writeback-engine (confirm path).
//
// Two tiers:
//   1. Rule-based (always available): lifecycle scan, file age, profile check.
//   2. AI-powered (when aiProvider is injected): content analysis, smart summaries,
//      topic extraction — real LLM calls, not placeholder text.
//
// The aiProvider interface: { generate(prompt, context) => Promise<string> }
// When absent, only rule-based suggestions are produced (backward compatible).

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadContract } from "./contract-engine.mjs";
import { scanLifecycle } from "./lifecycle-engine.mjs";
import {
  resolveWorkspaceModel,
  findStreamCategory,
  sanitizeTopicPlacement,
} from "./workspace-model.mjs";
import { executeWrite, executeArchive } from "./writeback-engine.mjs";
import {
  appendProfileEntry,
  writePeriodDigest,
  promoteStreamItem,
  ensureMemoryPlane,
} from "./memory-engine.mjs";
import {
  resolveActivityWindow,
  buildActivityCorpus,
  periodItemsFromWindow,
} from "./activity-window.mjs";
import {
  isPlaceholderOrPolluted,
  sanitizeAiContent,
  validateAiOutput,
} from "./ai-content-sanitize.mjs";
import {
  shouldSkipAiForFingerprint,
  markAiFingerprint,
  clearSuggestFingerprints,
} from "./suggest-fingerprint.mjs";

/**
 * @typedef {object} AiProvider
 * @property {(prompt: string, context?: object) => Promise<string>} generate
 */

/**
 * @typedef {object} Suggestion
 * @property {string} id
 * @property {string} kind - inbox_review | inbox_organize | stale_topic | catch_all | stream_digest | promote_memory | open_profile | archive_path | ai_summary | create_topic
 * @property {string} title
 * @property {string} summary
 * @property {string} [targetPath] - workspace-relative
 * @property {object} [payload]
 * @property {"low"|"medium"|"high"} impact
 */

/**
 * Resolve locale — returns "en" or "zh".
 * Priority: localeOverride (from UI) → contract locale → default zh.
 * @param {object} [contract]
 * @param {string} [localeOverride] — UI locale override (e.g., from Desktop settings)
 * @returns {"en"|"zh"}
 */
function resolveLocale(contract, localeOverride) {
  if (localeOverride) return String(localeOverride).startsWith("en") ? "en" : "zh";
  const locale = contract?.locale || contract?.workspace?.locale || "zh-CN";
  return String(locale).startsWith("en") ? "en" : "zh";
}

/** Bilingual suggestion text templates. */
const SUGGEST_L10N = {
  zh: {
    openProfileTitle: "完善「我的情况」",
    openProfileSummary: "还没有完整的个人记忆页，可打开 memory/profile.md 补充偏好与目标。",
    inboxReviewTitle: "收件箱待整理",
    inboxReviewSummary: (rel) => `${rel} 已超过回顾天数；确认后可归档到 99-归档（可恢复）。`,
    inboxOrganizeTitle: "收件箱智能整理",
    inboxOrganizeSummary: (n) => `收件箱有 ${n} 条内容待整理。配置 AI 后可自动分析并建议移入合适专题。`,
    staleTopicTitle: "陈旧专题",
    staleTopicSummary: (rel) => `${rel} 长期未更新；确认后归档（目录整体移入 99-归档）。`,
    catchAllTitle: "兜底类清理",
    catchAllSummary: (rel) => `${rel} 超过保留天数；确认后归档清理。`,
    streamDigestTitle: "生成周期反思",
    streamDigestSummaryAi: (period) => `AI 将为 ${period} 生成周期反思并写入 memory/periodic（确认后执行）。`,
    streamDigestSummaryNoAi: (period) => `可为 ${period} 生成 memory/periodic 反思（确认后需 AI 生成真实反思；无 AI 时不会写入占位）。`,
    promoteMemoryTitle: "动态 → 记忆（可选）",
    promoteMemorySummary: "近期动态有内容；确认后可将稳定结论追加到「我的情况」。",
    promoteMemorySection: "进行中的事",
  },
  en: {
    openProfileTitle: "Complete your profile",
    openProfileSummary: "Your profile page is incomplete. Open memory/profile.md to add preferences and goals.",
    inboxReviewTitle: "Inbox needs review",
    inboxReviewSummary: (rel) => `${rel} is past the review period. Archive to 99-Archive (recoverable).`,
    inboxOrganizeTitle: "Smart inbox organize",
    inboxOrganizeSummary: (n) => `${n} items in inbox need organizing. Configure AI to auto-analyze and suggest topic placement.`,
    staleTopicTitle: "Stale topic",
    staleTopicSummary: (rel) => `${rel} hasn't been updated recently. Archive it (moved to 99-Archive).`,
    catchAllTitle: "Catch-all cleanup",
    catchAllSummary: (rel) => `${rel} exceeds retention days. Archive to clean up.`,
    streamDigestTitle: "Generate period reflection",
    streamDigestSummaryAi: (period) => `AI will generate a reflection for ${period} and write to memory/periodic (runs on confirm).`,
    streamDigestSummaryNoAi: (period) => `Generate a memory/periodic reflection for ${period} (requires AI for real content; no placeholder written without AI).`,
    promoteMemoryTitle: "Stream → Memory (optional)",
    promoteMemorySummary: "Recent stream has content. Confirm to append stable conclusions to your profile.",
    promoteMemorySection: "In Progress",
  },
};

/**
 * Latest period note — prefers activity window (recent periods + content).
 * @param {string} workspaceRoot
 * @param {string} [engineRoot]
 * @param {object} [contract]
 * @returns {{ absPath: string, relPath: string, period: string, content: string } | null}
 */
function findLatestPeriodNote(workspaceRoot, engineRoot, contract) {
  try {
    const win = resolveActivityWindow({
      workspaceRoot,
      engineRoot,
      contract,
      options: { maxPeriods: 6, maxFiles: 30, minContentLength: 10, loadContent: true },
    });
    const periods = periodItemsFromWindow(win);
    if (periods.length > 0) {
      const p = periods[0];
      return {
        absPath: p.absPath,
        relPath: p.relPath,
        period: p.period || path.basename(p.relPath, ".md"),
        content: p.content || "",
      };
    }
    // Fallback: legacy single-dir scan
    const model = resolveWorkspaceModel({ workspaceRoot, engineRoot, config: contract });
    const streamCat = findStreamCategory(model);
    if (!streamCat?.path) return null;
    const dir = streamCat.path;
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
    const mdFiles = fs.readdirSync(dir)
      .filter((f) => /^\d{4}-[WM]\d{2}\.md$/u.test(f) || /^\d{4}-\d{2}-\d{2}\.md$/u.test(f) || /^\d{4}-\d{2}\.md$/u.test(f))
      .sort((a, b) => b.localeCompare(a));
    if (mdFiles.length === 0) return null;
    const fileName = mdFiles[0];
    const absPath = path.join(dir, fileName);
    const content = fs.readFileSync(absPath, "utf8");
    const relPath = path.relative(workspaceRoot, absPath).replace(/\\/g, "/");
    const period = fileName.replace(/\.md$/u, "");
    return { absPath, relPath, period, content };
  } catch {
    return null;
  }
}

/**
 * Activity-window corpus for AI analysis (periods + recently touched + anchors).
 * @param {string} workspaceRoot
 * @param {string} [engineRoot]
 * @param {object} [contract]
 * @returns {{ window: object, corpus: string, primaryPeriod: string|null, fingerprint: string }}
 */
function loadActivityContext(workspaceRoot, engineRoot, contract) {
    const window = resolveActivityWindow({
      workspaceRoot,
      engineRoot,
      contract,
      options: {
        windowDays: 21,
        maxPeriods: 6,
        maxFiles: 30,
        minContentLength: 10, // Lowered from 20 to catch freshly written short entries
        loadContent: true,
      },
    });
  const corpus = buildActivityCorpus(window, { maxChars: 16000 });
  const periods = periodItemsFromWindow(window);
  const primaryPeriod = periods[0]?.period || periods[0]?.relPath || null;
  const fingerprint = createHash("sha1")
    .update(
      window.items
        .map((i) => {
          const contentHash = createHash("sha1").update(i.content || "").digest("hex").slice(0, 8);
          return `${i.relPath}:${i.mtimeMs}:${contentHash}`;
        })
        .join("|"),
    )
    .digest("hex")
    .slice(0, 16);
  return { window, corpus, primaryPeriod, fingerprint };
}

/**
 * Generate suggestions without writing (safe to call on open / manual).
 *
 * When `aiProvider` is supplied, an additional `ai_summary` suggestion is
 * produced — real LLM call over the **activity window** (recent periods ∪
 * mtime-touched notes ∪ append-anchored parents).
 *
 * @param {{ workspaceRoot: string, engineRoot?: string, contract?: object, aiProvider?: AiProvider, force?: boolean }} opts
 * @returns {Promise<Suggestion[]>}
 */
export async function generateSuggestions({ workspaceRoot, engineRoot, contract, aiProvider, force = false, localeOverride }) {
  const resolved = contract || loadContract(workspaceRoot);
  const locale = resolveLocale(resolved, localeOverride);
  const L = SUGGEST_L10N[locale] || SUGGEST_L10N.zh;
  /** @type {Suggestion[]} */
  const out = [];

  // Manual force: drop durable + memory fingerprints so AI re-analyzes honestly
  if (force === true) {
    clearSuggestFingerprints(workspaceRoot, lastAnalyzedHash);
  }

  // Profile exists?
  ensureMemoryPlane(workspaceRoot);
  const profileRel = "memory/profile.md";
  const profileAbs = path.join(workspaceRoot, profileRel);
  if (!fs.existsSync(profileAbs) || fs.statSync(profileAbs).size < 40) {
    out.push({
      id: "open-profile",
      kind: "open_profile",
      title: L.openProfileTitle,
      summary: L.openProfileSummary,
      targetPath: profileRel,
      impact: "low",
      payload: { action: "open" },
    });
  }

  let lifecycle;
  try {
    lifecycle = scanLifecycle({ workspaceRoot, contract: resolved, engineRoot });
  } catch {
    lifecycle = { inboxReview: [], catchAllCleanup: [], staleTopics: [], streamDigest: [] };
  }

  for (const item of (lifecycle.inboxReview || []).slice(0, 8)) {
    const abs = typeof item === "string" ? item : item.path || item.relativePath;
    if (!abs) continue;
    const rel = path.isAbsolute(abs) ? path.relative(workspaceRoot, abs).replace(/\\/g, "/") : abs;
    out.push({
      id: `inbox-${rel}`,
      kind: "inbox_review",
      title: L.inboxReviewTitle,
      summary: L.inboxReviewSummary(rel),
      targetPath: rel,
      impact: "high",
      payload: { path: rel, action: "archive" },
    });
  }

  // ── AI-powered inbox organize: suggest moving inbox items to topics ─────
  // When AI is available, analyze each inbox item and suggest either:
  // 1. Move to an existing topic (when content matches)
  // 2. Create a new topic under a suitable category and move there
  // Rule-based fallback: when inbox has ≥3 items, suggest batch organize.
  try {
    const model = resolveWorkspaceModel({ workspaceRoot, engineRoot, config: resolved });
    const inboxCat = model.categories.find((c) => c.role === "buffer");
    if (inboxCat?.directory) {
      const inboxDir = path.join(workspaceRoot, inboxCat.directory);
      if (fs.existsSync(inboxDir) && fs.statSync(inboxDir).isDirectory()) {
        const inboxFiles = fs.readdirSync(inboxDir)
          .filter((f) => f.endsWith(".md") && !f.startsWith("."))
          .map((f) => {
            const abs = path.join(inboxDir, f);
            const rel = path.relative(workspaceRoot, abs).replace(/\\/g, "/");
            let content = "";
            try {
              content = fs.readFileSync(abs, "utf8").slice(0, 2000);
            } catch { /* ignore */ }
            return { name: f, abs, rel, content };
          })
          .filter((f) => f.content.trim().length > 20);

        if (inboxFiles.length > 0) {
          // Collect existing topics for matching
          const existingTopics = [];
          for (const cat of model.categories) {
            if (cat.role !== "deep-work" || !cat.directory) continue;
            const catDir = path.join(workspaceRoot, cat.directory);
            if (!fs.existsSync(catDir)) continue;
            for (const sub of fs.readdirSync(catDir)) {
              const subPath = path.join(catDir, sub);
              if (fs.statSync(subPath).isDirectory()) {
                existingTopics.push({
                  category: cat.directory,
                  topic: sub,
                  relPath: path.relative(workspaceRoot, subPath).replace(/\\/g, "/"),
                });
              }
            }
          }

          let aiOrganized = false;
          if (aiProvider && typeof aiProvider.generate === "function" && inboxFiles.length >= 1) {
            // AI: analyze inbox items and suggest topic placement
            const fingerprint = createHash("sha1")
              .update(inboxFiles.map((f) => `${f.rel}:${createHash("sha1").update(f.content).digest("hex").slice(0, 8)}`).join("|"))
              .digest("hex")
              .slice(0, 16);
            if (!shouldSkipAiForFingerprint(workspaceRoot, "inbox#organize", fingerprint, lastAnalyzedHash)) {
              try {
                const prompt = buildInboxOrganizePrompt(inboxFiles, existingTopics, locale);
                const aiResult = await aiProvider.generate(prompt, {
                  workspaceRoot,
                  operation: "inbox_organize",
                  period: "inbox-organize",
                  sourcePath: inboxFiles[0].rel,
                });
                const suggestions = parseInboxOrganizeResult(aiResult, inboxFiles, existingTopics, model, locale);
                if (suggestions.length > 0) {
                  for (const sug of suggestions.slice(0, 6)) {
                    out.push(sug);
                  }
                  // Only mark fingerprint when we got useful results —
                  // otherwise allow retry on next refresh
                  markAiFingerprint(workspaceRoot, "inbox#organize", fingerprint, lastAnalyzedHash);
                  aiOrganized = true;
                }
              } catch {
                // AI failed — rule-based fallback below
              }
            }
          }
          if (!aiOrganized && inboxFiles.length >= 3) {
            // Rule-based fallback: suggest batch organize when 3+ items in inbox
            out.push({
              id: "inbox-organize-batch",
              kind: "inbox_organize",
              title: L.inboxOrganizeTitle,
              summary: L.inboxOrganizeSummary(inboxFiles.length),
              targetPath: inboxFiles[0].rel,
              impact: "medium",
              payload: {
                action: "batch_hint",
                files: inboxFiles.map((f) => f.rel),
              },
            });
          }
        }
      }
    }
  } catch {
    /* inbox organize is best-effort — never block other suggestions */
  }

  for (const item of (lifecycle.staleTopics || []).slice(0, 5)) {
    const abs = typeof item === "string" ? item : item.path || item.topicPath || item.relativePath;
    if (!abs) continue;
    const rel = path.isAbsolute(abs) ? path.relative(workspaceRoot, abs).replace(/\\/g, "/") : abs;
    out.push({
      id: `stale-${rel}`,
      kind: "stale_topic",
      title: L.staleTopicTitle,
      summary: L.staleTopicSummary(rel),
      targetPath: rel,
      impact: "high",
      payload: { path: rel, action: "archive" },
    });
  }

  for (const item of (lifecycle.catchAllCleanup || []).slice(0, 5)) {
    const abs = typeof item === "string" ? item : item.path || item.relativePath;
    if (!abs) continue;
    const rel = path.isAbsolute(abs) ? path.relative(workspaceRoot, abs).replace(/\\/g, "/") : abs;
    out.push({
      id: `catchall-${rel}`,
      kind: "catch_all",
      title: L.catchAllTitle,
      summary: L.catchAllSummary(rel),
      targetPath: rel,
      impact: "high",
      payload: { path: rel, action: "archive" },
    });
  }

  for (const item of (lifecycle.streamDigest || []).slice(0, 3)) {
    const period = typeof item === "string" ? item : item.period || item.stem;
    // Never seed payload with "待摘要" placeholders — apply path generates real body
    // or skips write honestly when AI is missing/fails.
    const seedBody =
      item.body && !isPlaceholderOrPolluted(item.body) ? String(item.body) : "";
    out.push({
      id: `digest-${period}`,
      kind: "stream_digest",
      title: L.streamDigestTitle,
      summary: aiProvider
        ? L.streamDigestSummaryAi(period)
        : L.streamDigestSummaryNoAi(period),
      impact: "high",
      payload: { period, body: seedBody },
    });
  }

  // Promotion heuristic: any content under loose-stream / 10-* 动态 dirs
  try {
    /** @type {string[]} */
    let streamDirs = [];
    try {
      const model = resolveWorkspaceModel({ workspaceRoot, engineRoot, config: resolved });
      for (const c of model.categories || []) {
        if (c.role === "loose-stream" && c.directory) {
          streamDirs.push(path.join(workspaceRoot, c.directory));
        }
      }
    } catch {
      /* fall through FS scan */
    }
    if (streamDirs.length === 0) {
      for (const name of fs.readdirSync(workspaceRoot)) {
        if (/^\d{2}[ -].+/.test(name) && /动态|stream|daily|journal/i.test(name)) {
          streamDirs.push(path.join(workspaceRoot, name));
        }
      }
      // fallback: 10-* numbered mid slots often hold stream notes
      if (streamDirs.length === 0) {
        for (const name of fs.readdirSync(workspaceRoot)) {
          if (/^10[ -]/.test(name)) streamDirs.push(path.join(workspaceRoot, name));
        }
      }
    }
    let hasStreamMd = false;
    for (const streamDir of streamDirs) {
      if (fs.existsSync(streamDir) && fs.statSync(streamDir).isDirectory()) {
        const entries = fs.readdirSync(streamDir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isFile() && e.name.endsWith(".md")) {
            hasStreamMd = true;
            break;
          }
          // Also check year subdirectories (yearDir default true)
          if (e.isDirectory() && /^\d{4}$/u.test(e.name)) {
            try {
              const yearFiles = fs.readdirSync(path.join(streamDir, e.name));
              if (yearFiles.some((f) => f.endsWith(".md"))) {
                hasStreamMd = true;
                break;
              }
            } catch {
              /* ignore */
            }
          }
        }
        if (hasStreamMd) break;
      }
    }
    if (hasStreamMd) {
      const day = new Date().toISOString().slice(0, 10);
      // AI: extract from activity window (not only latest period file)
      let promoteEntry = null;
      let promoteSummary = L.promoteMemorySummary;
      if (aiProvider && typeof aiProvider.generate === "function") {
        const ctx = loadActivityContext(workspaceRoot, engineRoot, resolved);
        if (ctx.corpus.length > 40) {
          if (
            shouldSkipAiForFingerprint(
              workspaceRoot,
              "activity#promote",
              ctx.fingerprint,
              lastAnalyzedHash,
            )
          ) {
            promoteEntry = null;
          } else {
            try {
              const extractPrompt = buildMemoryExtractionPrompt(ctx.corpus, locale);
              const aiResult = await aiProvider.generate(extractPrompt, {
                workspaceRoot,
                operation: "memory_extract",
                period: ctx.primaryPeriod,
                sourcePath: "activity-window",
              });
              const { lines } = validateAiOutput(aiResult, "profile-lines", { max: 3, minLen: 4 });
              if (lines.length > 0) {
                const firstLine = lines[0];
                promoteEntry = `- （${day}）${firstLine}`;
                promoteSummary = `AI 提取的记忆候选：${firstLine.slice(0, 80)}${firstLine.length > 80 ? "…" : ""}`;
                markAiFingerprint(
                  workspaceRoot,
                  "activity#promote",
                  ctx.fingerprint,
                  lastAnalyzedHash,
                );
              }
            } catch {
              // AI failed — do not propose a "待填写" pollution entry
            }
          }
        }
      }
      // Without AI: offer open-style hint only when user can fill manually later —
      // never seed durable path with "待填写". With AI: only real extract.
      if (promoteEntry) {
        out.push({
          id: "promote-stream-hint",
          kind: "promote_memory",
          title: L.promoteMemoryTitle,
          summary: promoteSummary,
          impact: "high",
          payload: {
            action: "append_profile",
            section: L.promoteMemorySection,
            entry: { section: L.promoteMemorySection, content: promoteEntry },
          },
        });
      } else if (!aiProvider) {
        out.push({
          id: "promote-stream-hint",
          kind: "open_profile",
          title: L.promoteMemoryTitle,
          summary: locale === "en"
            ? "Recent stream has content. Open your profile to manually capture insights (configure AI for auto-extraction)."
            : "近期动态有内容；可打开「我的情况」手动沉淀（配置 AI 后可自动提取候选）。",
          impact: "low",
          targetPath: "memory/profile.md",
          payload: { action: "open" },
        });
      }
    }
  } catch {
    /* ignore */
  }

  // ── AI-powered suggestion: analyze activity window ─────────────────────
  // Scope = recent periods ∪ mtime-touched notes ∪ append parents (not latest file only).
  if (aiProvider && typeof aiProvider.generate === "function") {
    const ctx = loadActivityContext(workspaceRoot, engineRoot, resolved);
    if (ctx.corpus.length > 40) {
      if (
        shouldSkipAiForFingerprint(
          workspaceRoot,
          "activity#summary",
          ctx.fingerprint,
          lastAnalyzedHash,
        )
      ) {
        // Activity window unchanged since last successful AI pass (memory or durable) — skip thrash
      } else {
        try {
          const label = ctx.primaryPeriod || (locale === "en" ? "Recent Activity" : "近期活动");
          const profileCtx = loadProfileContext(workspaceRoot);
          const reflectionsCtx = loadRecentReflections(workspaceRoot);
          const analysisPrompt = buildPeriodAnalysisPrompt(label, ctx.corpus, locale, profileCtx, reflectionsCtx);
          const aiText = await aiProvider.generate(analysisPrompt, {
            workspaceRoot,
            operation: "period_analysis",
            period: ctx.primaryPeriod,
            sourcePath: "activity-window",
          });
          const usable = validateAiOutput(aiText, "suggest", { minLength: 10 });
          if (usable.ok) {
            markAiFingerprint(
              workspaceRoot,
              "activity#summary",
              ctx.fingerprint,
              lastAnalyzedHash,
            );
            const paths = ctx.window.items.map((i) => i.relPath).slice(0, 8);
            out.push({
              id: `ai-summary-${ctx.primaryPeriod || ctx.fingerprint}`,
              kind: "ai_summary",
              title: locale === "en" ? `AI Analysis: ${label}` : `AI 分析：${label}`,
              summary: truncate(usable.text, 120),
              targetPath: paths[0] || undefined,
              impact: "medium",
              payload: {
                period: ctx.primaryPeriod || label,
                sourcePath: paths[0] || "",
                sourcePaths: paths,
                analysis: usable.text,
                action: "write_digest",
              },
            });
          }
        } catch {
          // AI call failed — rule-based suggestions still work
        }
      }
    }
  }

  return out;
}

/**
 * Process-level hot cache + durable `.topmind/suggest-fingerprints.json`.
 * Cold start: load durable so we do not re-run AI when activity fingerprint unchanged.
 */
const lastAnalyzedHash = new Map();

/**
 * Build a focused prompt for extracting memory-worthy content from a period note.
 * Unlike the full analysis prompt, this extracts specific facts/preferences/goals
 * suitable for direct promotion to memory/profile.
 * @param {string} content
 * @returns {string}
 */
function buildMemoryExtractionPrompt(content, locale = "zh") {
  const trimmed = content.length > 10000 ? content.slice(0, 10000) + (locale === "en" ? "\n...(truncated)" : "\n...（截断）") : content;
  if (locale === "en") {
    return `Extract stable information worth remembering to "My Profile" (memory/profile) from the following recent activity materials.
Note: Topic notes should go under content categories/topic folders — do not treat them as memory topics.

---
${trimmed}
---

Extract 1-3 pieces of stable information worth remembering (preferences, goals, important facts), one per line, using concise declarative sentences.
Rules:
- Output only the extracted content lines — no prefixes, suffixes, thinking process, or explanations
- Do NOT use thinking tags or markdown code fences
- Output in English
- If nothing worth extracting, output nothing`;
  }
  return `请从以下「近期活动窗口」材料中提取值得沉淀到「我的情况」（memory/profile）的稳定信息。
注意：专题笔记应归入内容大类/专题夹，不要当作 memory 主题库。

---
${trimmed}
---

请提取 1-3 条值得记住的稳定信息（偏好、目标、重要事实），每条一行，用简洁的陈述句。
规则：
- 只输出提取的内容行，不要加前缀后缀语、思考过程或解释
- 不要使用 thinking 标签或 markdown 代码围栏
- 用中文输出
- 如果没有值得提取的，不输出任何内容`;
}

/**
 * Load user profile context for AI prompts — gives the AI semantic awareness
 * of the user's existing preferences, goals, and patterns, enabling deeper
 * analysis rather than surface-level extraction.
 * @param {string} workspaceRoot
 * @returns {string} — profile summary (empty string if no profile)
 */
function loadProfileContext(workspaceRoot) {
  try {
    const profilePath = path.join(workspaceRoot, "memory", "profile.md");
    if (!fs.existsSync(profilePath)) return "";
    const content = fs.readFileSync(profilePath, "utf8");
    // Truncate to 3000 chars — enough for the AI to see patterns without bloating prompt
    return content.length > 3000 ? content.slice(0, 3000) + "\n...(截断)" : content;
  } catch {
    return "";
  }
}

/**
 * Load recent periodic reflections for AI context — gives the AI awareness
 * of what insights have already been extracted, enabling it to identify
 * patterns and avoid duplicating prior conclusions.
 * @param {string} workspaceRoot
 * @returns {string} — periodic reflections summary (empty if none)
 */
function loadRecentReflections(workspaceRoot) {
  try {
    const periodicDir = path.join(workspaceRoot, "memory", "periodic");
    if (!fs.existsSync(periodicDir)) return "";
    // Scan both root and year subdirectories
    const reflections = [];
    const entries = fs.readdirSync(periodicDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && /^\d{4}$/u.test(e.name)) {
        const yearDir = path.join(periodicDir, e.name);
        const yearFiles = fs.readdirSync(yearDir)
          .filter((f) => f.endsWith(".md"))
          .sort((a, b) => b.localeCompare(a))
          .slice(0, 2);
        for (const f of yearFiles) {
          const content = fs.readFileSync(path.join(yearDir, f), "utf8");
          reflections.push({ period: f.replace(/\.md$/u, ""), content: content.slice(0, 1500) });
        }
      } else if (e.isFile() && e.name.endsWith(".md")) {
        const content = fs.readFileSync(path.join(periodicDir, e.name), "utf8");
        reflections.push({ period: e.name.replace(/\.md$/u, ""), content: content.slice(0, 1500) });
      }
    }
    if (reflections.length === 0) return "";
    reflections.sort((a, b) => b.period.localeCompare(a.period));
    return reflections.slice(0, 3)
      .map((r) => `### ${r.period}\n${r.content}`)
      .join("\n\n");
  } catch {
    return "";
  }
}

/**
 * Build a focused prompt for AI activity-window analysis.
 * Enhanced with user profile context and recent reflections for deeper
 * semantic analysis — the AI sees not just raw activity but the user's
 * existing patterns, enabling it to identify what's truly new/important.
 * @param {string} period
 * @param {string} content
 * @param {string} [profileContext] — user's existing memory/profile
 * @param {string} [reflectionsContext] — recent periodic reflections
 * @returns {string}
 */
function buildPeriodAnalysisPrompt(period, content, locale = "zh", profileContext = "", reflectionsContext = "") {
  const trimmed = content.length > 16000 ? content.slice(0, 16000) + (locale === "en" ? "\n...(truncated)" : "\n...（截断）") : content;
  const profileSection = profileContext
    ? (locale === "en"
      ? `\n## User Profile Context (existing memory/profile)\n---\n${profileContext}\n---\n`
      : `\n## 用户画像上下文（已有 memory/profile）\n---\n${profileContext}\n---\n`)
    : "";
  const reflectionsSection = reflectionsContext
    ? (locale === "en"
      ? `\n## Recent Reflections (already extracted insights)\n---\n${reflectionsContext}\n---\n`
      : `\n## 近期反思（已提取的洞察）\n---\n${reflectionsContext}\n---\n`)
    : "";
  if (locale === "en") {
    return `Analyze the following "recent activity window" materials (scope label: ${period}) and extract key information.
Materials may include: recent stream period notes, recently modified notes, and originals of appended content.
${profileSection}${reflectionsSection}
---
${trimmed}
---

Analyze the materials in light of the user's existing profile and recent reflections (if provided above).
Identify what is genuinely new, changed, or worth tracking — not just a restatement of what's already known.

Output in the following format (use only Markdown — no prefixes, suffixes, thinking process, or thinking tags; no markdown code fences):

## Key Points
- List 3-5 most important items (prioritize what's new or changed vs. existing profile)

## In Progress
- List items being actively pursued

## Worth Remembering (My Profile)
- Preferences, goals, or important facts not yet in the user's profile (goes to memory/profile or periodic digest — do not write to topic folders as memory store)

## Topic Suggestions (Content Categories)
- Topics worth creating/joining under a content category (suggest a topic name; do not write to memory/topics)`;
  }
  return `请分析以下「近期活动窗口」材料（范围标签：${period}），提取关键信息。
材料可能包含：最近动态周期本、近期修改的笔记、以及对旧文的增补与其原文。
${profileSection}${reflectionsSection}
---
${trimmed}
---

请结合用户已有画像和近期反思（如上方提供）来分析材料。
识别真正新的、有变化的、值得追踪的内容——不要简单复述已有信息。

请按以下格式输出（只用 Markdown，不要加前缀后缀语、思考过程或 thinking 标签，不要使用 markdown 代码围栏）：

## 近期要点
- 列出 3-5 条最重要的内容（优先关注与已有画像相比新增/变化的部分）

## 进行中的事
- 列出正在推进的事项

## 值得记住的（我的情况）
- 偏好、目标或重要事实中尚未写入画像的（进 memory/profile 或周期反思，不要写进专题目录当记忆库）

## 专题建议（内容大类）
- 可能值得在某个内容大类下建立/归入的专题（给出建议专题名，勿写 memory/topics）`;
}

/** Truncate text to maxLen with ellipsis. */
function truncate(text, maxLen) {
  const t = String(text || "").replace(/\n/g, " ").trim();
  return t.length > maxLen ? `${t.slice(0, maxLen - 1)}…` : t;
}

/**
 * Build a prompt for AI inbox organize — suggest topic placement for each item.
 * @param {Array<{name: string, rel: string, content: string}>} inboxFiles
 * @param {Array<{category: string, topic: string, relPath: string}>} existingTopics
 * @returns {string}
 */
function buildInboxOrganizePrompt(inboxFiles, existingTopics, locale = "zh") {
  const fileList = inboxFiles.map((f) => `${locale === "en" ? "### File" : "### 文件"}: ${f.name}\n${locale === "en" ? "Path" : "路径"}: ${f.rel}\n${locale === "en" ? "Content summary" : "内容摘要"}:\n${f.content.slice(0, 500)}`).join("\n\n");
  const topicList = existingTopics.length > 0
    ? (locale === "en" ? `\n## Existing Topics\n${existingTopics.map((t) => `- ${t.category}/${t.topic}`).join("\n")}` : `\n## 已有专题\n${existingTopics.map((t) => `- ${t.category}/${t.topic}`).join("\n")}`)
    : (locale === "en" ? "\n## Existing Topics\n(none)" : "\n## 已有专题\n（暂无专题）");
  if (locale === "en") {
    return `Analyze the following inbox files and suggest the best destination for each.

${topicList}

## Files to Organize
${fileList}

## Requirements
For each file, provide one suggestion. Output strictly as a JSON array (no markdown code fences, no thinking process, no thinking tags, no prefix/suffix):

[
  {
    "file": "filename.md",
    "action": "move_to_topic",
    "category": "category-dir-name",
    "topic": "topic-dir-name",
    "reason": "brief reason"
  },
  {
    "file": "another-file.md",
    "action": "create_topic_and_move",
    "category": "category-dir-name",
    "topic": "new-topic-name (YYYY-topic format)",
    "title": "Topic Title",
    "reason": "brief reason"
  }
]

Notes:
- action must be "move_to_topic" or "create_topic_and_move"
- move_to_topic must use an existing topic
- create_topic_and_move when no suitable existing topic exists
- If file content doesn't fit any topic, don't output a suggestion for that file
- category must be an existing category directory name
- topic name uses YYYY-topic format (e.g., 2025-reading-notes)`;
  }
  return `请分析以下收件箱中的文件，为每个文件建议最合适的去向。

${topicList}

## 待整理文件
${fileList}

## 要求
请为每个文件给出一条建议，严格输出 JSON 数组（不要 markdown 代码围栏、不要思考过程、不要 thinking 标签、不要前缀后缀语）：

[
  {
    "file": "文件名.md",
    "action": "move_to_topic",
    "category": "大类目录名",
    "topic": "专题目录名",
    "reason": "简短理由"
  },
  {
    "file": "另一个文件.md",
    "action": "create_topic_and_move",
    "category": "大类目录名",
    "topic": "新专题名（YYYY-主题格式）",
    "title": "专题标题",
    "reason": "简短理由"
  }
]

注意：
- action 只能是 "move_to_topic" 或 "create_topic_and_move"
- move_to_topic 必须用已有专题
- create_topic_and_move 用于没有合适已有专题时
- 如果文件内容不适合归入任何专题，不要输出该文件的建议
- category 必须是已存在的大类目录名
- topic 名称用 YYYY-主题 格式（如 2025-读书记录）`;
}

/**
 * Parse AI inbox organize result into suggestion objects.
 * Validates that the category exists on disk before emitting a suggestion.
 * @param {string} aiText
 * @param {Array<{name: string, rel: string, content: string}>} inboxFiles
 * @param {Array<{category: string, topic: string, relPath: string}>} existingTopics
 * @param {object} model - resolved workspace model (for category validation)
 * @returns {Suggestion[]}
 */
function parseInboxOrganizeResult(aiText, inboxFiles, existingTopics, model, locale = "zh") {
  const out = [];
  // Build a set of valid category directories for fast lookup
  const validCategories = new Set(
    (model?.categories || [])
      .filter((c) => c.directory && c.role === "deep-work")
      .map((c) => c.directory),
  );
  try {
    // Extract JSON block from response
    const jsonMatch = aiText.match(/```json\s*([\s\S]*?)```/u) || aiText.match(/(\[[\s\S]*\])/u);
    if (!jsonMatch) return out;
    const parsed = JSON.parse(jsonMatch[1].trim());
    if (!Array.isArray(parsed)) return out;

    for (const item of parsed) {
      if (!item.file || !item.action) continue;
      const file = inboxFiles.find((f) => f.name === item.file || f.rel === item.file);
      if (!file) continue;
      const validActions = ["move_to_topic", "create_topic_and_move"];
      if (!validActions.includes(item.action)) continue;
      // Validate category exists on disk
      if (!validCategories.has(item.category)) continue;
      // For move_to_topic: validate the topic actually exists
      if (item.action === "move_to_topic") {
        const exists = existingTopics.some(
          (t) => t.category === item.category && t.topic === item.topic,
        );
        if (!exists) continue;
      }

      const sug = {
        id: `inbox-organize-${file.name}`,
        kind: "inbox_organize",
        title: item.action === "move_to_topic"
          ? (locale === "en" ? `Move to topic: ${item.category}/${item.topic}` : `移入专题：${item.category}/${item.topic}`)
          : (locale === "en" ? `Create topic & move: ${item.category}/${item.topic}` : `新建专题并移入：${item.category}/${item.topic}`),
        summary: truncate(`${file.name} → ${item.category}/${item.topic}${item.reason ? ` · ${item.reason}` : ""}`, 120),
        targetPath: file.rel,
        impact: "medium",
        payload: {
          action: item.action,
          file: file.rel,
          category: item.category,
          topic: item.topic,
          title: item.title || item.topic,
          reason: item.reason || "",
        },
      };
      out.push(sug);
    }
  } catch {
    /* JSON parse failed — return empty */
  }
  return out;
}

/**
 * Build a prompt for AI period reflection generation.
 * Unlike the analysis prompt (which extracts themes), this produces a
 * period reflection suitable for memory/periodic storage.
 * @param {string} period
 * @param {string} content
 * @returns {string}
 */
function buildPeriodDigestPrompt(period, content, locale = "zh") {
  const trimmed = content.length > 8000 ? content.slice(0, 8000) + (locale === "en" ? "\n...(truncated)" : "\n...（截断）") : content;
  if (locale === "en") {
    return `Generate a period reflection for the following period note (${period}).

Not "what happened this week" but "what this week reveals" — focus areas, knowledge & insights, behavioral signals, preference shifts, threads to watch.

---
${trimmed}
---

Output in the following format (use only Markdown — no prefixes, suffixes, thinking process, or thinking tags; no markdown code fences):

## ${period} Period Reflection

### Key Points
- Extract 3-5 most important items

### In Progress
- List items being actively pursued

### Worth Remembering
- List preferences, goals, or important information that may need to be saved to personal memory

### Patterns & Insights
- What recurring themes or behavioral patterns emerge from this period's activity?`;
  }
  return `请为以下周期笔记（${period}）生成一份周期反思。

不是「本周发生了什么」，而是「本周揭示了什么」——关注焦点、知识与见解、行为信号、偏好变化、线索。

---
${trimmed}
---

请按以下格式输出（只用 Markdown，不要加前缀后缀语、思考过程或 thinking 标签，不要使用 markdown 代码围栏）：

## ${period} 周期反思

### 本周要点
- 提取 3-5 条本周最重要的内容

### 进行中的事
- 列出正在推进的事项

### 值得记住的
- 列出可能需要沉淀到个人记忆的偏好、目标或重要信息

### 模式与洞察
- 本周活动中浮现了什么反复出现的主题或行为模式？`;
}

/**
 * Apply a suggestion after user confirm — high-impact writes go through writeback.
 *
 * When `aiProvider` is supplied:
 * - `stream_digest`: AI generates a real period reflection (not placeholder).
 * - `ai_summary`: AI analysis result is written to memory/periodic/.
 * - `promote_memory`: AI can enrich the memory entry with context.
 *
 * @param {{ workspaceRoot: string, suggestion: Suggestion, contract?: object, engineRoot?: string, aiProvider?: AiProvider }} opts
 */
export async function applySuggestion({ workspaceRoot, suggestion, contract, engineRoot, aiProvider, localeOverride }) {
  if (!suggestion || !suggestion.kind) throw new Error("suggestion required");
  const resolved = contract || loadContract(workspaceRoot);
  const locale = resolveLocale(resolved, localeOverride);

  switch (suggestion.kind) {
    case "open_profile": {
      ensureMemoryPlane(workspaceRoot);
      const targetPath = path.join(workspaceRoot, "memory/profile.md");
      if (!fs.existsSync(targetPath)) {
        return executeWrite({
          targetPath,
          content: "---\ntitle: 我的情况\nmemory_layer: global\nprotection: open\n---\n\n# 我的情况\n\n## 偏好\n\n## 当前目标\n\n## 进行中的事\n",
          workspaceRoot,
          contract: resolved,
          operation: "create",
          actor: "user",
          confirmed: true,
          role: "memory",
        });
      }
      return {
        operation: "open",
        wroteFiles: false,
        targetPath: "memory/profile.md",
        note: "open only",
      };
    }
    case "stream_digest": {
      const period = suggestion.payload?.period || "period";
      // When AI is available, generate a real period reflection from the activity window.
      // On missing/failed AI: honest no-write (never dump placeholder text).
      let body = "";
      let derivedFrom = [];
      const seed = suggestion.payload?.body;
      if (seed && !isPlaceholderOrPolluted(seed)) {
        const seedUsable = validateAiOutput(seed, "suggest", { minLength: 8 });
        if (seedUsable.ok) body = seedUsable.text;
      }
      if (aiProvider && typeof aiProvider.generate === "function") {
        const ctx = loadActivityContext(workspaceRoot, engineRoot, resolved);
        const corpus = ctx.corpus.length > 40
          ? ctx.corpus
          : (findLatestPeriodNote(workspaceRoot, engineRoot, resolved)?.content || "");
        if (corpus.length > 40) {
          try {
            const prompt = buildPeriodDigestPrompt(period, corpus, locale);
            const aiDigest = await aiProvider.generate(prompt, {
              workspaceRoot,
              operation: "period_digest",
              period,
              sourcePath: "activity-window",
            });
            const usable = validateAiOutput(aiDigest, "suggest", { minLength: 10 });
            if (usable.ok) {
              body = usable.text;
              derivedFrom = ctx.window.items.map((i) => i.relPath).slice(0, 8);
            }
          } catch {
            // AI failed — leave body as-is; may skip write below
          }
        }
      }
      if (!body || isPlaceholderOrPolluted(body)) {
        return {
          operation: "skip",
          wroteFiles: false,
          ok: false,
          targetPath: `memory/periodic/${period}.md`,
          reason: "no-usable-digest",
          note: "AI 不可用或生成失败：未写入周期反思（避免占位污染）",
        };
      }
      const evidence = writePeriodDigest({
        workspaceRoot,
        period,
        body,
        contract: resolved,
        derivedFrom,
      });
      const wrote = evidence.wroteFiles !== false && evidence.operation !== "skip";
      return {
        operation: wrote ? "promote" : "skip",
        wroteFiles: wrote,
        ok: wrote,
        targetPath: `memory/periodic/${period}.md`,
        writebackMode: "auto",
        writebackEvidence: evidence,
        reason: evidence.reason,
        note: wrote
          ? "周期反思已写入 memory/periodic"
        : evidence.note || "未写入周期反思",
      };
    }
    case "ai_summary": {
      // AI analysis result — write to memory/periodic/ as a derived reflection.
      // Sanitize + reject pollution; never write raw thinking/JSON dumps.
      const period = suggestion.payload?.period || "period";
      const analysisUsable = validateAiOutput(suggestion.payload?.analysis || "", "suggest", { minLength: 10 });
      const sourcePath = suggestion.payload?.sourcePath || "";
      if (!analysisUsable.ok) {
        return {
          operation: "skip",
          wroteFiles: false,
          ok: false,
          targetPath: `memory/periodic/${period}.md`,
          reason: analysisUsable.reason || "no-usable-analysis",
          note: "分析结果不可用或含污染：未写入 memory/periodic",
        };
      }
      const evidence = writePeriodDigest({
        workspaceRoot,
        period,
        body: analysisUsable.text,
        contract: resolved,
        derivedFrom: sourcePath ? [sourcePath] : (suggestion.payload?.sourcePaths || []).slice(0, 8),
      });
      const wrote = evidence.wroteFiles !== false && evidence.operation !== "skip";
      return {
        operation: wrote ? "promote" : "skip",
        wroteFiles: wrote,
        ok: wrote,
        targetPath: `memory/periodic/${period}.md`,
        writebackMode: "auto",
        writebackEvidence: evidence,
        reason: evidence.reason,
        note: wrote ? "AI 分析结果已写入 memory/periodic" : evidence.note,
      };
    }
    case "promote_memory": {
      if (suggestion.payload?.action === "append_profile") {
        const raw = suggestion.payload.entry;
        const entry =
          typeof raw === "string" || raw == null
            ? {
                section: suggestion.payload.section || "进行中的事",
                content: String(raw || "").trim(),
              }
            : {
                ...raw,
                content: sanitizeAiContent(raw.content ?? raw.text ?? raw.body ?? ""),
              };
        if (!entry.content || isPlaceholderOrPolluted(entry.content)) {
          return {
            operation: "skip",
            wroteFiles: false,
            ok: false,
            targetPath: "memory/profile.md",
            reason: "placeholder-or-polluted",
            note: "记忆条目为空或含占位/思考污染：未写入 profile",
          };
        }
        const result = appendProfileEntry({
          workspaceRoot,
          entry,
          contract: resolved,
        });
        const wrote = result.wroteFiles !== false && result.operation !== "skip";
        return {
          operation: wrote ? "promote" : "skip",
          wroteFiles: wrote,
          ok: wrote || result.reason === "duplicate-fact",
          targetPath: result.targetPath || "memory/profile.md",
          writebackMode: result.writebackMode || "auto",
          writebackEvidence: result,
          reason: result.reason,
          note: result.note,
        };
      }
      if (suggestion.payload?.item && suggestion.payload?.target) {
        return promoteStreamItem({
          workspaceRoot,
          item: suggestion.payload.item,
          target: suggestion.payload.target,
          contract: resolved,
        });
      }
      throw new Error("promote_memory payload incomplete");
    }
    case "create_topic": {
      // Content-plane topic under a category — never memory/topics.
      // Sanitize before any mkdir/write (path traversal / outside workspace /
      // system·buffer·delivery·loose-stream roles rejected).
      let placement;
      try {
        placement = sanitizeTopicPlacement({
          workspaceRoot,
          category: suggestion.payload?.category,
          name: suggestion.payload?.name,
          requireCategoryOnDisk: true,
          engineRoot,
          contract: resolved,
        });
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err));
      }
      const { category, name, topicFileRel, absDir, absFile } = placement;
      const title = String(
        suggestion.payload?.title || placement.titleBase || "专题",
      ).trim() || "专题";
      if (fs.existsSync(absFile)) {
        return {
          operation: "create",
          wroteFiles: false,
          ok: true,
          targetPath: topicFileRel,
          note: "专题已存在",
        };
      }
      // mkdir only after sanitize proved path is under workspace + real category
      if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });
      const body = `---
title: ${title}
category: ${category}
topic: ${name}
status: active
source_type: ai-derived
protection: open
---

# ${title}

## 概述

${suggestion.payload?.reason ? `> ${String(suggestion.payload.reason).trim()}\n` : ""}
## 笔记

`;
      const result = executeWrite({
        targetPath: absFile,
        content: body,
        workspaceRoot,
        contract: resolved,
        operation: "create",
        actor: "user",
        confirmed: true,
        role: "deep-work",
      });
      return {
        operation: "create",
        wroteFiles: result.wroteFiles !== false,
        ok: result.wroteFiles !== false,
        targetPath: topicFileRel,
        writebackMode: result.writebackMode || "auto",
        writebackEvidence: result,
        note: "已在内容大类下创建专题",
      };
    }
    case "inbox_organize": {
      // Move an inbox file to an existing topic or create a new topic and move.
      const fileRel = suggestion.payload?.file || suggestion.targetPath;
      if (!fileRel) throw new Error("inbox_organize requires file path");
      const srcAbs = path.isAbsolute(fileRel) ? fileRel : path.join(workspaceRoot, fileRel);
      const srcRel = path.relative(workspaceRoot, srcAbs).replace(/\\/g, "/");
      if (!fs.existsSync(srcAbs)) {
        return { operation: "skip", wroteFiles: false, ok: false, reason: "source-not-found", note: "源文件不存在" };
      }
      const action = suggestion.payload?.action || "batch_hint";
      if (action === "batch_hint") {
        // Rule-based hint — just open the inbox for manual organize
        return { operation: "open", wroteFiles: false, ok: true, targetPath: srcRel, note: "请手动整理或配置 AI 后重新生成建议" };
      }
      const category = suggestion.payload?.category;
      const topicName = suggestion.payload?.topic;
      if (!category || !topicName) {
        return { operation: "skip", wroteFiles: false, ok: false, reason: "missing-target", note: "缺少目标大类或专题名" };
      }
      // Resolve target directory via workspace model (security: path under workspace)
      let targetDir;
      try {
        const placement = sanitizeTopicPlacement({
          workspaceRoot,
          category,
          name: topicName,
          requireCategoryOnDisk: true,
          engineRoot,
          contract: resolved,
        });
        targetDir = placement.absDir;
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      } catch (err) {
        return { operation: "skip", wroteFiles: false, ok: false, reason: "invalid-placement", note: err instanceof Error ? err.message : String(err) };
      }
      // For create_topic_and_move: ensure topic.md exists
      if (action === "create_topic_and_move") {
        const topicFile = path.join(targetDir, "topic.md");
        if (!fs.existsSync(topicFile)) {
          const title = String(suggestion.payload?.title || topicName).trim();
          const body = `---\ntitle: ${title}\ncategory: ${category}\ntopic: ${topicName}\nstatus: active\nsource_type: ai-derived\nprotection: open\n---\n\n# ${title}\n\n## 概述\n\n${suggestion.payload?.reason ? `> ${String(suggestion.payload.reason).trim()}\n` : ""}## 笔记\n\n`;
          executeWrite({
            targetPath: topicFile,
            content: body,
            workspaceRoot,
            contract: resolved,
            operation: "create",
            actor: "user",
            confirmed: true,
            role: "deep-work",
          });
        }
      }
      // Move the file using executeArchive (backup-safe) + executeWrite (create at target)
      const fileName = path.basename(srcAbs);
      const targetAbs = path.join(targetDir, fileName);
      const targetRel = path.relative(workspaceRoot, targetAbs).replace(/\\/g, "/");
      // Read source content, archive source, write to target
      let content;
      try {
        content = fs.readFileSync(srcAbs, "utf8");
      } catch {
        return { operation: "skip", wroteFiles: false, ok: false, reason: "read-failed", note: "读取源文件失败" };
      }
      // Target file collision: if same-name file exists in target, skip to prevent overwrite
      if (fs.existsSync(targetAbs)) {
        return { operation: "skip", wroteFiles: false, ok: false, reason: "target-exists", note: `目标已有同名文件：${targetRel}` };
      }
      const archiveResult = executeArchive({
        targetPath: srcAbs,
        workspaceRoot,
        contract: resolved,
        actor: "user",
        confirmed: true,
      });
      if (archiveResult.pending) {
        return { operation: "skip", wroteFiles: false, ok: false, reason: "archive-pending", note: "归档源文件需确认", pending: true, needsConfirm: true };
      }
      const writeResult = executeWrite({
        targetPath: targetAbs,
        content,
        workspaceRoot,
        contract: resolved,
        operation: "create",
        actor: "user",
        confirmed: true,
        role: "deep-work",
      });
      return {
        operation: "move",
        wroteFiles: writeResult.wroteFiles !== false,
        ok: writeResult.wroteFiles !== false,
        targetPath: targetRel,
        sourcePath: srcRel,
        writebackMode: "auto",
        writebackEvidence: writeResult,
        note: `已移入 ${category}/${topicName}`,
      };
    }
    case "inbox_review":
    case "stale_topic":
    case "catch_all":
    case "archive_path": {
      const raw = suggestion.targetPath || suggestion.payload?.path;
      if (!raw) throw new Error(`${suggestion.kind} requires target path`);
      const abs = path.isAbsolute(raw) ? raw : path.join(workspaceRoot, raw);
      const rel = path.relative(workspaceRoot, abs).replace(/\\/g, "/");
      // applySuggestion is only called after user confirm in Desktop strip
      const result = executeArchive({
        targetPath: abs,
        workspaceRoot,
        contract: resolved,
        actor: "user",
        confirmed: true,
      });
      return {
        operation: result.operation || "archive",
        wroteFiles: result.wroteFiles !== false && !result.pending,
        ok: !result.pending && result.wroteFiles !== false,
        targetPath: result.targetPath || rel,
        backupPath: result.backupPath,
        writebackMode: result.writebackMode || "auto",
        writebackEvidence: result,
        note: result.note || "archived via write-gate",
        pending: result.pending,
        needsConfirm: result.needsConfirm,
      };
    }
    default:
      throw new Error(`Unknown suggestion kind: ${suggestion.kind}`);
  }
}

export { scanLifecycle };
