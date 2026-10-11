/** Types for lib/ai-content-sanitize.mjs (AI body hygiene + write sanitizer). */

export interface SanitizeAiWriteOpts {
  /** Allow JSON/YAML config bodies (tools may write settings files). */
  allowJson?: boolean;
}

export type SanitizeAiWriteResult =
  | { ok: true; text: string }
  | { ok: false; text: ""; reason: string };

export function sanitizeAiContent(text: string): string;
export function sanitizeAiWriteBody(
  raw: unknown,
  opts?: SanitizeAiWriteOpts,
): SanitizeAiWriteResult;
export function isPlaceholderOrPolluted(text: string): boolean;
export function usableAiBody(text: string): boolean;
export function looksLikeJsonDump(text: string): boolean;
export function looksLikeThinkingDump(text: string): boolean;
export function splitAssistantVisible(text: string): string;
export function extractJsonPayload(text: string, fallback?: unknown): unknown;
