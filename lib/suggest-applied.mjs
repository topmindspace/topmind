/**
 * Durable "user already accepted this card" memory for suggest-engine.
 *
 * System plane only: `{workspace}/.topmind/suggest-applied.json`.
 *
 * Why this exists, and how it differs from the two neighbours:
 * - `suggest-fingerprint.mjs` answers "did we already *analyze* this activity?"
 *   Cleared by `force`. Does not know whether the user accepted the card.
 * - `suggest-dismissed.mjs` answers "the user rejected this card."
 *   Survives force + restarts. Never auto-clears by apply.
 * - This file answers "the user *accepted* this card." Survives restarts so a
 *   cold-start auto-prep does not re-nag the same open-profile / batch-hint /
 *   digest / promote card. Survives `force` (refresh is not a change of mind).
 *   TTL bounds the memory so a genuinely new digest of the same period can
 *   still be offered later; content-addressed ids (digest-{period}) stop
 *   matching once the period rolls over.
 *
 * Session `appliedIds` in Desktop ActionStore remains the in-process cache;
 * this file is the cross-restart truth.
 */

import fs from "node:fs";
import path from "node:path";

export const SUGGEST_APPLIED_REL = ".topmind/suggest-applied.json";

/** Applied records older than this are forgotten (pruned lazily on read/write). */
export const APPLIED_TTL_DAYS = 30;

const TTL_MS = APPLIED_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * @typedef {{
 *   ids: Record<string, string>,
 *   history?: Array<{ id: string, kind?: string, at: string, targetPath?: string, note?: string }>,
 *   updatedAt?: string
 * }} SuggestAppliedState
 */

/**
 * @param {string} workspaceRoot
 * @returns {string}
 */
export function suggestAppliedPath(workspaceRoot) {
  return path.join(workspaceRoot, SUGGEST_APPLIED_REL);
}

/**
 * Drop ids older than the TTL. Pure — returns a new map.
 * @param {Record<string, string>} ids
 * @param {number} [nowMs]
 * @returns {Record<string, string>}
 */
export function pruneAppliedIds(ids, nowMs = Date.now()) {
  /** @type {Record<string, string>} */
  const kept = {};
  if (!ids || typeof ids !== "object") return kept;
  for (const [id, iso] of Object.entries(ids)) {
    if (!id) continue;
    const t = Date.parse(String(iso));
    if (Number.isNaN(t) || nowMs - t < TTL_MS) kept[id] = String(iso);
  }
  return kept;
}

/**
 * @param {string} workspaceRoot
 * @returns {SuggestAppliedState}
 */
export function loadAppliedSuggestions(workspaceRoot) {
  const abs = suggestAppliedPath(workspaceRoot);
  try {
    if (!fs.existsSync(abs)) return { ids: {}, history: [] };
    const raw = JSON.parse(fs.readFileSync(abs, "utf8"));
    const rawIds =
      raw && typeof raw.ids === "object" && raw.ids && !Array.isArray(raw.ids)
        ? /** @type {Record<string, string>} */ (raw.ids)
        : {};
    const history = Array.isArray(raw?.history)
      ? raw.history
          .filter((h) => h && typeof h.id === "string")
          .slice(0, 50)
      : [];
    return {
      ids: pruneAppliedIds(rawIds),
      history,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
    };
  } catch {
    return { ids: {}, history: [] };
  }
}

/**
 * @param {string} workspaceRoot
 * @param {SuggestAppliedState} state
 */
export function saveAppliedSuggestions(workspaceRoot, state) {
  const abs = suggestAppliedPath(workspaceRoot);
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const payload = {
      ids: pruneAppliedIds(state.ids || {}),
      history: Array.isArray(state.history) ? state.history.slice(0, 50) : [],
      updatedAt: new Date().toISOString(),
    };
    const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, abs);
  } catch {
    /* system plane best-effort */
  }
}

/**
 * Record a successful apply. Idempotent; refreshes the timestamp on re-apply.
 * Appends to the short apply-history used as incremental AI context.
 *
 * @param {string} workspaceRoot
 * @param {{ id: string, kind?: string, targetPath?: string, note?: string }} rec
 * @returns {boolean} whether the id was newly recorded
 */
export function markSuggestionApplied(workspaceRoot, rec) {
  const id = String(rec?.id || "").trim();
  if (!id) return false;
  const state = loadAppliedSuggestions(workspaceRoot);
  const nowIso = new Date().toISOString();
  const isNew = !Object.prototype.hasOwnProperty.call(state.ids, id);
  state.ids[id] = nowIso;
  state.history = [
    {
      id,
      kind: rec.kind ? String(rec.kind) : undefined,
      at: nowIso,
      targetPath: rec.targetPath ? String(rec.targetPath) : undefined,
      note: rec.note ? String(rec.note).slice(0, 120) : undefined,
    },
    ...(state.history || []).filter((h) => h && h.id !== id),
  ].slice(0, 50);
  saveAppliedSuggestions(workspaceRoot, state);
  return isNew;
}

/**
 * @param {string} workspaceRoot
 * @param {string} id
 * @returns {boolean}
 */
export function isSuggestionApplied(workspaceRoot, id) {
  const key = String(id || "").trim();
  if (!key) return false;
  return Object.prototype.hasOwnProperty.call(
    loadAppliedSuggestions(workspaceRoot).ids,
    key,
  );
}

/**
 * Drop already-applied cards from a generated batch (unless force re-offer).
 * Shape-preserving when nothing is filtered.
 * @template {{ id?: string }} T
 * @param {string} workspaceRoot
 * @param {T[]} suggestions
 * @param {{ force?: boolean }} [opts]
 * @returns {T[]}
 */
export function filterAppliedSuggestions(workspaceRoot, suggestions, opts = {}) {
  const list = Array.isArray(suggestions) ? suggestions : [];
  if (list.length === 0 || opts.force === true) return list;
  const applied = loadAppliedSuggestions(workspaceRoot).ids;
  if (Object.keys(applied).length === 0) return list;
  const kept = list.filter((s) => {
    const id = String(s?.id || "");
    if (!id) return true;
    return !Object.prototype.hasOwnProperty.call(applied, id);
  });
  return kept.length === list.length ? list : kept;
}

/**
 * Short human-readable recent-apply digest for AI prompts (incremental context).
 * Empty string when nothing recent.
 * @param {string} workspaceRoot
 * @param {{ limit?: number, maxDays?: number }} [opts]
 * @returns {string}
 */
export function recentAppliedSummary(workspaceRoot, opts = {}) {
  const limit = Number.isFinite(opts.limit) ? Number(opts.limit) : 8;
  const maxDays = Number.isFinite(opts.maxDays) ? Number(opts.maxDays) : 14;
  const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;
  const { history = [] } = loadAppliedSuggestions(workspaceRoot);
  const lines = [];
  for (const h of history) {
    if (!h || !h.id) continue;
    const t = Date.parse(String(h.at || ""));
    if (Number.isFinite(t) && t < cutoff) continue;
    const kind = h.kind || "suggestion";
    const target = h.targetPath ? ` → ${h.targetPath}` : "";
    lines.push(`- [${kind}] ${h.id}${target}`);
    if (lines.length >= limit) break;
  }
  return lines.join("\n");
}

/**
 * Forget every applied record (tests / user reset). Does NOT touch fingerprints
 * or dismissals.
 * @param {string} [workspaceRoot]
 */
export function clearAppliedSuggestions(workspaceRoot) {
  if (!workspaceRoot) return;
  try {
    const abs = suggestAppliedPath(workspaceRoot);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch {
    /* ignore */
  }
}
