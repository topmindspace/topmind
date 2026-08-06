/**
 * Review-session handler for MCP transport.
 *
 * MCP does not natively support review-before-execute flows. We implement a
 * two-phase pattern:
 * 1. First tools/call returns { status: "review_required", reviewPolicy, preview }
 * 2. User reviews in UI, second call with _reviewed: true executes the tool
 *
 * The sessionId ties the two calls together.
 * Pending sessions are persisted to a temp file so they survive server restarts.
 */
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import { t } from "../core/i18n-strings.mjs";

const USER_STORE_DIR = path.join(os.homedir(), ".topmind");
const STORE_PATH = path.join(USER_STORE_DIR, "review-sessions.json");

/** In-memory store for pending review sessions, backed by temp file. */
const pendingReviews = new Map();
let _restored = false;

async function persistSessions() {
  try {
    // Atomic write: temp file then rename
    await fs.mkdir(USER_STORE_DIR, { recursive: true });
    const tmpPath = STORE_PATH + ".tmp";
    const entries = [...pendingReviews.entries()];
    await fs.writeFile(tmpPath, JSON.stringify(entries, null, 2), "utf8");
    await fs.rename(tmpPath, STORE_PATH);
  } catch {
    // Persistence is best-effort; in-memory store remains authoritative
  }
}

async function restoreSessions() {
  if (_restored) return;
  _restored = true;
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const entries = JSON.parse(raw);
    if (Array.isArray(entries)) {
      const now = new Date();
      for (const [id, session] of entries) {
        if (new Date(session.expiresAt) < now) continue; // skip expired
        pendingReviews.set(id, session);
      }
    }
  } catch {
    // No persisted sessions or unreadable file — start fresh
  }
}

/**
 * Create a pending review session.
 * Returns a session object that the MCP server returns to the client.
 */
export async function createReviewSession(kind, command, payload, reviewPolicy, preview) {
  await restoreSessions();
  const sessionId = randomUUID();
  const session = {
    sessionId,
    kind,
    command,
    payload,
    reviewPolicy,
    preview,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 min TTL
  };
  pendingReviews.set(sessionId, session);
  await persistSessions();
  return session;
}

/**
 * Consume a pending review session (one-time use).
 * Returns the session if valid, or null if expired/missing.
 */
export async function consumeReviewSession(sessionId) {
  await restoreSessions();
  const session = pendingReviews.get(sessionId);
  if (!session) return null;

  pendingReviews.delete(sessionId);
  await persistSessions();

  if (new Date(session.expiresAt) < new Date()) {
    return null;
  }

  return session;
}

/**
 * Format a review-required response for MCP tools/call result.
 */
export function formatReviewResponse(session) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          status: "review_required",
          sessionId: session.sessionId,
          kind: session.kind,
          command: session.command,
          ...(session.reviewPolicy ? { reviewPolicy: session.reviewPolicy } : {}),
          ...(session.preview ? { preview: session.preview } : {}),
          message: t("msg.reviewRequired", { kind: session.kind, command: session.command, sessionId: session.sessionId }),
        }, null, 2),
      },
    ],
    isError: false,
  };
}

/**
 * Format a tool execution result for MCP tools/call result.
 */
export function formatToolResult(result) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          status: result.ok ? "success" : "error",
          kind: result.kind,
          command: result.command,
          ...(result.parsed ? { data: result.parsed } : {}),
          ...(result.stdout ? { stdout: result.stdout.substring(0, 8000) } : {}),
          ...(result.stderr ? { stderr: result.stderr.substring(0, 4000) } : {}),
          ...(result.validationErrors ? { validationErrors: result.validationErrors } : {}),
          ...(result.affectedFiles ? { affectedFiles: result.affectedFiles } : {}),
          wroteFiles: result.wroteFiles,
        }, null, 2),
      },
    ],
    isError: !result.ok,
  };
}

/** Clean up expired sessions periodically. */
export function cleanupExpiredSessions() {
  const now = new Date();
  for (const [id, session] of pendingReviews) {
    if (new Date(session.expiresAt) < now) {
      pendingReviews.delete(id);
    }
  }
}
