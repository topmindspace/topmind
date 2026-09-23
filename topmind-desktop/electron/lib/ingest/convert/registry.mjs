/**
 * Converter registry — policy (preferred engine → fallbacks) + I/O adapters.
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
import { runAnydocToMarkdown } from "../anydoc-sidecar.mjs";
import {
  filterAvailableEngines,
  normalizePreferredConverter,
  resolveConverterChain,
  anydocFormatForKind,
} from "../convert-policy.mjs";

/** @typedef {{ probe: Function, runAnydoc: Function, runMarkitdown: Function, runPandoc: Function }} ConvertAdapters */

/** @type {Partial<ConvertAdapters>|null} */
let testAdapters = null;

/** Tests inject spawn/probe at the I/O edge only. */
export function setConvertAdaptersForTest(partial) {
  testAdapters = partial && typeof partial === "object" ? { ...partial } : null;
}

export function resetConvertAdaptersForTest() {
  testAdapters = null;
}

function adapters() {
  return {
    probe: probeExternalTools,
    runAnydoc: runAnydocToMarkdown,
    runMarkitdown: runMarkitdownToMarkdown,
    runPandoc: runPandocToMarkdown,
    ...(testAdapters || {}),
  };
}

/**
 * @param {{
 *   kind: string,
 *   absPath: string,
 *   preferExternal?: boolean,
 *   preferredConverter?: string,
 *   tools?: object,
 * }} opts
 * @returns {Promise<{ markdown: string, title?: string, converter: string, warnings?: string[] }>}
 */
export async function convertToMarkdown(opts) {
  const { kind, absPath } = opts;
  const preferExternal = opts.preferExternal !== false;
  const preferredConverter = normalizePreferredConverter(opts.preferredConverter, preferExternal);
  const warnings = [];
  const baseName = path.basename(absPath, path.extname(absPath));
  const ext = path.extname(absPath).replace(/^\./u, "").toLowerCase();
  const a = adapters();

  const planned = resolveConverterChain({
    kind,
    preference: preferredConverter,
    preferExternal,
  });

  const tools = opts.tools || (preferExternal && planned.some((e) => e !== "builtin") ? await a.probe() : {});
  const available = {
    anydoc: Boolean(tools?.anydoc?.available),
    markitdown: Boolean(tools?.markitdown?.available),
    pandoc: Boolean(tools?.pandoc?.available),
  };
  const chain = filterAvailableEngines(planned, available);

  for (const engine of chain) {
    if (engine === "anydoc") {
      try {
        const r = await a.runAnydoc(absPath, {
          kind,
          format: anydocFormatForKind(kind, ext),
        });
        return {
          markdown: r.markdown,
          title: r.title || baseName,
          converter: `anydoc@${tools.anydoc?.version || r.version || "local"}`,
          warnings: [...warnings, ...(r.warnings || [])],
        };
      } catch (e) {
        warnings.push(shortWarn(e instanceof Error ? e.message : String(e)));
      }
      continue;
    }
    if (engine === "markitdown") {
      try {
        const r = await a.runMarkitdown(absPath);
        return {
          markdown: r.markdown,
          title: r.title || baseName,
          converter: `markitdown@${tools.markitdown?.version || "local"}`,
          warnings,
        };
      } catch (e) {
        warnings.push(shortWarn(e instanceof Error ? e.message : String(e)));
      }
      continue;
    }
    if (engine === "pandoc") {
      try {
        const r = await a.runPandoc(absPath);
        return {
          markdown: r.markdown,
          title: r.title || baseName,
          converter: `pandoc@${tools.pandoc?.version || "local"}`,
          warnings,
        };
      } catch (e) {
        warnings.push(shortWarn(e instanceof Error ? e.message : String(e)));
      }
      continue;
    }
    if (engine === "builtin") {
      const result = await convertBuiltin(kind, absPath);
      if (warnings.length) {
        result.warnings = [...(result.warnings || []), ...warnings];
      }
      return result;
    }
  }

  if (warnings.length) {
    throw new Error(warnings[0]);
  }
  if (!planned.length) {
    throw new Error(`不支持的类型: ${kind}`);
  }
  throw new Error(`没有可用的转换器处理 ${kind}（可安装 anydoc，或改用已安装的 markitdown / pandoc）`);
}

async function convertBuiltin(kind, absPath) {
  switch (kind) {
    case "markdown":
    case "text":
      return convertPassthrough(absPath, kind);
    case "html":
      return convertHtmlFile(absPath);
    case "docx":
      return convertDocx(absPath);
    case "pdf":
      return convertPdf(absPath);
    case "xlsx":
    case "csv":
      return convertSpreadsheet(absPath, kind);
    case "pptx":
      return convertPptx(absPath);
    case "eml":
      return convertEml(absPath);
    case "msg":
      throw new Error("Outlook .msg 暂不支持纯 JS 转换；请另存为 .eml 或安装 markitdown 后重试");
    default:
      throw new Error(`不支持的类型: ${kind}`);
  }
}

/** Keep external-tool failure notes short for frontmatter / UI. */
function shortWarn(msg) {
  const s = String(msg || "").replace(/\s+/gu, " ").trim();
  return s.length > 200 ? `${s.slice(0, 197)}…` : s;
}
