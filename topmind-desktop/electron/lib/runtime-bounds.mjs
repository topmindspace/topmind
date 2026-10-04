/**
 * Long-session retention and owned-process lifetime.
 *
 * Caps and "which pids/windows are ours" are pure: callers pass the table.
 * Electron quit, workspace switch, hidden-render finish, and the dev signal
 * handlers call these functions and then perform the real destroy/kill.
 * Tests inject tables — nothing here shells out to pkill or taskkill.
 */
import path from "node:path";
import {
  COMPACT_DEFAULT_KEEP_RECENT,
  COMPACT_DEFAULT_MAX_CHARS,
  COMPACT_DEFAULT_MAX_MESSAGES,
  COMPACT_DEFAULT_MAX_PER_MESSAGE,
} from "./ai-session-compact.mjs";

export const WORKING_SET_CAPS = Object.freeze({
  /** Distinct workspace projections kept in the main process. */
  notesIndexRoots: 8,
  notesPerRoot: 5000,
  aiTranscriptMessages: COMPACT_DEFAULT_MAX_MESSAGES,
  aiTranscriptKeepRecent: COMPACT_DEFAULT_KEEP_RECENT,
  aiTranscriptMaxChars: COMPACT_DEFAULT_MAX_CHARS,
  aiTranscriptMaxPerMessage: COMPACT_DEFAULT_MAX_PER_MESSAGE,
  /** Full transcripts held for the open workspace (not every historical chat). */
  aiTranscriptSessions: 4,
  streamRows: 400,
  streamDrafts: 12,
  streamToolCalls: 80,
  taskItems: 40,
  taskLogLines: 48,
  fetchMediaEntries: 24,
  fetchMediaBytes: 8 * 1024 * 1024,
  treeChildCache: 80,
  hiddenRenderConcurrency: 1,
  ignoredChanges: 2000,
});

/** @param {unknown[]} items @param {number} max */
export function capHead(items, max) {
  const list = Array.isArray(items) ? items : [];
  const n = Math.max(0, Number(max) || 0);
  if (n === 0) return [];
  if (list.length <= n) return list.slice();
  return list.slice(0, n);
}

/** Keep the newest tail of an append-only list. */
export function capTail(items, max) {
  const list = Array.isArray(items) ? items : [];
  const n = Math.max(0, Number(max) || 0);
  if (n === 0) return [];
  if (list.length <= n) return list.slice();
  return list.slice(list.length - n);
}

/**
 * Bound a Map of projections. `builtAt`/`at` decides eviction; `activeKey` is kept.
 * Notes sorted newest-first are capped from the head.
 * @param {Map<string, object>} map
 */
export function retainKeyedProjection(map, key, value, opts = {}) {
  const maxKeys = Math.max(1, Number(opts.maxKeys) || WORKING_SET_CAPS.notesIndexRoots);
  const notesCap = Number(opts.notesCap) || WORKING_SET_CAPS.notesPerRoot;
  const next = { ...(value || {}) };
  if (Array.isArray(next.notes)) next.notes = capHead(next.notes, notesCap);
  next.builtAt = Number(next.builtAt) || Date.now();
  map.set(key, next);
  if (map.size <= maxKeys) return map;
  const ranked = [...map.entries()]
    .filter(([k]) => k !== key)
    .sort((a, b) => Number(a[1]?.builtAt || a[1]?.at || 0) - Number(b[1]?.builtAt || b[1]?.at || 0));
  while (map.size > maxKeys && ranked.length) {
    map.delete(ranked.shift()[0]);
  }
  return map;
}

/**
 * Move `key` to the newest end and drop the oldest entries past `maxKeys`.
 * @template K, V
 * @param {Map<K, V>} map
 * @returns {Map<K, V>}
 */
export function rememberMapEntry(map, key, value, maxKeys) {
  const max = Math.max(1, Number(maxKeys) || 1);
  const next = new Map(map || []);
  next.delete(key);
  next.set(key, value);
  while (next.size > max) {
    const oldest = next.keys().next().value;
    next.delete(oldest);
  }
  return next;
}

/** Drop earliest-expiring keys once an expiry map exceeds `max`. */
export function capExpiryMap(map, max) {
  const n = Math.max(1, Number(max) || WORKING_SET_CAPS.ignoredChanges);
  if (!map || map.size <= n) return map;
  const ranked = [...map.entries()].sort((a, b) => Number(a[1]) - Number(b[1]));
  while (map.size > n && ranked.length) {
    map.delete(ranked.shift()[0]);
  }
  return map;
}

