export interface TaskIntent { targetPath?: string; skillId?: string; output?: 'review' | 'edit'; allowWeb?: boolean; }
export interface TaskCapabilities { toolCalling?: boolean | 'unknown'; vision?: boolean | 'unknown'; imageGeneration?: boolean; imageRendering?: boolean; }
export interface TaskContract { request: string; question?: string | null; kind: string; targetKind: string; targetPath: string | null; referencePaths: string[]; skillId: string | null; output: 'edit' | 'review'; allowWeb: boolean; capabilities: TaskCapabilities; memoryEnabled?: boolean; blockReason: string | null; }
export interface TaskExecutionGuard { readonly reason: string | null; readonly calls: number; readonly writes: number; readonly question: string | null; stop(reason: string): void; beforeModel(): boolean; beforeTool(name: string, input?: Record<string, unknown>): { ok: boolean; error?: string; args?: Record<string, unknown> }; afterTool(name: string, args: unknown, result: unknown): void; }
export function resolveTaskContract(options?: { userText?: string; focusPath?: string | null; referencePaths?: string[]; skillId?: string | null; intent?: TaskIntent; priorTask?: TaskContract | null; memoryEnabled?: boolean; capabilities?: TaskCapabilities }): TaskContract;
export function createTaskExecutionGuard(contract: TaskContract, options?: { maxCalls?: number; maxModelCalls?: number; now?: () => number; timeoutMs?: number }): TaskExecutionGuard;
export function taskContractPrompt(contract: TaskContract): string;
export function taskStopMessage(reason: string | null, locale?: string, targetPath?: string | null): string;
export function taskAllowsTool(contract: TaskContract, name: string): boolean;
export function bindTaskToolSchema(contract: TaskContract, name: string, schema: Record<string, unknown>): Record<string, unknown>;
export function documentTaskOutcome(contract: TaskContract, guard: TaskExecutionGuard, options?: { text?: string; stepLimitHit?: boolean; locale?: string }): { status: 'done' | 'incomplete' | 'blocked'; blockReason: string | null; text: string; pathReceipts: string[] };
