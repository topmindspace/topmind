/** Types for the shared image rewrite. The implementation is embed-images.mjs. Importers of the .mjs specifier resolve this .d.mts. */

export function isWorkspaceImageName(name: string): boolean;
export function normalizePosixPath(rel: string): string;
export function safeDecodePath(rel: string): string;
export function encodeAssetPath(rel: string): string;
export function localAssetUrl(workspaceRel: string): string;
export function resolveNoteRelativeMedia(noteRelativePath: string, mediaRel: string): string;
export function parseEmbedSuffix(suffix: string): { width?: number; height?: number; caption?: string };
export function buildImageIndex(knownPaths: readonly string[] | null | undefined): {
  hasList: boolean;
  byLower: Map<string, string>;
  byBase: Map<string, string>;
};
export function resolveEmbedTarget(
  target: string,
  index: { hasList: boolean; byLower: Map<string, string>; byBase: Map<string, string> },
): string | null;
export function rewriteWorkspaceImageMarkdown(
  markdown: string,
  noteRelativePath: string,
  knownPaths?: readonly string[] | null,
): string;
export function restoreWorkspaceImageMarkdown(markdown: string, noteRelativePath: string): string;
export function wikilinkFromTitle(title: string): string | null;
export function embedDisplayFromTitle(
  title: string,
): { alt: string; width: number; height: number } | null;
export function filenameFromAssetUrl(url: string): string;
export function collectImageEmbeds(
  markdown: string,
): Array<{ target: string; suffix: string; inner: string }>;
export function collectLocalMarkdownImageTargets(markdown: string): string[];
