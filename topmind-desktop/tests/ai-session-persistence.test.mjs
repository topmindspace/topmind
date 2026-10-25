import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AiService } from "../electron/ai-service.mjs";

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "topmind-session-read-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, ctx: { workspaceStatePaths: { aiSessionMessagesDirPath: dir, aiWorkspaceStateFilePath: path.join(dir, "state.json") } } };
}

test("missing session history is an empty conversation", async (t) => {
  const { ctx } = await fixture(t);
  assert.deepEqual(await AiService.loadMessages({ sessionId: "missing" }, ctx), []);
});

test("valid persisted history round-trips through the real service", async (t) => {
  const { ctx } = await fixture(t);
  const messages = [{ role: "user", content: "hello" }, { role: "assistant", content: "answer" }];
  await AiService.saveMessages({ sessionId: "valid", messages }, ctx);
  assert.deepEqual(await AiService.loadMessages({ sessionId: "valid" }, ctx), messages);
});

test("malformed history reports failure and preserves the original bytes", async (t) => {
  const { ctx, dir } = await fixture(t);
  const file = path.join(dir, "broken.json");
  const bytes = '[{"role":"user","content":"unfinished';
  await writeFile(file, bytes);
  await assert.rejects(AiService.loadMessages({ sessionId: "broken" }, ctx));
  assert.equal(await readFile(file, "utf8"), bytes);
});

test("an unexpected JSON shape is not converted into empty history", async (t) => {
  const { ctx, dir } = await fixture(t);
  const file = path.join(dir, "object.json");
  const bytes = '{"messages":"unexpected legacy or damaged payload"}';
  await writeFile(file, bytes);
  await assert.rejects(AiService.loadMessages({ sessionId: "object" }, ctx));
  assert.equal(await readFile(file, "utf8"), bytes);
});

test("damaged message rows report failure without rewriting the source", async (t) => {
  const { ctx, dir } = await fixture(t);
  const file = path.join(dir, "rows.json");
  for (const rows of [[null], [{ role: "user" }], [{ role: "unknown", content: "source" }]]) {
    const bytes = JSON.stringify(rows);
    await writeFile(file, bytes);
    await assert.rejects(AiService.loadMessages({ sessionId: "rows" }, ctx));
    assert.equal(await readFile(file, "utf8"), bytes);
  }
});

test("concurrent session metadata updates preserve both conversations", async (t) => {
  const { ctx } = await fixture(t);
  await Promise.all([
    AiService.updateSession({ sessionId: "a", patch: { title: "A" } }, ctx),
    AiService.updateSession({ sessionId: "b", patch: { title: "B" } }, ctx),
  ]);
  assert.deepEqual((await AiService.listSessions({}, ctx)).map((s) => s.id).sort(), ["a", "b"]);
});

test("a clear queued after a save does not resurrect deleted history", async (t) => {
  const { ctx } = await fixture(t);
  const save = AiService.saveMessages({ sessionId: "clear-race", messages: [{ role: "user", content: "x".repeat(30000) }] }, ctx);
  const clear = AiService.clearSession({ sessionId: "clear-race" }, ctx);
  await Promise.all([save, clear]);
  assert.deepEqual(await AiService.loadMessages({ sessionId: "clear-race" }, ctx), []);
});

test("failed atomic replacement preserves previous history and a later save recovers", async (t) => {
  const { ctx, dir } = await fixture(t);
  const file = path.join(dir, "atomic.json");
  const previous = [{ role: "user", content: "previous durable request" }];
  const next = [...previous, { role: "assistant", content: "new answer" }];
  await AiService.saveMessages({ sessionId: "atomic", messages: previous }, ctx);
  const bytes = await readFile(file, "utf8");
  const rename = fs.rename;
  fs.rename = async (from, to) => {
    if (to === file) throw Object.assign(new Error("fixture replacement failed"), { code: "EIO" });
    return rename(from, to);
  };
  try {
    await assert.rejects(AiService.saveMessages({ sessionId: "atomic", messages: next }, ctx), /fixture replacement failed/);
    assert.equal(await readFile(file, "utf8"), bytes);
    assert.deepEqual(await readdir(dir), ["atomic.json"], "failed replacement must clean temporary files");
  } finally {
    fs.rename = rename;
  }
  await AiService.saveMessages({ sessionId: "atomic", messages: next }, ctx);
  assert.deepEqual(await AiService.loadMessages({ sessionId: "atomic" }, ctx), next);
});
