// ── topmind Ingest Pipeline (Kernel 8/8) ───────────────────────────────────
// Authoritative engine for ingest normalization and routing: URL/document/connector
// content normalization, deduplication, tagging, and routing to target locations.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { resolveWorkspaceModel, resolveStreamTarget, findCategoryByRole as findCategoryByRoleFromModel } from "./workspace-model.mjs";
import { buildFrontmatter } from "./yaml-writer.mjs";

/**
 * Normalize and route ingested content to target location.
 * Ingest pipeline only handles post-capture normalization and routing;
 * actual fetching/syncing stays in Surface layer (Extension, connectors).
 *
 * @param {object} options
 * @param {string} options.content - raw content (markdown or HTML)
 * @param {string} options.sourceType - source type (url|document|connector)
 * @param {object} options.metadata - source metadata (url, title, author, etc.)
 * @param {object} options.contract - v4 contract object
 * @param {string} options.workspaceRoot - absolute path to workspace root
 * @param {string} [options.engineRoot] - engine root for template loading
 * @param {string} [options.targetOverride] - override default target (inbox|stream|topic)
 * @returns {object} { targetPath: string|null, appendToPeriod: boolean, periodTarget: object|null, normalized: string, metadata: object }
 */
export function ingestContent({ content, sourceType, metadata, contract, workspaceRoot, engineRoot, targetOverride }) {
  const ingest = contract?.ingest || {};
  const defaultTarget = targetOverride || ingest.default_target || "stream";

  // Normalize content (HTML → Markdown if needed)
  const normalized = normalizeContent(content, sourceType);

  // Deduplicate (check if content already exists)
  const isDuplicate = checkDuplicate(normalized, workspaceRoot);
  if (isDuplicate) {
    return {
      targetPath: null,
      appendToPeriod: false,
      periodTarget: null,
      normalized,
      metadata: { ...metadata, duplicate: true },
    };
  }

  // Route to target
  const route = routeToTarget(defaultTarget, metadata, workspaceRoot, contract, engineRoot);

  // Tag with frontmatter
  const tagged = addFrontmatter(normalized, metadata, sourceType);

  return {
    targetPath: route.targetPath,
    appendToPeriod: route.appendToPeriod,
    periodTarget: route.periodTarget,
    normalized: tagged,
    metadata,
  };
}

/**
 * Normalize content (HTML → Markdown if needed).
 * @param {string} content
 * @param {string} sourceType
 * @returns {string} normalized markdown
 */
function normalizeContent(content, sourceType) {
  // If content is HTML, convert to Markdown
  if (sourceType === "url" && content.trim().startsWith("<")) {
    return htmlToMarkdown(content);
  }
  return content;
}

/**
 * Convert HTML to Markdown using regex-based transformation.
 * Handles common HTML tags; for complex HTML, Surface layer should pre-convert.
 * @param {string} html
 * @returns {string} markdown
 */
function htmlToMarkdown(html) {
  let md = html;

  // Remove script/style tags and their content
  md = md.replace(/<script[\s\S]*?<\/script>/gi, "");
  md = md.replace(/<style[\s\S]*?<\/style>/gi, "");
  md = md.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");

  // Headers
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n");
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n");
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n");

  // Bold / Italic
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");

  // Links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

  // Images
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, "![$2]($1)");
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, "![]($1)");

  // Lists
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (match, content) => {
    return content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
  });
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (match, content) => {
    let i = 1;
    return content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, () => `${i++}. $1\n`);
  });

  // Blockquotes
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (match, content) => {
    return content.trim().split("\n").map((line) => `> ${line}`).join("\n");
  });

  // Code blocks
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, "\n```\n$1\n```\n");
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");

  // Paragraphs and line breaks
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n");
  md = md.replace(/<br\s*\/?>/gi, "\n");
  md = md.replace(/<hr\s*\/?>/gi, "\n---\n");

  // Tables (basic)
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (match, content) => {
    const rows = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(content)) !== null) {
      const cells = [];
      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        cells.push(cellMatch[1].trim());
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length === 0) return "";
    const header = rows[0];
    const separator = header.map(() => "---");
    const body = rows.slice(1);
    return `\n| ${header.join(" | ")} |\n| ${separator.join(" | ")} |\n${body.map((r) => `| ${r.join(" | ")} |`).join("\n")}\n`;
  });

  // Strip remaining HTML tags
  md = md.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  md = md.replace(/&amp;/g, "&");
  md = md.replace(/&lt;/g, "<");
  md = md.replace(/&gt;/g, ">");
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/&nbsp;/g, " ");

  // Clean up excessive whitespace
  md = md.replace(/\n{3,}/g, "\n\n");
  md = md.trim();

  return md;
}

