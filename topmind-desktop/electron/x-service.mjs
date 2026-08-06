/**
 * XService — X (Twitter) connector for Desktop.
 *
 * Capability model (aligned with official X docs 2026):
 *
 *   Agent hosts (Cursor/Grok/Claude):
 *     Official MCP at https://api.x.com/mcp via `xurl mcp` OAuth bridge.
 *     NOT embedded in Desktop — those clients own the MCP session.
 *
 *   Desktop app:
 *     Layer A — App-only Bearer Token → read-only (search, timeline, user lookup)
 *     Layer B — local `xurl` CLI (user OAuth in ~/.xurl) → read + post
 *
 * Bearer App-Only cannot post. postTweet refuses Bearer and requires CLI.
 *
 * Refs: https://docs.x.com/tools/mcp · https://api.x.com/2
 */
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logInfo, logError, logWarn, writeArchiveBackup, timestampStamp } from "./lib/writeback.mjs";
import { resolveDataRoot, inboxRoot } from "./lib/path-model.mjs";
import { ensureDir, readText, listDir } from "./lib/fs-utils.mjs";
import { splitMarkdownFrontmatter } from "./lib/frontmatter.mjs";
import { normalizeTweet, extractTweets, isOverTweetLimit } from "./lib/x-normalize.mjs";
import { resolveConnectorSyncCategory } from "./lib/connector-category.mjs";
import { loadConnectorSettings, writeConnectorNote } from "./lib/connector-bridge.mjs";

const execFileAsync = promisify(execFile);
const X_API_V2 = "https://api.x.com/2";

/** Install / auth hints for settings UI (no network). */
const XURL_INSTALL_HINTS = {
  brew: "brew install --cask xdevplatform/tap/xurl",
  npm: "npm i -g @xdevplatform/xurl",
  auth: "xurl auth oauth2",
  mcp: "npx @xdevplatform/xurl mcp https://api.x.com/mcp",
  docs: "https://docs.x.com/tools/mcp",
};

const loadSettingsWithSecrets = loadConnectorSettings;

function maxResult(n) {
  const num = Number(n) || 10;
  return Math.max(1, Math.min(100, num));
}

/** Probe local xurl (global binary or npx package). */
async function probeXurl() {
  const tries = [
    { cmd: "xurl", args: ["--version"] },
    { cmd: "npx", args: ["-y", "@xdevplatform/xurl", "--version"] },
  ];
  for (const t of tries) {
    try {
      const { stdout } = await execFileAsync(t.cmd, t.args, { timeout: 8000 });
      return { ok: true, cmd: t.cmd, baseArgs: t.cmd === "npx" ? ["-y", "@xdevplatform/xurl"] : [], version: String(stdout || "").trim().slice(0, 80) };
    } catch {
      /* try next */
    }
  }
  return { ok: false, cmd: null, baseArgs: [], version: null };
}

async function runXurl(probe, args) {
  if (!probe.ok) throw new Error("xurl 不可用。安装: brew install --cask xdevplatform/tap/xurl 或 npm i -g @xdevplatform/xurl");
  const fullArgs = [...probe.baseArgs, ...args];
  const { stdout, stderr } = await execFileAsync(probe.cmd, fullArgs, { timeout: 30_000, maxBuffer: 2_000_000 });
  const text = String(stdout || "").trim();
  if (!text) throw new Error(stderr?.trim() || "xurl 无输出");
  try {
    return JSON.parse(text);
  } catch {
    // Some xurl subcommands print plain text
    return { raw: text, stderr: String(stderr || "").trim() };
  }
}

async function xApiV2(bearerToken, endpoint, options = {}) {
  const url = endpoint.startsWith("http") ? endpoint : `${X_API_V2}${endpoint}`;
  const res = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeout || 20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`X API ${res.status}: ${text.slice(0, 240)}`);
  }
  return res.json();
}

async function resolveSyncCategory(workspaceRoot, preferred, engineRoot) {
  return resolveConnectorSyncCategory(workspaceRoot, preferred, "x", { engineRoot });
}

async function detectLayers(settings) {
  const x = settings?.x || {};
  const hasBearer = Boolean(x.bearerToken && String(x.bearerToken).trim());
  const xurl = await probeXurl();
  // mcpEndpoint is advisory (agent-side); Desktop does not call hosted MCP directly
  const hasMcpHint = Boolean(x.mcpEndpoint && String(x.mcpEndpoint).trim());
  return {
    hasApi: hasBearer,
    hasCli: xurl.ok,
    hasMcpHint,
    xurl,
    /** Preferred read layer */
    readLayer: hasBearer ? "api" : xurl.ok ? "cli" : null,
    /** Preferred write layer — never bearer app-only */
    writeLayer: xurl.ok ? "cli" : null,
  };
}

