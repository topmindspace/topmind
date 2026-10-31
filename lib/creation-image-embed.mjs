/** Resolve Obsidian raster image embeds for a read-only creation snapshot. */
import fs from "node:fs";
import path from "node:path";
import { loadVaultIgnoreSync, pathMatchesUserIgnore, shouldSkipVaultDirName } from "./vault-walk.mjs";

const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp)$/iu;
const MAX_WALK_ENTRIES = 100_000;

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    const repaired = segment.replace(/%(?![0-9a-f]{2})/giu, "%25");
    try { return decodeURIComponent(repaired); } catch { return segment; }
  }
}

/** Conservative raster embed grammar; unsafe decoded paths stay unresolved. */
export function parseCreationImageEmbed(inner) {
  const text = String(inner || "").trim();
  if (!text || /[\x00-\x1f#]/u.test(text)) return null;
  const pipe = text.indexOf("|");
  const raw = (pipe >= 0 ? text.slice(0, pipe) : text).trim().replace(/\\/gu, "/");
  const target = raw.split("/").map(decodeSegment).join("/");
  if (!target || target.startsWith("/") || /^[a-z][a-z\d+.-]*:/iu.test(target) ||
      target.split("/").some((part) => !part || part === "." || part === "..") ||
      !IMAGE_EXT.test(target)) return null;
  return { target, suffix: pipe >= 0 ? text.slice(pipe + 1).trim() : "", inner: text };
}

/** Resolve a note's embeds in one bounded walk; pathless names must be unique. */
export function resolveCreationImageEmbeds(workspaceRoot, targets) {
  const unique = [...new Set(targets)];
  const results = new Map(unique.filter((target) => target.includes("/"))
    .map((target) => [target, { status: "found", relativePath: target }]));
  const wanted = new Map(unique.filter((target) => !target.includes("/"))
    .map((target) => [target.toLowerCase(), []]));
  if (wanted.size === 0) return results;
  const ignore = loadVaultIgnoreSync(workspaceRoot);
  let visited = 0;
  const walk = (directory, prefix) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (++visited > MAX_WALK_ENTRIES) return false;
      if (!entry.name || entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (pathMatchesUserIgnore(relativePath, ignore)) continue;
      if (entry.isDirectory()) {
        if (!shouldSkipVaultDirName(entry.name) && !walk(path.join(directory, entry.name), relativePath)) return false;
      } else if (entry.isFile() && wanted.has(entry.name.toLowerCase())) {
        const matches = wanted.get(entry.name.toLowerCase());
        if (matches.length < 2) matches.push(relativePath);
      }
    }
    return true;
  };
  const complete = walk(workspaceRoot, "");
  for (const target of unique) {
    if (target.includes("/")) continue;
    const matches = wanted.get(target.toLowerCase());
    results.set(target, !complete ? { status: "scan-incomplete" }
      : matches.length > 1 ? { status: "ambiguous" }
        : matches.length === 0 ? { status: "missing" }
          : { status: "found", relativePath: matches[0] });
  }
  return results;
}