function messageChars(message) {
  if (!message || typeof message !== "object") return 0;
  let n = 0;
  for (const field of ["content", "contentRaw", "reasoning", "reasoningProvider"]) {
    if (typeof message[field] === "string") n += message[field].length;
  }
  return n;
}

function truncateField(value, max) {
  if (typeof value !== "string" || value.length <= max) return value;
  return `${value.slice(0, max)}\n[truncated ${value.length}]`;
}

function truncateMessage(message, maxPerMessage) {
  if (!message || typeof message !== "object") return message;
  const next = { ...message };
  for (const field of ["content", "contentRaw", "reasoning", "reasoningProvider"]) {
    if (typeof next[field] === "string") next[field] = truncateField(next[field], maxPerMessage);
  }
  if (Array.isArray(next.toolCalls)) {
    next.toolCalls = boundToolCalls(next.toolCalls);
  }
  return next;
}

/**
 * Hard bound for one open-workspace transcript.
 * Under the cap, the same array is returned. Over the cap, the first turn
 * (goal) and the keep-recent tail stay; middle turns fold into one marker.
 * String fields are truncated. Tool-call objects on kept turns stay.
 * @param {object[]} messages
 */
export function retainTranscript(messages, caps = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const maxMessages = Math.max(4, Number(caps.maxMessages) || WORKING_SET_CAPS.aiTranscriptMessages);
  const keepRecent = Math.max(
    1,
    Math.min(
      maxMessages - 2,
      Number(caps.keepRecent) || WORKING_SET_CAPS.aiTranscriptKeepRecent,
    ),
  );
  const maxChars = Math.max(1000, Number(caps.maxChars) || WORKING_SET_CAPS.aiTranscriptMaxChars);
  const maxPerMessage = Math.max(
    200,
    Number(caps.maxPerMessage) || WORKING_SET_CAPS.aiTranscriptMaxPerMessage,
  );
  const overCount = list.length > maxMessages;
  const overChars = list.reduce((n, m) => n + messageChars(m), 0) > maxChars;
  const overField = list.some((m) => messageChars(m) > maxPerMessage);
  if (!overCount && !overChars && !overField) return list;

  let next = list.map((m) => ({ ...m }));
  if (next.length > maxMessages) {
    const head = next[0];
    const tail = next.slice(-keepRecent);
    const dropped = Math.max(0, next.length - 1 - tail.length);
    const markerRole = tail[0]?.role === "user" ? "assistant" : "user";
    next = [
      head,
      {
        role: markerRole,
        content: `[Session compacted] ${dropped} earlier turns folded.`,
      },
      ...tail,
    ];
    if (next.length > maxMessages) {
      next = [next[0], next[1], ...next.slice(next.length - (maxMessages - 2))];
    }
  }
  next = next.map((m) => truncateMessage(m, maxPerMessage));
  while (next.length > 2 && next.reduce((n, m) => n + messageChars(m), 0) > maxChars) {
    next.splice(2, 1);
  }
  if (next.reduce((n, m) => n + messageChars(m), 0) > maxChars) {
    next = next.map((m) => truncateMessage(m, Math.max(200, Math.floor(maxChars / Math.max(1, next.length)))));
  }
  return next;
}

/**
 * @param {Map<string, { messages: object[], at: number }>} store
 */
export function rememberTranscript(store, sessionId, messages, caps = {}) {
  const bounded = retainTranscript(messages, caps);
  const maxSessions = Math.max(1, Number(caps.maxSessions) || WORKING_SET_CAPS.aiTranscriptSessions);
  store.set(sessionId, { messages: bounded, at: Date.now() });
  if (store.size > maxSessions) {
    const ranked = [...store.entries()]
      .filter(([id]) => id !== sessionId)
      .sort((a, b) => Number(a[1]?.at || 0) - Number(b[1]?.at || 0));
    while (store.size > maxSessions && ranked.length) {
      store.delete(ranked.shift()[0]);
    }
  }
  return bounded;
}

