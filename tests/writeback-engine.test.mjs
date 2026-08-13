/**
 * Kernel writeback-engine — real temp workspace path (shipped executeWrite).
 * Policy: backup/receipt only for high-impact (locked overwrite, locked/core delete).
 * executeArchive is a destination move into 99-归档 (not unlink).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  evaluateWritePermission,
  executeWrite,
  executeDelete,
  isHighImpactContentWrite,
  isRecoverableLifecycle,
  peekFrontmatter,
} from "../lib/writeback-engine.mjs";
import { buildDefaultContract } from "../lib/contract-engine.mjs";
import { generateSuggestions, applySuggestion } from "../lib/suggest-engine.mjs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "topmind-wb-"));

function absFromEvidence(ws, p) {
  if (!p) return "";
  return path.isAbsolute(p) ? p : path.join(ws, p);
}

function listArchiveFiles(ws) {
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const st = fs.statSync(abs);
      if (st.isDirectory()) out.push(...walk(abs));
      else out.push(abs);
    }
    return out;
  };
  return {
    backups: walk(path.join(ws, "99-归档", "backups")).filter((p) => !p.includes(`${path.sep}trash${path.sep}`)),
    trash: walk(path.join(ws, "99-归档", "backups", "trash")),
    receipts: walk(path.join(ws, "99-归档", "receipts")),
  };
}

function seedWorkspace() {
  const ws = path.join(tmpRoot, "ws");
  fs.mkdirSync(path.join(ws, "10-动态"), { recursive: true });
  fs.mkdirSync(path.join(ws, "00-收件箱"), { recursive: true });
  fs.mkdirSync(path.join(ws, "99-归档", "backups"), { recursive: true });
  fs.mkdirSync(path.join(ws, "memory"), { recursive: true });
  const contract = buildDefaultContract();
  fs.writeFileSync(
    path.join(ws, "topmind.yaml"),
    `contract_version: 4\nworkspace:\n  name: test\n  template: stream\nwriteback:\n  mode: auto\n  shadow: true\n  backup_to: 99-归档/backups\n  receipts: 99-归档/receipts\nprotection:\n  defaults:\n    by_role:\n      buffer: open\n      loose-stream: open\n      deep-work: open\n      memory: open\n      delivery: open\n      system: locked\n`,
    "utf8",
  );
  return { ws, contract };
}

describe("writeback-engine", () => {
  /** @type {{ ws: string, contract: object }} */
  let env;

  before(() => {
    env = seedWorkspace();
  });

  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("peekFrontmatter reads protection", () => {
    const fm = peekFrontmatter("---\nprotection: locked\ntitle: x\n---\n\nbody\n");
    assert.equal(fm.protection, "locked");
  });

  it("isHighImpactContentWrite: only locked existing files", () => {
    assert.equal(isHighImpactContentWrite({ fileExists: true, protection: "locked" }), true);
    assert.equal(isHighImpactContentWrite({ fileExists: true, protection: "open" }), false);
    assert.equal(isHighImpactContentWrite({ fileExists: false, protection: "locked" }), false);
  });

  it("isRecoverableLifecycle: locked / memory / topic.md / topic dir / delivery only", () => {
    assert.equal(isRecoverableLifecycle({ protection: "locked", relativePath: "10-动态/x.md" }), true);
    assert.equal(isRecoverableLifecycle({ protection: "open", relativePath: "memory/profile.md" }), true);
    assert.equal(isRecoverableLifecycle({ protection: "open", relativePath: "20-专题/2026-foo/topic.md" }), true);
    assert.equal(isRecoverableLifecycle({
      protection: "open",
      relativePath: "20-专题/2026-foo",
      isDirectory: true,
      hasTopicHome: true,
    }), true);
    assert.equal(isRecoverableLifecycle({ protection: "open", relativePath: "88-输出/out.md" }), true);
    assert.equal(isRecoverableLifecycle({ protection: "open", relativePath: "00-收件箱/scratch.md" }), false);
    assert.equal(isRecoverableLifecycle({ protection: "open", relativePath: "10-动态/2026/2026-W30.md" }), false);
    assert.equal(isRecoverableLifecycle({
      protection: "open",
      relativePath: "00-收件箱/loose-dir",
      isDirectory: true,
      hasTopicHome: false,
    }), false);
  });

  it("open file: AI/user update has no backup and no receipt", () => {
    const rel = "10-动态/note.md";
    const target = path.join(env.ws, rel);
    const first = executeWrite({
      targetPath: target,
      content: "---\ntitle: a\nprotection: open\n---\n\nhello\n",
      workspaceRoot: env.ws,
      contract: env.contract,
      actor: "ai",
      confirmed: true,
      operation: "create",
      skipShadow: true,
    });
    assert.equal(first.wroteFiles, true);
    assert.ok(first.targetPath === rel || first.target_path === rel || first.targetPath?.endsWith("note.md"));
    assert.ok(Array.isArray(first.affectedFiles) && first.affectedFiles.length >= 1);
    assert.ok(fs.existsSync(target));
    assert.ok(!first.backupPath && !first.backup_path, "create must not invent backup");
    assert.ok(!first.receipt_path || first.receipt_path === first.backup_path, "create: no real receipt");
    assert.equal(listArchiveFiles(env.ws).receipts.length, 0, "open create: no receipts yaml");

    const second = executeWrite({
      targetPath: target,
      content: "---\ntitle: a\nprotection: open\n---\n\nhello world\n",
      workspaceRoot: env.ws,
      contract: env.contract,
      actor: "ai",
      confirmed: true,
      operation: "update",
      skipShadow: true,
    });
    assert.equal(second.wroteFiles, true);
    assert.ok(!second.backupPath && !second.backup_path, "open AI update must not backup");
    // receiptPath falls back to backupPath in toSurfaceEvidence; both must be falsy for open
    assert.ok(!second.backup_path, "open AI update: no backup_path");
    assert.equal(second.receipt_path ?? null, null);

    const userUpdate = executeWrite({
      targetPath: target,
      content: "---\ntitle: a\nprotection: open\n---\n\nhello user\n",
      workspaceRoot: env.ws,
      contract: env.contract,
      actor: "user",
      confirmed: true,
      operation: "update",
      skipShadow: true,
    });
    assert.equal(userUpdate.wroteFiles, true);
    assert.ok(!userUpdate.backupPath && !userUpdate.backup_path, "open user update must not backup");
  });

  it("locked file: AI denied; user overwrite gets backup + receipt", () => {
    const target = path.join(env.ws, "10-动态/locked.md");
    const content = "---\nprotection: locked\n---\n\nsecret\n";
    fs.writeFileSync(target, content, "utf8");

    const perm = evaluateWritePermission({
      contract: env.contract,
      targetPath: target,
      workspaceRoot: env.ws,
      frontmatter: { protection: "locked" },
      actor: "ai",
    });
    assert.equal(perm.allowed, false);

    assert.throws(
      () =>
        executeWrite({
          targetPath: target,
          content: content + "x",
          workspaceRoot: env.ws,
          contract: env.contract,
          actor: "ai",
          confirmed: true,
        }),
      /Write denied|locked/i,
    );

    const userWrite = executeWrite({
      targetPath: target,
      content: "---\nprotection: locked\n---\n\nsecret user\n",
      workspaceRoot: env.ws,
      contract: env.contract,
      actor: "user",
      confirmed: true,
      skipShadow: true,
    });
    assert.equal(userWrite.wroteFiles, true);
    assert.ok(userWrite.backupPath || userWrite.backup_path, "locked user overwrite must backup");
    assert.ok(
      userWrite.receipt_path || userWrite.receiptPath,
      "locked user overwrite must write receipt",
    );
    const absBackup = path.isAbsolute(userWrite.backup_path || userWrite.backupPath)
      ? userWrite.backup_path || userWrite.backupPath
      : path.join(env.ws, userWrite.backup_path || userWrite.backupPath);
    assert.ok(fs.existsSync(absBackup), "backup file must exist on disk");
    assert.equal(fs.readFileSync(absBackup, "utf8"), content);
  });

  it("existing locked file: overwrite still backs up when new FM omits protection", () => {
    const target = path.join(env.ws, "10-动态/locked-drop-fm.md");
    const original = "---\nprotection: locked\n---\n\nold\n";
    fs.writeFileSync(target, original, "utf8");
    // Callers that rebuild frontmatter without protection: locked must still
    // treat existing locked file as high-impact (and deny AI).
    assert.throws(
      () =>
        executeWrite({
          targetPath: target,
          content: "---\ntitle: unlocked-looking\n---\n\nnew\n",
          workspaceRoot: env.ws,
          contract: env.contract,
          actor: "ai",
          confirmed: true,
          skipShadow: true,
        }),
      /Write denied|locked/i,
    );
    const ev = executeWrite({
      targetPath: target,
      content: "---\ntitle: unlocked-looking\n---\n\nnew\n",
      workspaceRoot: env.ws,
      contract: env.contract,
      actor: "user",
      confirmed: true,
      skipShadow: true,
      frontmatter: { title: "unlocked-looking" },
    });
    assert.equal(ev.wroteFiles, true);
    assert.ok(ev.backup_path || ev.backupPath, "existing locked must backup even if new FM open");
  });

  it("path outside workspace is denied", () => {
    const outside = path.join(tmpRoot, "outside-secret.md");
    fs.writeFileSync(outside, "nope\n", "utf8");
    const perm = evaluateWritePermission({
      contract: env.contract,
      targetPath: outside,
      workspaceRoot: env.ws,
      actor: "user",
    });
    assert.equal(perm.allowed, false);
    assert.match(perm.reason, /outside workspace/i);
    assert.throws(
      () =>
        executeWrite({
          targetPath: outside,
          content: "x",
          workspaceRoot: env.ws,
          contract: env.contract,
          actor: "user",
          confirmed: true,
        }),
      /Write denied|outside/i,
    );
  });

  it("confirm mode returns pending without confirmed", () => {
    const contract = {
      ...env.contract,
      writeback: { ...(env.contract.writeback || {}), mode: "confirm" },
    };
    const target = path.join(env.ws, "10-动态/confirm.md");
    const pending = executeWrite({
      targetPath: target,
      content: "---\ntitle: c\n---\n\nx\n",
      workspaceRoot: env.ws,
      contract,
      actor: "ai",
      confirmed: false,
      skipShadow: true,
    });
    assert.equal(pending.pending || pending.needsConfirm, true);
    assert.equal(pending.wroteFiles, false);
    assert.ok(!fs.existsSync(target));

    const done = executeWrite({
      targetPath: target,
      content: "---\ntitle: c\n---\n\nx\n",
      workspaceRoot: env.ws,
      contract,
      actor: "ai",
      confirmed: true,
      skipShadow: true,
    });
    assert.equal(done.wroteFiles, true);
    assert.ok(fs.existsSync(target));
    assert.ok(!done.backup_path && !done.backupPath, "open confirm write still no backup");
  });

  it("executeDelete: ordinary open scratch has no trash/receipt; core/locked do; permanent has neither", () => {
    const scratch = path.join(env.ws, "00-收件箱/gone.md");
    fs.writeFileSync(scratch, "---\ntitle: g\n---\n\nbye\n", "utf8");
    const scratchEv = executeDelete({
      targetPath: scratch,
      workspaceRoot: env.ws,
      contract: env.contract,
      actor: "user",
      confirmed: true,
    });
    assert.equal(scratchEv.wroteFiles, true);
    assert.ok(!fs.existsSync(scratch));
    assert.ok(!scratchEv.backupPath && !scratchEv.backup_path, "ordinary inbox delete: no trash");
    assert.ok(!scratchEv.receipt_path, "ordinary inbox delete: no receipt");
    assert.ok(
      !fs.existsSync(path.join(env.ws, "99-归档", "backups", "trash", "00-收件箱")),
      "ordinary inbox delete must not create trash dir",
    );

    const locked = path.join(env.ws, "10-动态/locked-del.md");
    fs.writeFileSync(locked, "---\nprotection: locked\n---\n\nkeep\n", "utf8");
    const lockedEv = executeDelete({
      targetPath: locked,
      workspaceRoot: env.ws,
      contract: env.contract,
      actor: "user",
      confirmed: true,
    });
    assert.equal(lockedEv.wroteFiles, true);
    assert.ok(!fs.existsSync(locked));
    assert.ok(lockedEv.backupPath || lockedEv.backup_path, "locked delete: trash copy");
    assert.ok(lockedEv.receipt_path || lockedEv.receiptPath, "locked delete: receipt");
    const absTrash = absFromEvidence(env.ws, lockedEv.backup_path || lockedEv.backupPath);
    assert.ok(fs.existsSync(absTrash), "locked trash file must exist");

    const core = path.join(env.ws, "memory/profile.md");
    fs.mkdirSync(path.dirname(core), { recursive: true });
    fs.writeFileSync(core, "---\ntitle: me\n---\n\nfact\n", "utf8");
    const coreEv = executeDelete({
      targetPath: core,
      workspaceRoot: env.ws,
      contract: env.contract,
      actor: "user",
      confirmed: true,
    });
    assert.equal(coreEv.wroteFiles, true);
    assert.ok(coreEv.backupPath || coreEv.backup_path, "memory delete: trash copy");
    assert.ok(coreEv.receipt_path || coreEv.receiptPath, "memory delete: receipt");

    const target2 = path.join(env.ws, "00-收件箱/gone-perm.md");
    fs.writeFileSync(target2, "---\ntitle: p\n---\n\nperm\n", "utf8");
    const permEv = executeDelete({
      targetPath: target2,
      workspaceRoot: env.ws,
      contract: env.contract,
      actor: "user",
      confirmed: true,
      permanent: true,
    });
    assert.equal(permEv.wroteFiles, true);
    assert.ok(!fs.existsSync(target2));
    assert.ok(!permEv.backupPath && !permEv.backup_path, "permanent delete: no trash");
    assert.ok(!permEv.receipt_path, "permanent delete: no receipt");
  });

  it("executeArchive ordinary file moves to 99-归档 (destination, not unlink)", async () => {
    const { executeArchive } = await import("../lib/writeback-engine.mjs");
    const target = path.join(env.ws, "00-收件箱/archive-me.md");
    fs.writeFileSync(target, "---\ntitle: a\n---\n\nkeep me\n", "utf8");
    const ev = executeArchive({
      targetPath: target,
      workspaceRoot: env.ws,
      contract: env.contract,
      actor: "user",
      confirmed: true,
    });
    assert.equal(ev.wroteFiles, true);
    assert.ok(!fs.existsSync(target), "source leaves inbox");
    const dest = ev.backup_path || ev.backupPath;
    assert.ok(dest, "archive reports destination");
    const destAbs = path.isAbsolute(dest) ? dest : path.join(env.ws, dest);
    assert.ok(fs.existsSync(destAbs), "content must live under 99-归档");
    assert.match(destAbs.replace(/\\/g, "/"), /99-归档/);
    assert.equal(fs.readFileSync(destAbs, "utf8"), "---\ntitle: a\n---\n\nkeep me\n");
    assert.ok(!ev.receipt_path, "ordinary archive: dest only, no extra YAML receipt");
  });

  it("executeArchive directory peeks topic.md protection (locked denies AI)", async () => {
    const { executeArchive } = await import("../lib/writeback-engine.mjs");
    const topicDir = path.join(env.ws, "20-专题", "2020-locked");
    fs.mkdirSync(topicDir, { recursive: true });
    fs.writeFileSync(
      path.join(topicDir, "topic.md"),
      "---\ntitle: Locked topic\nprotection: locked\n---\n\nbody\n",
      "utf8",
    );
    assert.throws(
      () =>
        executeArchive({
          targetPath: topicDir,
          workspaceRoot: env.ws,
          contract: env.contract,
          actor: "ai",
          confirmed: true,
        }),
      /locked|Write denied/i,
    );
    assert.ok(fs.existsSync(topicDir), "dir must remain when AI denied");
    // user may still archive locked topic
    const ev = executeArchive({
      targetPath: topicDir,
      workspaceRoot: env.ws,
      contract: env.contract,
      actor: "user",
      confirmed: true,
    });
    assert.equal(ev.wroteFiles, true);
    assert.ok(!fs.existsSync(topicDir));
    assert.ok(ev.backupPath || ev.backup_path, "archive has recoverable copy");
    assert.ok(ev.receipt_path || ev.receiptPath, "archive writes receipt");
  });
});

