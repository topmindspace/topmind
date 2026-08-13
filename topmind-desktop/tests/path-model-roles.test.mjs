/**
 * Desktop inboxRoot / archiveRoot / outputsRoot must follow live on-disk
 * English or renamed {NN-Name} dirs — not invent 00-收件箱 / 99-归档.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  inboxRoot, archiveRoot, outputsRoot, createWorkspaceContext,
} from "../electron/lib/path-model.mjs";
import { setEngineRoot } from "../electron/lib/workspace-home.mjs";
import { scanOps } from "../electron/lib/workspace-scan-ops.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "tm-path-roles-"));

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function seedEnglishWs(dirName = "ws-en") {
  const userWorkspaceRoot = path.join(tmpRoot, dirName);
  mkdirSync(path.join(userWorkspaceRoot, "00-Inbox"), { recursive: true });
  mkdirSync(path.join(userWorkspaceRoot, "10-Stream"), { recursive: true });
  mkdirSync(path.join(userWorkspaceRoot, "88-Outputs"), { recursive: true });
  mkdirSync(path.join(userWorkspaceRoot, "99-Archive"), { recursive: true });
  writeFileSync(
    path.join(userWorkspaceRoot, "topmind.yaml"),
    [
      "contract_version: 4",
      "workspace:",
      "  template: stream",
      "  locale: en-US",
      "writeback:",
      "  mode: auto",
      "  backup_to: 99-归档/backups",
      "  receipts: 99-归档/receipts",
      "",
    ].join("\n"),
    "utf8",
  );
  return createWorkspaceContext({ engineRoot: repoRoot, userWorkspaceRoot });
}

test("inboxRoot/archiveRoot/outputsRoot use English on-disk dirs, not invented Chinese", () => {
  setEngineRoot(repoRoot);
  const ws = seedEnglishWs();
  const inbox = inboxRoot(ws);
  const arch = archiveRoot(ws);
  const out = outputsRoot(ws);
  assert.equal(path.basename(inbox), "00-Inbox");
  assert.equal(path.basename(arch), "99-Archive");
  assert.equal(path.basename(out), "88-Outputs");
  assert.ok(existsSync(inbox));
  assert.ok(existsSync(arch));
  assert.ok(existsSync(out));
  assert.ok(!existsSync(path.join(ws.userWorkspaceRoot, "00-收件箱")));
  assert.ok(!existsSync(path.join(ws.userWorkspaceRoot, "88-输出")));
  assert.ok(!existsSync(path.join(ws.userWorkspaceRoot, "99-归档")));
});

test("scan workspaceHealth + ingest destPrefix stay on live English inbox", async () => {
  setEngineRoot(repoRoot);
  const ws = seedEnglishWs("ws-scan");
  writeFileSync(path.join(ws.userWorkspaceRoot, "00-Inbox", "note.md"), "# n\n", "utf8");

  const health = await scanOps.workspaceHealth({}, { workspaceRoot: ws });
  const inboxAbs = health.checks?.inbox?.path;
  const outAbs = health.checks?.outputs?.path;
  const archAbs = health.checks?.archive?.path;
  assert.ok(inboxAbs, "health reports inbox path");
  assert.equal(path.basename(inboxAbs), "00-Inbox");
  assert.equal(path.basename(outAbs), "88-Outputs");
  assert.equal(path.basename(archAbs), "99-Archive");
  assert.equal(health.checks.inbox.ok, true);
  assert.ok(
    !(health.issues || []).some((i) => /00-收件箱|88-输出|99-归档/.test(String(i.path || i.message || ""))),
    "health must not report invented Chinese dirs",
  );

  // Same helper ingest/clip use as destPrefix
  const destPrefix = path.basename(inboxRoot(ws));
  assert.equal(destPrefix, "00-Inbox");
  assert.ok(!existsSync(path.join(ws.userWorkspaceRoot, "00-收件箱")));
});

test("renamed slot-00 dir is buffer (00-Capture), not 00-收件箱", () => {
  setEngineRoot(repoRoot);
  const userWorkspaceRoot = path.join(tmpRoot, "ws-renamed");
  mkdirSync(path.join(userWorkspaceRoot, "00-Capture"), { recursive: true });
  mkdirSync(path.join(userWorkspaceRoot, "88-Ship"), { recursive: true });
  mkdirSync(path.join(userWorkspaceRoot, "99-Vault"), { recursive: true });
  writeFileSync(
    path.join(userWorkspaceRoot, "topmind.yaml"),
    "contract_version: 4\nworkspace:\n  template: stream\n",
    "utf8",
  );
  const ws = createWorkspaceContext({ engineRoot: repoRoot, userWorkspaceRoot });
  assert.equal(path.basename(inboxRoot(ws)), "00-Capture");
  assert.equal(path.basename(outputsRoot(ws)), "88-Ship");
  assert.equal(path.basename(archiveRoot(ws)), "99-Vault");
});
