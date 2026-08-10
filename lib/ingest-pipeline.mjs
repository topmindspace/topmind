// ── topmind Ingest Pipeline (Kernel 8/8) ───────────────────────────────────
// Authoritative engine for ingest routing: resolves target location for
// captured content (inbox / stream / topic). HTML→Markdown conversion and
// content fetching stay in Surface layer (Desktop html-to-markdown.mjs,
// Extension Readability) — Kernel does not maintain a second converter.

import path from "node:path";
import { resolveWorkspaceModel, resolveStreamTarget, findCategoryByRole as findCategoryByRoleFromModel } from "./workspace-model.mjs";

/**
 * Public routing helper for Surfaces (Desktop ingest commit, etc.).
 * Resolves where ingested content should be placed in the workspace.
 *
 * @param {object} opts
 * @param {"inbox"|"stream"|"topic"} [opts.target] - default "inbox"
 * @param {object} [opts.metadata] - source metadata (title, url, topic, etc.)
 * @param {string} opts.workspaceRoot
 * @param {object} [opts.contract]
 * @param {string} [opts.engineRoot]
 * @returns {{ targetPath: string|null, appendToPeriod: boolean, periodTarget: object|null }}
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

/**
 * Route content to target location based on default target.
 * @param {string} defaultTarget
 * @param {object} metadata
 * @param {string} workspaceRoot
 * @param {object} contract
 * @param {string} [engineRoot] - engine root for template loading
 * @returns {object} { targetPath: string|null, appendToPeriod: boolean, periodTarget: object|null }
 */
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
