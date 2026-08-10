import { readText } from "../../fs-utils.mjs";
import path from "node:path";
import { splitMarkdownFrontmatter } from "../../frontmatter.mjs";

/**
 * @param {string} absPath
 * @param {'markdown'|'text'} kind
 */
export async function convertPassthrough(absPath, kind) {
  const raw = await readText(absPath);
  const name = path.basename(absPath, path.extname(absPath));
  if (kind === "markdown") {
    const { body, data } = splitMarkdownFrontmatter(raw);
    const title = data?.title ? String(data.title) : name;
    // Keep body only; commit will inject topmind frontmatter (preserve useful body)
    const bodyOrFull = raw.startsWith("---") ? body : raw;
    return {
      markdown: bodyOrFull.trim() ? bodyOrFull : raw,
      title,
      converter: "passthrough",
      warnings: [],
    };
  }
  return {
    markdown: raw,
    title: name,
    converter: "passthrough",
    warnings: [],
  };
}
