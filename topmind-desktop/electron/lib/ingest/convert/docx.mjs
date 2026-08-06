import path from "node:path";
import { htmlToMarkdown } from "../../html-to-markdown.mjs";

/**
 * @param {string} absPath
 */
export async function convertDocx(absPath) {
  let mammoth;
  try {
    mammoth = await import("mammoth");
  } catch {
    throw new Error("缺少 mammoth 依赖，无法转换 .docx");
  }
  const convert = mammoth.default?.convertToHtml || mammoth.convertToHtml;
  if (typeof convert !== "function") throw new Error("mammoth API unavailable");

  const result = await convert({ path: absPath });
  const html = result.value || "";
  const messages = (result.messages || []).map((m) => m.message || String(m)).filter(Boolean);
  const md = htmlToMarkdown(html, { alreadyIsolated: true, maxLen: 500_000 });
  const name = path.basename(absPath, path.extname(absPath));
  if (!md.trim()) throw new Error("docx 无可提取正文");
  return {
    markdown: md,
    title: name,
    converter: "mammoth",
    warnings: messages.slice(0, 8),
  };
}
