/**
 * Clip destination modes — single source of truth.
 *
 * Used by:
 *  - clip-bridge.mjs (resolveClipDest whitelist for HTTP payload)
 *  - workspace-inbox-ops.mjs (ingestInbox dest.mode validation)
 *
 * Keep in sync: any new mode must be handled in BOTH call sites.
 */
export const CLIP_DEST_MODES = Object.freeze(["inbox", "stream", "topic", "category"]);
