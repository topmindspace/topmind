/** Ordered persistence for one workspace's chat index, transcripts and goals. */
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { ensureDir, readJson } from "./fs-utils.mjs";
import { getDesktopWorkingSet, rememberDesktopTranscript } from "./runtime-bounds.mjs";

const pending = new Map();
const directory = (ctx) => ctx.workspaceStatePaths.aiSessionMessagesDirPath;

export function safeSessionId(value) {
  const id = String(value || "").trim();
  if (!id || !/^[A-Za-z0-9_-]+$/u.test(id) || id.includes("..")) throw new Error(`Invalid sessionId: ${id}`);
  return id;
}
const messagePath = (ctx, id) => path.join(directory(ctx), `${safeSessionId(id)}.json`);
const goalPath = (ctx, id) => path.join(directory(ctx), `${safeSessionId(id)}.goal.json`);

/** Failed writes must leave the previous complete conversation readable. */
async function writeJson(file, value, indent = 0) {
  const content = JSON.stringify(value, null, indent);
  await ensureDir(path.dirname(file));
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, file);
  } finally {
    await handle?.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
  }
}

async function ordered(ctx, operation) {
  const key = path.resolve(directory(ctx));
  const previous = pending.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  pending.set(key, next);
  try { return await next; }
  finally { if (pending.get(key) === next) pending.delete(key); }
}
const readState = (ctx) => readJson(ctx.workspaceStatePaths.aiWorkspaceStateFilePath, { sessions: {}, history: [] });
const writeState = (ctx, state) => writeJson(ctx.workspaceStatePaths.aiWorkspaceStateFilePath, { ...state, updatedAt: new Date().toISOString() }, 2);

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.some((message) =>
    !message || typeof message !== "object" || typeof message.content !== "string" ||
    !["user", "assistant", "system"].includes(message.role)
  )) throw new Error("Conversation data is not a valid message list.");
}
async function unlinkIfPresent(file) {
  try { await fs.unlink(file); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
}

export const AiSessionStore = {
  getState(ctx) { return ordered(ctx, () => readState(ctx)); },
  listSessions(ctx) {
    return ordered(ctx, async () => Object.entries((await readState(ctx)).sessions || {}).map(([id, value]) => ({ id, ...value })));
  },
  loadMessages(sessionId, ctx) {
    const id = safeSessionId(sessionId);
    return ordered(ctx, async () => {
      await ensureDir(directory(ctx));
      let raw;
      try { raw = JSON.parse(await fs.readFile(messagePath(ctx, id), "utf8")); }
      catch (error) { if (error?.code === "ENOENT") return []; throw error; }
      validateMessages(raw);
      const bounded = rememberDesktopTranscript(id, raw);
      if (bounded !== raw) await writeJson(messagePath(ctx, id), bounded);
      return bounded;
    });
  },
  saveMessages(sessionId, messages, ctx) {
    const id = safeSessionId(sessionId);
    validateMessages(messages);
    return ordered(ctx, async () => {
      await ensureDir(directory(ctx));
      await writeJson(messagePath(ctx, id), rememberDesktopTranscript(id, messages));
      return { ok: true };
    });
  },
  clearSession(sessionId, ctx) {
    const id = safeSessionId(sessionId);
    return ordered(ctx, async () => {
      await unlinkIfPresent(messagePath(ctx, id));
      await unlinkIfPresent(goalPath(ctx, id));
      getDesktopWorkingSet().transcripts.delete(id);
      const state = await readState(ctx);
      delete (state.sessions || {})[id];
      await writeState(ctx, state);
      return { ok: true };
    });
  },
  clearAllSessions(ctx) {
    return ordered(ctx, async () => {
      let entries;
      try { entries = await fs.readdir(directory(ctx)); }
      catch (error) { if (error?.code !== "ENOENT") throw error; entries = []; }
      for (const name of entries) await unlinkIfPresent(path.join(directory(ctx), name));
      getDesktopWorkingSet().transcripts.clear();
      await writeState(ctx, { sessions: {}, history: [] });
      return { ok: true };
    });
  },
  updateSession(sessionId, patch, ctx) {
    const id = safeSessionId(sessionId);
    return ordered(ctx, async () => {
      const state = await readState(ctx);
      const previous = Object.hasOwn(state.sessions || {}, id) ? state.sessions[id] : {};
      state.sessions = { ...state.sessions, [id]: { ...previous, ...patch } };
      await writeState(ctx, state);
      return state.sessions[id];
    });
  },
  loadGoal(sessionId, ctx) {
    return ordered(ctx, () => readJson(goalPath(ctx, sessionId), null));
  },
  async saveGoal(sessionId, goalState, ctx) {
    // A goal checkpoint is rebuildable from the transcript; failure must not
    // turn a completed content write into a failed invocation.
    try {
      await ordered(ctx, async () => {
        await ensureDir(directory(ctx));
        await writeJson(goalPath(ctx, sessionId), {
          goal: goalState?.goal || "", plan: goalState?.plan || [], criteria: goalState?.criteria || [],
          doneCriteria: goalState?.doneCriteria || [], pathReceipts: (goalState?.pathReceipts || []).slice(-24),
          kind: goalState?.kind, status: goalState?.status || "idle", blockReason: goalState?.blockReason || null,
          updatedAt: new Date().toISOString(),
        }, 2);
      });
    } catch { /* best-effort checkpoint */ }
  },
};
