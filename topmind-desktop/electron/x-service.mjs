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
import { logInfo, logError, logWarn, timestampStamp } from "./lib/writeback.mjs";
import { resolveDataRoot, inboxRoot } from "./lib/path-model.mjs";
import { ensureDir, readText, listDir } from "./lib/fs-utils.mjs";
import { splitMarkdownFrontmatter } from "./lib/frontmatter.mjs";
import { t } from "./lib/electron-i18n.mjs";
import {
  extractTweets,
  isOverTweetLimit,
  X_API_ORIGIN,
  X_OFFICIAL_MCP_URL,
  searchRecentQueryPath,
  userByUsernamePath,
  userTweetsPath,
  xurlSearchShortcutArgs,
  xurlSearchRestArgs,
  xurlPostShortcutArgs,
  xurlPostRestArgs,
  parsePostedTweetId,
  formatTweetEntry,
  collectArchivedTweetIds,
  decideArchiveTweets,
  mergeTweetIdList,
  defaultXTopicName,
  defaultPostedTopicName,
} from "./lib/x-normalize.mjs";
import { resolveConnectorSyncCategory } from "./lib/connector-category.mjs";
import { loadConnectorSettings, writeConnectorNote } from "./lib/connector-bridge.mjs";

const execFileAsync = promisify(execFile);

