export declare const MEMORY_PATH_KEYS: string[];
export declare const MEMORY_WRITE_TOOLS: Set<string>;
export declare function isFencedMemoryPath(value: unknown, options?: { workspaceRoot?: string }): boolean;
export declare function memoryFence(tool: string, args: Record<string, unknown>, options?: { workspaceRoot?: string; blocked?: string }): { ok: false; tool: string; operation: string; error: string; note?: string } | null;
