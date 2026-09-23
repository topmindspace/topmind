import { promises as fs } from "node:fs";
import path from "node:path";

import { parseFrontmatter } from "./frontmatter.mjs";
import { isValidCategoryName } from "./workspace-context.mjs";

/**
 * v3.5.4 topic structure — sections/articles/entities typed object directories
 * were removed as defaults in v3.5.4. These functions still enumerate files in
 * those directories if they exist (backward compatibility with v2.x workspaces),
 * but new topics should not create them. outline.md / setting.md / style.md
 * default anchor files are also deprecated — if they linger from v2.x,
 * workspace-audit will flag them as drift.
 */

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(targetPath) {
  try {
    return (await fs.stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

export async function isFile(targetPath) {
  try {
    return (await fs.stat(targetPath)).isFile();
  } catch {
    return false;
  }
}

export function workspaceRelative(targetPath, workspaceRoot) {
  return path.relative(workspaceRoot, targetPath).split(path.sep).join("/");
}

function isMemoFile(targetPath) {
  return path.basename(targetPath, ".md").endsWith("-memo");
}

function isTemplateEntity(targetPath) {
  const parts = targetPath.split(path.sep);
  return path.basename(targetPath).startsWith("_")
    || path.basename(targetPath) === "template.md"
    || parts.some((part) => part.startsWith("_") || part === "template");
}

export async function fileInfo(targetPath, workspaceRoot, kind) {
  const stat = await fs.stat(targetPath);
  return {
    relativePath: workspaceRelative(targetPath, workspaceRoot),
    name: path.basename(targetPath),
    kind,
    sizeBytes: stat.size,
    updatedAt: stat.mtime.toISOString().replace(/\.\d{3}Z$/u, "+00:00"),
  };
}

async function listMarkdownFiles(root, {
  includeMemos = true,
  includeTemplates = true,
} = {}) {
  const files = [];
  if (!await isDirectory(root)) return files;

  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (!entry.isFile() || path.extname(entry.name) !== ".md") continue;
      if (!includeMemos && isMemoFile(entryPath)) continue;
      if (!includeTemplates && isTemplateEntity(entryPath)) continue;
      files.push(entryPath);
    }
  }

  await walk(root);
  files.sort(compareStrings);
  return files;
}

export async function walkMarkdown(root, workspaceRoot, kind, options = {}) {
  const files = await listMarkdownFiles(root, options);
  return Promise.all(files.map((file) => fileInfo(file, workspaceRoot, kind)));
}

// ── v3.2 category / topic readers ──────────────────────────────────────────

/**
 * v3.2 topic home file (`topic.md`). Optional — missing is not an error.
 */
export async function topicHomeFiles(topicRootDir, workspaceRoot) {
  const topicFile = path.join(topicRootDir, "topic.md");
  if (!await isFile(topicFile)) return [];
  return [await fileInfo(topicFile, workspaceRoot, "home")];
}

/**
 * Topic memos (sections/ + articles/ *-memo.md sidecars from v2.x).
 * Retained for backward compatibility — new topics should not create these.
 */
export async function topicMemoFiles(topicRootDir, workspaceRoot) {
  const roots = [path.join(topicRootDir, "articles"), path.join(topicRootDir, "sections")];
  const files = [];
  for (const root of roots) {
    const markdown = await listMarkdownFiles(root);
    for (const file of markdown.filter(isMemoFile)) {
      files.push(await fileInfo(file, workspaceRoot, "memo"));
    }
  }
  files.sort((left, right) => compareStrings(left.relativePath, right.relativePath));
  return files;
}

/**
 * Topic structured files: sections / articles / memos / entities.
 * These typed object directories were removed as defaults in v3.5.4.
 * Functions retained for backward compat — enumerate files if dirs exist.
 */
export async function topicStructuredFiles(topicRootDir, workspaceRoot) {
  return {
    sections: await walkMarkdown(path.join(topicRootDir, "sections"), workspaceRoot, "section", { includeMemos: false }),
    articles: await walkMarkdown(path.join(topicRootDir, "articles"), workspaceRoot, "article", { includeMemos: false }),
    memos: await topicMemoFiles(topicRootDir, workspaceRoot),
    entities: await walkMarkdown(path.join(topicRootDir, "entities"), workspaceRoot, "entity", { includeTemplates: false }),
  };
}

async function statSafe(targetPath) {
  try {
    return await fs.stat(targetPath);
  } catch {
    return null;
  }
}

export function compareStrings(left, right) {
  const leftValue = String(left);
  const rightValue = String(right);
  if (leftValue < rightValue) return -1;
  if (leftValue > rightValue) return 1;
  return 0;
}

export async function ensureDir(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}
