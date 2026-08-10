/**
 * topmind Clip — slim templates (Obsidian-inspired, topmind frontmatter).
 * Variables: title url author published site content selection highlights clipped_at excerpt
 */

/** @typedef {{
 *   id: string,
 *   name: string,
 *   nameKey?: string,
 *   matches?: string[],
 *   noteName?: string,
 *   body: string,
 *   properties?: Record<string, string>,
 * }} ClipTemplate */

/** @type {ClipTemplate[]} */
export const BUILTIN_TEMPLATES = [
  {
    id: "article",
    name: "Article",
    nameKey: "tpl_article",
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
    name: "Selection / Highlights",
    nameKey: "tpl_selection",
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
    name: "Bookmark",
    nameKey: "tpl_bookmark",
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
    nameKey: "tpl_github",
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
    name: "Zhihu",
    nameKey: "tpl_zhihu",
    matches: ["*://*.zhihu.com/*", "*://zhihu.com/*"],
    noteName: "{{title}}",
    body: "{{content}}",
    properties: {
      source_type: "external-capture",
      source: "{{url}}",
      author: "{{author}}",
      site_name: "Zhihu",
      fetch_method: "{{mode}}",
    },
  },
];

/**
 * Resolve the display name of a template (i18n for built-ins, raw name for user templates).
 * @param {ClipTemplate} template
 * @returns {string}
 */
export function getTemplateName(template) {
  if (template?.nameKey) {
    const msg = chrome.i18n.getMessage(template.nameKey);
    if (msg) return msg;
  }
  return template?.name || template?.id || "";
}

/**
 * @param {string} pattern e.g. *://*.zhihu.com/*
 * @param {string} url
 */
export function matchUrlPattern(pattern, url) {
  const p = String(pattern || "").trim();
  if (!p) return false;
  // Convert simple glob to regex
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
 * @returns {ClipTemplate}
 */
export function pickTemplate(url, extra = [], templateId = "") {
  const all = [...extra, ...BUILTIN_TEMPLATES];
  if (templateId) {
    const hit = all.find((t) => t.id === templateId);
    if (hit) return hit;
  }
  for (const t of all) {
    if (!t.matches?.length) continue;
    if (t.matches.some((m) => matchUrlPattern(m, url))) return t;
  }
  return BUILTIN_TEMPLATES.find((t) => t.id === "article") || BUILTIN_TEMPLATES[0];
}

/**
 * Validate and normalize user template JSON.
 * @param {unknown} raw
 * @returns {{ ok: true, templates: ClipTemplate[] } | { ok: false, error: string }}
 */
export function parseCustomTemplates(raw) {
  let data = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, error: "invalid_json" };
    }
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray(data.templates)
      ? data.templates
      : null;
  if (!list) return { ok: false, error: "expected_array_or_templates" };
  /** @type {ClipTemplate[]} */
  const templates = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.id || "").trim();
    const name = String(item.name || id || "").trim();
    const body = String(item.body || "{{content}}");
    if (!id) continue;
    templates.push({
      id: id.slice(0, 64),
      name: name.slice(0, 80) || id,
      matches: Array.isArray(item.matches)
        ? item.matches.map((m) => String(m)).filter(Boolean).slice(0, 20)
        : undefined,
      noteName: item.noteName ? String(item.noteName) : "{{title}}",
      body,
      properties:
        item.properties && typeof item.properties === "object"
          ? Object.fromEntries(
              Object.entries(item.properties)
                .slice(0, 30)
                .map(([k, v]) => [String(k).slice(0, 40), String(v)]),
            )
          : undefined,
    });
  }
  if (!templates.length) return { ok: false, error: "no_valid_templates" };
  return { ok: true, templates: templates.slice(0, 40) };
}

/** @returns {Promise<ClipTemplate[]>} */
export async function loadCustomTemplates() {
  try {
    const bag = await chrome.storage.local.get("customTemplates");
    const list = bag.customTemplates;
    if (!Array.isArray(list)) return [];
    return list.filter((t) => t && t.id && t.body);
  } catch {
    return [];
  }
}

/** @param {ClipTemplate[]} templates */
export async function saveCustomTemplates(templates) {
  await chrome.storage.local.set({ customTemplates: templates || [] });
}

/**
 * @param {string} tpl
 * @param {Record<string, string>} vars
 */
export function renderTemplateString(tpl, vars) {
  let s = String(tpl || "");
  // Simple {{#if key}}...{{else}}...{{/if}}
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
 * @returns {{ title: string, body: string, properties: Record<string, string> }}
 */
export function applyTemplate(template, vars) {
  const title = renderTemplateString(template.noteName || "{{title}}", vars).trim() || vars.title || "capture";
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
 * Format highlights as markdown blockquotes.
 * @param {{ text: string }[]} highlights
 */
export function formatHighlights(highlights) {
  if (!Array.isArray(highlights) || !highlights.length) return "";
  return highlights
    .map((h) => String(h.text || "").trim())
    .filter(Boolean)
    .map((t) =>
      t
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n"),
    )
    .join("\n\n");
}
