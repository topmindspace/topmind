/**
 * Suggestion apply-label + navigation helpers.
 *
 * Write-kinds confirm-to-write; open-existing (open_profile, or an explicit
 * source 周期本 path) uses "打开". Never treat medium-impact writes as open.
 */

export const WRITE_SUGGESTION_KINDS = [
  "stream_digest",
  "ai_summary",
  "promote_memory",
  "inbox_review",
  "stale_topic",
  "catch_all",
  "inbox_organize",
  "create_topic",
] as const;

export function suggestionApplyIsWrite(
  kind?: string,
  source?: string,
): boolean {
  if (source === "pending_write") return true;
  if (!kind) return false;
  return (WRITE_SUGGESTION_KINDS as readonly string[]).includes(kind);
}

/**
 * Existing note the user can open without writing (周期本 / profile / inbox file).
 */
export function suggestionOpenPath(item: {
  targetPath?: string;
  suggestionKind?: string;
  suggestionPayload?: Record<string, unknown>;
}): string | null {
  const payload = item.suggestionPayload || {};
  const candidates = [
    item.targetPath,
    typeof payload.sourcePath === "string" ? payload.sourcePath : "",
    typeof payload.path === "string" ? payload.path : "",
  ];
  for (const raw of candidates) {
    if (typeof raw !== "string") continue;
    const p = raw.replace(/\\/g, "/").trim();
    if (!p) continue;
    if (p.includes("..")) continue;
    if (/(?:^|\/)(?:undefined|period)\.md$/u.test(p)) continue;
    return p;
  }
  return null;
}

/**
 * Path to open after a successful write — apply evidence (yearDir), never a
 * hardcoded flat periodic filename.
 */
function safeRelPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const p = raw.replace(/\\/g, "/").trim();
  if (!p) return null;
  if (p.includes("..")) return null;
  if (/(?:^|\/)(?:undefined|period)\.md$/u.test(p)) return null;
  return p;
}

export function suggestionNavPathAfterApply(
  res: {
    targetPath?: unknown;
    ok?: boolean;
    wroteFiles?: boolean;
  },
  item?: {
    suggestionKind?: string;
    suggestionPayload?: Record<string, unknown>;
  },
): string | null {
  if (!res || res.ok === false || res.wroteFiles === false) return null;
  const written = safeRelPath(res.targetPath);
  const digest = safeRelPath(item?.suggestionPayload?.digestPath);
  const kind = item?.suggestionKind || "";
  const isDigestKind = kind === "stream_digest" || kind === "ai_summary";
  if (isDigestKind) {
    if (written && /(?:^|\/)memory\/periodic\//u.test(written)) return written;
    if (digest) return digest;
  }
  return written;
}
