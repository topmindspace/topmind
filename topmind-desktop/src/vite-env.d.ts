/// <reference types="vite/client" />

/** Injected at build time from topmind-desktop/package.json */
declare const __APP_VERSION__: string;

interface topmindBridge {
  invoke(method: string, params?: unknown): Promise<unknown>;
  subscribe(event: string, handler: (payload: unknown) => void): () => void;
  /** Electron webUtils — absolute path for OS drag/paste File */
  getPathForFile?(file: File): string;
}

interface Window {
  topmind: topmindBridge;
}
