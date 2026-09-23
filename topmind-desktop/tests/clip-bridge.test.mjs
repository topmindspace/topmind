/**
 * Clip Bridge unit tests (no real listen when port busy — pure helpers + light HTTP).
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  generateClipToken,
  startClipBridge,
  stopClipBridge,
  getClipBridgeLive,
  CLIP_BRIDGE_DEFAULT_PORT,
} from "../electron/lib/clip-bridge.mjs";

// Windows: --test-force-exit fires process.exit right after the last test.
// Give the server + client sockets a beat to fully close, otherwise libuv
// aborts on exit (UV_HANDLE_CLOSING, win/async.c) even though all tests pass.
after(async () => {
  await stopClipBridge();
  await new Promise((r) => setTimeout(r, 250));
});

let _loopbackSupported = null;
async function canConnectLoopback() {
  if (_loopbackSupported !== null) return _loopbackSupported;
  const net = await import("node:net");
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = s.address().port;
      const c = net.connect(port, "127.0.0.1");
      c.on("connect", () => {
        c.end();
        s.close(() => {
          _loopbackSupported = true;
          resolve(true);
        });
      });
      c.on("error", () => {
        c.destroy();
        s.close(() => {
          _loopbackSupported = false;
          resolve(false);
        });
      });
    });
    s.on("error", () => {
      _loopbackSupported = false;
      resolve(false);
    });
  });
}

test("generateClipToken returns non-empty base64url-ish string", () => {
  const t = generateClipToken();
  assert.ok(t.length >= 16);
  assert.doesNotMatch(t, /\s/u);
});

test("clip bridge rejects unauthorized and accepts bearer token", async (t) => {
  if (!(await canConnectLoopback())) {
    t.skip("Sandbox environment blocks loopback TCP socket connections (EPERM)");
    return;
  }
  await stopClipBridge();
  const token = generateClipToken();
  const port = 19890;
  let ingested = null;

  await startClipBridge({
    port,
    token,
    getContext: () => ({ workspaceRoot: { userWorkspaceRoot: "/tmp/ws" } }),
    ingest: async (p) => {
      ingested = p;
      return { ok: true, operation: "create", targetPath: "00-收件箱/test.md", path: "00-收件箱/test.md" };
    },
  });

  try {
    const live = getClipBridgeLive();
    assert.equal(live.running, true);
    assert.equal(live.port, port);

    const health = await fetch(`http://127.0.0.1:${port}/v1/health`, { headers: { Connection: "close" } });
    assert.equal(health.status, 200);
    const hj = await health.json();
    assert.equal(hj.ok, true);
    assert.equal(hj.workspaceReady, true);

    const unauth = await fetch(`http://127.0.0.1:${port}/v1/clip`, {
      method: "POST",
      headers: { Connection: "close", "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });
    assert.equal(unauth.status, 401);
    await unauth.text(); // drain body — release socket before next request

    const ok = await fetch(`http://127.0.0.1:${port}/v1/clip`, {
      method: "POST",
      headers: { Connection: "close",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        title: "From test",
        content: "clip body",
        source: "https://example.com",
        source_type: "external-capture",
      }),
    });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.ok, true);
    assert.equal(body.path, "00-收件箱/test.md");
    assert.equal(ingested?.content, "clip body");
    assert.equal(ingested?.source, "https://example.com");
  } finally {
    await stopClipBridge();
  }
});

test("clip bridge destinations requires auth and returns shape", async (t) => {
  if (!(await canConnectLoopback())) {
    t.skip("Sandbox environment blocks loopback TCP socket connections (EPERM)");
    return;
  }
  await stopClipBridge();
  const token = generateClipToken();
  const port = 19895;
  await startClipBridge({
    port,
    token,
    getContext: () => ({ workspaceRoot: { userWorkspaceRoot: "/tmp/ws" } }),
    ingest: async () => ({ ok: true, path: "x" }),
    listDestinations: async () => ({
      inbox: true,
categories: [{ id: "10-动态", name: "10-动态", role: "deep-work" }],
topics: [{ id: "10-动态/2026-主题", name: "2026-主题", category: "10-动态" }],
    }),
  });
  try {
    const unauth = await fetch(`http://127.0.0.1:${port}/v1/destinations`);
    assert.equal(unauth.status, 401);
    await unauth.text(); // drain body — release socket
    const ok = await fetch(`http://127.0.0.1:${port}/v1/destinations`, {
      headers: { Connection: "close", Authorization: `Bearer ${token}` },
    });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.ok, true);
    assert.equal(body.inbox, true);
    assert.equal(body.categories.length, 1);
    assert.equal(body.topics[0].id, "10-动态/2026-主题");
  } finally {
    await stopClipBridge();
  }
});

test("clip bridge passes dest and applies article template after convert", async (t) => {
  if (!(await canConnectLoopback())) {
    t.skip("Sandbox environment blocks loopback TCP socket connections (EPERM)");
    return;
  }
  await stopClipBridge();
  const token = generateClipToken();
  const port = 19896;
  let ingested = null;
  await startClipBridge({
    port,
    token,
    getContext: () => ({
      workspaceRoot: { userWorkspaceRoot: "/tmp/ws" },
      appSettings: { clipBridge: { downloadImages: false } },
    }),
    ingest: async (p) => {
      ingested = p;
      return {
        ok: true,
        operation: "create",
targetPath: "10-动态/2026-主题/note.md",
path: "10-动态/2026-主题/note.md",
      };
    },
  });
  try {
    const html = `<article><h2>Templated</h2><p>Enough body text for readability conversion path so template receives clean markdown content.</p></article>`;
    const res = await fetch(`http://127.0.0.1:${port}/v1/clip`, {
      method: "POST",
      headers: { Connection: "close",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        title: "T",
        content_html: html,
        content: "fallback",
        source: "https://zhihu.com/question/1",
        mode: "readability",
        template_id: "zhihu",
        dest: { mode: "topic", topicId: "10-动态/2026-主题" },
        download_images: false,
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.dest?.mode, "topic");
    assert.equal(ingested?.dest?.topicId, "10-动态/2026-主题");
    assert.equal(ingested?.frontmatter?.clip_template, "zhihu");
    assert.match(ingested?.content || "", /Templated|Enough body/i);
  } finally {
    await stopClipBridge();
  }
});

test("clip bridge converts content_html via shared markdown pipeline", async (t) => {
  if (!(await canConnectLoopback())) {
    t.skip("Sandbox environment blocks loopback TCP socket connections (EPERM)");
    return;
  }
  await stopClipBridge();
  const token = generateClipToken();
  const port = 19894;
  let ingested = null;

  await startClipBridge({
    port,
    token,
    getContext: () => ({ workspaceRoot: { userWorkspaceRoot: "/tmp/ws" } }),
    ingest: async (p) => {
      ingested = p;
      return { ok: true, operation: "create", targetPath: "00-收件箱/html.md", path: "00-收件箱/html.md" };
    },
  });

  try {
    const html = `<div><h2>Readable Heading</h2><p>This is a long enough paragraph for clip conversion quality and cleaning of web noise.</p><p>Second paragraph keeps structure for markdown output.</p><div class="related">Buy now spam</div></div>`;
    const ok = await fetch(`http://127.0.0.1:${port}/v1/clip`, {
      method: "POST",
      headers: { Connection: "close",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        title: "HTML clip",
        content: "fallback plain should not win",
        content_html: html,
        source: "https://example.com/post?utm_source=x&id=9",
        source_type: "external-capture",
        mode: "readability",
        author: "Ada",
      }),
    });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.ok, true);
    assert.equal(body.method, "readability");
    assert.match(ingested?.content || "", /Readable Heading|long enough paragraph/i);
    assert.match(ingested?.content || "", /Second paragraph/i);
    assert.doesNotMatch(ingested?.content || "", /Buy now spam/i);
    assert.equal(ingested?.source, "https://example.com/post?id=9");
    assert.equal(ingested?.frontmatter?.fetch_method, "readability");
    assert.equal(ingested?.frontmatter?.author, "Ada");
    assert.ok(Number(ingested?.frontmatter?.word_count) > 10);
  } finally {
    await stopClipBridge();
  }
});

test("clip bridge returns 503 without workspace", async (t) => {
  if (!(await canConnectLoopback())) {
    t.skip("Sandbox environment blocks loopback TCP socket connections (EPERM)");
    return;
  }
  await stopClipBridge();
  const token = generateClipToken();
  const port = 19891;
  await startClipBridge({
    port,
    token,
    getContext: () => ({}),
    ingest: async () => {
      throw new Error("should not ingest");
    },
  });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/clip`, {
      method: "POST",
      headers: { Connection: "close",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ content: "x" }),
    });
    assert.equal(res.status, 503);
    await res.text(); // drain body — release socket
  } finally {
    await stopClipBridge();
  }
});

test("default port constant is stable", () => {
  assert.equal(CLIP_BRIDGE_DEFAULT_PORT, 19827);
});

test("getClipBridgeLive never exposes bearer token", async () => {
  await stopClipBridge();
  const token = generateClipToken();
  await startClipBridge({
    port: 19893,
    token,
    getContext: () => ({ workspaceRoot: { userWorkspaceRoot: "/tmp" } }),
    ingest: async () => ({}),
  });
  try {
    const live = getClipBridgeLive();
    assert.equal(live.running, true);
    assert.equal("token" in live, false);
  } finally {
    await stopClipBridge();
  }
});
