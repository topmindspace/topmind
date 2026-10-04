/**
 * Long-session retention and owned-process lifetime.
 * Drives the shipped functions with injected tables — no pkill/taskkill.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  WORKING_SET_CAPS,
  applyDevTeardown,
  boundToolCalls,
  capExpiryMap,
  claimHiddenRender,
  createHotPathScope,
  createOwnedRuntime,
  createWorkingSet,
  finishHiddenRender,
  getDesktopWorkingSet,
  liveOwned,
  mountAiDeltas,
  mountOverlay,
  mountSidebarTree,
  mountStreamFeed,
  parsePsCommandTable,
  planDevSessionStart,
  planSignalTeardown,
  registerOwned,
  releaseDesktopWorkingSets,
  releaseOwned,
  releaseWorkingSet,
  rememberDesktopTranscript,
  rememberMapEntry,
  rememberTranscript,
  retainFetchMediaBuffer,
  retainKeyedProjection,
  retainStreamRows,
  retainTasks,
  retainTranscript,
  selectWorkspaceTreePids,
} from "../electron/lib/runtime-bounds.mjs";

function transcriptChars(messages) {
  return messages.reduce((n, m) => {
    let c = 0;
    for (const field of ["content", "contentRaw", "reasoning", "reasoningProvider"]) {
      if (typeof m?.[field] === "string") c += m[field].length;
    }
    return n + c;
  }, 0);
}

test("notes, transcripts, stream rows, tasks, and fetch buffers stay inside their caps", () => {
  const notes = new Map();
  for (let i = 0; i < 30; i += 1) {
    const fat = Array.from({ length: WORKING_SET_CAPS.notesPerRoot + 2500 }, (_, n) => ({ n, root: i }));
    retainKeyedProjection(notes, `root-${i}`, { notes: fat, builtAt: i }, {
      maxKeys: WORKING_SET_CAPS.notesIndexRoots,
      notesCap: WORKING_SET_CAPS.notesPerRoot,
    });
    assert.ok(notes.size <= WORKING_SET_CAPS.notesIndexRoots);
    for (const entry of notes.values()) {
      assert.ok(entry.notes.length <= WORKING_SET_CAPS.notesPerRoot);
    }
  }
  assert.equal(notes.size, WORKING_SET_CAPS.notesIndexRoots);
  assert.ok(notes.has("root-29"));

  const transcripts = new Map();
  for (let s = 0; s < 12; s += 1) {
    const messages = [];
    for (let m = 0; m < WORKING_SET_CAPS.aiTranscriptMessages + 40; m += 1) {
      messages.push({
        role: m % 2 === 0 ? "user" : "assistant",
        content: "x".repeat(2000),
        toolCalls: m % 2 === 1 ? [{ id: `t${m}`, name: "read_file", output: { path: "a.md" } }] : undefined,
      });
    }
    const kept = rememberTranscript(transcripts, `session-${s}`, messages);
    assert.ok(kept.length <= WORKING_SET_CAPS.aiTranscriptMessages);
    assert.ok(transcriptChars(kept) <= WORKING_SET_CAPS.aiTranscriptMaxChars);
    assert.ok(transcripts.size <= WORKING_SET_CAPS.aiTranscriptSessions);
    const withTools = kept.find((row) => Array.isArray(row.toolCalls) && row.toolCalls.length > 0);
    assert.ok(withTools, "kept turns still carry tool calls");
  }
  assert.equal(transcripts.size, WORKING_SET_CAPS.aiTranscriptSessions);

  let rows = [];
  for (let i = 0; i < WORKING_SET_CAPS.streamRows + 80; i += 1) {
    rows = retainStreamRows([...rows, { index: i }]);
    assert.ok(rows.length <= WORKING_SET_CAPS.streamRows);
  }
  assert.equal(rows.length, WORKING_SET_CAPS.streamRows);
  assert.equal(rows[rows.length - 1].index, WORKING_SET_CAPS.streamRows + 79);

  let tasks = [];
  for (let i = 0; i < WORKING_SET_CAPS.taskItems + 25; i += 1) {
    const logs = Array.from({ length: WORKING_SET_CAPS.taskLogLines + 30 }, (_, n) => `log-${n}`);
    tasks = retainTasks([
      ...tasks,
      { id: `task-${i}`, status: i % 17 === 0 ? "running" : "completed", logs },
    ]);
    assert.ok(tasks.length <= WORKING_SET_CAPS.taskItems);
    for (const task of tasks) assert.ok(task.logs.length <= WORKING_SET_CAPS.taskLogLines);
  }

  let media = [];
  for (let i = 0; i < 40; i += 1) {
    media = retainFetchMediaBuffer([
      ...media,
      { id: `fetch-${i}`, bytes: 1024 * 1024, payload: "m".repeat(1024 * 1024) },
    ]);
    assert.ok(media.length <= WORKING_SET_CAPS.fetchMediaEntries);
    const bytes = media.reduce((n, entry) => n + entry.bytes, 0);
    assert.ok(bytes <= WORKING_SET_CAPS.fetchMediaBytes);
  }

  const calls = boundToolCalls(
    Array.from({ length: WORKING_SET_CAPS.streamToolCalls + 10 }, (_, i) => ({
      id: `c${i}`,
      output: { blob: "z".repeat(8000) },
    })),
  );
  assert.ok(calls.length <= WORKING_SET_CAPS.streamToolCalls);
  assert.equal(calls[calls.length - 1].output, undefined);

  const drafts = rememberMapEntry(new Map(), "p0", "draft", WORKING_SET_CAPS.streamDrafts);
  let growing = drafts;
  for (let i = 1; i < WORKING_SET_CAPS.streamDrafts + 6; i += 1) {
    growing = rememberMapEntry(growing, `p${i}`, "draft", WORKING_SET_CAPS.streamDrafts);
    assert.ok(growing.size <= WORKING_SET_CAPS.streamDrafts);
  }

  const expiry = new Map();
  for (let i = 0; i < WORKING_SET_CAPS.ignoredChanges + 50; i += 1) {
    expiry.set(`f${i}`, i);
  }
  capExpiryMap(expiry, WORKING_SET_CAPS.ignoredChanges);
  assert.equal(expiry.size, WORKING_SET_CAPS.ignoredChanges);
});

test("workspace close and quit empty working sets", () => {
  const bag = createWorkingSet();
  retainKeyedProjection(bag.notes, "root", {
    notes: [{ path: "a.md" }],
    builtAt: 1,
  });
  rememberTranscript(bag.transcripts, "s1", [
    { role: "user", content: "hello" },
    { role: "assistant", content: "world" },
  ]);
  bag.streamRows = retainStreamRows([{ index: 1 }, { index: 2 }]);
  bag.tasks = retainTasks([{ id: "t", status: "completed", logs: ["a"] }]);
  bag.fetchMedia = retainFetchMediaBuffer([{ id: "m", bytes: 10, payload: "0123456789" }]);
  bag.streamDrafts.set("period", "draft");

  releaseWorkingSet(bag, "workspace-close");
  assert.equal(bag.notes.size, 0);
  assert.equal(bag.transcripts.size, 0);
  assert.equal(bag.streamRows.length, 0);
  assert.equal(bag.tasks.length, 0);
  assert.equal(bag.fetchMedia.length, 0);
  assert.equal(bag.streamDrafts.size, 0);

  const again = createWorkingSet();
  rememberTranscript(again.transcripts, "s2", [{ role: "user", content: "stay" }]);
  again.fetchMedia = retainFetchMediaBuffer([{ id: "m2", bytes: 4, payload: "abcd" }]);
  releaseWorkingSet(again, "quit");
  assert.equal(again.transcripts.size, 0);
  assert.equal(again.fetchMedia.length, 0);
});

test("desktop transcript singleton fills to the cap and quit drops it", () => {
  releaseDesktopWorkingSets("quit");
  try {
    for (let s = 0; s < WORKING_SET_CAPS.aiTranscriptSessions + 3; s += 1) {
      const messages = Array.from({ length: WORKING_SET_CAPS.aiTranscriptMessages + 15 }, (_, m) => ({
        role: m % 2 === 0 ? "user" : "assistant",
        content: `turn ${m}`,
      }));
      const kept = rememberDesktopTranscript(`live-${s}`, messages);
      assert.ok(kept.length <= WORKING_SET_CAPS.aiTranscriptMessages);
    }
    assert.ok(getDesktopWorkingSet().transcripts.size <= WORKING_SET_CAPS.aiTranscriptSessions);
    releaseDesktopWorkingSets("quit");
    assert.equal(getDesktopWorkingSet().transcripts.size, 0);
    assert.equal(getDesktopWorkingSet().fetchMedia.length, 0);
  } finally {
    releaseDesktopWorkingSets("quit");
  }
});

test("owned processes and hidden renders empty after quit, switch, and SIGHUP", () => {
  const cwd = "/ws/topmind-desktop";
  const runtime = createOwnedRuntime();
  registerOwned(runtime, { kind: "ingest-child", pid: 11, workspaceKey: cwd });
  registerOwned(runtime, { kind: "host-child", pid: 12, workspaceKey: cwd });
  registerOwned(runtime, { kind: "utility-window", token: "capture", workspaceKey: cwd });
  registerOwned(runtime, { kind: "watcher", token: "chokidar", workspaceKey: cwd });
  registerOwned(runtime, { kind: "dev-renderer", pid: 21, workspaceKey: cwd });
  registerOwned(runtime, { kind: "dev-electron", pid: 22, workspaceKey: cwd });
  const first = claimHiddenRender(runtime, "render-a");
  const second = claimHiddenRender(runtime, "render-b");
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(liveOwned(runtime, { kind: "render-window" }).length, 1);
  finishHiddenRender(runtime, first.id);
  const again = claimHiddenRender(runtime, "render-c");
  assert.equal(again.ok, true);
  assert.equal(liveOwned(runtime, { kind: "render-window" }).length, 1);

  releaseOwned(runtime, { reason: "quit" });
  assert.equal(liveOwned(runtime).length, 0);

  const switched = createOwnedRuntime();
  registerOwned(switched, { kind: "watcher", pid: 31, workspaceKey: cwd });
  registerOwned(switched, { kind: "host-child", pid: 32, workspaceKey: cwd });
  registerOwned(switched, { kind: "ingest-child", pid: 33, workspaceKey: cwd });
  claimHiddenRender(switched, "render-switch");
  releaseOwned(switched, { reason: "workspace-switch", workspaceKey: cwd });
  assert.equal(liveOwned(switched).length, 0);

  const dev = createOwnedRuntime();
  registerOwned(dev, { kind: "dev-renderer", pid: 41, workspaceKey: cwd });
  registerOwned(dev, { kind: "dev-electron", pid: 42, workspaceKey: cwd });
  const teardown = applyDevTeardown(dev, { signal: "SIGHUP", workspaceKey: cwd });
  assert.equal(teardown.forward, "SIGTERM");
  assert.notEqual(teardown.forward, "SIGKILL");
  assert.equal(teardown.escalate, "SIGKILL");
  assert.equal(liveOwned(dev).length, 0);
  assert.equal(planSignalTeardown("SIGTERM").forward, "SIGTERM");
});

test("a second same-workspace dev session replaces the previous tree and leaves other Electron alone", () => {
  const cwd = "/ws/topmind-desktop";
  const other = "/other/app";
  const processes = [
    { pid: 101, command: `node ${cwd}/scripts/dev-electron.mjs`, cwd },
    { pid: 102, command: `/Electron.app/Contents/MacOS/Electron ${cwd}`, cwd },
    { pid: 103, command: `node ${cwd}/scripts/dev-renderer.mjs`, cwd },
    { pid: 201, command: `/Electron.app/Contents/MacOS/Electron ${other}`, cwd: other },
    { pid: 202, command: "Electron Helper (GPU)", cwd: other },
    { pid: 7, command: `node ${cwd}/scripts/dev-desktop.mjs`, cwd },
  ];

  const reuse = planDevSessionStart({
    cwd,
    lockOwner: { pid: 7, alive: true, cwd },
    processes,
    selfPid: 7,
  });
  assert.equal(reuse.action, "reuse");
  assert.equal(reuse.start, false);
  assert.deepEqual(reuse.killPids, []);

  const replace = planDevSessionStart({
    cwd,
    lockOwner: { pid: 7, alive: false, cwd },
    processes,
    selfPid: 999,
  });
  assert.equal(replace.action, "replace");
  assert.equal(replace.start, true);
  assert.deepEqual([...replace.killPids].sort((a, b) => a - b), [7, 101, 102, 103]);
  assert.ok(!replace.killPids.includes(201));
  assert.ok(!replace.killPids.includes(202));

  const windows = selectWorkspaceTreePids([
    { pid: 10, command: "C:\\Program Files\\electron\\electron.exe C:\\ws\\topmind-desktop", cwd: "C:\\ws\\topmind-desktop" },
    { pid: 11, command: "C:\\Program Files\\electron\\electron.exe C:\\other\\notes", cwd: "C:\\other\\notes" },
  ], { cwd: "C:\\ws\\topmind-desktop" });
  assert.deepEqual(windows, [10]);

  const runtime = createOwnedRuntime();
  for (const pid of replace.killPids) {
    registerOwned(runtime, {
      kind: pid === 103 ? "dev-renderer" : "dev-electron",
      pid,
      workspaceKey: cwd,
    });
  }
  registerOwned(runtime, { kind: "dev-electron", pid: 201, workspaceKey: other });
  releaseOwned(runtime, { workspaceKey: cwd });
  const left = liveOwned(runtime);
  assert.equal(left.length, 1);
  assert.equal(left[0].pid, 201);

  const parsed = parsePsCommandTable("  101 node /ws/topmind-desktop/scripts/dev-electron.mjs\n  201 /Electron /other/app\n");
  assert.equal(parsed[0].pid, 101);
  assert.match(parsed[0].command, /dev-electron/);
  const fromPs = selectWorkspaceTreePids(parsed, { cwd });
  assert.deepEqual(fromPs, [101]);
});

test("hot-path subscribe and unsubscribe return listener and timer counts to baseline", () => {
  const scope = createHotPathScope();
  const baseline = scope.counts();
  assert.deepEqual(baseline, { listeners: 0, timers: 0 });

  for (let i = 0; i < 20; i += 1) {
    let ticks = 0;
    const stops = [
      mountSidebarTree(scope, () => () => {}),
      mountStreamFeed(scope, () => () => {}),
      mountAiDeltas(scope, () => () => {}),
      mountOverlay(scope, () => () => {}),
      scope.trackTimer(() => {
        const id = setInterval(() => { ticks += 1; }, 60_000);
        return () => clearInterval(id);
      }),
    ];
    assert.equal(scope.counts().listeners, baseline.listeners + 4);
    assert.equal(scope.counts().timers, baseline.timers + 1);
    for (const stop of stops) stop();
    assert.deepEqual(scope.counts(), baseline);
    assert.equal(ticks, 0);
  }

  mountSidebarTree(scope, () => () => {});
  mountAiDeltas(scope, () => () => {});
  scope.dispose();
  scope.dispose();
  assert.deepEqual(scope.counts(), baseline);
});
