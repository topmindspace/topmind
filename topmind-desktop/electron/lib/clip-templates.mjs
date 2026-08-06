/**
 * Clip templates (aligned with browser-extension/lib/templates.js).
 * Desktop applies article body templates AFTER html→md conversion.
 */

/** @typedef {{
 *   id: string,
 *   name: string,
 *   matches?: string[],
 *   noteName?: string,
 *   body: string,
 *   properties?: Record<string, string>,
 * }} ClipTemplate */

/** @type {ClipTemplate[]} */
export const BUILTIN_TEMPLATES = [
  {
    id: "article",
    name: "文章正文",
    noteName: "{{title}}",
    body: "{{content}}",
    properties: {
      source_type: "external-capture",
      source: "{{url}}",
      author: "{{author}}",
      site_name: "{{site}}",
      published: "{{published}}",
      fetch_method: "{{mode}}",
    },
  },
  {
    id: "selection",
    name: "选区 / 高亮",
    noteName: "{{title}}",
    body: "{{#if highlights}}{{highlights}}{{else}}> {{selection}}{{/if}}\n\n— [{{title}}]({{url}})",
    properties: {
      source_type: "external-capture",
      source: "{{url}}",
      fetch_method: "selection",
    },
  },
  {
    id: "bookmark",
    name: "书签摘录",
    noteName: "{{title}}",
    body: "{{excerpt}}\n\n{{url}}",
    properties: {
      source_type: "external-capture",
      source: "{{url}}",
      site_name: "{{site}}",
      fetch_method: "bookmark",
    },
  },
  {
    id: "github",
    name: "GitHub",
    matches: ["*://github.com/*/*"],
    noteName: "{{title}}",
    body: "{{content}}",
    properties: {
      source_type: "external-capture",
      source: "{{url}}",
      site_name: "GitHub",
      fetch_method: "{{mode}}",
    },
  },
  {
    id: "zhihu",
    name: "知乎",
    matches: ["*://*.zhihu.com/*", "*://zhihu.com/*"],
    noteName: "{{title}}",
    body: "{{content}}",
    properties: {
      source_type: "external-capture",
      source: "{{url}}",
      author: "{{author}}",
      site_name: "知乎",
      fetch_method: "{{mode}}",
    },
  },
];

export function matchUrlPattern(pattern, url) {
  const p = String(pattern || "").trim();
  if (!p) return false;
  const esc = p
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replace(/\*/gu, ".*");
  try {
    return new RegExp(`^${esc}$`, "iu").test(url);
  } catch {
    return false;
  }
}

/**
 * @param {string} url
 * @param {ClipTemplate[]} [extra]
 * @param {string} [templateId]
 */
export function pickTemplate(url, extra = [], templateId = "") {
  if (templateId) {
    const all = [...extra, ...BUILTIN_TEMPLATES];
    const hit = all.find((t) => t.id === templateId);
    if (hit) return hit;
  }
  const all = [...extra, ...BUILTIN_TEMPLATES];
  for (const t of all) {
    if (!t.matches?.length) continue;
    if (t.matches.some((m) => matchUrlPattern(m, url))) return t;
  }
  return BUILTIN_TEMPLATES.find((t) => t.id === "article") || BUILTIN_TEMPLATES[0];
}

export function renderTemplateString(tpl, vars) {
  let s = String(tpl || "");
  s = s.replace(
    /\{\{#if\s+(\w+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/gu,
    (_, key, yes, no) => {
      const v = vars[key];
      return v && String(v).trim() ? yes : no || "";
    },
  );
  s = s.replace(/\{\{(\w+)\}\}/gu, (_, key) => {
    const v = vars[key];
    return v == null ? "" : String(v);
  });
  return s;
}

/**
 * @param {ClipTemplate} template
 * @param {Record<string, string>} vars
 */
export function applyTemplate(template, vars) {
  const title =
    renderTemplateString(template.noteName || "{{title}}", vars).trim() ||
    vars.title ||
    "capture";
  const body = renderTemplateString(template.body || "{{content}}", vars).trim();
  /** @type {Record<string, string>} */
  const properties = {};
  for (const [k, v] of Object.entries(template.properties || {})) {
    const rendered = renderTemplateString(v, vars).trim();
    if (rendered) properties[k] = rendered;
  }
  properties.clipped_at = vars.clipped_at || new Date().toISOString();
  return { title, body, properties };
}

/**
 * Apply template to already-converted markdown (Bridge article path).
 * @param {string} contentMd
 * @param {object} meta
 * @param {{ templateId?: string, customTemplates?: ClipTemplate[] }} [opts]
 */
export function applyArticleTemplate(contentMd, meta, opts = {}) {
  const url = String(meta.source || meta.url || "");
  const template = pickTemplate(url, opts.customTemplates || [], opts.templateId);
  const vars = {
    title: String(meta.title || ""),
    url,
    author: String(meta.author || ""),
    published: String(meta.published || ""),
    site: String(meta.site_name || meta.siteName || ""),
    content: String(contentMd || ""),
    selection: String(meta.selection || ""),
    highlights: String(meta.highlights || ""),
    excerpt: String(meta.excerpt || ""),
    mode: String(meta.method || meta.mode || "readability"),
    clipped_at: new Date().toISOString(),
  };
  const rendered = applyTemplate(template, vars);
  return {
    title: rendered.title,
    content: rendered.body,
    properties: rendered.properties,
    templateId: template.id,
  };
}