export const XService = {
  async getStatus(_p, ctx) {
    const settings = await loadSettingsWithSecrets(ctx);
    const layers = await detectLayers(settings);
    const syncCategory = await resolveSyncCategory(ctx.workspaceRoot, settings?.x?.syncCategory, ctx.engineRoot);
    const ready = layers.hasApi || layers.hasCli;
    return {
      ready,
      enabled: Boolean(settings?.x?.enabled),
      accessLayer: layers.writeLayer || layers.readLayer,
      readLayer: layers.readLayer,
      writeLayer: layers.writeLayer,
      hasMcp: layers.hasMcpHint,
      hasApi: layers.hasApi,
      hasCli: layers.hasCli,
      xurlVersion: layers.xurl.version,
      xurlCmd: layers.xurl.ok ? layers.xurl.cmd : null,
      canPost: Boolean(layers.writeLayer),
      canRead: Boolean(layers.readLayer),
      syncCategory,
      autoArchive: Boolean(settings?.x?.autoArchivePosts),
      officialMcpUrl: "https://api.x.com/mcp",
      agentMcpHint: "Agent 宿主用 xurl mcp 桥接官方 MCP；Desktop 内用 Bearer(读) + xurl(写)",
      installHints: XURL_INSTALL_HINTS,
    };
  },

  /**
   * Probe local tools (xurl) without calling X API.
   * Used by settings UI for install guidance.
   */
  async probeTools(_p, _ctx) {
    const xurl = await probeXurl();
    return {
      xurl: {
        ok: xurl.ok,
        version: xurl.version,
        cmd: xurl.ok ? xurl.cmd : null,
      },
      canPost: xurl.ok,
      installHints: XURL_INSTALL_HINTS,
      message: xurl.ok
        ? `xurl 可用 (${xurl.cmd}${xurl.version ? ` · ${xurl.version}` : ""})`
        : "未检测到 xurl — 发帖不可用。请按 installHints 安装并 xurl auth oauth2。",
    };
  },

  /** Lightweight connectivity probe for settings UI. */
  async testConnection(_p, ctx) {
    const settings = await loadSettingsWithSecrets(ctx);
    const layers = await detectLayers(settings);
    const results = { api: null, cli: null };

    if (layers.hasApi) {
      try {
        // Lightweight authenticated call
        await xApiV2(settings.x.bearerToken, "/tweets/search/recent?query=from:X&max_results=10");
        results.api = { ok: true, mode: "app-only-bearer", note: "只读" };
      } catch (err) {
        results.api = { ok: false, error: err.message };
      }
    }
    if (layers.hasCli) {
      try {
        const v = await runXurl(layers.xurl, ["--version"]);
        results.cli = { ok: true, version: v?.raw || layers.xurl.version || "ok" };
      } catch (err) {
        results.cli = { ok: false, error: err.message };
      }
    }

    const ok = Boolean(results.api?.ok || results.cli?.ok);
    return {
      ok,
      results,
      message: ok
        ? `连接正常${results.api?.ok ? " · API 只读" : ""}${results.cli?.ok ? " · xurl 可用(可发帖)" : ""}`
        : "未检测到可用接入层。配置 Bearer Token 或安装 xurl。",
    };
  },

  /**
   * Post a tweet. Requires xurl (user OAuth). Bearer App-Only cannot post.
   * Always confirm in UI before calling.
   */
  async postTweet({ text, replyToId }, ctx) {
    if (!text || !String(text).trim()) throw new Error("text required.");
    const body = String(text).trim();
    if (isOverTweetLimit(body)) throw new Error("推文超过 280 字符限制。");

    const settings = await loadSettingsWithSecrets(ctx);
    const layers = await detectLayers(settings);

    if (!layers.writeLayer) {
      // Soft-fail: keep draft in inbox so work is not lost
      const draftPath = await savePostDraft(ctx, body, "缺少发帖通道（需要本机 xurl 用户 OAuth）");
      throw new Error(
        `无法发帖：App-only Bearer 不能写。请安装并登录 xurl（brew install --cask xdevplatform/tap/xurl && xurl auth oauth2）。草稿已保存: ${draftPath}`,
      );
    }

    try {
      const args = ["post", body];
      if (replyToId) args.push("--reply-to", String(replyToId));
      // Prefer JSON if supported; fall back
      let result;
      try {
        result = await runXurl(layers.xurl, [...args, "--json"]);
      } catch {
        result = await runXurl(layers.xurl, args);
      }
      const tweetId = result?.data?.id || result?.id || result?.tweet_id;
      logInfo("x", "tweet posted", { tweetId, via: "cli" });

      if (settings?.x?.autoArchivePosts) {
        try {
          await archivePostedTweet(ctx, body, tweetId);
        } catch (err) {
          logWarn("x", "auto-archive failed", { error: err.message });
        }
      }
      return { ok: true, tweetId: tweetId ? String(tweetId) : undefined, text: body, via: "cli" };
    } catch (err) {
      logError("x", "postTweet failed", { error: err.message });
      const draftPath = await savePostDraft(ctx, body, err.message).catch(() => null);
      throw new Error(draftPath ? `${err.message}（草稿: ${draftPath}）` : err.message);
    }
  },

  async searchTweets({ query, maxResults = 10 }, ctx) {
    if (!query) throw new Error("query required.");
    const settings = await loadSettingsWithSecrets(ctx);
    const layers = await detectLayers(settings);
    if (!layers.readLayer) throw new Error("X 未配置。请填入 Bearer Token 或安装 xurl。");

    const limit = maxResult(maxResults);
    if (layers.readLayer === "api") {
      const params = new URLSearchParams({
        query: String(query),
        max_results: String(Math.max(10, limit)), // API min 10 for recent search
        "tweet.fields": "created_at,public_metrics,author_id",
        expansions: "author_id",
        "user.fields": "username,name",
      });
      const raw = await xApiV2(settings.x.bearerToken, `/tweets/search/recent?${params}`);
      return { data: extractTweets(raw), meta: raw.meta, via: "api" };
    }
    // CLI
    const raw = await runXurl(layers.xurl, ["search", String(query), "--limit", String(limit)]);
    return { data: extractTweets(raw), via: "cli" };
  },

  async getTimeline({ username, maxResults = 10 }, ctx) {
    if (!username) throw new Error("username required.");
    const handle = String(username).replace(/^@/, "");
    const settings = await loadSettingsWithSecrets(ctx);
    const layers = await detectLayers(settings);
    if (!layers.readLayer) throw new Error("X 未配置。");

    const limit = maxResult(maxResults);
    if (layers.readLayer === "api") {
      const userData = await xApiV2(
        settings.x.bearerToken,
        `/users/by/username/${encodeURIComponent(handle)}?user.fields=username,name`,
      );
      const userId = userData?.data?.id;
      if (!userId) throw new Error(`用户 @${handle} 未找到。`);
      const params = new URLSearchParams({
        max_results: String(Math.max(5, limit)),
        "tweet.fields": "created_at,public_metrics,author_id",
        exclude: "replies",
      });
      const raw = await xApiV2(settings.x.bearerToken, `/users/${userId}/tweets?${params}`);
      const tweets = extractTweets(raw).map((t) => ({ ...t, username: handle }));
      return { data: tweets, user: userData.data, via: "api" };
    }
    const raw = await runXurl(layers.xurl, ["timeline", "--user", handle, "--limit", String(limit)]);
    return { data: extractTweets(raw).map((t) => ({ ...t, username: t.username || handle })), via: "cli" };
  },

  /**
   * Archive tweets into a topic note.
   * @param {{ tweets: unknown[], topicName?: string, title?: string, append?: boolean }} p
   * - append: if true and note exists, append entries instead of full overwrite
   */
  async syncToNotes({ tweets, topicName, title, append = false }, ctx) {
    const list = (Array.isArray(tweets) ? tweets : []).map((t) => normalizeTweet(t)).filter(Boolean);
    if (list.length === 0) throw new Error("tweets array required.");

    const settings = await loadSettingsWithSecrets(ctx);
    const syncCategory = await resolveSyncCategory(ctx.workspaceRoot, settings?.x?.syncCategory, ctx.engineRoot);
    const dataRoot = resolveDataRoot(ctx.workspaceRoot);
    const year = new Date().getFullYear();
    const topic = String(topicName || `${year}-X推文收集`).replace(/[\\/]/gu, "-").trim() || `${year}-X推文收集`;
    const topicDir = path.join(dataRoot, syncCategory, topic);
    await ensureDir(topicDir);

    // Ensure topic has a topic.md homepage when first created
    const topicPath = path.join(topicDir, "topic.md");
    const hasTopic = await readText(topicPath).catch(() => null);
    if (!hasTopic) {
      const topicFm = {
        title: topic,
        category: syncCategory,
        topic,
        source_type: "external-capture",
        source: "x-sync",
      };
      await writeConnectorNote(ctx, {
        absPath: topicPath,
        body: `# ${topic}\n\n> X 推文归档专题 · 由 topmind Desktop 同步\n`,
        frontmatter: topicFm,
        operation: "create",
      });
    }

    const safeTitle = (title || "推文收集").replace(/[\\/]/gu, "-");
    const entries = [];
    for (const t of list) {
      const date = t.created_at ? new Date(t.created_at).toISOString().slice(0, 10) : "";
      entries.push(`## @${t.username}${date ? ` · ${date}` : ""}\n`);
      entries.push(`> ${t.text.replace(/\n/g, "\n> ")}\n`);
      if (t.url) entries.push(`\n🔗 [原文](${t.url})\n`);
      entries.push("");
    }
    const entriesMd = entries.join("\n");
    const notePath = path.join(topicDir, `${safeTitle}.md`);
    const old = await readText(notePath).catch(() => null);
    let prevCount = 0;
    if (old) {
      await writeArchiveBackup(ctx.workspaceRoot, {
        savedAt: new Date().toISOString(),
        content: old,
        pathParts: ["x-backup", topic, `${timestampStamp()}__${path.basename(notePath)}`],
      });
      const { data: fm } = splitMarkdownFrontmatter(old);
      prevCount = Number(fm?.tweet_count) || 0;
    }

    let body;
    let totalCount = list.length;
    if (append && old) {
      const { body: oldBody } = splitMarkdownFrontmatter(old);
      body = `${oldBody.trimEnd()}\n\n---\n\n${entriesMd}`;
      totalCount = (Number.isFinite(prevCount) ? prevCount : 0) + list.length;
    } else {
      body = `# ${safeTitle}\n\n${entriesMd}`;
    }

    const noteFm = {
      title: safeTitle,
      source_type: "external-capture",
      source: "x-sync",
      category: syncCategory,
      topic,
      synced_at: new Date().toISOString(),
      tweet_count: totalCount,
    };
    await writeConnectorNote(ctx, {
      absPath: notePath,
      body,
      frontmatter: noteFm,
      operation: old ? "update" : "create",
    });
    const rel = `${syncCategory}/${topic}/${path.basename(notePath)}`.replace(/\\/g, "/");
    logInfo("x", "synced tweets to notes", { count: list.length, totalCount, append: Boolean(append), path: rel });
    return {
      ok: true,
      path: rel,
      count: list.length,
      totalCount,
      appended: Boolean(append && old),
      category: syncCategory,
      topic,
    };
  },
};

