export type WritingPlatform = 'wechat' | 'x' | 'text';
export type WritingTheme = 'minimal-ink' | 'tech-blue' | 'newsprint' | 'graphite';
export const WRITING_THEMES: Record<WritingTheme, { ink: string; accent: string; paper: string; muted: string }>;
export const WRITING_ACTIONS: ReadonlyArray<{ id: string; zh: string; en: string; prompt: string; promptEn: string }>;
export function stripFrontmatter(value: string): string;
export interface ArticleDelivery { platform: WritingPlatform; theme: WritingTheme; html: string; body: string; text: string; checklist: string; images: Array<{ source: string; alt: string; status: string }>; diagnostics: Array<{ code: string; source?: string }> }
export function renderArticle(input: { markdown: string; platform?: WritingPlatform; theme?: WritingTheme; title?: string; images?: Record<string, string> }): ArticleDelivery;
export function resolveArticleImage(sourcePath: string, reference: string): string;
export function prepareArticle(input: { sourcePath: string; markdown: string; platform?: WritingPlatform; theme?: WritingTheme; title?: string }, readImage: (relative: string) => Promise<string>): Promise<ArticleDelivery>;