/** @param {object[]} tasks */
export function retainTasks(tasks, caps = {}) {
  const maxTasks = Math.max(1, Number(caps.maxTasks) || WORKING_SET_CAPS.taskItems);
  const maxLogLines = Math.max(1, Number(caps.maxLogLines) || WORKING_SET_CAPS.taskLogLines);
  const withLogs = (Array.isArray(tasks) ? tasks : []).map((task) => ({
    ...task,
    logs: capTail(task?.logs, maxLogLines),
  }));
  if (withLogs.length <= maxTasks) return withLogs;
  const active = withLogs.filter((t) => t.status === "running" || t.status === "queued");
  const rest = withLogs.filter((t) => t.status !== "running" && t.status !== "queued");
  const room = Math.max(0, maxTasks - active.length);
  const kept = [...capTail(active, maxTasks), ...capTail(rest, room)];
  return capTail(kept, maxTasks);
}

/** @param {object[]} rows */
export function retainStreamRows(rows, max = WORKING_SET_CAPS.streamRows) {
  return capTail(rows, max);
}

function entryBytes(entry) {
  if (!entry || typeof entry !== "object") return 0;
  if (typeof entry.bytes === "number" && Number.isFinite(entry.bytes)) return Math.max(0, entry.bytes);
  if (typeof entry.payload === "string") return entry.payload.length;
  return 0;
}

/**
 * Bound fetch/media buffers the desktop keeps. A single oversized payload is
 * truncated so one fetch cannot exceed the byte cap, and older entries drop
 * until both the count and the byte total are inside the cap.
 * @param {object[]} entries
 */
export function retainFetchMediaBuffer(entries, caps = {}) {
  const maxEntries = Math.max(1, Number(caps.maxEntries) || WORKING_SET_CAPS.fetchMediaEntries);
  const maxBytes = Math.max(1, Number(caps.maxBytes) || WORKING_SET_CAPS.fetchMediaBytes);
  const source = Array.isArray(entries) ? entries : [];
  /** @type {object[]} */
  const newestFirst = [];
  let total = 0;
  for (let i = source.length - 1; i >= 0 && newestFirst.length < maxEntries; i -= 1) {
    let entry = source[i];
    let bytes = entryBytes(entry);
    if (bytes > maxBytes) {
      const payload = typeof entry.payload === "string" ? entry.payload.slice(0, maxBytes) : entry.payload;
      entry = { ...entry, bytes: maxBytes, payload };
      bytes = maxBytes;
    }
    if (total + bytes > maxBytes && newestFirst.length > 0) break;
    newestFirst.push(entry);
    total += bytes;
  }
  return newestFirst.reverse();
}

/** @param {object[]} calls */
export function boundToolCalls(calls, caps = {}) {
  const maxCalls = Math.max(1, Number(caps.maxCalls) || WORKING_SET_CAPS.streamToolCalls);
  const maxOutputChars = Math.max(200, Number(caps.maxOutputChars) || 4000);
  return capTail(calls, maxCalls).map((call) => {
    if (!call || call.output == null) return call;
    let serialized = "";
    try {
      serialized = JSON.stringify(call.output);
    } catch {
      return { ...call, output: undefined };
    }
    if (serialized.length <= maxOutputChars) return call;
    return { ...call, output: undefined };
  });
}

export function createWorkingSet() {
  return {
    notes: new Map(),
    transcripts: new Map(),
    streamRows: [],
    streamDrafts: new Map(),
    tasks: [],
    fetchMedia: [],
  };
}

/**
 * Drop in-memory working sets. Quit and workspace close/switch empty them
 * (the keep-recent window is what retain* enforces while the session is open).
 */
export function releaseWorkingSet(bag, _reason) {
  if (!bag) return bag;
  bag.notes?.clear?.();
  bag.transcripts?.clear?.();
  bag.streamDrafts?.clear?.();
  if (Array.isArray(bag.streamRows)) bag.streamRows.length = 0;
  if (Array.isArray(bag.tasks)) bag.tasks.length = 0;
  if (Array.isArray(bag.fetchMedia)) bag.fetchMedia.length = 0;
  return bag;
}

const desktopSet = createWorkingSet();

export function getDesktopWorkingSet() {
  return desktopSet;
}

export function rememberDesktopTranscript(sessionId, messages, caps) {
  return rememberTranscript(desktopSet.transcripts, sessionId, messages, caps);
}

export function rememberDesktopFetchMedia(entry) {
  desktopSet.fetchMedia = retainFetchMediaBuffer([...desktopSet.fetchMedia, entry]);
  return desktopSet.fetchMedia;
}

export function rememberDesktopStreamRows(rows) {
  desktopSet.streamRows = retainStreamRows(rows);
  return desktopSet.streamRows;
}

export function releaseDesktopWorkingSets(reason) {
  return releaseWorkingSet(desktopSet, reason);
}

/**
 * @returns {{ seq: number, entries: object[] }}
 */
