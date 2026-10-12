/**
 * Dev-supervisor teardown. Drives escalateWorkspaceTree — the sequence
 * dev-desktop.mjs awaits before process.exit. Kill and the process table are
 * injected. This file does not spawn Electron, Vite, or signal a live pid.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  escalateWorkspaceTree,
  ownedDevChildRecord,
} from "../electron/lib/runtime-bounds.mjs";

const cwd = "/ws/topmind-desktop";
const other = "/other/app";

function workspaceProc(pid, script = "dev-electron.mjs") {
  return { pid, command: `node ${cwd}/scripts/${script}`, cwd };
}

function deferred() {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  return { gate, release };
}

test("a workspace pid that ignores the catchable signal is SIGKILLed before the call resolves", async () => {
  const calls = [];
  const { gate, release } = deferred();
  let waitedMs = null;
  const pending = escalateWorkspaceTree({
    signal: "SIGTERM",
    processes: [
      workspaceProc(101),
      { pid: 201, command: `/Electron.app/Contents/MacOS/Electron ${other}`, cwd: other },
      { pid: 301, command: "grok", cwd: "/Users/pand/.grok" },
      { pid: 302, command: "node /opt/muse/vm.js", cwd: "/opt/muse" },
    ],
    cwd,
    selfPid: 7,
    parentPid: 1,
    graceMs: 5,
    kill(pid, signal) {
      calls.push({ pid, signal });
    },
    isAlive(pid) {
      return pid === 101;
    },
    wait(ms) {
      waitedMs = ms;
      return gate;
    },
  });

  let resolved = false;
  const done = pending.then((result) => {
    assert.equal(calls.at(-1)?.signal, "SIGKILL");
    assert.deepEqual(result.signals, [
      { pid: 101, signal: "SIGTERM" },
      { pid: 101, signal: "SIGKILL" },
    ]);
    resolved = true;
    return result;
  });

  await Promise.resolve();
  assert.equal(resolved, false);
  assert.equal(waitedMs, 5);
  assert.deepEqual(calls, [{ pid: 101, signal: "SIGTERM" }]);

  release();
  const result = await done;
  assert.equal(resolved, true);
  assert.equal(result.forward, "SIGTERM");
  assert.equal(result.escalate, "SIGKILL");
  assert.deepEqual(result.survivors, [101]);
  assert.deepEqual(calls, [
    { pid: 101, signal: "SIGTERM" },
    { pid: 101, signal: "SIGKILL" },
  ]);
  assert.ok(calls.every((call) => call.pid === 101));
});

test("an unrelated pid is never signaled", async () => {
  const calls = [];
  let waited = false;
  const result = await escalateWorkspaceTree({
    signal: "SIGTERM",
    processes: [
      { pid: 7, command: `node ${cwd}/scripts/dev-desktop.mjs`, cwd },
      { pid: 1, command: `node ${cwd}/scripts/dev-desktop.mjs`, cwd },
      { pid: 201, command: `/Electron.app/Contents/MacOS/Electron ${other}`, cwd: other },
      { pid: 202, command: "Electron Helper (GPU)", cwd: other },
      { pid: 19, command: `node ${other}/node_modules/vite/bin/vite.js`, cwd: "" },
      { pid: 20, command: `${other}/node_modules/esbuild/bin/esbuild --service=0.25.0`, cwd: "" },
      { pid: 301, command: "grok", cwd: "/Users/pand/.grok" },
      { pid: 302, command: "node /opt/muse/vm.js", cwd: "/opt/muse" },
    ],
    cwd,
    selfPid: 7,
    parentPid: 1,
    graceMs: 1,
    kill(pid, signal) {
      calls.push({ pid, signal });
    },
    isAlive() {
      return true;
    },
    wait() {
      waited = true;
      return Promise.resolve();
    },
  });

  assert.deepEqual(calls, []);
  assert.equal(waited, false);
  assert.deepEqual(result.forwarded, []);
  assert.deepEqual(result.survivors, []);
  assert.deepEqual(result.signals, []);
});

test("a pid that dies on the catchable signal is not SIGKILLed", async () => {
  const calls = [];
  const alive = new Set([101, 201]);
  const result = await escalateWorkspaceTree({
    signal: "SIGTERM",
    processes: [
      workspaceProc(101),
      { pid: 201, command: `/Electron.app/Contents/MacOS/Electron ${other}`, cwd: other },
    ],
    cwd,
    selfPid: 7,
    parentPid: 1,
    graceMs: 1,
    kill(pid, signal) {
      calls.push({ pid, signal });
      if (signal !== "SIGKILL") alive.delete(pid);
    },
    isAlive(pid) {
      return alive.has(pid);
    },
    wait() {
      return Promise.resolve();
    },
  });

  assert.deepEqual(calls, [{ pid: 101, signal: "SIGTERM" }]);
  assert.deepEqual(result.forwarded, [101]);
  assert.deepEqual(result.survivors, []);
  assert.ok(!calls.some((call) => call.signal === "SIGKILL"));
  assert.ok(!calls.some((call) => call.pid === 201));
});

test("SIGINT and SIGHUP stay catchable-first for a survivor", async () => {
  for (const signal of ["SIGINT", "SIGHUP"]) {
    const calls = [];
    const result = await escalateWorkspaceTree({
      signal,
      processes: [workspaceProc(101)],
      cwd,
      selfPid: 7,
      graceMs: 0,
      kill(_pid, sig) {
        calls.push(sig);
      },
      isAlive() {
        return true;
      },
      wait() {
        return Promise.resolve();
      },
    });
    assert.notEqual(result.forward, "SIGKILL");
    assert.deepEqual(calls, [result.forward, "SIGKILL"]);
    assert.equal(result.escalate, "SIGKILL");
  }
});

test("a direct dev child missing from the process table is still escalated", async () => {
  const calls = [];
  const child = ownedDevChildRecord({
    pid: 55,
    cwd,
    script: `${cwd}/scripts/dev-renderer.mjs`,
    execPath: "/Users/pand/.nvm/versions/node/v22.12.0/bin/node",
  });
  const result = await escalateWorkspaceTree({
    signal: "SIGTERM",
    processes: [
      child,
      { pid: 404, command: "node /other/grok/session", cwd: "/other/grok" },
    ],
    cwd,
    selfPid: 7,
    parentPid: 1,
    graceMs: 0,
    kill(pid, signal) {
      calls.push({ pid, signal });
    },
    isAlive() {
      return true;
    },
    wait() {
      return Promise.resolve();
    },
  });

  assert.deepEqual(calls, [
    { pid: 55, signal: "SIGTERM" },
    { pid: 55, signal: "SIGKILL" },
  ]);
  assert.deepEqual(result.survivors, [55]);
  assert.ok(!calls.some((call) => call.pid === 404));
});

test("the default grace wait is not unref'd and still SIGKILLs a survivor", async () => {
  const original = globalThis.setTimeout;
  const unrefCalls = [];
  globalThis.setTimeout = (fn, ms, ...args) => {
    const timer = original(fn, ms, ...args);
    const originalUnref = typeof timer.unref === "function" ? timer.unref.bind(timer) : null;
    timer.unref = () => {
      unrefCalls.push(ms);
      return originalUnref ? originalUnref() : timer;
    };
    return timer;
  };

  const calls = [];
  try {
    const result = await escalateWorkspaceTree({
      signal: "SIGTERM",
      processes: [workspaceProc(101)],
      cwd,
      selfPid: 7,
      graceMs: 15,
      kill(pid, signal) {
        calls.push({ pid, signal });
      },
      isAlive() {
        return true;
      },
    });
    assert.deepEqual(unrefCalls, []);
    assert.deepEqual(calls, [
      { pid: 101, signal: "SIGTERM" },
      { pid: 101, signal: "SIGKILL" },
    ]);
    assert.deepEqual(result.survivors, [101]);
  } finally {
    globalThis.setTimeout = original;
  }
});

test("the dev supervisor awaits escalation and does not leave an unref'd kill timer", () => {
  const source = readFileSync(new URL("../scripts/dev-desktop.mjs", import.meta.url), "utf8");
  assert.match(source, /escalateWorkspaceTree/);
  assert.match(source, /ownedDevChildRecord/);
  assert.match(source, /await replaceStaleWorkspaceTree\(\)/);
  assert.match(source, /await stopChildren\(\)/);
  assert.doesNotMatch(source, /timer\.unref/);
  assert.doesNotMatch(source, /setTimeout/);
  const exitAt = source.lastIndexOf("process.exit");
  const awaitStop = source.indexOf("await stopChildren()");
  assert.ok(awaitStop > 0 && awaitStop < exitAt);

  const renderer = readFileSync(new URL("../scripts/dev-renderer.mjs", import.meta.url), "utf8");
  const electron = readFileSync(new URL("../scripts/dev-electron.mjs", import.meta.url), "utf8");
  for (const launcher of [renderer, electron]) {
    const exitAtLauncher = launcher.lastIndexOf("process.exit");
    const waitAt = launcher.lastIndexOf("await new Promise");
    assert.ok(waitAt > 0 && waitAt < exitAtLauncher);
  }
});
