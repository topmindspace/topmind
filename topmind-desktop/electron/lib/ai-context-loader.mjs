/**
 * AI Context Loader — pre-load workspace context for the system prompt.
 *
 * Goal: inject workspace overview, memory profile, and topic context into the
 * system prompt so the AI agent doesn't need 2-3 extra tool calls (list_categories,
 * read profile, read topic.md) just to understand the workspace before acting.
 *
 * All loads are best-effort — failures degrade gracefully (empty string).
 * Content is truncated to stay within token budget.
 */
import path from "node:path";
import fs from "node:fs";
import { resolveDataRoot } from "./path-model.mjs";
import { readText } from "./fs-utils.mjs";
import { logInfo } from "./writeback.mjs";

const PROFILE_MAX_CHARS = 2000;
const TOPIC_MD_MAX_CHARS = 3000;

/**
 * Strip YAML frontmatter for prompt injection (CRLF-safe).
 * Shared by profile + topic.md loaders so Windows period/workspace files
 * do not dump `---` YAML into the agent system prompt.
 * @param {string} content
 * @returns {string} body without frontmatter (may be empty)
 */
export function stripFrontmatterForPrompt(content) {
  const raw = String(content || "");
  // Match opening ---, body, closing ---, optional trailing blank lines (LF or CRLF)
  const stripped = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/u, "");
  return stripped.trim();
}

/**
 * Build a compact workspace overview string for the system prompt.
 * Returns category list with topic counts — one line per category.
 *
 * @param {object} ctx - workspace context
 * @param {string} [ctx.workspaceRoot]
 * @returns {Promise<string>}
 */
export async function loadWorkspaceOverview(ctx) {
  try {
    const root = resolveDataRoot(ctx.workspaceRoot);
    const { resolveWorkspaceModel } = await import("./workspace-model-api.mjs");
    const model = await resolveWorkspaceModel(root);
    const cats = await Promise.all(model.categories
      .filter((c) => c.ok && !c.hidden)
      .map(async (c) => {
        let topicCount = 0;
        try {
          const catDir = path.join(root, c.directory);
          const stat = await fs.promises.stat(catDir);
          if (stat.isDirectory()) {
            const entries = await fs.promises.readdir(catDir, { withFileTypes: true });
            topicCount = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).length;
          }
        } catch { /* ignore */ }
        const parts = [c.directory];
        if (c.role && c.role !== "deep-work") parts.push(`(${c.role})`);
        if (c.specialBehavior) parts.push(`[${c.specialBehavior}]`);
        if (topicCount > 0) parts.push(`${topicCount} 专题`);
        return parts.join(" ");
      }));
    if (cats.length === 0) return "";
    return cats.join("\n");
  } catch {
    return "";
  }
}

/**
 * Load memory/profile.md content (truncated) for the system prompt.
 * Gives the AI user preferences, goals, and ongoing context.
 *
 * @param {object} ctx
 * @param {string} [ctx.workspaceRoot]
 * @returns {Promise<string>}
 */
export async function loadMemoryProfile(ctx) {
  try {
    const root = resolveDataRoot(ctx.workspaceRoot);
    const { resolveMemoryPaths } = await import("./workspace-model-api.mjs");
    const memPaths = await resolveMemoryPaths(root);
    const profileFile = memPaths?.profileFile || "profile.md";
    const memDir = memPaths?.dir || "memory";
    const profilePath = path.join(root, memDir, profileFile);
    const content = await readText(profilePath);
    if (!content || content.trim().length < 20) return "";
    // Strip frontmatter for prompt (AI doesn't need YAML metadata); CRLF-safe
    const body = stripFrontmatterForPrompt(content);
    if (!body) return "";
    return body.length > PROFILE_MAX_CHARS
      ? `${body.slice(0, PROFILE_MAX_CHARS)}…(截断)`
      : body;
  } catch {
    return "";
  }
}

/**
 * Load topic.md content (truncated) when a topicId is active.
 * Gives the AI topic overview, stable memory, and working notes context.
 *
 * @param {object} ctx
 * @param {string} [ctx.workspaceRoot]
 * @param {string} [topicId] - "category/topic-name"
 * @returns {Promise<string>}
 */
export async function loadTopicContext(ctx, topicId) {
  if (!topicId || typeof topicId !== "string" || !topicId.includes("/")) return "";
  try {
    const root = resolveDataRoot(ctx.workspaceRoot);
    const [cat, topic] = topicId.split("/");
    if (!cat || !topic) return "";
    const topicMdPath = path.join(root, cat, topic, "topic.md");
    const content = await readText(topicMdPath);
    if (!content || content.trim().length < 20) return "";
    const body = stripFrontmatterForPrompt(content);
    if (!body) return "";
    return body.length > TOPIC_MD_MAX_CHARS
      ? `${body.slice(0, TOPIC_MD_MAX_CHARS)}…(截断)`
      : body;
  } catch {
    return "";
  }
}

/**
 * Load all context needed for the system prompt in parallel.
 * Returns an object with overview, profile, and topicContext strings.
 *
 * @param {object} ctx
 * @param {string} [topicId]
 * @returns {Promise<{overview: string, profile: string, topicContext: string}>}
 */
export async function loadAiContext(ctx, topicId) {
  const [overview, profile, topicContext] = await Promise.all([
    loadWorkspaceOverview(ctx),
    loadMemoryProfile(ctx),
    loadTopicContext(ctx, topicId),
  ]);
  const loaded = Boolean(overview || profile || topicContext);
  if (loaded) {
    logInfo("ai-context", "loaded workspace context for system prompt", {
      hasOverview: Boolean(overview),
      hasProfile: Boolean(profile),
      hasTopicContext: Boolean(topicContext),
      topicId: topicId || null,
    });
  }
  return { overview, profile, topicContext };
}
