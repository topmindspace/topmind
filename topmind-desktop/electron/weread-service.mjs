/**
 * v4 WereadService — WeRead (微信读书) official Agent Gateway.
 *
 * Official skill: https://weread.qq.com/r/weread-skills (v1.0.4)
 *
 * Sync policy:
 * - Target category via shared resolver (auto + template + FS)
 * - Full /user/notebooks pagination (count + lastSort) — no silent ~20 cap
 * - Only books with exportable notes (划线 noteCount + 想法 reviewCount)
 * - Per book: /book/bookmarklist + /review/list/mine (optional)
 * - Skip when local note_fingerprint matches (not lastSyncAt filter)
 * - Soft runtime budget; remaining books continue next run
 * - lastSyncAt is display-only
 * - Stats cached as slim snapshot for hub UI
 */
import path from "node:path";
import { logInfo, logError, logWarn } from "./lib/writeback.mjs";
import { resolveDataRoot } from "./lib/path-model.mjs";
import { readText, ensureDir } from "./lib/fs-utils.mjs";
import { splitMarkdownFrontmatter } from "./lib/frontmatter.mjs";
import { t } from "./lib/electron-i18n.mjs";
import {
  loadConnectorSettings,
  persistConnectorPatch,
  writeConnectorNote,
  sleep,
} from "./lib/connector-bridge.mjs";
import { resolveConnectorSyncCategory } from "./lib/connector-category.mjs";
import {
  WEREAD_SKILL_VERSION,
  parseNotebooks,
  parseHighlights,
  parseReviews,
  contentFingerprint,
  formatNotesMarkdown,
  bookTopicName,
  slimStatsSnapshot,
} from "./lib/weread-notes.mjs";

const WEREAD_API_URL = "https://i.weread.qq.com/api/agent/gateway";
const DEFAULT_BUDGET_MS = 4 * 60 * 1000;
const BOOK_THROTTLE_MS = 180;
const NOTEBOOKS_PAGE = 100;
const NOTEBOOKS_MAX_PAGES = 50;
const REVIEWS_PAGE = 20;
const REVIEWS_MAX_PAGES = 40;
const STATS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

const loadSettingsWithSecrets = loadConnectorSettings;
const persistWereadPatch = (ctx, patch) => persistConnectorPatch(ctx, "weread", patch);

async function resolveWereadCategory(settings, ctx) {
  return resolveConnectorSyncCategory(
    ctx.workspaceRoot,
    settings?.weread?.syncCategory,
    "weread",
    { engineRoot: ctx.engineRoot },
  );
}

function budgetMs(settings) {
  const mins = Number(settings?.weread?.syncBudgetMinutes);
  if (Number.isFinite(mins) && mins >= 1 && mins <= 15) return Math.round(mins * 60 * 1000);
  return DEFAULT_BUDGET_MS;
}

/**
 * Gateway call. Params flat next to api_name (official requirement).
 * Surfaces upgrade_info and errcode hints.
 */
async function wereadApi(apiKey, apiName, params = {}) {
  if (!apiKey) throw new Error(t("weread.apiKeyMissing"));
  const body = { api_name: apiName, skill_version: WEREAD_SKILL_VERSION, ...params };
  const res = await fetch(WEREAD_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });

  let json;
  try {
    json = await res.json();
  } catch {
    if (!res.ok) throw new Error(`WeRead API HTTP ${res.status}`);
    throw new Error(t("weread.invalidJson"));
  }

  if (json.upgrade_info?.message) {
    throw new Error(t("weread.upgradeNeeded", { msg: json.upgrade_info.message }));
  }

  if (json.errcode && json.errcode !== 0) {
    const hint =
      json.errcode === -2012
        ? t("weread.keyInvalid")
        : json.errcode === -2003
          ? t("weread.paramError")
          : "";
    throw new Error(t("weread.errorWithCode", { msg: json.errmsg || `code ${json.errcode}` }) + hint);
  }

  if (!res.ok) {
    throw new Error(
      `WeRead API ${res.status}: ${json.errmsg || JSON.stringify(json).slice(0, 200)}`,
    );
  }

  return json.data ?? json;
}

