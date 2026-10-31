export type WritingPlatform = 'wechat' | 'x' | 'text';
export type WritingTheme = 'minimal-ink' | 'tech-blue' | 'newsprint' | 'graphite';
export const WRITING_THEMES: Record<WritingTheme, { ink: string; accent: string; paper: string; muted: string }>;
export const ARTICLE_RENDERER_PROVIDER: Readonly<{ id: string; version: string }>;
export const WRITING_ACTIONS: ReadonlyArray<{ id: string; zh: string; en: string; prompt: string; promptEn: string }>;
export function stripFrontmatter(value: string): string;
export interface ArticleDelivery { platform: WritingPlatform; theme: WritingTheme; html: string; body: string; text: string; checklist: string; images: Array<{ source: string; alt: string; status: string }>; diagnostics: Array<{ code: string; source?: string }> }
export function renderArticle(input: { markdown: string; platform?: WritingPlatform; theme?: WritingTheme; title?: string; images?: Record<string, string> }): ArticleDelivery;
export function resolveArticleImage(sourcePath: string, reference: string): string;
export function prepareArticle(input: { sourcePath: string; markdown: string; platform?: WritingPlatform; theme?: WritingTheme; title?: string }, readImage: (relative: string) => Promise<string>): Promise<ArticleDelivery>;
export interface ArticleResult {
  schemaVersion: 1;
  capabilityId: 'article.render';
  provider: Readonly<{ id: string; version: string }>;
  status: 'ok' | 'warning' | 'error';
  input: { fingerprint: string | null; target?: { platform: WritingPlatform; theme: WritingTheme };
    source?: { relativePath: string; sha256: string };
    imageBytes?: Array<{ relativePath: string; sha256: string }>;
    creationSnapshotFingerprint?: string; localTextTitle?: string | null;
    renderParameters?: { theme: WritingTheme; title: string } };
  artifacts: Array<{ role: 'preview' | 'clipboard-html' | 'source-markdown' | 'image-checklist' | 'local-clipboard-text'; format: string; content: string; sha256: string }>;
  images: ArticleDelivery['images'];
  diagnostics: Array<{ code: string; severity: 'warning' | 'error'; message: string; location?: { source: string } }>;
}
export function renderArticleResult(input?: { markdown?: string; platform?: WritingPlatform; theme?: WritingTheme; title?: string; sourcePath?: string; images?: Record<string, string> }): Promise<ArticleResult>;
export function prepareArticleResult(input: { sourcePath: string; markdown: string; platform?: WritingPlatform; theme?: WritingTheme; title?: string }, readImage: (relative: string) => Promise<string>): Promise<ArticleResult>;
export function prepareArticleResultFromSource(input: { sourcePath: string; sourceBytes: Uint8Array;
  platform?: WritingPlatform; theme?: WritingTheme; title?: string; creationSnapshotFingerprint?: string },
  readImage: (relative: string) => Promise<string>): Promise<ArticleResult>;
export function articleLocalTextDocument(result: ArticleResult): { text_kind: 'platform_text'; title?: string; body: string } | null;
