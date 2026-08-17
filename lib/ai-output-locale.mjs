// ── topmind AI output-language resolver (pure, no I/O) ─────────────────────
// Shared by Kernel engines and Desktop prompt builders.
//
// 3-tier policy for user-visible / workspace-durable model text:
//   1. Explicit language request in the user turn
//   2. Script of the material being transformed (edited span > whole source)
//   3. Workspace locale from topmind.yaml (`workspace.locale` / `locale`), then zh
//
// UI chrome locale is NOT a tier. Do not pass settings.ui.locale here.

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/u;
const LATIN_CHAR_RE = /[A-Za-z]/u;

const EXPLICIT_EN = [
  /用(?:英|英文|英语)(?:来)?(?:写|回复|输出|翻译|回答|润色|改写)?/u,
  /(?:请|帮我)?(?:翻译|改写|润色|回复|输出)(?:成|为|到)\s*英(?:文|语)/u,
  /英文(?:写|回复|输出|版)/u,
  /(?:translate|write|reply|answer|output|respond|rewrite|polish)\s+(?:this\s+)?(?:in|into|to)\s+english\b/iu,
  /\bin\s+english\b/iu,
  /translate\s+to\s+en(?:glish)?\b/iu,
];

const EXPLICIT_ZH = [
  /用(?:中文|汉语|简体(?:中文)?)(?:来)?(?:写|回复|输出|翻译|回答|润色|改写)?/u,
  /(?:请|帮我)?(?:翻译|改写|润色|回复|输出)(?:成|为|到)\s*(?:中文|汉语|简体)/u,
  /中文(?:写|回复|输出|版)/u,
  /(?:translate|write|reply|answer|output|respond|rewrite|polish)\s+(?:this\s+)?(?:in|into|to)\s+(?:chinese|zh|mandarin|simplified chinese)\b/iu,
  /\bin\s+(?:chinese|zh-cn|mandarin)\b/iu,
  /translate\s+to\s+(?:zh|chinese)\b/iu,
];

/**
 * Strip fences, URLs, inline code, and YAML frontmatter so script detection
 * is not skewed by metadata or pasted links.
 * @param {string} text
 * @returns {string}
 */