export function createOwnedRuntime() {
  return { seq: 0, entries: [] };
}

export function registerOwned(runtime, entry) {
  const id = entry?.id || `own-${(runtime.seq += 1)}`;
  for (const prev of runtime.entries) {
    if (prev.alive && prev.id === id) prev.alive = false;
  }
  const row = {
    id,
    kind: entry?.kind || "helper",
    pid: Number.isInteger(entry?.pid) ? entry.pid : null,
    token: entry?.token ?? null,
    workspaceKey: entry?.workspaceKey ?? null,
    cwd: entry?.cwd ?? null,
    alive: true,
  };
  runtime.entries.push(row);
  return row;
}

export function liveOwned(runtime, filter) {
  return (runtime?.entries || []).filter((entry) => {
    if (!entry?.alive) return false;
    if (!filter) return true;
    if (filter.workspaceKey && entry.workspaceKey && entry.workspaceKey !== filter.workspaceKey) {
      return false;
    }
    if (filter.kind && entry.kind !== filter.kind) return false;
    return true;
  });
}

export function releaseOwned(runtime, { workspaceKey } = {}) {
  const released = [];
  for (const entry of runtime?.entries || []) {
    if (!entry.alive) continue;
    if (workspaceKey && entry.workspaceKey && entry.workspaceKey !== workspaceKey) continue;
    entry.alive = false;
    released.push(entry);
  }
  return released;
}

export function claimHiddenRender(runtime, token) {
  const live = liveOwned(runtime, { kind: "render-window" });
  if (live.length >= WORKING_SET_CAPS.hiddenRenderConcurrency) {
    return { ok: false, active: live.length, id: null };
  }
  const row = registerOwned(runtime, {
    kind: "render-window",
    id: token || undefined,
    token: token || "render",
  });
  return { ok: true, active: live.length + 1, id: row.id };
}

export function finishHiddenRender(runtime, id) {
  const entry = (runtime?.entries || []).find((row) => row.id === id);
  if (entry) entry.alive = false;
  return entry || null;
}

const desktopOwned = createOwnedRuntime();
/** @type {Map<string, () => void>} */
const ownedDestroyers = new Map();

export function getDesktopOwnedRuntime() {
  return desktopOwned;
}

export function registerDesktopOwned(entry) {
  return registerOwned(desktopOwned, entry);
}

export function attachOwnedDestroyer(id, destroy) {
  if (id && typeof destroy === "function") ownedDestroyers.set(id, destroy);
}

export function forgetDesktopOwned(idOrPid) {
  for (const entry of desktopOwned.entries) {
    if (!entry.alive) continue;
    if (entry.id === idOrPid || entry.pid === idOrPid) {
      entry.alive = false;
      ownedDestroyers.delete(entry.id);
    }
  }
}

export function releaseDesktopOwned(opts) {
  return releaseOwned(desktopOwned, opts);
}

export function claimDesktopHiddenRender(token) {
  return claimHiddenRender(desktopOwned, token);
}

export function finishDesktopHiddenRender(id) {
  ownedDestroyers.delete(id);
  return finishHiddenRender(desktopOwned, id);
}

/**
 * Destroy windows and signal pids that releaseOwned just marked dead.
 * @param {object[]} entries
 * @param {(pid: number) => void} [killPid]
 */
export function reapDesktopOwned(entries, killPid) {
  const kill = killPid || ((pid) => {
    try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
  });
  for (const entry of entries || []) {
    const destroy = ownedDestroyers.get(entry.id);
    ownedDestroyers.delete(entry.id);
    if (destroy) {
      try { destroy(); } catch { /* already gone */ }
    }
    if (entry.pid) {
      try { kill(entry.pid); } catch { /* already gone */ }
    }
  }
}

/**
 * Normalize a path for workspace-scoped comparisons.
 * Windows drive paths stay literal on non-Windows so tests can inject them.
 */
export function normalizeWorkspaceKey(value) {
  const raw = String(value || "").replace(/\\/g, "/").replace(/\/+$/u, "");
  if (!raw) return "";
  const windowsDrive = /^[A-Za-z]:\//u.test(raw);
  if (windowsDrive && process.platform !== "win32") return raw;
  try {
    return path.resolve(raw).replace(/\\/g, "/").replace(/\/+$/u, "");
  } catch {
    return raw;
  }
}

const OWNED_COMMAND = /electron|dev-electron|dev-renderer|dev-desktop/iu;

