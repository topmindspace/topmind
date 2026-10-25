export declare function readWorkspaceState<T>(root: string, name: string, fallback: T, validate?: (value: unknown) => boolean): T;
export declare function writeWorkspaceState<T>(root: string, name: string, value: T): T;
