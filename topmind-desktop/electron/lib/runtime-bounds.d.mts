/** Types for the shared retention module. The implementation is runtime-bounds.mjs. */

export interface WorkingSetCaps {
  notesIndexRoots: number;
  notesPerRoot: number;
  aiTranscriptMessages: number;
  aiTranscriptKeepRecent: number;
  aiTranscriptMaxChars: number;
  aiTranscriptMaxPerMessage: number;
  aiTranscriptSessions: number;
  streamRows: number;
  streamDrafts: number;
  streamToolCalls: number;
  taskItems: number;
  taskLogLines: number;
  fetchMediaEntries: number;
  fetchMediaBytes: number;
  treeChildCache: number;
  hiddenRenderConcurrency: number;
  ignoredChanges: number;
}

export const WORKING_SET_CAPS: WorkingSetCaps;

export function capTail<T>(items: readonly T[] | null | undefined, max: number): T[];

export function rememberMapEntry<K, V>(map: Map<K, V>, key: K, value: V, maxKeys: number): Map<K, V>;

export function retainTranscript<T>(messages: readonly T[], caps?: object): T[];

export function retainTasks<T>(tasks: readonly T[], caps?: object): T[];

export function retainStreamRows<T>(rows: readonly T[], max?: number): T[];

export function boundToolCalls<T>(calls: readonly T[], caps?: object): T[];

export interface HotPathScope {
  trackListener(start: () => (() => void) | void): () => void;
  trackTimer(start: () => (() => void) | void): () => void;
  dispose(): void;
  counts(): { listeners: number; timers: number };
}

export function createHotPathScope(): HotPathScope;

export function mountSidebarTree(scope: HotPathScope, listen: () => (() => void) | void): () => void;

export function mountStreamFeed(scope: HotPathScope, listen: () => (() => void) | void): () => void;

export function mountAiDeltas(scope: HotPathScope, listen: () => (() => void) | void): () => void;

export function mountOverlay(scope: HotPathScope, listen: () => (() => void) | void): () => void;

export function releaseDesktopWorkingSets(reason?: string): unknown;