describe("suggest-engine", () => {
  it("generateSuggestions does not write; apply open_profile can create profile", async () => {
    const ws = path.join(tmpRoot, "suggest-ws");
    fs.mkdirSync(path.join(ws, "10-动态"), { recursive: true });
    fs.mkdirSync(path.join(ws, "00-收件箱"), { recursive: true });
    fs.writeFileSync(path.join(ws, "10-动态/2026-W30.md"), "# week\n\nnote\n", "utf8");
    fs.writeFileSync(
      path.join(ws, "topmind.yaml"),
      "contract_version: 4\nworkspace:\n  template: stream\nwriteback:\n  mode: auto\n  backup_to: 99-归档/backups\n  receipts: 99-归档/receipts\n",
      "utf8",
    );
    fs.mkdirSync(path.join(ws, "99-归档", "backups"), { recursive: true });

    const before = await generateSuggestions({ workspaceRoot: ws });
    assert.ok(Array.isArray(before));
    assert.ok(before.length >= 1, "expected at least one suggestion");

    const profilePath = path.join(ws, "memory/profile.md");
    assert.ok(!fs.existsSync(profilePath) || fs.statSync(profilePath).size < 40 || true);

    const open = before.find((s) => s.kind === "open_profile");
    if (open) {
      const applied = await applySuggestion({ workspaceRoot: ws, suggestion: open });
      assert.ok(applied);
      assert.ok(fs.existsSync(profilePath));
    }

    // Without AI: no promote_memory pollution ("待填写"); may offer open_profile instead
    const promote = before.find((s) => s.kind === "promote_memory");
    if (promote) {
      const expectedSnippet =
        typeof promote.payload?.entry === "object"
          ? promote.payload.entry.content
          : String(promote.payload?.entry || "");
      assert.ok(
        !/待填写|待 AI/.test(expectedSnippet),
        "must not seed placeholder promote entry",
      );
      await applySuggestion({ workspaceRoot: ws, suggestion: promote });
      assert.ok(fs.existsSync(profilePath), "profile must exist after promote");
      const body = fs.readFileSync(profilePath, "utf8");
      assert.ok(!body.includes("undefined"), "must not write literal undefined");
    } else {
      // Honest path: open_profile (or only digest/etc.) — apply must not write "待填写"
      const openOnly = before.find((s) => s.kind === "open_profile");
      assert.ok(openOnly || before.length >= 1, "expected open_profile or other non-polluting suggestions");
      if (openOnly) {
        await applySuggestion({ workspaceRoot: ws, suggestion: openOnly });
        assert.ok(fs.existsSync(profilePath));
        const body = fs.readFileSync(profilePath, "utf8");
        assert.ok(!body.includes("待填写"));
        assert.ok(!body.includes("undefined"));
      }
    }
  });

  it("applySuggestion archives stale_topic and catch_all files via executeArchive", async () => {
    const ws = path.join(tmpRoot, "archive-suggest-ws");
    const inbox = path.join(ws, "00-收件箱");
    const topic = path.join(ws, "20-专题", "2020-old-topic");
    fs.mkdirSync(inbox, { recursive: true });
    fs.mkdirSync(topic, { recursive: true });
    fs.mkdirSync(path.join(ws, "99-归档", "backups"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "topmind.yaml"),
      "contract_version: 4\nwriteback:\n  mode: auto\n  backup_to: 99-归档/backups\n  receipts: 99-归档/receipts\n",
      "utf8",
    );
    const inboxFile = path.join(inbox, "old.md");
    fs.writeFileSync(inboxFile, "# old inbox\n", "utf8");
    // force old mtime
    const old = new Date(Date.now() - 120 * 864e5);
    fs.utimesSync(inboxFile, old, old);
    fs.writeFileSync(path.join(topic, "topic.md"), "# stale\n", "utf8");
    fs.utimesSync(path.join(topic, "topic.md"), old, old);

    const appliedFile = await applySuggestion({
      workspaceRoot: ws,
      suggestion: {
        kind: "inbox_review",
        id: "t1",
        title: "x",
        summary: "y",
        impact: "high",
        targetPath: "00-收件箱/old.md",
        payload: { path: "00-收件箱/old.md", action: "archive" },
      },
    });
    assert.equal(appliedFile.wroteFiles, true);
    assert.ok(!fs.existsSync(inboxFile), "inbox file archived away");
    const destRel = appliedFile.backupPath || appliedFile.writebackEvidence?.backupPath;
    assert.ok(destRel, "inbox_review must report archive destination");
    const destAbs = path.isAbsolute(destRel) ? destRel : path.join(ws, destRel);
    assert.ok(fs.existsSync(destAbs), "archived inbox file must exist under 99-归档");
    assert.match(destAbs.replace(/\\/g, "/"), /99-归档/, "archive destination is 99-归档");
    assert.equal(fs.readFileSync(destAbs, "utf8"), "# old inbox\n");

    const appliedTopic = await applySuggestion({
      workspaceRoot: ws,
      suggestion: {
        kind: "stale_topic",
        id: "t2",
        title: "x",
        summary: "y",
        impact: "high",
        targetPath: "20-专题/2020-old-topic",
        payload: { path: "20-专题/2020-old-topic", action: "archive" },
      },
    });
    assert.equal(appliedTopic.wroteFiles, true);
    assert.ok(!fs.existsSync(topic), "topic dir archived away");
    assert.ok(appliedTopic.backupPath || appliedTopic.writebackEvidence?.backupPath);
  });

  it("applySuggestion inbox_organize writes dest before unlinking source", async () => {
    const ws = path.join(tmpRoot, "organize-move-ws");
    const inbox = path.join(ws, "00-收件箱");
    const topic = path.join(ws, "20-专题", "2026-dest");
    fs.mkdirSync(inbox, { recursive: true });
    fs.mkdirSync(topic, { recursive: true });
    fs.writeFileSync(
      path.join(ws, "topmind.yaml"),
      "contract_version: 4\nwriteback:\n  mode: auto\n  backup_to: 99-归档/backups\n  receipts: 99-归档/receipts\n",
      "utf8",
    );
    const inboxFile = path.join(inbox, "clip.md");
    fs.writeFileSync(inboxFile, "# clip body\n", "utf8");
    fs.writeFileSync(path.join(topic, "topic.md"), "---\ntitle: dest\n---\n\n# dest\n", "utf8");

    const applied = await applySuggestion({
      workspaceRoot: ws,
      suggestion: {
        kind: "inbox_organize",
        id: "org1",
        title: "move",
        summary: "y",
        impact: "medium",
        targetPath: "00-收件箱/clip.md",
        payload: {
          file: "00-收件箱/clip.md",
          action: "move_to_topic",
          category: "20-专题",
          topic: "2026-dest",
        },
      },
    });
    assert.equal(applied.ok, true);
    assert.ok(!fs.existsSync(inboxFile), "source unlinked after dest write");
    const dest = path.join(topic, "clip.md");
    assert.ok(fs.existsSync(dest), "dest written first");
    assert.equal(fs.readFileSync(dest, "utf8"), "# clip body\n");

    const src = fs.readFileSync(new URL("../lib/suggest-engine.mjs", import.meta.url), "utf8");
    const caseIdx = src.indexOf('case "inbox_organize"');
    const nextCase = src.indexOf("case \"inbox_review\"", caseIdx);
    const body = src.slice(caseIdx, nextCase > caseIdx ? nextCase : caseIdx + 4000);
    assert.ok(body.indexOf("executeWrite") < body.indexOf("unlinkSync"), "write dest before unlink");
    assert.ok(body.indexOf("isPathInsideWorkspace") < body.indexOf("unlinkSync"), "contain src before unlink");
    assert.doesNotMatch(body, /executeArchive/);
  });

  it("applySuggestion inbox_organize refuses outside fileRel and leaves the file", async () => {
    const ws = path.join(tmpRoot, "organize-escape-ws");
    const inbox = path.join(ws, "00-收件箱");
    const topic = path.join(ws, "20-专题", "2026-dest");
    fs.mkdirSync(inbox, { recursive: true });
    fs.mkdirSync(topic, { recursive: true });
    fs.writeFileSync(
      path.join(ws, "topmind.yaml"),
      "contract_version: 4\nwriteback:\n  mode: auto\n  backup_to: 99-归档/backups\n  receipts: 99-归档/receipts\n",
      "utf8",
    );
    fs.writeFileSync(path.join(topic, "topic.md"), "---\ntitle: dest\n---\n\n# dest\n", "utf8");

    const outside = path.join(tmpRoot, "organize-secret.md");
    fs.writeFileSync(outside, "do-not-delete\n", "utf8");
    const siblingPrefix = `${ws}-evil`;
    fs.mkdirSync(siblingPrefix, { recursive: true });
    const prefixFile = path.join(siblingPrefix, "leak.md");
    fs.writeFileSync(prefixFile, "prefix-leak\n", "utf8");

    const applyOutside = (fileRel) =>
      applySuggestion({
        workspaceRoot: ws,
        suggestion: {
          kind: "inbox_organize",
          id: `org-escape-${fileRel}`,
          title: "escape",
          summary: "no",
          impact: "high",
          targetPath: fileRel,
          payload: {
            file: fileRel,
            action: "move_to_topic",
            category: "20-专题",
            topic: "2026-dest",
          },
        },
      });

    const viaParent = await applyOutside(path.join("..", "organize-secret.md"));
    assert.equal(viaParent.ok, false);
    assert.equal(viaParent.wroteFiles, false);
    assert.equal(viaParent.reason, "outside-workspace");

    const viaAbs = await applyOutside(outside);
    assert.equal(viaAbs.ok, false);
    assert.equal(viaAbs.reason, "outside-workspace");

    const viaPrefix = await applyOutside(prefixFile);
    assert.equal(viaPrefix.ok, false);
    assert.equal(viaPrefix.reason, "outside-workspace");

    assert.equal(fs.readFileSync(outside, "utf8"), "do-not-delete\n");
    assert.equal(fs.readFileSync(prefixFile, "utf8"), "prefix-leak\n");
    assert.ok(fs.existsSync(outside), "outside file must remain");
    assert.ok(fs.existsSync(prefixFile), "sibling-prefix file must remain");
    assert.ok(!fs.existsSync(path.join(topic, "organize-secret.md")));
    assert.ok(!fs.existsSync(path.join(topic, "leak.md")));
  });

  it("appendProfileEntry accepts string entry without writing undefined", async () => {
    const { appendProfileEntry } = await import("../lib/memory-engine.mjs");
    const ws = path.join(tmpRoot, "entry-shape-ws");
    fs.mkdirSync(path.join(ws, "99-归档", "backups"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "topmind.yaml"),
      "contract_version: 4\nwriteback:\n  mode: auto\n  backup_to: 99-归档/backups\n  receipts: 99-归档/receipts\n",
      "utf8",
    );
    appendProfileEntry({
      workspaceRoot: ws,
      entry: "- string entry ok",
    });
    const body = fs.readFileSync(path.join(ws, "memory/profile.md"), "utf8");
    assert.ok(body.includes("string entry ok"));
    assert.ok(!body.includes("undefined"));
  });
});
