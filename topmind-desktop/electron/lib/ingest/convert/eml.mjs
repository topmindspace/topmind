import path from "node:path";
import { promises as fs } from "node:fs";
import { htmlToMarkdown } from "../../html-to-markdown.mjs";

/**
 * @param {string} absPath
 */
export async function convertEml(absPath) {
  let simpleParser;
  try {
    const mod = await import("mailparser");
    simpleParser = mod.simpleParser || mod.default?.simpleParser;
  } catch {
    throw new Error("缺少 mailparser 依赖，无法转换 .eml");
  }
  if (typeof simpleParser !== "function") throw new Error("mailparser API unavailable");

  const raw = await fs.readFile(absPath);
  const mail = await simpleParser(raw);

  const subject = mail.subject || path.basename(absPath, path.extname(absPath));
  const from = formatAddresses(mail.from);
  const to = formatAddresses(mail.to);
  const date = mail.date ? new Date(mail.date).toISOString() : "";
  const cc = formatAddresses(mail.cc);

  let body = "";
  if (mail.html) {
    body = htmlToMarkdown(String(mail.html), { maxLen: 500_000 });
  } else if (mail.text) {
    body = String(mail.text);
  } else {
    body = "_（无正文）_";
  }

  const header = [
    `# ${subject}`,
    "",
    from ? `- **From**: ${from}` : null,
    to ? `- **To**: ${to}` : null,
    cc ? `- **Cc**: ${cc}` : null,
    date ? `- **Date**: ${date}` : null,
    "",
    "---",
    "",
  ]
    .filter((x) => x !== null)
    .join("\n");

  return {
    markdown: `${header}${body}`.trim(),
    title: subject,
    converter: "mailparser",
    warnings: [],
  };
}

function formatAddresses(field) {
  if (!field) return "";
  const vals = field.value || field;
  if (Array.isArray(vals)) {
    return vals
      .map((a) => {
        if (!a) return "";
        if (typeof a === "string") return a;
        const name = a.name || "";
        const addr = a.address || "";
        return name ? `${name} <${addr}>` : addr;
      })
      .filter(Boolean)
      .join(", ");
  }
  if (typeof field.text === "string") return field.text;
  return String(field);
}
