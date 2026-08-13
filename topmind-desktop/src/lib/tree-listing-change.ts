/**
 * Pure “listing change vs content-only save” decision for the category tree.
 * Kept off React so tests can drive watcher / ingest / clip payloads.
 */
import type { Selection } from "../types";
import { expandIdsForSelection } from "./tree-reveal";

export type TreeFileChangeKind = "listing" | "content";

export type TreeFileChangeSection =
  | "inbox"
  | "outputs"
  | "archive"
  | "memory"
  | "category"
  | "topic"
  | "";

export type ParsedFileChange = {
  relativePath: string;
  event: string;
  topicId: string;
  source: string;
  listingHint: boolean;
};

export type TreeFileChangeDecision = {
  kind: TreeFileChangeKind;
  relativePath: string;
  topicId: string;
  section: TreeFileChangeSection;
};

const LISTING_EVENTS = new Set(["add", "unlink", "addDir", "unlinkDir"]);
const LISTING_SOURCES = new Set(["ingest", "clip"]);

function posixRel(raw: string): string {
  return String(raw || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//u, "")
    .replace(/^\/+/u, "");
}

function partsOf(rel: string): string[] {
  return posixRel(rel).split("/").filter(Boolean);
}

function rootOf(rel: string): string {
  return partsOf(rel)[0] || "";
}

function pickString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === "string" ? v : "";
}

/** Buffer / inbox (role, not a hardcoded folder name). */
export function isBufferRootPath(rel: string): boolean {
  const root = rootOf(rel);
  return /^00([- ]|$)/u.test(root) || /inbox/iu.test(root);
}

export function isDeliveryRootPath(rel: string): boolean {
  const root = rootOf(rel);
  return /^88([- ]|$)/u.test(root) || /outputs?/iu.test(root);
}

export function isSystemRootPath(rel: string): boolean {
  const root = rootOf(rel);
  return /^99([- ]|$)/u.test(root) || /archive/iu.test(root);
}

export function isMemoryPath(rel: string): boolean {
  return rootOf(rel).toLowerCase() === "memory";
}

export function topicIdFromRelativePath(rel: string): string {
  const parts = partsOf(rel);
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : "";
}

export function sectionForRelativePath(rel: string): TreeFileChangeSection {
  if (!rel) return "";
  if (isBufferRootPath(rel)) return "inbox";
  if (isDeliveryRootPath(rel)) return "outputs";
  if (isSystemRootPath(rel)) return "archive";
  if (isMemoryPath(rel)) return "memory";
  const parts = partsOf(rel);
  if (parts.length <= 2) return "category";
  return "topic";
}

/** Normalize watcher / clip / ingest / editor payloads. */
export function parseFileChangedPayload(payload: unknown): ParsedFileChange {
  if (!payload || typeof payload !== "object") {
    return { relativePath: "", event: "", topicId: "", source: "", listingHint: false };
  }
  const obj = payload as Record<string, unknown>;
  const relativePath = posixRel(
    pickString(obj, "relativePath") || pickString(obj, "path") || pickString(obj, "targetPath"),
  );
  const event = pickString(obj, "event").trim();
  const topicId = pickString(obj, "topicId") || topicIdFromRelativePath(relativePath);
  const source = pickString(obj, "source").trim().toLowerCase();
  const listingHint = obj.listing === true || obj.listing === "true";
  return { relativePath, event, topicId, source, listingHint };
}

/**
 * Listing = rebuild inbox / outputs / archive / category-root topology.
 * Content = topic-internal save; tree may do a targeted children reload.
 */
export function classifyTreeFileChange(payload: unknown): TreeFileChangeDecision {
  const parsed = parseFileChangedPayload(payload);
  const relativePath = parsed.relativePath;
  const section = sectionForRelativePath(relativePath);
  const topicId = parsed.topicId;

  if (parsed.listingHint || LISTING_SOURCES.has(parsed.source) || LISTING_EVENTS.has(parsed.event)) {
    return { kind: "listing", relativePath, topicId, section };
  }
  if (!relativePath) {
    return { kind: "listing", relativePath: "", topicId, section: "" };
  }
  if (section === "inbox" || section === "outputs" || section === "archive" || section === "memory") {
    return { kind: "listing", relativePath, topicId, section };
  }
  if (section === "category") {
    return { kind: "listing", relativePath, topicId, section };
  }
  return { kind: "content", relativePath, topicId, section: "topic" };
}

export function inboxChildCount(
  tree: { id: string; children?: unknown[] }[] | null | undefined,
): number {
  const node = (tree || []).find((n) => n.id === "section/inbox");
  return Array.isArray(node?.children) ? node.children.length : 0;
}

/** Expand inbox after empty→non-empty, or when the selection lives under inbox. */
export function shouldExpandInboxSection(opts: {
  prevInboxCount: number;
  nextInboxCount: number;
  selection?: Selection | null;
}): boolean {
  if (opts.nextInboxCount <= 0) return false;
  if (opts.prevInboxCount === 0) return true;
  const sel = opts.selection;
  if (!sel) return false;
  return expandIdsForSelection(sel).includes("section/inbox");
}
