/** Portable host renderer. Canonical source: topmind-writing-skills. No IO or executable HTML. */
import { sha256, sha256Bytes } from './content-sha256.mjs';
export const WRITING_THEMES = Object.freeze({
  'minimal-ink': { ink: '#252525', accent: '#955247', paper: '#ffffff', muted: '#666666' },
  'tech-blue': { ink: '#172033', accent: '#0369a1', paper: '#ffffff', muted: '#536174' },
  newsprint: { ink: '#24211c', accent: '#80502a', paper: '#fffdf8', muted: '#655f55' },
  graphite: { ink: '#222222', accent: '#444444', paper: '#ffffff', muted: '#666666' },
});
/** Version of the renderer's output semantics, independent from the npm package version. */
export const ARTICLE_RENDERER_PROVIDER = Object.freeze({ id: 'topmind-writing-skills/article-renderer', version: '1.1.0' });
export const WRITING_ACTIONS = Object.freeze([
  { id: 'topmind-revise', zh: '改稿', en: 'Revise', prompt: '按 topmind-revise 审校当前内容，保留事实、数字、归因和作者原意。' },
  { id: 'topmind-format', zh: '只排版', en: 'Format', prompt: '按 topmind-format 只调整当前内容的排版，不改写文字。' },
  { id: 'topmind-briefs', zh: '短文', en: 'Brief', prompt: '按 topmind-briefs，基于当前材料写一篇信息清楚的短文。' },
  { id: 'topmind-viral-posts', zh: '互动短帖', en: 'Social post', prompt: '按 topmind-viral-posts，基于当前材料写一条互动短帖。' },
  { id: 'topmind-wechat-post', zh: '公众号', en: 'WeChat', prompt: '按 topmind-wechat-post，基于当前材料完成公众号稿，只出稿不代发。' },
  { id: 'topmind-x-article', zh: 'X 长文', en: 'X Article', prompt: '按 topmind-x-article，基于当前材料完成 X 长文，只出稿不代发。' },
  { id: 'topmind-cover', zh: '封面', en: 'Cover', prompt: '按 topmind-cover，为当前文章制作封面；先核对实际生图能力，缺少工具时说明。' },
  { id: 'topmind-poster', zh: '长图', en: 'Poster', prompt: '按 topmind-poster，为当前内容制作信息长图；先核对实际渲染能力，缺少工具时保留 HTML 并说明。' },
].map(action => ({ ...action, promptEn: `Use ${action.id} for the current document. Preserve source language, facts and author intent. Use only available tools; explain missing image or rendering capabilities. Draft and deliver only; do not publish.` })));
const esc = value => String(value).replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function stripFrontmatter(value) {
  return String(value || '').replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').replace(/^---\n[\s\S]*?\n---(?:\n|$)/u, '');
}
export function resolveArticleImage(sourcePath, reference) {
  if (typeof sourcePath !== 'string' || typeof reference !== 'string'
    || !sourcePath || !reference || /[\\:\u0000-\u001f]|^\//u.test(sourcePath)
    || /[\\:\u0000-\u001f]|^\//u.test(reference)) throw new Error('Invalid workspace image path');
  const parts = [];
  for (const segment of sourcePath.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') { if (!parts.length) throw new Error('Source escapes workspace'); parts.pop(); }
    else parts.push(segment);
  }
  if (!parts.length) throw new Error('Invalid workspace image path');
  parts.pop();
  for (const segment of reference.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') { if (!parts.length) throw new Error('Image escapes workspace'); parts.pop(); }
    else parts.push(segment);
  }
  return parts.join('/');
}
async function collectArticleImages(input, readImage) {
  const images = Object.create(null);
  for (const match of String(input.markdown).matchAll(/!\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/gu)) {
    const source = match[1];
    if (/^(https?:|data:)/iu.test(source) || Object.hasOwn(images, source)) continue;
    const relativePath = resolveArticleImage(input.sourcePath, source);
    try { images[source] = await readImage(relativePath); }
    catch { images[source] = ''; }
  }
  return images;
}
export async function prepareArticle(input, readImage) {
  const images = await collectArticleImages(input, readImage);
  return renderArticle({ ...input, images });
}
function safeUrl(value, image = false) {
  const url = String(value || '').trim();
  if (/[\u0000-\u0020\u007f<>"']/u.test(url)) return null;
  if (/^https?:\/\//iu.test(url)) return url;
  if (!image && /^(mailto:|#)/iu.test(url)) return url;
  if (image && /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/iu.test(url)) return url;
  return null;
}
/** Render Markdown without interpreting raw HTML. Local image bytes must be supplied by the host. */
export function renderArticle({ markdown = '', platform = 'wechat', theme = 'minimal-ink', title = '', images = {} } = {}) {
  if (!['wechat', 'x', 'text'].includes(platform)) throw new Error('Unsupported delivery format');
  if (!Object.hasOwn(WRITING_THEMES, theme)) throw new Error('Unknown writing theme');
  const palette = WRITING_THEMES[theme];
  const source = stripFrontmatter(markdown);
  const diagnostics = [];
  const imageList = [];
  const footnotes = [];
  const inline = raw => {
    const stash = [];
    const token = html => { stash.push(html); return `\u0001${stash.length - 1}\u0002`; };
    // Remove control characters so a source cannot impersonate a stash token.
    let value = String(raw).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '');
    value = value.replace(/`([^`]+)`/gu, (_, code) => token(`<code style="font-family:monospace;background:#f1f1f1;padding:2px 4px;">${esc(code)}</code>`));
    value = value.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/gu, (_, alt, src) => {
      const supplied = Object.hasOwn(images, src) ? images[src] : src;
      const url = safeUrl(supplied, true);
      const status = !url ? 'missing' : /^data:/iu.test(url) ? 'embedded' : 'remote';
      imageList.push({ source: src, alt, status });
      if (!url) { diagnostics.push({ code: 'image-unavailable', source: src }); return token(`<span style="color:${palette.muted};">[${esc(alt || src)}]</span>`); }
      return token(`<img src="${esc(url)}" alt="${esc(alt)}" style="max-width:100%;height:auto;display:block;margin:18px auto;" />`);
    });
    value = value.replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/gu, (_, label, rawUrl) => {
      const url = safeUrl(rawUrl);
      if (!url) { diagnostics.push({ code: 'unsafe-link' }); return token(esc(label)); }
      if (platform === 'wechat' && /^https?:/iu.test(url)) {
        footnotes.push(url);
        return token(`${esc(label)}<sup>[${footnotes.length}]</sup>`);
      }
      return token(`<a href="${esc(url)}" style="color:${palette.accent};">${esc(label)}</a>`);
    });
    value = esc(value).replace(/\*\*([^*]+)\*\*/gu, '<strong>$1</strong>').replace(/__([^_]+)__/gu, '<strong>$1</strong>').replace(/(?<!\*)\*([^*]+)\*(?!\*)/gu, '<em>$1</em>').replace(/~~([^~]+)~~/gu, '<s>$1</s>');
    return value.replace(/\u0001(\d+)\u0002/gu, (_, n) => stash[Number(n)] || '');
  };
  const lines = source.split('\n');
  const out = [];
  let paragraph = [];
  const flush = () => { if (paragraph.length) out.push(`<p style="margin:0 0 18px;line-height:1.85;">${inline(paragraph.join('\n')).replace(/\n/gu, '<br />')}</p>`); paragraph = []; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/u.test(line)) {
      flush(); const language = line.trim().slice(3); const code = [];
      while (++i < lines.length && !/^\s*```/u.test(lines[i])) code.push(lines[i]);
      if (i === lines.length) diagnostics.push({ code: 'unclosed-code-fence' });
      out.push(`<section style="font-family:monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f4;padding:14px;margin:18px 0;">${esc(code.join('\n'))}</section>`);
      if (language === 'mermaid') diagnostics.push({ code: 'diagram-source-only' });
    } else if (/^#{1,6}\s/u.test(line)) {
      flush(); const [, marks, text] = line.match(/^(#{1,6})\s+(.*)$/u);
      out.push(`<h${Math.max(2, marks.length)} style="font-size:${marks.length < 3 ? 22 : 18}px;line-height:1.5;margin:28px 0 14px;color:${palette.accent};">${inline(text)}</h${Math.max(2, marks.length)}>`);
    } else if (/^\s*([-*_])(?:\s*\1){2,}\s*$/u.test(line)) {
      flush(); out.push('<hr style="border:0;border-top:1px solid #dddddd;margin:26px 0;" />');
    } else if (/^\s*>/u.test(line)) {
      flush(); const quote = [line.replace(/^\s*>\s?/u, '')];
      while (i + 1 < lines.length && /^\s*>/u.test(lines[i + 1])) quote.push(lines[++i].replace(/^\s*>\s?/u, ''));
      out.push(`<blockquote style="margin:18px 0;padding:10px 16px;border-left:3px solid ${palette.accent};color:${palette.muted};">${inline(quote.join('\n')).replace(/\n/gu, '<br />')}</blockquote>`);
    } else if (/^\s*(?:[-+*]|\d+[.)])\s+/u.test(line)) {
      flush(); const ordered = /^\s*\d/u.test(line); const tag = ordered ? 'ol' : 'ul'; const items = [line];
      const re = ordered ? /^\s*\d+[.)]\s+/u : /^\s*[-+*]\s+/u;
      while (i + 1 < lines.length && re.test(lines[i + 1])) items.push(lines[++i]);
      out.push(`<${tag} style="padding-left:24px;margin:16px 0;">${items.map(item => `<li style="margin:8px 0;line-height:1.8;">${inline(item.replace(re, ''))}</li>`).join('')}</${tag}>`);
    } else if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/u.test(lines[i + 1])) {
      flush(); const cells = row => row.trim().replace(/^\||\|$/gu, '').split('|').map(c => c.trim());
      const head = cells(line); i++; const rows = [];
      while (i + 1 < lines.length && lines[i + 1].trim() && lines[i + 1].includes('|')) rows.push(cells(lines[++i]));
      const row = (values, tag) => `<tr>${values.map(cell => `<${tag} style="border:1px solid #dddddd;padding:8px;text-align:left;">${inline(cell)}</${tag}>`).join('')}</tr>`;
      out.push(`<table style="border-collapse:collapse;width:100%;font-size:14px;margin:20px 0;"><thead>${row(head, 'th')}</thead><tbody>${rows.map(r => row(r, 'td')).join('')}</tbody></table>`);
      if (platform === 'x') diagnostics.push({ code: 'table-paste-check' });
    } else if (/^:::/u.test(line)) {
      flush(); diagnostics.push({ code: 'container-as-text' }); paragraph.push(line);
    } else if (!line.trim()) flush();
    else paragraph.push(line);
  }
  flush();
  if (footnotes.length) out.push(`<section style="font-size:13px;color:${palette.muted};margin-top:28px;">${footnotes.map((url, i) => `<p>[${i + 1}] ${esc(url)}</p>`).join('')}</section>`);
  const text = source.trim();
  const body = `<section style="color:${palette.ink};background:${palette.paper};font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;font-size:16px;line-height:1.85;overflow-wrap:anywhere;">${out.join('\n')}</section>`;
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline';"><title>${esc(title || '文章预览')}</title></head><body style="max-width:720px;margin:0 auto;padding:24px;">${body}</body></html>`;
  const checklist = ['# 图片交付清单', '', '按正文出现顺序核对；内嵌不代表目标平台已托管或发布。', '', ...imageList.map((item, i) => `${i + 1}. ${item.status} · ${item.source.replace(/[\r\n]/gu, ' ')}`)].join('\n');
  return { platform, theme, html, body, text, images: imageList, diagnostics, checklist };
}

const ARTICLE_DIAGNOSTIC_MESSAGES = Object.freeze({
  'image-unavailable': 'Image could not be loaded or embedded.',
  'unsafe-link': 'Unsafe link was removed from the rendered output.',
  'unclosed-code-fence': 'Code fence was not closed.',
  'diagram-source-only': 'Diagram source needs a separate visual render.',
  'table-paste-check': 'Check table layout after pasting into the target editor.',
  'container-as-text': 'Unsupported container was rendered as text.',
  'remote-image-unverified': 'Remote image was referenced but its availability was not verified.',
});
const MAX_BOUND_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_BOUND_IMAGE_BASE64_CHARS = 48 * 1024 * 1024;
function validBoundSourcePath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 2048
    && /\.(?:md|markdown)$/iu.test(value) && !/[\\:\u0000-\u001f]/u.test(value)
    && value.split('/').every(segment => segment && segment !== '.' && segment !== '..');
}
async function embeddedImageBytesSha256(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^data:image\/(?:png|jpe?g|gif|webp);base64,([a-z0-9+/]+={0,2})$/iu);
  if (!match || match[1].length > MAX_BOUND_IMAGE_BASE64_CHARS || typeof atob !== 'function') return null;
  try {
    const binary = atob(match[1]);
    return await sha256Bytes(Uint8Array.from(binary, char => char.charCodeAt(0)));
  } catch {
    return null;
  }
}
function articleInputSnapshot(input, delivery) {
  const images = Object.entries(input.images ?? {})
    .map(([source, value]) => [source, String(value)])
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return {
    markdown: String(input.markdown ?? ''),
    platform: delivery.platform,
    theme: delivery.theme,
    title: String(input.title ?? ''),
    sourcePath: input.sourcePath == null ? null : String(input.sourcePath),
    images,
    provider: ARTICLE_RENDERER_PROVIDER,
  };
}
function articleFailure(error) {
  const message = error instanceof Error ? error.message : '';
  const known = {
    'Unsupported delivery format': ['unsupported-platform', 'Unsupported delivery format.'],
    'Unknown writing theme': ['unknown-theme', 'Unknown writing theme.'],
    'Invalid workspace image path': ['invalid-image-path', 'Image path must remain inside the workspace.'],
    'Source escapes workspace': ['invalid-image-path', 'Image path must remain inside the workspace.'],
    'Image escapes workspace': ['invalid-image-path', 'Image path must remain inside the workspace.'],
    'Invalid workspace source path': ['invalid-source-path', 'Source path must be a canonical workspace-relative Markdown path.'],
    'Invalid source bytes': ['invalid-source-bytes', 'Source must be supplied as UTF-8 bytes.'],
    'Invalid source encoding': ['invalid-source-encoding', 'Source bytes must be valid UTF-8.'],
    'Source too large': ['source-too-large', 'Source exceeds the 16 MiB render limit.'],
    'Invalid creation snapshot fingerprint': ['invalid-snapshot-fingerprint', 'Creation snapshot fingerprint must be SHA-256.'],
    'Invalid article title': ['invalid-title', 'Article title must be a string.'],
    'Unsupported bound renderer option': ['unsupported-render-option', 'Byte-bound rendering accepts only platform, theme and title options.'],
  }[message];
  return {
    schemaVersion: 1,
    capabilityId: 'article.render',
    provider: ARTICLE_RENDERER_PROVIDER,
    status: 'error',
    input: { fingerprint: null },
    artifacts: [],
    images: [],
    diagnostics: [{ code: known?.[0] ?? 'render-failed', severity: 'error', message: known?.[1] ?? 'Article could not be rendered.' }],
  };
}

