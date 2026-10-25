export interface PendingWrite { id: string; relativePath: string; content: string; toolName?: string; operation?: "write" | "delete" | "archive"; expectedHash?: string; createdAt: string; }
export declare const MAX_PENDING_WRITES: number;
export declare function listPendingWrites(root: string): PendingWrite[];
export declare function stashPendingWrite(options: { workspaceRoot: string; relativePath: string; content?: string; toolName?: string; operation?: "write" | "delete" | "archive"; expectedHash?: string }): PendingWrite;
export declare function takePendingWrite(root: string, id: string): PendingWrite | null;
export declare function rejectPendingWrite(root: string, id: string): boolean;
export declare function restorePendingWrite(root: string, entry: PendingWrite): void;
export declare function acceptPendingWrite(root: string, id: string): { ok: boolean; error?: string; relativePath?: string; evidence?: Record<string, unknown> };
