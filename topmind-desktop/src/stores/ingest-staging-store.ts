/**
 * Pending ingest batch when confirmBeforeConvert is on.
 * Path references only — binary is never copied into the workspace here.
 */
import { create } from "zustand";
import type { IngestBatchItem } from "../types";

export type IngestDest = { mode: "inbox" | "topic"; topicId?: string };

interface IngestStagingState {
  open: boolean;
  items: IngestBatchItem[];
  dest: IngestDest;
  capped: boolean;
  busy: boolean;
  error: string | null;
  openBatch: (payload: {
    items: IngestBatchItem[];
    dest?: IngestDest;
    capped?: boolean;
  }) => void;
  setItems: (items: IngestBatchItem[]) => void;
  setDest: (dest: IngestDest) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
  close: () => void;
}

export const useIngestStagingStore = create<IngestStagingState>((set) => ({
  open: false,
  items: [],
  dest: { mode: "inbox" },
  capped: false,
  busy: false,
  error: null,
  openBatch: ({ items, dest, capped }) =>
    set({
      open: true,
      items: items.map((it) => ({ ...it, selected: it.selected !== false })),
      dest: dest || { mode: "inbox" },
      capped: Boolean(capped),
      busy: false,
      error: null,
    }),
  setItems: (items) => set({ items }),
  setDest: (dest) => set({ dest }),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),
  close: () =>
    set({
      open: false,
      items: [],
      busy: false,
      error: null,
      capped: false,
    }),
}));
