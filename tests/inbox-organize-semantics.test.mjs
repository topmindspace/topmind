/**
 * Inbox age never implies archive. Placement (move / create topic) is the
 * preferred confirm path; batch_hint covers the no-AI case.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { generateSuggestions } = await import(path.join(root, "lib/suggest-engine.mjs"));
const { ensureContract } = await import(path.join(root, "lib/contract-engine.mjs"));

function seedWorkspace() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "topmind-inbox-sem-"));
  const contract = ensureContract(ws);
  const inbox = path.join(ws, "00-Inbox");
  fs.mkdirSync(inbox, { recursive: true });
  // Aged note (mtime 10 days ago) — past default review_after_days=7
  const oldNote = path.join(inbox, "aged-note.md");
  fs.writeFileSync(oldNote, "# aged\n\n内容足够长以便进入整理扫描窗口。".repeat(3), "utf8");
  const old = Date.now() - 10 * 24 * 60 * 60 * 1000;
  fs.utimesSync(oldNote, old, old);
  return { ws, contract };
}

test("aged Inbox notes never become per-file archive cards", async () => {
  const { ws, contract } = seedWorkspace();
  try {
    const out = await generateSuggestions({
      workspaceRoot: ws,
      contract,
      engineRoot: root,
      lastAnalyzedHash: {},
      locale: "zh",
    });
    const list = Array.isArray(out) ? out : out?.suggestions || out?.items || [];
    const archiveInbox = list.filter(
      (s) => s.kind === "inbox_review" && s.payload?.action === "archive",
    );
    assert.equal(archiveInbox.length, 0, "inbox_review must not force archive");
    const kinds = list.map((s) => s.kind);
    // Placement review surface still exists via organize.
    assert.ok(
      kinds.includes("inbox_organize") || !list.some((s) => String(s.targetPath || "").includes("00-Inbox")),
      "expected inbox_organize placement card when aged notes exist",
    );
    for (const s of list) {
      if (s.kind === "inbox_organize") {
        assert.ok(
          s.payload?.action === "batch_hint" ||
            s.payload?.action === "move_to_topic" ||
            s.payload?.action === "create_topic_and_move",
          `unexpected organize action: ${s.payload?.action}`,
        );
        assert.notEqual(s.payload?.action, "archive");
      }
    }
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("suggest-engine copy steers toward topic placement, not archive", () => {
  const src = fs.readFileSync(path.join(root, "lib/suggest-engine.mjs"), "utf8");
  assert.match(src, /inboxReviewTitle:\s*"Inbox 待归位"/u);
  assert.doesNotMatch(src, /确认后可归档到 99-归档/u);
  assert.match(src, /create_topic_and_move/u);
  assert.match(src, /不要仅因笔记较旧就建议归档/u);
});

test("Desktop ActionStore does not force archive for inbox_review", () => {
  const src = fs.readFileSync(
    path.join(root, "topmind-desktop/src/stores/action-store.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    src,
    /item\.suggestionKind === 'inbox_review'\s*\n\s*\|\| item\.suggestionKind === 'stale_topic'/u,
  );
  assert.match(src, /item\.suggestionKind === 'stale_topic'\s*\n\s*\|\| item\.suggestionKind === 'catch_all'/u);
});
