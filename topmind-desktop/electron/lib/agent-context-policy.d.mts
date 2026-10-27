export function estimateTokens(text: unknown): number;
export function needsActiveDocument(text: unknown): boolean;
export function resolveContextWindow(modelWindow?: number | null, ceiling?: number | null): number;
export function resolveContextBudget(contextWindow?: number | null, options?: { fixedTokens?: number; responseTokens?: number }): { window: number; responseTokens: number; maxTokens: number; maxChars: number; maxMessages: number; keepRecent: number; maxPerMessage: number };
export function clipContext(text: unknown, maxTokens: number): string;
export function compactPromptBlocks(blocks: string[], maxTokens: number): { blocks: string[]; compacted: boolean; overflow: boolean };
export function articleHistory(messages: Array<{role: string; content?: string; focusPath?: string | null; focus?: {path: string}}>, targetPath?: string | null): Array<{role: string; content: string}>;
export function boundToolResult(result: unknown, maxTokens: number): unknown;
export function fitSdkContext(messages: Array<Record<string, unknown>>, maxTokens: number): { messages: Array<Record<string, unknown>>; compacted: boolean; overflow: boolean };