/**
 * Check if content already exists in workspace (deduplication).
 * Uses SHA-256 content hash stored in .topmind/index/content-hashes.json
 * Non-blocking: if .topmind/index/ doesn't exist, skips dedup check (returns false).
 * @param {string} content
 * @param {string} workspaceRoot
 * @returns {boolean}
 */
function checkDuplicate(content, workspaceRoot) {
  const hash = crypto.createHash("sha256").update(content, "utf8").digest("hex");
  const indexDir = path.join(workspaceRoot, ".topmind", "index");
  const hashFile = path.join(indexDir, "content-hashes.json");

  // If index dir doesn't exist, skip dedup — don't force-create machine-state dirs
  if (!fs.existsSync(indexDir)) {
    return false;
  }

  // Load existing hashes
  let hashes = {};
  if (fs.existsSync(hashFile)) {
    try {
      hashes = JSON.parse(fs.readFileSync(hashFile, "utf8"));
    } catch {
      hashes = {};
    }
  }

  // Check if hash exists
  if (hashes[hash]) {
    return true;
  }

  // Store new hash (only if index dir already exists)
  hashes[hash] = {
    first_seen: new Date().toISOString(),
    length: content.length,
  };
  fs.writeFileSync(hashFile, JSON.stringify(hashes, null, 2), "utf8");

  return false;
}

/**
 * Route content to target location based on default target.
 * @param {string} defaultTarget
 * @param {object} metadata
 * @param {string} workspaceRoot
 * @param {object} contract
 * @param {string} [engineRoot] - engine root for template loading
 * @returns {object} { targetPath: string|null, appendToPeriod: boolean, periodTarget: object|null }
 */
/**
 * Public routing helper for Surfaces (Desktop ingest commit, etc.).
 * @param {object} opts
 * @param {"inbox"|"stream"|"topic"} [opts.target]
 * @param {object} [opts.metadata]
 * @param {string} opts.workspaceRoot
 * @param {object} [opts.contract]
 * @param {string} [opts.engineRoot]
 */
export function resolveIngestRoute({
  target = "inbox",
  metadata = {},
  workspaceRoot,
  contract,
  engineRoot,
}) {
  return routeToTarget(target, metadata, workspaceRoot, contract, engineRoot);
}

function routeToTarget(defaultTarget, metadata, workspaceRoot, contract, engineRoot) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const slug = slugify(metadata.title || "untitled");

  switch (defaultTarget) {
    case "inbox": {
      const inboxDir = findCategoryByRole(workspaceRoot, contract, "buffer", engineRoot);
      if (!inboxDir) throw new Error("Inbox category not found");
      return {
        targetPath: path.join(inboxDir, `${timestamp}-${slug}.md`),
        appendToPeriod: false,
        periodTarget: null,
      };
    }
    case "stream": {
      // Stream target: append to current period note (handled by stream-engine)
      // Return null targetPath and let caller use stream-engine to append
      const periodTarget = resolveStreamTarget({ workspaceRoot, engineRoot, config: contract });
      return {
        targetPath: null,
        appendToPeriod: true,
        periodTarget,
      };
    }
    case "topic": {
      const deepWorkDir = findCategoryByRole(workspaceRoot, contract, "deep-work", engineRoot);
      if (!deepWorkDir) throw new Error("Deep-work category not found");
      const topicDir = metadata.topic
        ? path.join(deepWorkDir, metadata.topic)
        : deepWorkDir;
      return {
        targetPath: path.join(topicDir, `${slug}.md`),
        appendToPeriod: false,
        periodTarget: null,
      };
    }
    default:
      throw new Error(`Unknown ingest target: ${defaultTarget}`);
  }
}

/**
 * Add frontmatter to content.
 * @param {string} content
 * @param {object} metadata
 * @param {string} sourceType
 * @returns {string} content with frontmatter
 */
function addFrontmatter(content, metadata, sourceType) {
  const frontmatter = buildFrontmatter({
    title: metadata.title || "Untitled",
    source_type: "external-capture",
    source: metadata.url,
    author: metadata.author,
    captured_at: new Date().toISOString(),
  });

  return `${frontmatter}\n${content}`;
}

/**
 * Slugify title for filename.
 * @param {string} title
 * @returns {string}
 */
function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

/**
 * Find category directory by role using workspace-model.
 * @param {string} workspaceRoot
 * @param {object} contract
 * @param {string} role
 * @param {string} [engineRoot] - engine root for template loading
 * @returns {string|null}
 */
function findCategoryByRole(workspaceRoot, contract, role, engineRoot) {
  const model = resolveWorkspaceModel({ workspaceRoot, engineRoot, config: contract });
  const category = findCategoryByRoleFromModel(model, role);
  return category ? path.join(workspaceRoot, category.directory) : null;
}
