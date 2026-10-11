import path from "node:path";
import { promises as fs } from "node:fs";

/**
 * Extract text layer from PDF (no OCR).
 * @param {string} absPath
 */
export async function convertPdf(absPath) {
  const name = path.basename(absPath, path.extname(absPath));
  const warnings = [];

  try {
    const unpdf = await import("unpdf");
    const extractText = unpdf.extractText;
    const getDocumentProxy = unpdf.getDocumentProxy;
    if (typeof extractText !== "function") throw new Error("unpdf.extractText missing");
    const data = await fs.readFile(absPath);
    const bytes = new Uint8Array(data);
    const doc =
      typeof getDocumentProxy === "function" ? await getDocumentProxy(bytes) : bytes;
    const result = await extractText(doc, { mergePages: true });
    const text =
      typeof result === "string"
        ? result
        : result?.text != null
          ? Array.isArray(result.text)
            ? result.text.join("\n\n")
            : String(result.text)
          : Array.isArray(result)
            ? result.join("\n\n")
            : "";
    const cleaned = normalizePdfText(String(text || ""));
    if (!cleaned.trim()) {
      throw new Error("PDF 无可提取文本（可能是扫描件）");
    }
    return {
      markdown: cleaned,
      title: name,
      converter: "unpdf",
      warnings: cleaned.length < 80 ? ["提取文本很短，可能是扫描版 PDF"] : warnings,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(msg.includes("扫描") || msg.includes("无可提取") ? msg : `PDF 转换失败: ${msg}`);
  }
}

function normalizePdfText(text) {
  let t = String(text || "")
    .replace(/\r\n/gu, "\n")
    .replace(/\f/gu, "\n\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  // Soft wrap: join hyphenated line breaks
  t = t.replace(/(\w)-\n(\w)/gu, "$1$2");
  return t;
}
