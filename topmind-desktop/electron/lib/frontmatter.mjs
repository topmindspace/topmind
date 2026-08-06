import yaml from "js-yaml";

export function splitMarkdownFrontmatter(content) {
  const normalized = String(content || "").replace(/\r/g, "");
  if (!normalized.startsWith("---\n")) {
    return { frontMatter: "", body: normalized.replace(/^\n+/, ""), data: {} };
  }

  const closingFenceIndex = normalized.indexOf("\n---", 4);
  if (closingFenceIndex === -1) {
    return { frontMatter: "", body: normalized.replace(/^\n+/, ""), data: {} };
  }

  const fenceEnd = closingFenceIndex + "\n---".length;
  const nextChar = normalized[fenceEnd];
  if (nextChar && nextChar !== "\n") {
    return { frontMatter: "", body: normalized.replace(/^\n+/, ""), data: {} };
  }

  const frontMatter = normalized.slice(4, closingFenceIndex).trim();
  const body = normalized
    .slice(nextChar === "\n" ? fenceEnd + 1 : fenceEnd)
    .replace(/^\n+/, "");

  return { frontMatter, body, data: parseYamlFrontmatter(frontMatter) };
}

function parseYamlFrontmatter(frontMatter) {
  if (!String(frontMatter || "").trim()) return {};
  return yaml.load(frontMatter, { schema: yaml.CORE_SCHEMA }) || {};
}

export function stringifyYamlFrontmatter(data) {
  return yaml.dump(data, { lineWidth: -1, noRefs: true, flowLevel: 1, quotingType: '"', forceQuotes: true }).trim();
}

/** Inject frontmatter fields into markdown content, preserving existing fields. */
export function injectFrontmatter(content, fields) {
  const { frontMatter, body, data } = splitMarkdownFrontmatter(content);
  const merged = { ...data, ...fields };
  const yamlStr = stringifyYamlFrontmatter(merged);
  return `---\n${yamlStr}\n---\n\n${body}`;
}
