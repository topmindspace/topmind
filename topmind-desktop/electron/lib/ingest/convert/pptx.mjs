import path from "node:path";
import { promises as fs } from "node:fs";
import JSZip from "jszip";

/**
 * Extract text from pptx (OOXML zip) slide by slide.
 * Pure-JS fallback when markitdown/pandoc unavailable or fail.
 * @param {string} absPath
 */
export async function convertPptx(absPath) {
  if (!JSZip) {
    throw new Error("缺少 jszip 依赖，无法转换 .pptx");
  }

  let buf;
  try {
    buf = await fs.readFile(absPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`无法读取 PPTX 文件: ${msg}`);
  }

  let zip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`PPTX 不是有效的 ZIP/OOXML（可能加密或损坏）: ${msg}`);
  }

  // OOXML uses forward slashes; tolerate accidental backslashes from odd writers.
  const rawKeys = Object.keys(zip.files);
  const toPosix = (n) => n.replace(/\\/gu, "/");
  const names = rawKeys.map(toPosix);
  /** @type {Map<string, string>} posix → original zip key */
  const keyByPosix = new Map();
  for (const k of rawKeys) keyByPosix.set(toPosix(k), k);

  const slideFiles = names
    .filter((n) => {
      const key = keyByPosix.get(n);
      return /^ppt\/slides\/slide\d+\.xml$/iu.test(n) && key && !zip.files[key]?.dir;
    })
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)/iu)?.[1] || 0);
      const nb = Number(b.match(/slide(\d+)/iu)?.[1] || 0);
      return na - nb;
    });

  const resolveZipKey = (posixName) => keyByPosix.get(posixName) || posixName;

  if (!slideFiles.length) {
    // Help diagnose: empty deck vs wrong container
    const hasPpt = names.some((n) => n.startsWith("ppt/"));
    if (!hasPpt) {
      throw new Error("不是有效的 PPTX（包内无 ppt/ 目录）");
    }
    throw new Error("PPTX 中未找到幻灯片（ppt/slides/slideN.xml）");
  }

  const parts = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const key = resolveZipKey(slideFiles[i]);
    const xml = await zip.files[key].async("string");
    const texts = extractAText(xml);
    parts.push(`## 幻灯片 ${i + 1}\n`);
    if (texts.length) parts.push(texts.join("\n\n"));
    else parts.push("_（无文本）_");
    parts.push("");
  }

  // Optional speaker notes
  const noteFiles = names
    .filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/iu.test(n) && !zip.files[n]?.dir)
    .sort((a, b) => {
      const na = Number(a.match(/notesSlide(\d+)/iu)?.[1] || 0);
      const nb = Number(b.match(/notesSlide(\d+)/iu)?.[1] || 0);
      return na - nb;
    });
  if (noteFiles.length) {
    const noteParts = [];
    for (let i = 0; i < noteFiles.length; i++) {
      const key = resolveZipKey(noteFiles[i]);
      const xml = await zip.files[key].async("string");
      const texts = extractAText(xml);
      if (!texts.length) continue;
      noteParts.push(`### 备注 ${i + 1}\n`);
      noteParts.push(texts.join("\n\n"));
      noteParts.push("");
    }
    if (noteParts.length) {
      parts.push("---\n");
      parts.push("## 演讲者备注\n");
      parts.push(...noteParts);
    }
  }

  const markdown = parts.join("\n").trim();
  const name = path.basename(absPath, path.extname(absPath));
  const warnings = [];
  if (markdown.replace(/[#_\s幻灯片\d（无文本）演讲者备注-]/gu, "").length < 20) {
    warnings.push("幻灯片文本很少，复杂版式/图片可能丢失；可安装 markitdown[all] 重试");
  }

  return {
    markdown,
    title: name,
    converter: "pptx-ooxml",
    warnings,
  };
}

/** Pull <a:t> text nodes from OOXML. */
function extractAText(xml) {
  const texts = [];
  const re = /<a:t[^>]*>([^<]*)<\/a:t>/gu;
  let m;
  // Group roughly by paragraph breaks via </a:p>
  const chunks = String(xml || "").split(/<\/a:p>/iu);
  for (const chunk of chunks) {
    const para = [];
    re.lastIndex = 0;
    while ((m = re.exec(chunk)) !== null) {
      const t = decodeXml(m[1]).trim();
      if (t) para.push(t);
    }
    if (para.length) texts.push(para.join(""));
  }
  return texts;
}

function decodeXml(s) {
  return String(s || "")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'");
}