/** Install / auth hints for settings UI (no network). */
const XURL_INSTALL_HINTS = {
  brew: "brew install --cask xdevplatform/tap/xurl",
  npm: "npm i -g @xdevplatform/xurl",
  auth: "xurl auth oauth2",
  mcp: `npx -y @xdevplatform/xurl mcp ${X_OFFICIAL_MCP_URL}`,
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
  if (!probe.ok) throw new Error(t("x.xurlMissing"));
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
  const url = endpoint.startsWith("http")
    ? endpoint
    : `${X_API_ORIGIN}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
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
      officialMcpUrl: X_OFFICIAL_MCP_URL,
      agentMcpHint: t("x.agentMcpHint"),
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
        ? t("x.xurlReady", { cmd: xurl.cmd, ver: xurl.version ? ` · ${xurl.version}` : "" })
        : t("x.xurlNotFound"),
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
        await xApiV2(settings.x.bearerToken, searchRecentQueryPath("from:X", 10));
        results.api = { ok: true, mode: "app-only-bearer", note: "read-only" };
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
        ? t("x.connected", {
            api: results.api?.ok ? t("x.connectedApi") : "",
            cli: results.cli?.ok ? t("x.connectedCli") : "",
          })
        : t("x.notConnected"),
    };
  },

  /**
   * Post a tweet. Requires xurl (user OAuth). Bearer App-Only cannot post.
   * Always confirm in UI before calling.
   */
  async postTweet({ text, replyToId }, ctx) {
    if (!text || !String(text).trim()) throw new Error(t("x.textRequired"));
    const body = String(text).trim();
    if (isOverTweetLimit(body)) throw new Error(t("x.overLimit"));

    const settings = await loadSettingsWithSecrets(ctx);
    const layers = await detectLayers(settings);

    if (!layers.writeLayer) {
      // Soft-fail: keep draft in inbox so work is not lost
      const draftPath = await savePostDraft(ctx, body, t("x.noWriteChannel"));
      throw new Error(t("x.cannotPostDraft", { path: draftPath }));
    }

    try {
      let result;
      try {
        result = await runXurl(layers.xurl, xurlPostRestArgs(body, replyToId));
      } catch {
        if (replyToId) throw new Error(t("x.replyNeedsRest"));
        result = await runXurl(layers.xurl, xurlPostShortcutArgs(body));
      }
      const tweetId = parsePostedTweetId(result);
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
    if (!query) throw new Error(t("x.queryRequired"));
    const settings = await loadSettingsWithSecrets(ctx);
    const layers = await detectLayers(settings);
    if (!layers.readLayer) throw new Error(t("x.notConfiguredRead"));

    const limit = maxResult(maxResults);
    if (layers.readLayer === "api") {
      const raw = await xApiV2(settings.x.bearerToken, searchRecentQueryPath(query, limit));
      return { data: extractTweets(raw), meta: raw.meta, via: "api" };
    }
    let raw;
    try {
      raw = await runXurl(layers.xurl, xurlSearchRestArgs(query, limit));
    } catch {
      raw = await runXurl(layers.xurl, xurlSearchShortcutArgs(query));
    }
    return { data: extractTweets(raw), via: "cli" };
  },

  async getTimeline({ username, maxResults = 10 }, ctx) {
    if (!username) throw new Error(t("x.usernameRequired"));
    const handle = String(username).replace(/^@/, "");
    const settings = await loadSettingsWithSecrets(ctx);
    const layers = await detectLayers(settings);
    if (!layers.readLayer) throw new Error(t("x.notConfigured"));

    const limit = maxResult(maxResults);
    const lookupUser = async (fn) => {
      const userData = await fn(userByUsernamePath(handle));
      const userId = userData?.data?.id;
      if (!userId) throw new Error(t("x.userNotFound", { handle }));
      const raw = await fn(userTweetsPath(userId, limit));
      const tweets = extractTweets(raw).map((tw) => ({ ...tw, username: handle }));
      return { data: tweets, user: userData.data };
    };
    if (layers.readLayer === "api") {
      const out = await lookupUser((path) => xApiV2(settings.x.bearerToken, path));
      return { ...out, via: "api" };
    }
    const out = await lookupUser((path) => runXurl(layers.xurl, [path]));
    return { ...out, via: "cli" };
  },

  /**
   * Archive tweets into a topic note.
   * @param {{ tweets: unknown[], topicName?: string, title?: string, append?: boolean }} p
   * - append: if true and note exists, append entries instead of full overwrite
   */
  async syncToNotes({ tweets, topicName, title, append = false }, ctx) {
    const incoming = Array.isArray(tweets) ? tweets : [];
    if (incoming.length === 0) throw new Error(t("x.tweetsRequired"));
    const settings = await loadSettingsWithSecrets(ctx);
    const syncCategory = await resolveSyncCategory(ctx.workspaceRoot, settings?.x?.syncCategory, ctx.engineRoot);
    const dataRoot = resolveDataRoot(ctx.workspaceRoot);
    const year = new Date().getFullYear();
    const topic = String(topicName || defaultXTopicName(year)).replace(/[\\/]/gu, "-").trim() || defaultXTopicName(year);
    const topicDir = path.join(dataRoot, syncCategory, topic);
    await ensureDir(topicDir);

    const topicPath = path.join(topicDir, "topic.md");
    const hasTopic = await readText(topicPath).catch(() => null);
    if (!hasTopic) {
      const topicFm = {
        title: topic,
        category: syncCategory,
        topic,
        source_type: "external-capture",
        source: "x",
      };
      await writeConnectorNote(ctx, {
        absPath: topicPath,
        body: `# ${topic}\n\n> X 推文归档专题 · 由 topmind Desktop 同步\n`,
        frontmatter: topicFm,
        operation: "create",
      });
    }

    const safeTitle = (title || "推文收集").replace(/[\\/]/gu, "-");
    const notePath = path.join(topicDir, `${safeTitle}.md`);
    const old = await readText(notePath).catch(() => null);
    const existingIds = collectArchivedTweetIds(old || "");
    const { toWrite, skipped } = decideArchiveTweets(incoming, existingIds, { append: Boolean(append && old) });
    if (toWrite.length === 0) {
      return {
        ok: true,
        path: `${syncCategory}/${topic}/${path.basename(notePath)}`.replace(/\\/g, "/"),
        count: 0,
        skipped: skipped.length,
        totalCount: Number(splitMarkdownFrontmatter(old || "").data?.tweet_count) || existingIds.size,
        appended: Boolean(append && old),
        category: syncCategory,
        topic,
      };
    }

    const entriesMd = toWrite.map((tw) => formatTweetEntry(tw)).join("\n");
    let prevCount = 0;
    let prevIds = [];
    if (old) {
      const { data: fm } = splitMarkdownFrontmatter(old);
      prevCount = Number(fm?.tweet_count) || 0;
      prevIds = Array.isArray(fm?.tweet_ids) ? fm.tweet_ids.map(String) : [...existingIds];
    }

    let body;
    let totalCount = toWrite.length;
    if (append && old) {
      const { body: oldBody } = splitMarkdownFrontmatter(old);
      body = `${oldBody.trimEnd()}\n\n---\n\n${entriesMd}`;
      totalCount = (Number.isFinite(prevCount) ? prevCount : 0) + toWrite.length;
    } else {
      body = `# ${safeTitle}\n\n${entriesMd}`;
    }

    const noteFm = {
      title: safeTitle,
      source_type: "external-capture",
      source: "x",
      category: syncCategory,
      topic,
      synced_at: new Date().toISOString(),
      tweet_count: totalCount,
      tweet_ids: mergeTweetIdList(prevIds, toWrite.map((tw) => tw.id).filter(Boolean)),
    };
    await writeConnectorNote(ctx, {
      absPath: notePath,
      body,
      frontmatter: noteFm,
      operation: old ? "update" : "create",
    });
    const rel = `${syncCategory}/${topic}/${path.basename(notePath)}`.replace(/\\/g, "/");
    logInfo("x", "synced tweets to notes", {
      count: toWrite.length,
      skipped: skipped.length,
      totalCount,
      append: Boolean(append),
      path: rel,
    });
    return {
      ok: true,
      path: rel,
      count: toWrite.length,
      skipped: skipped.length,
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
  const topic = defaultPostedTopicName(year);
  const topicDir = path.join(dataRoot, syncCategory, topic);
  await ensureDir(topicDir);
  const topicPath = path.join(topicDir, "topic.md");
  if (!(await readText(topicPath).catch(() => null))) {
    await writeConnectorNote(ctx, {
      absPath: topicPath,
      body: `# ${topic}\n\n> 本机 xurl 已发推文归档\n`,
      frontmatter: {
        title: topic,
        category: syncCategory,
        topic,
        source_type: "user-original",
        source: "x",
      },
      operation: "create",
    });
  }
  const archivePath = path.join(topicDir, "已发布推文.md");
  const old = await readText(archivePath).catch(() => null);
  const existingIds = collectArchivedTweetIds(old || "");
  if (tweetId && existingIds.has(String(tweetId))) return;
  const posted = {
    id: tweetId ? String(tweetId) : undefined,
    text,
    username: "me",
    created_at: new Date().toISOString(),
    url: tweetId ? `https://x.com/i/web/status/${tweetId}` : "",
  };
  const entry = formatTweetEntry(posted);
  const { body: oldBody, data: oldFm } = splitMarkdownFrontmatter(old || "");
  const content = old ? `${oldBody.trimEnd()}\n\n---\n\n${entry}` : `# 已发布推文\n\n${entry}`;
  const prevIds = Array.isArray(oldFm?.tweet_ids) ? oldFm.tweet_ids.map(String) : [...existingIds];
  await writeConnectorNote(ctx, {
    absPath: archivePath,
    body: content,
    frontmatter: {
      title: "已发布推文",
      source_type: "user-original",
      source: "x",
      category: syncCategory,
      topic,
      tweet_ids: mergeTweetIdList(prevIds, tweetId ? [String(tweetId)] : []),
    },
    operation: old ? "update" : "create",
  });
}

async function savePostDraft(ctx, text, reason) {
  const dataRoot = resolveDataRoot(ctx.workspaceRoot);
  // Prefer role:buffer via path-model (hyphen/space + template/extensions)
  let inbox = path.basename(inboxRoot(ctx.workspaceRoot));
  if (!inbox || inbox === "." || inbox === dataRoot) {
    try {
      const entries = await listDir(dataRoot);
      const found = entries.find((e) => /^00[ -]/u.test(e));
      inbox = found || "00-Inbox";
    } catch {
      inbox = "00-Inbox";
    }
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