async function fetchAllNotebooks(apiKey, emit) {
  const all = [];
  const seen = new Set();
  let lastSort;
  let page = 0;
  let totalBookCount = null;

  while (page < NOTEBOOKS_MAX_PAGES) {
    const params = { count: NOTEBOOKS_PAGE };
    if (lastSort != null) params.lastSort = lastSort;
    emit?.("weread:sync-progress", {
      phase: "notebooks",
      message: page === 0 ? t("weread.fetchingBooks") : t("weread.pagingNotebooks", { page: page + 1 }),
      page: page + 1,
    });
    const data = await wereadApi(apiKey, "/user/notebooks", params);
    if (totalBookCount == null && data.totalBookCount != null) {
      totalBookCount = Number(data.totalBookCount) || null;
    }
    const rawBooks = Array.isArray(data?.books) ? data.books : [];
    const parsed = parseNotebooks(data);
    for (const b of parsed) {
      if (seen.has(b.bookId)) continue;
      seen.add(b.bookId);
      all.push(b);
    }
    const hasMore = data.hasMore === 1 || data.hasMore === true;
    if (!hasMore || rawBooks.length === 0) break;
    const last = rawBooks[rawBooks.length - 1];
    const nextSort = last?.sort;
    if (nextSort == null || nextSort === lastSort) break;
    lastSort = nextSort;
    page++;
    await sleep(BOOK_THROTTLE_MS);
  }

  all.sort((a, b) => (b.sort || 0) - (a.sort || 0));
  return { notebooks: all, totalBookCount: totalBookCount ?? all.length };
}

async function fetchAllReviews(apiKey, bookId) {
  const all = [];
  let synckey = 0;
  let page = 0;
  while (page < REVIEWS_MAX_PAGES) {
    const data = await wereadApi(apiKey, "/review/list/mine", {
      bookid: bookId,
      synckey,
      count: REVIEWS_PAGE,
    });
    const batch = parseReviews(data);
    all.push(...batch);
    const hasMore = data.hasMore === 1 || data.hasMore === true;
    if (!hasMore || batch.length === 0) break;
    const next = data.synckey;
    if (next == null || next === synckey) break;
    synckey = next;
    page++;
    await sleep(80);
  }
  return all;
}

async function readLocalNoteMeta(highlightsPath) {
  const existingFile = await readText(highlightsPath).catch(() => null);
  if (!existingFile) {
    return {
      existingFile: null,
      localCount: -1,
      noteCount: -1,
      reviewCount: -1,
      fingerprint: null,
    };
  }
  const { data: existingFm } = splitMarkdownFrontmatter(existingFile);
  const localCount = Number(existingFm?.highlight_count);
  const noteCount = Number(existingFm?.note_count);
  const reviewCount = Number(existingFm?.review_count);
  return {
    existingFile,
    localCount: Number.isFinite(localCount) ? localCount : -1,
    noteCount: Number.isFinite(noteCount) ? noteCount : -1,
    reviewCount: Number.isFinite(reviewCount) ? reviewCount : -1,
    fingerprint:
      typeof existingFm?.note_fingerprint === "string" ? existingFm.note_fingerprint : null,
  };
}

function statusFromSettings(settings, syncCategory) {
  const w = settings?.weread || {};
  return {
    ready: Boolean(w.apiKey),
    enabled: Boolean(w.enabled),
    lastSyncAt: w.lastSyncAt || null,
    lastSyncSummary: w.lastSyncSummary || null,
    syncCategory,
    syncCategoryPreference: w.syncCategory || "auto",
    includeThoughts: w.includeThoughts !== false,
    syncBudgetMinutes: Number(w.syncBudgetMinutes) || 4,
    skillVersion: WEREAD_SKILL_VERSION,
    statsCache: w.statsCache || null,
  };
}

