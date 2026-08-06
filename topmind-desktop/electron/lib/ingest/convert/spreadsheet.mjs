import path from "node:path";
import { promises as fs } from "node:fs";
import { readText } from "../../fs-utils.mjs";

/**
 * @param {string} absPath
 * @param {'xlsx'|'csv'} kind
 */
export async function convertSpreadsheet(absPath, kind) {
  const name = path.basename(absPath, path.extname(absPath));

  if (kind === "csv" || path.extname(absPath).toLowerCase() === ".tsv") {
    const raw = await readText(absPath);
    const sep = path.extname(absPath).toLowerCase() === ".tsv" ? "\t" : ",";
    const md = csvToMarkdown(raw, sep);
    return {
      markdown: md || raw,
      title: name,
      converter: "csv",
      warnings: [],
    };
  }

  let XLSX;
  try {
    XLSX = await import("xlsx");
  } catch {
    throw new Error("缺少 xlsx 依赖，无法转换表格");
  }
  const wb = XLSX.readFile
    ? XLSX.readFile(absPath)
    : XLSX.read(await fs.readFile(absPath), { type: "buffer" });
  const sheets = wb.SheetNames || [];
  if (!sheets.length) throw new Error("工作簿无工作表");

  const parts = [];
  for (const sheetName of sheets.slice(0, 20)) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    parts.push(`## ${sheetName}\n`);
    parts.push(rowsToMarkdownTable(rows));
    parts.push("");
  }

  const markdown = parts.join("\n").trim();
  if (!markdown) throw new Error("表格无可提取内容");
  return {
    markdown,
    title: name,
    converter: "xlsx",
    warnings: sheets.length > 20 ? [`仅转换前 20 个工作表（共 ${sheets.length}）`] : [],
  };
}

function csvToMarkdown(raw, sep = ",") {
  const lines = String(raw || "").split(/\r?\n/u).filter((l) => l.length);
  if (!lines.length) return "";
  const rows = lines.map((line) => splitCsvLine(line, sep));
  return rowsToMarkdownTable(rows);
}

function splitCsvLine(line, sep) {
  if (sep === "\t") return line.split("\t");
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
    } else if (c === sep && !inQ) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function rowsToMarkdownTable(rows) {
  if (!Array.isArray(rows) || !rows.length) return "_（空表）_";
  const maxCols = Math.min(
    20,
    rows.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0),
  );
  if (maxCols === 0) return "_（空表）_";
  const norm = rows.slice(0, 500).map((r) => {
    const arr = Array.isArray(r) ? r : [r];
    return Array.from({ length: maxCols }, (_, i) => cell(arr[i]));
  });
  const header = norm[0];
  const body = norm.length > 1 ? norm.slice(1) : [];
  const sep = header.map(() => "---");
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ];
  if (rows.length > 500) lines.push(`\n_… 已截断，共 ${rows.length} 行_`);
  return lines.join("\n");
}

function cell(v) {
  return String(v ?? "")
    .replace(/\|/gu, "\\|")
    .replace(/\r?\n/gu, " ")
    .slice(0, 200);
}