/**
 * Pids that belong to this workspace's Node/Electron tree.
 * Unrelated Electron processes (different cwd / command line) are excluded.
 * @param {Array<{ pid?: number, command?: string, cwd?: string, workspaceKey?: string, owned?: boolean }>} processes
 */
export function selectWorkspaceTreePids(processes, { cwd, selfPid, parentPid } = {}) {
  const needle = normalizeWorkspaceKey(cwd);
  if (!needle) return [];
  const out = [];
  for (const proc of processes || []) {
    const pid = Number(proc?.pid);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (pid === selfPid || pid === parentPid) continue;
    const cmd = String(proc?.command || "");
    const cmdNorm = cmd.replace(/\\/g, "/");
    const pcwd = normalizeWorkspaceKey(proc?.cwd || "");
    const key = normalizeWorkspaceKey(proc?.workspaceKey || "");
    const inWorkspace = key === needle
      || pcwd === needle
      || (pcwd && pcwd.startsWith(`${needle}/`))
      || cmdNorm.includes(needle);
    if (!inWorkspace) continue;
    if (proc?.owned !== true && !OWNED_COMMAND.test(cmd)) continue;
    out.push(pid);
  }
  return [...new Set(out)];
}

/**
 * A live same-workspace dev lock reuses the existing tree.
 * A dead lock replaces it: kill only this workspace's previous tree.
 */
export function planDevSessionStart({ cwd, lockOwner, processes, selfPid, parentPid } = {}) {
  const needle = normalizeWorkspaceKey(cwd);
  const ownerCwd = normalizeWorkspaceKey(lockOwner?.cwd || "");
  const ownerAlive = Boolean(
    lockOwner
    && lockOwner.alive
    && Number.isInteger(lockOwner.pid)
    && lockOwner.pid > 0
    && ownerCwd === needle,
  );
  if (ownerAlive) {
    return { action: "reuse", killPids: [], start: false };
  }
  return {
    action: "replace",
    killPids: selectWorkspaceTreePids(processes || [], { cwd: needle, selfPid, parentPid }),
    start: true,
  };
}

/**
 * SIGHUP must not be delivered as SIGKILL first: the child has to observe a
 * catchable signal so it can reap a detached Electron process group.
 */
export function planSignalTeardown(signal) {
  const sig = String(signal || "SIGTERM").toUpperCase();
  if (sig === "SIGINT") {
    return { forward: "SIGINT", escalate: "SIGKILL", escalateAfterMs: 1500 };
  }
  return { forward: "SIGTERM", escalate: "SIGKILL", escalateAfterMs: 1500 };
}

export function applyDevTeardown(runtime, { signal, workspaceKey } = {}) {
  const plan = planSignalTeardown(signal);
  const released = releaseOwned(runtime, { workspaceKey });
  return { ...plan, released, live: liveOwned(runtime) };
}

/** Parse `ps -ax -o pid=,command=` (or pid + command separated by whitespace). */
export function parsePsCommandTable(text) {
  const rows = [];
  for (const line of String(text || "").split(/\n/u)) {
    const match = line.match(/^\s*(\d+)\s+(.*)$/u);
    if (!match) continue;
    rows.push({ pid: Number(match[1]), command: match[2].trim(), cwd: "" });
  }
  return rows;
}

/**
 * Listener/timer scope for sidebar, stream, AI delta, and overlay mount cycles.
 * subscribe functions return an unsubscribe. dispose is idempotent.
 */
export function createHotPathScope() {
  let listeners = 0;
  let timers = 0;
  /** @type {Array<() => void>} */
  const stops = [];
  function track(start, bucket) {
    const unsub = start();
    if (bucket === "timer") timers += 1;
    else listeners += 1;
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (bucket === "timer") timers -= 1;
      else listeners -= 1;
      try { unsub?.(); } catch { /* ignore */ }
    };
    stops.push(stop);
    return stop;
  }
  return {
    trackListener(start) { return track(start, "listener"); },
    trackTimer(start) { return track(start, "timer"); },
    dispose() {
      for (const stop of stops.splice(0, stops.length)) stop();
    },
    counts() {
      return { listeners, timers };
    },
  };
}

export function mountSidebarTree(scope, listen) {
  return scope.trackListener(listen);
}

export function mountStreamFeed(scope, listen) {
  return scope.trackListener(listen);
}

export function mountAiDeltas(scope, listen) {
  return scope.trackListener(listen);
}

export function mountOverlay(scope, listen) {
  return scope.trackListener(listen);
}