// Extract a local text fallback only from markup produced by renderArticle.
// It is an estimate for preflight checks, never a target editor readback.
function localClipboardText(html) {
  return html
    .replace(/<img\b[^>]*\/?\s*>/giu, '')
    .replace(/<br\s*\/?\s*>/giu, '\n')
    .replace(/<\/(?:p|h[1-6]|blockquote|li|tr|section|table)>/giu, '\n')
    .replace(/<\/(?:th|td)>/giu, '\t')
    .replace(/<hr\b[^>]*\/?\s*>/giu, '\n')
    .replace(/<[^>]+>/gu, '')
    .replace(/&lt;/gu, '<').replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"').replace(/&#39;/gu, "'")
    .replace(/&amp;/gu, '&')
    .replace(/[\t ]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

/** Prepared local text for a length preflight; the target editor must be checked separately. */
export function articleLocalTextDocument(result) {
  if (result?.status === 'error' || !result?.input?.source) return null;
  const artifact = result.artifacts?.find(item => item.role === 'local-clipboard-text');
  if (artifact?.format !== 'text/plain' || typeof artifact.content !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(artifact.sha256 ?? '')) return null;
  const title = result.input.localTextTitle;
  if (title !== null && typeof title !== 'string') return null;
  return { text_kind: 'platform_text', ...(title === null ? {} : { title }), body: artifact.content };
}
/** Deterministic, machine-readable delivery. The legacy renderArticle shape is unchanged. */
export async function renderArticleResult(input = {}) {
  try {
    const delivery = renderArticle(input);
    const fingerprint = await sha256(JSON.stringify(articleInputSnapshot(input, delivery)));
    const artifacts = await Promise.all([
      { role: 'preview', format: 'text/html', content: delivery.html },
      { role: 'clipboard-html', format: 'text/html', content: delivery.body },
      { role: 'source-markdown', format: 'text/markdown', content: delivery.text },
      { role: 'image-checklist', format: 'text/markdown', content: delivery.checklist },
    ].map(async artifact => ({ ...artifact, sha256: await sha256(artifact.content) })));
    const diagnostics = [
      ...delivery.diagnostics.map(diagnostic => ({
        code: diagnostic.code,
        severity: 'warning',
        message: ARTICLE_DIAGNOSTIC_MESSAGES[diagnostic.code] ?? 'Review the rendered output.',
        ...(diagnostic.source == null ? {} : { location: { source: diagnostic.source } }),
      })),
      ...delivery.images.filter(image => image.status === 'remote').map(image => ({
        code: 'remote-image-unverified',
        severity: 'warning',
        message: ARTICLE_DIAGNOSTIC_MESSAGES['remote-image-unverified'],
        location: { source: image.source },
      })),
    ];
    return {
      schemaVersion: 1,
      capabilityId: 'article.render',
      provider: ARTICLE_RENDERER_PROVIDER,
      status: diagnostics.length ? 'warning' : 'ok',
      input: { fingerprint, target: { platform: delivery.platform, theme: delivery.theme } },
      artifacts,
      images: delivery.images,
      diagnostics,
    };
  } catch (error) {
    return articleFailure(error);
  }
}
/** Load local images through the host, then fingerprint their actual returned data. */
export async function prepareArticleResult(input, readImage) {
  try {
    const images = await collectArticleImages(input, readImage);
    return await renderArticleResult({ ...input, images });
  } catch (error) {
    return articleFailure(error);
  }
}

/**
 * Render exact UTF-8 source bytes supplied by a trusted host. The host compares
 * input.source against the selected Kernel snapshot before using the artifacts.
 */
export async function prepareArticleResultFromSource({
  sourcePath, sourceBytes, creationSnapshotFingerprint, ...options
} = {}, readImage) {
  if (!validBoundSourcePath(sourcePath)) return articleFailure(new Error('Invalid workspace source path'));
  if (!(sourceBytes instanceof Uint8Array)) return articleFailure(new Error('Invalid source bytes'));
  if (sourceBytes.byteLength > MAX_BOUND_SOURCE_BYTES) return articleFailure(new Error('Source too large'));
  if (creationSnapshotFingerprint !== undefined &&
      (typeof creationSnapshotFingerprint !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(creationSnapshotFingerprint))) {
    return articleFailure(new Error('Invalid creation snapshot fingerprint'));
  }
  if (options.title !== undefined && typeof options.title !== 'string') {
    return articleFailure(new Error('Invalid article title'));
  }
  if (Object.keys(options).some(key => !['platform', 'theme', 'title'].includes(key))) {
    return articleFailure(new Error('Unsupported bound renderer option'));
  }
  // Own the bytes before the first await so caller mutation cannot split the
  // hash from the Markdown actually rendered.
  const stableBytes = Uint8Array.from(sourceBytes);
  let markdown;
  try {
    markdown = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(stableBytes);
  } catch {
    return articleFailure(new Error('Invalid source encoding'));
  }
  const source = { relativePath: sourcePath, sha256: await sha256Bytes(stableBytes) };
  const readImages = new Map();
  const trackedReadImage = async relativePath => {
    const dataUrl = await readImage(relativePath);
    const sha256 = await embeddedImageBytesSha256(dataUrl);
    if (sha256) readImages.set(relativePath, sha256);
    return dataUrl;
  };
  const result = await prepareArticleResult({ ...options, sourcePath, markdown }, trackedReadImage);
  if (result.status === 'error') return result;
  const clipboard = result.artifacts.find(item => item.role === 'clipboard-html');
  const localTextArtifact = { role: 'local-clipboard-text', format: 'text/plain',
    content: localClipboardText(clipboard.content) };
  localTextArtifact.sha256 = await sha256(localTextArtifact.content);
  const localTextTitle = options.title ?? null;
  const renderParameters = { theme: result.input.target.theme, title: options.title ?? '' };
  const imageBytes = [...readImages].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([relativePath, sha256]) => ({ relativePath, sha256 }));
  return { ...result, artifacts: [...result.artifacts, localTextArtifact], input: { ...result.input, source,
    imageBytes,
    localTextTitle,
    renderParameters,
    ...(creationSnapshotFingerprint === undefined ? {} : { creationSnapshotFingerprint }),
    fingerprint: await sha256(JSON.stringify({ rendererFingerprint: result.input.fingerprint, source, imageBytes,
      localTextTitle, renderParameters, localTextSha256: localTextArtifact.sha256,
      ...(creationSnapshotFingerprint === undefined ? {} : { creationSnapshotFingerprint }) })) } };
}
