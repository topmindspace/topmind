/**
 * In-memory ingest job queue with optional desktop-state persistence.
 * Runtime projection only — not content truth.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveDesktopStateHome } from "../workspace-home.mjs";

/**
 * @typedef {object} IngestJob
 * @property {string} id
 * @property {string} createdAt
 * @property {string} [updatedAt]
 * @property {'queued'|'running'|'done'|'failed'|'cancelled'} status
 * @property {{ kind?: string, path: string, name: string, size?: number }} source
 * @property {{ mode: 'inbox'|'topic', topicId?: string }} dest
 * @property {number} [progress]
 * @property {{ targetPath?: string, title?: string, converter?: string, warnings?: string[], fallback?: boolean }} [result]
 * @property {string} [error]
 */

/** @type {Map<string, IngestJob>} */
const jobs = new Map();
/** @type {string[]} */
const order = [];
let running = 0;
/** @type {((event: string, payload: unknown) => void) | null} */
let emitFn = null;
/** @type {((job: IngestJob, ctx: object) => Promise<void>) | null} */
let processFn = null;
/** @type {(() => object) | null} */
let getCtxFn = null;
let concurrency = 1;
const MAX_JOBS = 200;

export function configureIngestQueue(opts = {}) {
  if (typeof opts.emit === "function") emitFn = opts.emit;
  if (typeof opts.processJob === "function") processFn = opts.processJob;
  if (typeof opts.getContext === "function") getCtxFn = opts.getContext;
  if (typeof opts.concurrency === "number" && opts.concurrency >= 1 && opts.concurrency <= 4) {
    concurrency = opts.concurrency;
  }
}

function emit(event, payload) {
  try {
    emitFn?.(event, payload);
  } catch {
    /* ignore */
  }
}

function touch(job) {
  job.updatedAt = new Date().toISOString();
  jobs.set(job.id, job);
  emit("ingest:job-updated", job);
  emit("ingest:queue-changed", { jobs: listJobs() });
  void persistQueue().catch(() => {});
}

export function listJobs() {
  return order.map((id) => jobs.get(id)).filter(Boolean);
}

export function getJob(id) {
  return jobs.get(id) || null;
}

/**
 * @param {object} item
 * @param {string} item.absolutePath
 * @param {{ mode?: string, topicId?: string }} [dest]
 * @param {{ name?: string, size?: number }} [meta]
 */
export function enqueueItem(item, dest = {}, meta = {}) {
  const abs = String(item.absolutePath || item.path || "").trim();
  if (!abs) throw new Error("absolutePath required");
  const id = randomUUID();
  const job = {
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "queued",
    source: {
      path: abs,
      name: meta.name || path.basename(abs),
      size: meta.size,
    },
    dest: {
      mode: dest.mode === "topic" && dest.topicId ? "topic" : "inbox",
      topicId: dest.mode === "topic" ? dest.topicId : undefined,
    },
    progress: 0,
  };
  jobs.set(id, job);
  order.unshift(id);
  while (order.length > MAX_JOBS) {
    const old = order.pop();
    if (old) jobs.delete(old);
  }
  touch(job);
  void pump();
  return job;
}

export function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) return null;
  if (job.status === "queued") {
    job.status = "cancelled";
    job.error = "cancelled";
    touch(job);
  }
  // running: cooperative cancel not implemented mid-convert; mark for skip result
  return job;
}

export function retryJob(id) {
  const job = jobs.get(id);
  if (!job) return null;
  if (job.status !== "failed" && job.status !== "cancelled" && job.status !== "done") {
    return job;
  }
  job.status = "queued";
  job.error = undefined;
  job.result = undefined;
  job.progress = 0;
  touch(job);
  void pump();
  return job;
}

async function pump() {
  if (!processFn || !getCtxFn) return;
  while (running < concurrency) {
    const next = order.map((id) => jobs.get(id)).find((j) => j && j.status === "queued");
    if (!next) break;
    running += 1;
    next.status = "running";
    next.progress = 5;
    touch(next);
    const jobRef = next;
    void (async () => {
      try {
        const ctx = getCtxFn();
        await processFn(jobRef, ctx);
        if (jobRef.status === "running") {
          jobRef.status = "done";
          jobRef.progress = 100;
        }
      } catch (e) {
        jobRef.status = "failed";
        jobRef.error = e instanceof Error ? e.message : String(e);
        jobRef.progress = 100;
      } finally {
        touch(jobRef);
        running -= 1;
        void pump();
      }
    })();
  }
}

function queueStatePath() {
  return path.join(resolveDesktopStateHome(), "state", "ingest-queue.json");
}

async function persistQueue() {
  const file = queueStatePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const slim = listJobs()
    .slice(0, 50)
    .map((j) => ({
      id: j.id,
      createdAt: j.createdAt,
      status: j.status,
      source: { path: j.source?.path, name: j.source?.name },
      dest: j.dest,
      result: j.result,
      error: j.error,
    }));
  await fs.writeFile(file, JSON.stringify({ jobs: slim, savedAt: new Date().toISOString() }, null, 2), "utf8");
}

/** Re-queue only pending paths after restart (best-effort). */
export async function restoreQueueFromDisk() {
  try {
    const raw = await fs.readFile(queueStatePath(), "utf8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data?.jobs)) return;
    for (const j of data.jobs) {
      if (j?.status === "queued" || j?.status === "running") {
        if (j.source?.path) {
          enqueueItem(
            { absolutePath: j.source.path },
            j.dest || {},
            { name: j.source.name },
          );
        }
      }
    }
  } catch {
    /* no state */
  }
}
