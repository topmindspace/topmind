/**
 * Kernel ingest routing — shipped resolveIngestRoute on temp workspace.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { resolveIngestRoute } from "../lib/ingest-pipeline.mjs";
import { buildDefaultContract } from "../lib/contract-engine.mjs";
import { stashPendingWrite, listPendingWrites, takePendingWrite, rejectPendingWrite } from "../topmind-desktop/electron/lib/pending-writes.mjs";
import { executeWrite } from "../lib/writeback-engine.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "topmind-ingest-"));

describe("resolveIngestRoute", () => {
  let ws;
  let contract;

  before(() => {
    ws = path.join(tmp, "ws");
    fs.mkdirSync(path.join(ws, "00-收件箱"), { recursive: true });
    fs.mkdirSync(path.join(ws, "10-动态"), { recursive: true });
    fs.mkdirSync(path.join(ws, "20-专题"), { recursive: true });
    contract = buildDefaultContract();
    fs.writeFileSync(
      path.join(ws, "topmind.yaml"),
      "contract_version: 4\nworkspace:\n  template: balanced\n",
      "utf8",
    );
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("routes inbox to buffer category file path", () => {
    const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const r = resolveIngestRoute({
      target: "inbox",
      metadata: { title: "Test Note" },
      workspaceRoot: ws,
      contract,
      engineRoot,
    });
    assert.equal(r.appendToPeriod, false);
    assert.ok(r.targetPath);
    assert.match(r.targetPath.replace(/\\/g, "/"), /00-收件箱\/.+\.md$/);
  });

  it("routes stream to period append", () => {
    const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const r = resolveIngestRoute({
      target: "stream",
      metadata: { title: "x" },
      workspaceRoot: ws,
      contract,
      engineRoot,
    });
    assert.equal(r.appendToPeriod, true);
    assert.ok(r.periodTarget);
  });
});

describe("pending-writes queue", () => {
  it("stash list confirm take reject", () => {
    const e = stashPendingWrite({
      relativePath: "00-收件箱/a.md",
      content: "# hi\n",
      toolName: "save_file",
    });
    assert.ok(e.id);
    const list = listPendingWrites();
    assert.ok(list.some((x) => x.id === e.id));
    const taken = takePendingWrite(e.id);
    assert.equal(taken?.content, "# hi\n");
    assert.equal(listPendingWrites().some((x) => x.id === e.id), false);

    const e2 = stashPendingWrite({
      relativePath: "00-收件箱/b.md",
      content: "x",
      toolName: "save_file",
    });
    assert.equal(rejectPendingWrite(e2.id), true);
    assert.equal(listPendingWrites().some((x) => x.id === e2.id), false);
  });

  it("confirm path: pending then executeWrite with confirmed", () => {
    const ws = path.join(tmp, "pw-ws");
    fs.mkdirSync(path.join(ws, "00-收件箱"), { recursive: true });
    fs.mkdirSync(path.join(ws, "99-归档", "backups"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "topmind.yaml"),
      "contract_version: 4\nwriteback:\n  mode: confirm\n  backup_to: 99-归档/backups\n  receipts: 99-归档/receipts\n",
      "utf8",
    );
    const target = path.join(ws, "00-收件箱/pending.md");
    const pending = executeWrite({
      targetPath: target,
      content: "---\ntitle: p\n---\n\nbody\n",
      workspaceRoot: ws,
      actor: "ai",
      confirmed: false,
      skipShadow: true,
    });
    assert.equal(pending.pending || pending.needsConfirm, true);
    assert.ok(!fs.existsSync(target));

    const done = executeWrite({
      targetPath: target,
      content: "---\ntitle: p\n---\n\nbody\n",
      workspaceRoot: ws,
      actor: "ai",
      confirmed: true,
      skipShadow: true,
    });
    assert.equal(done.wroteFiles, true);
    assert.ok(fs.existsSync(target));
  });
});