export function stripNoiseForScriptDetect(text) {
  return String(text || "")
    .replace(/^---[\s\S]*?\n---/u, " ")
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`[^`]+`/gu, " ")
    .replace(/https?:\/\/\S+/giu, " ")
    .replace(/\b[\w.+-]+@[\w.-]+\.\w+\b/gu, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/gu, " ")
    .replace(/\[[^\]]*\]\([^)]+\)/gu, " ");
}

/**
 * Cheap script heuristic: CJK vs Latin. Mixed text uses majority (CJK weighted).
 * Short / empty / noise-only → null (caller falls through).
 * @param {string} [text]
 * @returns {"zh"|"en"|null}
 */
export function detectSourceScript(text) {
  const cleaned = stripNoiseForScriptDetect(text);
  if (!cleaned.trim()) return null;

  let cjk = 0;
  let latin = 0;
  for (const ch of cleaned) {
    if (CJK_RE.test(ch)) cjk += 1;
    else if (LATIN_CHAR_RE.test(ch)) latin += 1;
  }

  if (cjk < 2 && latin < 8) return null;
  if (cjk === 0) return latin >= 8 ? "en" : null;
  if (latin === 0) return cjk >= 2 ? "zh" : null;
  // CJK is denser; weight so a Chinese sentence with a few English tokens stays zh.
  return cjk * 2 >= latin ? "zh" : "en";
}

/**
 * Extract an explicit language ask from the user turn.
 * UI language is not a request. Bare "translate" without a target is not a request.
 * @param {string} [userText]
 * @returns {"zh"|"en"|null}
 */
export function extractExplicitLanguageRequest(userText) {
  const t = String(userText || "").trim();
  if (!t) return null;
  for (const re of EXPLICIT_EN) {
    if (re.test(t)) return "en";
  }
  for (const re of EXPLICIT_ZH) {
    if (re.test(t)) return "zh";
  }
  return null;
}

/**
 * Workspace locale fallback only. `auto` / missing → zh.
 * @param {object} [contract]
 * @param {string} [workspaceLocale]
 * @returns {"zh"|"en"}
 */
export function resolveWorkspaceOutputLocale(contract, workspaceLocale) {
  const raw = workspaceLocale || contract?.workspace?.locale || contract?.locale || "zh-CN";
  if (!raw || raw === "auto") return "zh";
  return String(raw).startsWith("en") ? "en" : "zh";
}

/**
 * Host UI locale for product AI (Desktop settings.ui.locale / Obsidian
 * localeOverride or app language). `auto` / empty → not set.
 * Desktop and Obsidian are alternate hosts, not a stacked list.
 * @param {string} [tag]
 * @returns {"zh"|"en"|null}
 */
export function normalizeSurfaceUiLocale(tag) {
  if (tag == null || tag === "" || tag === "auto") return null;
  return String(tag).startsWith("en") ? "en" : "zh";
}

/**
 * Product AI (suggestion cards, todo extract/maintain, ops suggestion text).
 * Explicit request → host UI locale → workspace locale.
 * Source-document language is not a tier here — these are app-facing generations.
 *
 * @param {{
 *   userText?: string,
 *   uiLocale?: string,
 *   contract?: object,
 *   workspaceLocale?: string,
 * }} [opts]
 * @returns {"zh"|"en"}
 */
export function resolveProductAiLanguage(opts = {}) {
  const explicit = extractExplicitLanguageRequest(opts.userText);
  if (explicit) return explicit;
  const ui = normalizeSurfaceUiLocale(opts.uiLocale);
  if (ui) return ui;
  return resolveWorkspaceOutputLocale(opts.contract, opts.workspaceLocale);
}

/**
 * 3-tier output language for user-visible / durable model text.
 *
 * @param {{
 *   userText?: string,
 *   sourceText?: string,
 *   editedSpan?: string,
 *   contract?: object,
 *   workspaceLocale?: string,
 * }} [opts]
 * @returns {"zh"|"en"}
 */
export function resolveOutputLanguage(opts = {}) {
  const explicit = extractExplicitLanguageRequest(opts.userText);
  if (explicit) return explicit;

  const fromSpan = detectSourceScript(opts.editedSpan);
  if (fromSpan) return fromSpan;

  const fromSource = detectSourceScript(opts.sourceText);
  if (fromSource) return fromSource;

  return resolveWorkspaceOutputLocale(opts.contract, opts.workspaceLocale);
}

/**
 * Pick the document being processed for Agent-turn language resolution.
 * Only the focused / user-mounted note counts. Profile, overview, and
 * preloaded topic.md are chrome context — they must not become source.
 *
 * @param {{
 *   focusPath?: string,
 *   mountedFiles?: Array<{ name?: string, path?: string, content?: string }>,
 *   profile?: string,
 *   overview?: string,
 *   topicContext?: string,
 *   memoryProfile?: string,
 * }} [opts]
 * @returns {{ editedSpan: string, sourceText: string }}
 */
export function pickDocumentSourceForOutputLanguage(opts = {}) {
  void opts.profile;
  void opts.overview;
  void opts.topicContext;
  void opts.memoryProfile;

  const files = Array.isArray(opts.mountedFiles) ? opts.mountedFiles : [];
  const focusPath = typeof opts.focusPath === "string" ? opts.focusPath.trim() : "";
  const contentOf = (f) => String(f?.content ?? "");
  const nameOf = (f) => String(f?.name || f?.path || "");

  if (focusPath) {
    const hit = files.find((f) => {
      const n = nameOf(f);
      return n === focusPath || n.endsWith(focusPath);
    });
    if (hit && contentOf(hit).trim()) {
      const body = contentOf(hit);
      return { editedSpan: body, sourceText: body };
    }
  }

  const withBody = files.filter((f) => contentOf(f).trim());
  if (withBody.length === 0) return { editedSpan: "", sourceText: "" };
  if (withBody.length === 1) {
    const body = contentOf(withBody[0]);
    return { editedSpan: body, sourceText: body };
  }
  return {
    editedSpan: "",
    sourceText: withBody.map(contentOf).join("\n"),
  };
}

/**
 * Agent / invoke 3-tier entry: pick focus/mounted note, then resolve.
 * Inline complete may pass editedSpan/sourceText directly (the selection / file).
 * Extra profile/overview fields are ignored even if supplied.
 *
 * @param {{
 *   userText?: string,
 *   editedSpan?: string,
 *   sourceText?: string,
 *   focusPath?: string,
 *   mountedFiles?: Array<{ name?: string, path?: string, content?: string }>,
 *   contract?: object,
 *   workspaceLocale?: string,
 *   profile?: string,
 *   overview?: string,
 *   topicContext?: string,
 *   memoryProfile?: string,
 * }} [opts]
 * @returns {"zh"|"en"}
 */
export function resolveAgentOutputLanguage(opts = {}) {
  const hasDirect =
    String(opts.editedSpan || "").trim() || String(opts.sourceText || "").trim();
  const picked = hasDirect
    ? { editedSpan: opts.editedSpan || "", sourceText: opts.sourceText || "" }
    : pickDocumentSourceForOutputLanguage(opts);
  return resolveOutputLanguage({
    userText: opts.userText,
    editedSpan: picked.editedSpan,
    sourceText: picked.sourceText,
    contract: opts.contract,
    workspaceLocale: opts.workspaceLocale,
  });
}

/**
 * Workspace-locale fallback used by file chrome (todo headings, op labels).
 * The second argument is ignored — it used to be a UI localeOverride force.
 * Document transforms must call `resolveOutputLanguage` with source/user text.
 *
 * @param {object} [contract]
 * @param {string} [_localeOverride]
 * @returns {"zh"|"en"}
 */
export function resolveAiLocale(contract, _localeOverride) {
  void _localeOverride;
  return resolveOutputLanguage({ contract });
}
