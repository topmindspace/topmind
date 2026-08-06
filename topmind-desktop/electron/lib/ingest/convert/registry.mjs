/**
 * Converter registry — pure-JS first, optional external tools.
 */
import path from "node:path";
import { convertPassthrough } from "./passthrough-text.mjs";
import { convertHtmlFile } from "./html.mjs";
import { convertDocx } from "./docx.mjs";
import { convertPdf } from "./pdf.mjs";
import { convertSpreadsheet } from "./spreadsheet.mjs";
import { convertPptx } from "./pptx.mjs";
import { convertEml } from "./eml.mjs";
import {
  probeExternalTools,
  runPandocToMarkdown,
  runMarkitdownToMarkdown,
} from "../external-tools.mjs";

/** Formats markitdown / pandoc typically handle well. */
const MARKITDOWN_KINDS = new Set(["docx", "pdf", "xlsx", "csv", "pptx", "html"]);
const PANDOC_KINDS = new Set(["docx", "html", "pptx", "markdown", "text"]);

/**
 * @param {{ kind: string, absPath: string, preferExternal?: boolean }} opts
 * @returns {Promise<{ markdown: string, title?: string, converter: string, warnings?: string[] }>}
 */
export async function convertToMarkdown(opts) {
  const { kind, absPath } = opts;
  const preferExternal = opts.preferExternal !== false;
  const warnings = [];
  const baseName = path.basename(absPath, path.extname(absPath));

  if (preferExternal) {
    const tools = await probeExternalTools();
    if (tools.markitdown?.available && MARKITDOWN_KINDS.has(kind)) {
      try {
        // Invocation (cmd/argv) comes from probe cache — not re-guessed here
        const r = await runMarkitdownToMarkdown(absPath);
        return {
          markdown: r.markdown,
          title: baseName,
          converter: `markitdown@${tools.markitdown.version || "local"}`,
          warnings,
        };
      } catch (e) {
        warnings.push(shortWarn(e instanceof Error ? e.message : String(e)));
      }
    }
    if (tools.pandoc?.available && PANDOC_KINDS.has(kind)) {
      try {
        const r = await runPandocToMarkdown(absPath);
        return {
          markdown: r.markdown,
          title: baseName,
          converter: `pandoc@${tools.pandoc.version || "local"}`,
          warnings,
        };
      } catch (e) {
        warnings.push(shortWarn(e instanceof Error ? e.message : String(e)));
      }
    }
  }

  // Pure-JS path
  let result;
  switch (kind) {
    case "markdown":
    case "text":
      result = await convertPassthrough(absPath, kind);
      break;
    case "html":
      result = await convertHtmlFile(absPath);
      break;
    case "docx":
      result = await convertDocx(absPath);
      break;
    case "pdf":
      result = await convertPdf(absPath);
      break;
    case "xlsx":
    case "csv":
      result = await convertSpreadsheet(absPath, kind);
      break;
    case "pptx":
      result = await convertPptx(absPath);
      break;
    case "eml":
      result = await convertEml(absPath);
      break;
    case "msg":
      throw new Error("Outlook .msg 暂不支持纯 JS 转换；请另存为 .eml 或安装 markitdown 后重试");
    default:
      throw new Error(`不支持的类型: ${kind}`);
  }

  if (warnings.length) {
    result.warnings = [...(result.warnings || []), ...warnings];
  }
  return result;
}

/** Keep external-tool failure notes short for frontmatter / UI. */
function shortWarn(msg) {
  const s = String(msg || "").replace(/\s+/gu, " ").trim();
  return s.length > 200 ? `${s.slice(0, 197)}…` : s;
}
