import { readText } from "../../fs-utils.mjs";
import { htmlToMarkdown, extractMeta } from "../../html-to-markdown.mjs";
import path from "node:path";

/**
 * @param {string} absPath
 */
export async function convertHtmlFile(absPath) {
  const html = await readText(absPath);
  const meta = extractMeta(html) || {};
  const md = htmlToMarkdown(html, { maxLen: 500_000 });
  const name = path.basename(absPath, path.extname(absPath));
  return {
    markdown: md,
    title: meta.title || name,
    converter: "html-to-markdown",
    warnings: md.trim() ? [] : ["HTML 转换结果为空"],
  };
}