export const WereadService = {
  async getStatus(_p, ctx) {
    const settings = await loadSettingsWithSecrets(ctx);
    const syncCategory = await resolveWereadCategory(settings, ctx);
    return statusFromSettings(settings, syncCategory);
  },

  async testConnection(_p, ctx) {
    const settings = await loadSettingsWithSecrets(ctx);
    const apiKey = settings?.weread?.apiKey;
    if (!apiKey) throw new Error(t("weread.apiKeyMissing"));
    const data = await wereadApi(apiKey, "/_list");
    return { ok: true, skillVersion: WEREAD_SKILL_VERSION, data };
  },

  async getBookshelf(_p, ctx) {
    const settings = await loadSettingsWithSecrets(ctx);
    const apiKey = settings?.weread?.apiKey;
    if (!apiKey) throw new Error(t("weread.apiKeyMissing"));
    return wereadApi(apiKey, "/shelf/sync");
  },

  /** Full notebook list with pagination (for hub UI). */
  async listNotebooks(_p, ctx) {
    const settings = await loadSettingsWithSecrets(ctx);
    const apiKey = settings?.weread?.apiKey;
    if (!apiKey) throw new Error(t("weread.apiKeyMissing"));
    const { notebooks, totalBookCount } = await fetchAllNotebooks(apiKey, null);
    return {
      books: notebooks,
      total: notebooks.length,
      totalBookCount,
    };
  },

  async getHighlights({ bookId }, ctx) {
    if (!bookId) throw new Error("bookId required.");
    const settings = await loadSettingsWithSecrets(ctx);
    const apiKey = settings?.weread?.apiKey;
    if (!apiKey) throw new Error(t("weread.apiKeyMissing"));
    return wereadApi(apiKey, "/book/bookmarklist", { bookId });
  },

  async getThoughts({ bookId }, ctx) {
    if (!bookId) throw new Error("bookId required.");
    const settings = await loadSettingsWithSecrets(ctx);
    const apiKey = settings?.weread?.apiKey;
    if (!apiKey) throw new Error(t("weread.apiKeyMissing"));
    return fetchAllReviews(apiKey, bookId);
  },

  /**
   * Reading stats. Uses slim cache when fresh unless force.
   * @param {{ mode?: string, force?: boolean, baseTime?: number }} p
   */
  async getStats(p = {}, ctx) {
    const mode = p.mode || "monthly";
    const force = Boolean(p.force);
    const settings = await loadSettingsWithSecrets(ctx);
    const apiKey = settings?.weread?.apiKey;
    if (!apiKey) throw new Error(t("weread.apiKeyMissing"));

    const cache = settings?.weread?.statsCache;
    if (
      !force &&
      cache &&
      cache.mode === mode &&
      cache.fetchedAt &&
      Date.now() - Date.parse(cache.fetchedAt) < STATS_CACHE_TTL_MS
    ) {
      return { ...cache, fromCache: true };
    }

    const params = { mode };
    if (p.baseTime != null) params.baseTime = p.baseTime;
    const raw = await wereadApi(apiKey, "/readdata/detail", params);
    const slim = slimStatsSnapshot(raw, mode);
    try {
      await persistWereadPatch(ctx, { statsCache: slim });
    } catch (err) {
      logWarn("weread", "failed to cache stats", { error: err.message });
    }
    return { ...slim, fromCache: false, raw: force ? undefined : undefined };
  },

  async searchBooks({ keyword, count = 10 }, ctx) {
    if (!keyword) throw new Error("keyword required.");
    const settings = await loadSettingsWithSecrets(ctx);
    const apiKey = settings?.weread?.apiKey;
    if (!apiKey) throw new Error(t("weread.apiKeyMissing"));
    return wereadApi(apiKey, "/store/search", { keyword, count });
  },

  async getBookDetail({ bookId }, ctx) {
    if (!bookId) throw new Error("bookId required.");
    const settings = await loadSettingsWithSecrets(ctx);
    const apiKey = settings?.weread?.apiKey;
    if (!apiKey) throw new Error(t("weread.apiKeyMissing"));
    return wereadApi(apiKey, "/book/info", { bookId });
  },

  /**
   * Sync highlights (+ thoughts) into workspace topics.
   * @param {{ bookIds?: string[], force?: boolean }} p
   */
  async syncHighlights(p = {}, ctx) {
    const settings = await loadSettingsWithSecrets(ctx);
    const apiKey = settings?.weread?.apiKey;
    if (!apiKey) throw new Error(t("weread.apiKeyMissing"));

    const includeThoughts = settings?.weread?.includeThoughts !== false;
    const force = Boolean(p.force);
    const filterIds = Array.isArray(p.bookIds)
      ? new Set(p.bookIds.map(String).filter(Boolean))
      : null;

    const syncCategory = await resolveWereadCategory(settings, ctx);
    const dataRoot = resolveDataRoot(ctx.workspaceRoot);
    const categoryDir = path.join(dataRoot, syncCategory);
    await ensureDir(categoryDir);

    const emit = typeof ctx.emit === "function" ? ctx.emit : () => {};
    const startedAt = Date.now();
    const maxMs = budgetMs(settings);

    logInfo("weread", "sync started", {
      syncCategory,
      includeThoughts,
      force,
      filterCount: filterIds?.size ?? 0,
      lastSyncAt: settings?.weread?.lastSyncAt || null,
    });

    let notebooks;
    let totalBookCount;
    try {
      const listed = await fetchAllNotebooks(apiKey, emit);
      notebooks = listed.notebooks;
      totalBookCount = listed.totalBookCount;
    } catch (err) {
      logWarn("weread", "/user/notebooks failed", { error: err.message });
      throw new Error(t("weread.fetchListFail", { msg: err.message }));
    }

    if (filterIds && filterIds.size > 0) {
      notebooks = notebooks.filter((b) => filterIds.has(b.bookId));
    }

    if (notebooks.length === 0) {
      const result = {
        ok: true,
        synced: 0,
        skipped: 0,
        skippedNoChange: 0,
        skippedNoHighlights: 0,
        total: 0,
        remaining: 0,
        totalHighlights: 0,
        totalThoughts: 0,
        message: filterIds
          ? t("weread.noExportableBooks")
          : t("weread.noNoteBooks"),
        syncCategory,
        skillVersion: WEREAD_SKILL_VERSION,
      };
      emit("weread:sync-done", result);
      return result;
    }

    emit("weread:sync-progress", {
      phase: "sync",
      message: t("weread.syncProgress", { count: notebooks.length, overview: totalBookCount ? ` (${totalBookCount})` : "", category: syncCategory, thoughts: includeThoughts ? "on" : "off" }),
      current: 0,
      total: notebooks.length,
    });

    let synced = 0;
    let skipped = 0;
    let skippedNoChange = 0;
    let skippedNoHighlights = 0;
    let totalHighlights = 0;
    let totalThoughts = 0;
    let processed = 0;
    let stoppedEarly = false;
    const errors = [];
    const syncedPaths = [];

    for (let i = 0; i < notebooks.length; i++) {
      if (Date.now() - startedAt > maxMs) {
        stoppedEarly = true;
        logInfo("weread", "sync budget reached", {
          processed,
          remaining: notebooks.length - processed,
        });
        break;
      }

      const book = notebooks[i];
      const bookId = book.bookId;
      const bookTitle = book.title || bookId;
      const topicName = bookTopicName(book);
      const topicDir = path.join(categoryDir, topicName);
      const highlightsPath = path.join(topicDir, "划线笔记.md");

      emit("weread:sync-progress", {
        phase: "book",
        message: `(${i + 1}/${notebooks.length}) ${bookTitle}`,
        current: i + 1,
        total: notebooks.length,
        bookTitle,
        bookId,
      });

      try {
        const local = await readLocalNoteMeta(highlightsPath);
        const remoteTarget = includeThoughts
          ? book.noteCount + book.reviewCount
          : book.noteCount;
        const localTarget = includeThoughts
          ? local.localCount
          : local.noteCount >= 0
            ? local.noteCount
            : local.localCount;

        // Cheap skip: remote notebook counts match local (best-effort; same-count swaps rare)
        if (!force && localTarget >= 0 && remoteTarget > 0 && localTarget === remoteTarget) {
          skippedNoChange++;
          processed++;
          continue;
        }

        const highlightData = await wereadApi(apiKey, "/book/bookmarklist", { bookId });
        const highlights = parseHighlights(highlightData);

        let reviews = [];
        if (includeThoughts) {
          try {
            reviews = await fetchAllReviews(apiKey, bookId);
          } catch (err) {
            logWarn("weread", "reviews fetch failed — continuing with highlights only", {
              bookId,
              error: err.message,
            });
          }
        }

        if (highlights.length === 0 && reviews.length === 0) {
          skippedNoHighlights++;
          processed++;
          continue;
        }

        const fp = contentFingerprint(highlights, reviews);
        const exportable = highlights.length + reviews.length;

        if (!force && local.fingerprint && local.fingerprint === fp) {
          skippedNoChange++;
          processed++;
          continue;
        }

        totalHighlights += highlights.length;
        totalThoughts += reviews.length;
        await ensureDir(topicDir);

        const nowIso = new Date().toISOString();
        const topicFm = {
          title: bookTitle,
          author: book.author || "",
          category: syncCategory,
          topic: topicName,
          source_type: "external-capture",
          source: "weread",
          weread_book_id: bookId,
          rating: book.rating || "",
          status: book.readingStatus === "done" ? "done" : "reading",
          synced_at: nowIso,
        };
        if (book.isbn) topicFm.isbn = book.isbn;
        if (book.cover) topicFm.cover = book.cover;

        const topicPath = path.join(topicDir, "topic.md");
        await writeConnectorNote(ctx, {
          absPath: topicPath,
          body: `# ${topicFm.title}\n\n> 来源: 微信读书\n> 作者: ${topicFm.author}\n> 同步时间: ${topicFm.synced_at}\n`,
          frontmatter: topicFm,
          operation: "update",
        });

        const md = formatNotesMarkdown(book, highlights, reviews);
        const hlFm = {
          title: `${topicFm.title} - 划线笔记`,
          source_type: "external-capture",
          source: "weread",
          weread_book_id: bookId,
          synced_at: nowIso,
          highlight_count: exportable,
          note_count: highlights.length,
          review_count: reviews.length,
          note_fingerprint: fp,
        };
        await writeConnectorNote(ctx, {
          absPath: highlightsPath,
          body: md,
          frontmatter: hlFm,
          operation: "update",
        });

        const rel = `${syncCategory}/${topicName}/划线笔记.md`.replace(/\\/g, "/");
        syncedPaths.push(rel);
        synced++;
        processed++;
      } catch (err) {
        logError("weread", "book sync failed", {
          bookId,
          title: bookTitle,
          error: err.message,
        });
        errors.push({ bookId, title: bookTitle, error: err.message });
        skipped++;
        processed++;
      }

      if (i < notebooks.length - 1) await sleep(BOOK_THROTTLE_MS);
    }

    const remaining = notebooks.length - processed;
    const now = new Date().toISOString();
    const summary = {
      synced,
      skippedNoChange,
      skipped,
      remaining,
      total: notebooks.length,
      isPartial: remaining > 0 || stoppedEarly,
    };
    try {
      await persistWereadPatch(ctx, {
        lastSyncAt: now,
        lastSyncSummary: summary,
      });
    } catch (err) {
      logWarn("weread", "failed to persist lastSyncAt", { error: err.message });
    }

    logInfo("weread", "sync completed", {
      ...summary,
      totalHighlights,
      totalThoughts,
      syncCategory,
    });

    const result = {
      ok: true,
      synced,
      skipped,
      skippedNoChange,
      skippedNoHighlights,
      total: notebooks.length,
      totalHighlights,
      totalThoughts,
      remaining,
      lastSyncAt: now,
      syncCategory,
      isPartial: summary.isPartial,
      skillVersion: WEREAD_SKILL_VERSION,
      paths: syncedPaths.slice(0, 20),
      message: remaining > 0
        ? t("weread.batchProgress", { processed, total: notebooks.length, remaining })
        : undefined,
      errors: errors.length > 0 ? errors : undefined,
    };
    emit("weread:sync-done", result);
    if (synced > 0 && typeof ctx.emit === "function") {
      // Notify workspace tree after disk writes
      try {
        ctx.emit("workspace:file-changed", { source: "weread-sync" });
      } catch {
        /* optional */
      }
    }
    return result;
  },
};