async function archivePostedTweet(ctx, text, tweetId) {
  const settings = await loadSettingsWithSecrets(ctx);
  const syncCategory = await resolveSyncCategory(ctx.workspaceRoot, settings?.x?.syncCategory, ctx.engineRoot);
  const dataRoot = resolveDataRoot(ctx.workspaceRoot);
  const year = new Date().getFullYear();
  const topic = `${year}-我的推文`;
  const topicDir = path.join(dataRoot, syncCategory, topic);
  await ensureDir(topicDir);
  const archivePath = path.join(topicDir, "已发布推文.md");
  const old = await readText(archivePath).catch(() => null);
  const entry = `## ${new Date().toISOString()}\n\n> ${text}\n\n🔗 [链接](${tweetId ? `https://x.com/i/web/status/${tweetId}` : "#"})\n`;
  const content = old ? `${old}\n---\n\n${entry}` : `# 已发布推文\n\n${entry}`;
  const fm = {
    title: "已发布推文",
    source_type: "user-original",
    source: "x-archive",
    category: syncCategory,
    topic,
  };
  await writeConnectorNote(ctx, {
    absPath: archivePath,
    body: content,
    frontmatter: fm,
    operation: old ? "update" : "create",
  });
}

async function savePostDraft(ctx, text, reason) {
  const dataRoot = resolveDataRoot(ctx.workspaceRoot);
  // Prefer role:buffer via path-model (hyphen/space + template/extensions)
  let inbox = path.basename(inboxRoot(ctx.workspaceRoot));
  if (!inbox || inbox === "." || inbox === dataRoot) {
    inbox = "00-收件箱";
    try {
      const entries = await listDir(dataRoot);
      const found = entries.find((e) => /^00[ -]/u.test(e));
      if (found) inbox = found;
    } catch { /* default */ }
  }
  const fn = `x-draft-${timestampStamp()}.md`;
  const rel = `${inbox}/${fn}`;
  const abs = path.join(dataRoot, inbox, fn);
  await ensureDir(path.dirname(abs));
  const fm = {
    title: "X 推文草稿",
    source_type: "user-original",
    source: "x-draft",
    captured_at: new Date().toISOString(),
  };
  await writeConnectorNote(ctx, {
    absPath: abs,
    body: `# X 推文草稿\n\n${text}\n\n> 未能自动发布：${reason || "未知错误"}\n`,
    frontmatter: fm,
    operation: "create",
  });
  return rel;
}
