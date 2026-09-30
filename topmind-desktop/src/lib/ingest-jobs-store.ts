/**
 * Shared ingest-jobs cache + single poller.
 *
 * Hub, IngestQueuePanel, and CaptureForm all used to call `api.ingest.list()`
 * independently — 2–3 parallel polls plus 2–3 IPC event subscribers. One
 * module-level store owns the list; consumers subscribe and share one interval
 * while any surface is mounted and jobs are active.
 */
import { api } from "../services/api";
import type { IngestJob } from "../types";

type Listener = () => void;

let jobs: IngestJob[] = [];
let loading = true;
let error: string | null = null;
let refreshSeq = 0;
const listeners = new Set<Listener>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let eventUnsubs: Array<() => void> = [];
let mounted = 0;
/** Stable snapshot object for useSyncExternalStore (replaced on emit). */
let snapshot: { jobs: IngestJob[]; loading: boolean; error: string | null } = {
  jobs,
  loading,
  error,
};

function emit() {
  snapshot = { jobs, loading, error };
  for (const l of listeners) l();
}

function hasActive(list: IngestJob[]) {
  return list.some((j) => j.status === "queued" || j.status === "running");
}

function stopPoll() {
  if (pollTimer != null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function ensurePoll() {
  if (pollTimer != null) return;
  if (!hasActive(jobs)) return;
  pollTimer = setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    void refreshIngestJobs();
  }, 1500);
}

export async function refreshIngestJobs(): Promise<void> {
  const seq = ++refreshSeq;
  try {
    const r = await api.ingest.list();
    if (seq !== refreshSeq) return; // stale response
    jobs = r.jobs || [];
    error = null;
  } catch (e) {
    if (seq !== refreshSeq) return;
    error = e instanceof Error ? e.message : String(e);
  } finally {
    if (seq === refreshSeq) {
      loading = false;
      emit();
    }
  }
  if (hasActive(jobs)) ensurePoll();
  else stopPoll();
}

function onVisibleRefresh() {
  if (document.visibilityState === "visible") void refreshIngestJobs();
}

function attachEvents() {
  if (eventUnsubs.length) return;
  // Late-bind to avoid circular import at module load.
  void import("../plugins/host").then(({ onLocal }) => {
    if (eventUnsubs.length) return;
    eventUnsubs = [
      onLocal("ingest:queue-changed", () => void refreshIngestJobs()),
      onLocal("ingest:job-updated", () => void refreshIngestJobs()),
    ];
  });
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibleRefresh);
    eventUnsubs.push(() => document.removeEventListener("visibilitychange", onVisibleRefresh));
  }
}

function detachEvents() {
  for (const u of eventUnsubs) u();
  eventUnsubs = [];
}

export function subscribeIngestJobs(listener: Listener): () => void {
  listeners.add(listener);
  mounted += 1;
  attachEvents();
  if (mounted === 1) void refreshIngestJobs();
  return () => {
    listeners.delete(listener);
    mounted = Math.max(0, mounted - 1);
    if (mounted === 0) {
      stopPoll();
      detachEvents();
    }
  };
}

export function getIngestJobsSnapshot(): {
  jobs: IngestJob[];
  loading: boolean;
  error: string | null;
} {
  return snapshot;
}
