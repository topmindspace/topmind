#!/usr/bin/env node
/**
 * Keep only the newest KEEP (default 2) GitHub Releases; delete older ones.
 *
 * Policy (product rule): each repo keeps the latest 2 releases — older ships
 * are cleaned so the Releases page stays current and storage does not grow.
 *
 * Usage (CI or local with GH_TOKEN / gh auth):
 *   node scripts/prune-releases.mjs [--keep 2] [--repo owner/name] [--dry-run]
 *
 * Never deletes the release just published when it is within the keep window.
 * Drafts are counted; pre-releases are counted. Tags of deleted releases are
 * left in git (release assets go away with the release).
 */
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith("--")) return args[i + 1];
  return fallback;
}
const KEEP = Math.max(1, Number(flag("keep", "2")) || 2);
const REPO = flag("repo", process.env.GITHUB_REPOSITORY || "");
const DRY = args.includes("--dry-run");

if (!REPO) {
  console.error("[prune-releases] --repo owner/name or GITHUB_REPOSITORY required");
  process.exit(1);
}

function gh(args_, opts = {}) {
  return execFileSync("gh", args_, {
    encoding: "utf8",
    env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "" },
    ...opts,
  });
}

function listReleases() {
  const out = gh([
    "api",
    `repos/${REPO}/releases`,
    "--paginate",
    "--jq",
    "[.[] | {id, tag_name, draft, prerelease, created_at, published_at}]",
  ]);
  // --paginate with a JSON array jq may emit multiple arrays; flatten
  const parts = out.split("\n").filter(Boolean);
  const all = [];
  for (const p of parts) {
    try {
      const j = JSON.parse(p);
      if (Array.isArray(j)) all.push(...j);
    } catch {
      /* skip */
    }
  }
  // Newest first: prefer published_at, fall back to created_at
  all.sort((a, b) => {
    const ta = Date.parse(a.published_at || a.created_at || 0);
    const tb = Date.parse(b.published_at || b.created_at || 0);
    return tb - ta;
  });
  return all;
}

function deleteRelease(id, tag) {
  if (DRY) {
    console.log(`[prune-releases] DRY would delete release id=${id} tag=${tag}`);
    return;
  }
  try {
    gh(["api", "-X", "DELETE", `repos/${REPO}/releases/${id}`]);
    console.log(`[prune-releases] deleted release id=${id} tag=${tag}`);
  } catch (e) {
    console.warn(`[prune-releases] failed to delete ${tag}: ${e.message}`);
  }
}

const releases = listReleases();
console.log(`[prune-releases] repo=${REPO} keep=${KEEP} total=${releases.length}${DRY ? " (dry-run)" : ""}`);
const doomed = releases.slice(KEEP);
for (const r of doomed) {
  deleteRelease(r.id, r.tag_name);
}
console.log(`[prune-releases] done. kept=${Math.min(KEEP, releases.length)} removed=${doomed.length}`);
