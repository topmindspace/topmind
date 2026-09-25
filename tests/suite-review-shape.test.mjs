/**
 * The suite review must name every axis and surface, and every path a
 * `fixed` item cites must exist. Disposition tokens are read from the
 * review; this file does not restate the findings.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reviewPath = path.join(repoRoot, "docs", "suite-review-2026-09-24.md");

const { resolveSkillsRoot, resolveObsidianRoot } = await import("./helpers/sister-repos.mjs");

/** Resolve a cited token: repo-relative, or `../topmind-skills|obsidian/...` against the live checkout. */
function resolveCited(token) {
  let rel = token;
  for (const [prefix, root] of [
    ["../topmind-skills/", resolveSkillsRoot()],
    ["../topmind-obsidian/", resolveObsidianRoot()],
    ["../topmind/", repoRoot],
  ]) {
    if (root && rel.startsWith(prefix)) {
      rel = path.join(root, rel.slice(prefix.length));
      return path.resolve(rel);
    }
  }
  return path.resolve(repoRoot, rel);
}

const AXES = [
  "技能",
  "工具",
  "工作流",
  "整体方案",
  "共享层",
  "引擎",
  "设计规约",
  "数据规约",
  "CI/CD",
  "脚本",
  "依赖",
  "文档",
  "整体结构",
];

const SURFACES = ["Kernel", "Desktop", "UTR", "Clip", "Skills", "Obsidian"];
const TOKENS = ["fixed", "discussion", "non-goal"];

function loadReview() {
  assert.ok(existsSync(reviewPath), reviewPath);
  return readFileSync(reviewPath, "utf8");
}

function sections(review) {
  const parts = review.split(/^## /m).slice(1);
  return parts.map((part) => {
    const newline = part.indexOf("\n");
    const title = (newline >= 0 ? part.slice(0, newline) : part).trim();
    const body = newline >= 0 ? part.slice(newline + 1).trim() : "";
    return { title, body };
  });
}

test("suite review names the 13 axes and 6 surfaces", () => {
  const review = loadReview();
  for (const axis of AXES) {
    assert.match(review, new RegExp(`^## ${axis}$`, "m"), axis);
  }
  for (const surface of SURFACES) {
    assert.match(review, new RegExp(surface), surface);
  }
  assert.match(review, /lib\//);
  assert.match(review, /browser-extension/);
});

test("each axis has one disposition and a non-empty body", () => {
  const found = new Map(sections(loadReview()).map((section) => [section.title, section]));
  const used = new Set();
  for (const axis of AXES) {
    const section = found.get(axis);
    assert.ok(section, `missing section ${axis}`);
    assert.ok(section.body.length > 0, `${axis} body empty`);
    const hits = TOKENS.filter((token) => new RegExp(`\\b${token}\\b`).test(section.body));
    assert.deepEqual(hits, [hits[0]], `${axis} dispositions: ${hits.join(",")}`);
    assert.equal(hits.length, 1, axis);
    used.add(hits[0]);
  }
  for (const token of TOKENS) {
    assert.ok(used.has(token), `no section uses ${token}`);
  }
});

test("every repo-relative path cited by a fixed item exists", () => {
  const fixed = sections(loadReview()).filter((section) => /\bfixed\b/.test(section.body));
  assert.ok(fixed.length > 0);
  const cited = [];
  for (const section of fixed) {
    for (const match of section.body.matchAll(/`([^`]+)`/g)) {
      const token = match[1];
      if (/^(https?:|mailto:)/u.test(token)) continue;
      if (/[{}*\s]/.test(token)) continue;
      const looksLikePath = token.includes("/") || /\.[a-z0-9]+$/iu.test(token);
      if (!looksLikePath) continue;
      cited.push({ axis: section.title, token });
    }
  }
  assert.ok(cited.length > 0, "fixed sections should cite paths");
  for (const { axis, token } of cited) {
    if (token.startsWith("../topmind-skills/") && !resolveSkillsRoot()) continue;
    if (token.startsWith("../topmind-obsidian/") && !resolveObsidianRoot()) continue;
    const abs = resolveCited(token);
    assert.ok(existsSync(abs), `${axis} cites missing path ${token}`);
  }
});
