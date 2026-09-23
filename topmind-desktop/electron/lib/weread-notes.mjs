/**
 * Pure WeRead note helpers — parsing, merge, format, fingerprint.
 * Kept free of I/O so unit tests can import without Electron.
 */
import { createHash } from "node:crypto";

/** Official skill_version for Agent Gateway body. */
export const WEREAD_SKILL_VERSION = "1.0.4";

/** Official Agent Gateway endpoint (POST + Bearer wrk-*). */
export const WEREAD_GATEWAY_URL = "https://i.weread.qq.com/api/agent/gateway";

/**
 * Official request body: api_name + skill_version + business params **flat**.
 * Never nest under `params`.
 */
export function buildGatewayBody(apiName, params = {}) {
  const extra = params && typeof params === "object" && !Array.isArray(params) ? params : {};
  return { api_name: apiName, skill_version: WEREAD_SKILL_VERSION, ...extra };
}

/**
 * Inspect a gateway JSON envelope. `upgrade_info` is advisory (newer zip)
 * and must be surfaced without treating the call as failed when data exists.
 */
export function inspectGatewayResponse(json) {
  if (!json || typeof json !== "object") {
    return { ok: false, errcode: -1, errmsg: "invalid-json", data: null, upgradeInfo: null };
  }
  const upgradeInfo =
    json.upgrade_info && typeof json.upgrade_info === "object" ? json.upgrade_info : null;
  const errcode = Number(json.errcode ?? 0) || 0;
  const hasError = errcode !== 0;
  const data = json.data !== undefined ? json.data : hasError ? null : json;
  return {
    ok: !hasError,
    errcode,
    errmsg: typeof json.errmsg === "string" ? json.errmsg : "",
    upgradeInfo,
    data,
  };
}

/** `/user/notebooks` page params (`count` + optional `lastSort`). */
export function notebooksPageParams(lastSort, count = 100) {
  const params = { count };
  if (lastSort != null) params.lastSort = lastSort;
  return params;
}

/** `/review/list/mine` page params (`bookid` + `synckey` + `count`). */
export function reviewsPageParams(bookId, synckey = 0, count = 20) {
  return { bookid: bookId, synckey, count };
}

/**
 * Exportable = 划线 (noteCount) + optional 想法 (reviewCount).
 * bookmarkCount is not exportable.
 */
export function isExportableBook(book, opts = {}) {
  const includeThoughts = opts.includeThoughts !== false;
  const noteCount = Number(book?.noteCount) || 0;
  const reviewCount = Number(book?.reviewCount) || 0;
  return includeThoughts ? noteCount + reviewCount > 0 : noteCount > 0;
}

export function remoteExportableCount(book, includeThoughts = true) {
  const noteCount = Number(book?.noteCount) || 0;
  const reviewCount = Number(book?.reviewCount) || 0;
  return includeThoughts ? noteCount + reviewCount : noteCount;
}

/**
 * Incremental / skip-empty decision used by WereadService.
 * `lastSyncAt` is never consulted (display-only).
 *
 * Pre-fetch (highlights/reviews omitted): skip-empty | skip-unchanged | fetch
 * Post-fetch: skip-empty | skip-unchanged | write
 *
 * @returns {{ action: 'skip-empty'|'skip-unchanged'|'fetch'|'write', reason: string, fingerprint?: string }}
 */
export function decideBookSync({
  force = false,
  includeThoughts = true,
  remote = {},
  local = {},
  highlights,
  reviews,
} = {}) {
  const remoteTarget = remoteExportableCount(remote, includeThoughts);
  const fetched = highlights !== undefined || reviews !== undefined;

  if (!fetched) {
    if (!isExportableBook(remote, { includeThoughts })) {
      return { action: "skip-empty", reason: "no-exportable-count" };
    }
    if (force) return { action: "fetch", reason: "force" };
    const localTarget = includeThoughts
      ? Number(local.localCount)
      : Number(local.noteCount) >= 0
        ? Number(local.noteCount)
        : Number(local.localCount);
    if (Number.isFinite(localTarget) && localTarget >= 0 && remoteTarget > 0 && localTarget === remoteTarget) {
      return { action: "skip-unchanged", reason: "count-match" };
    }
    return { action: "fetch", reason: "need-content" };
  }

  const hl = Array.isArray(highlights) ? highlights : [];
  const rv = Array.isArray(reviews) ? reviews : [];
  if (hl.length === 0 && rv.length === 0) {
    return { action: "skip-empty", reason: "empty-after-fetch" };
  }
  const fingerprint = contentFingerprint(hl, rv);
  if (!force && local.fingerprint && local.fingerprint === fingerprint) {
    return { action: "skip-unchanged", reason: "fingerprint-match", fingerprint };
  }
  return { action: "write", reason: force ? "force" : "changed", fingerprint };
}

/**
 * Parse /user/notebooks page into normalized book rows.
 * Exportable content ≈ noteCount (划线) + reviewCount (想法/点评).
 * bookmarkCount is bookmarkers only (not exportable content).
 */
export function parseNotebooks(notebookData) {
  const rawNotebooks = Array.isArray(notebookData?.books)
    ? notebookData.books
    : Array.isArray(notebookData)
      ? notebookData
      : [];
  return rawNotebooks
    .map((n) => {
      const bookInfo = n.book || n.bookInfo || n;
      const noteCount = Number(n.noteCount ?? 0) || 0;
      const reviewCount = Number(n.reviewCount ?? 0) || 0;
      const bookmarkCount = Number(n.bookmarkCount ?? 0) || 0;
      const exportableCount = noteCount + reviewCount;
      const markedStatus = n.markedStatus;
      let readingStatus = "reading";
      if (markedStatus === 1 || bookInfo.finishReading === 1) readingStatus = "done";
      return {
        bookId: String(n.bookId || bookInfo.bookId || bookInfo.id || ""),
        title: bookInfo.title || bookInfo.bookName || "",
        author: bookInfo.author || "",
        cover: bookInfo.cover || "",
        isbn: bookInfo.isbn || "",
        rating: bookInfo.newRating ?? bookInfo.rating ?? "",
        readingStatus,
        readingProgress: n.readingProgress ?? null,
        sort: Number(n.sort) || 0,
        noteCount,
        reviewCount,
        bookmarkCount,
        /** Exportable annotation count (划线 + 想法) — used for skip / progress UI. */
        remoteExportableCount: exportableCount,
        /** Statistical total = 划线 + 想法 + 书签. */
        remoteStatCount: noteCount + reviewCount + bookmarkCount,
      };
    })
    .filter((n) => n.bookId && isExportableBook(n));
}

/** Map chapterUid → title from bookmarklist chapters[]. */
export function buildChapterMap(chapters) {
  const map = new Map();
  if (!Array.isArray(chapters)) return map;
  for (const ch of chapters) {
    const uid = ch.chapterUid ?? ch.chapterIdx;
    if (uid == null) continue;
    map.set(String(uid), ch.title || ch.chapterTitle || `章节 ${uid}`);
  }
  return map;
}

/** Normalize bookmarklist payload into highlight rows. */
export function parseHighlights(highlightData) {
  const raw = Array.isArray(highlightData?.updated)
    ? highlightData.updated
    : Array.isArray(highlightData?.bookmarks)
      ? highlightData.bookmarks
      : Array.isArray(highlightData)
        ? highlightData
        : [];
  const chapterMap = buildChapterMap(highlightData?.chapters);
  return raw.map((h) => {
    const chapterUid = h.chapterUid != null ? String(h.chapterUid) : "";
    return {
      bookmarkId: String(h.bookmarkId || h.markId || ""),
      bookId: String(h.bookId || ""),
      chapterUid,
      chapterName: h.chapterName || chapterMap.get(chapterUid) || "未分类",
      markText: h.markText || h.highlightText || h.content || "",
      createTime: h.createTime || null,
      range: h.range || "",
      colorStyle: h.colorStyle,
      type: h.type,
    };
  }).filter((h) => h.markText || h.bookmarkId);
}

/** Normalize /review/list/mine page into thought rows. */
export function parseReviews(reviewData) {
  const raw = Array.isArray(reviewData?.reviews) ? reviewData.reviews : [];
  return raw.map((item) => {
    const r = item.review || item;
    return {
      reviewId: String(r.reviewId || item.reviewId || ""),
      content: r.content || "",
      abstract: r.abstract || "",
      range: r.range || "",
      chapterUid: r.chapterUid != null ? String(r.chapterUid) : "",
      chapterName: r.chapterName || "",
      chapterIdx: r.chapterIdx,
      createTime: r.createTime || null,
      star: r.star,
      isFinish: r.isFinish,
    };
  }).filter((r) => r.content || r.abstract || r.reviewId);
}

/**
 * Content fingerprint for skip detection (count alone can miss replace-same-count).
 */
export function contentFingerprint(highlights, reviews) {
  const hIds = (highlights || [])
    .map((h) => h.bookmarkId || `${h.range}|${h.markText}`)
    .filter(Boolean)
    .sort();
  const rIds = (reviews || [])
    .map((r) => r.reviewId || `${r.range}|${r.content}`)
    .filter(Boolean)
    .sort();
  const payload = `h:${hIds.length}:${hIds.join(",")}|r:${rIds.length}:${rIds.join(",")}`;
  return createHash("sha1").update(payload).digest("hex").slice(0, 16);
}

/**
 * Merge highlights + thoughts into chapter-grouped markdown body (no frontmatter).
 */
export function formatNotesMarkdown(book, highlights, reviews) {
  const title = book.title || book.bookName || "未知书名";
  const parts = [`# ${title} - 划线笔记\n`];

  /** @type {Map<string, { highlights: any[], thoughts: any[] }>} */
  const byChapter = new Map();
  const ensure = (name) => {
    const key = name || "未分类";
    if (!byChapter.has(key)) byChapter.set(key, { highlights: [], thoughts: [] });
    return byChapter.get(key);
  };

  for (const h of highlights || []) {
    ensure(h.chapterName).highlights.push(h);
  }

  // Pair thoughts that have abstract/range with matching highlight; else chapter bucket
  const usedThoughts = new Set();
  const rangeToThoughts = new Map();
  for (const t of reviews || []) {
    if (t.range) {
      if (!rangeToThoughts.has(t.range)) rangeToThoughts.set(t.range, []);
      rangeToThoughts.get(t.range).push(t);
    }
  }

  for (const [, bucket] of byChapter) {
    for (const h of bucket.highlights) {
      if (h.range && rangeToThoughts.has(h.range)) {
        for (const t of rangeToThoughts.get(h.range)) {
          if (!usedThoughts.has(t.reviewId || t.content)) {
            usedThoughts.add(t.reviewId || t.content);
            h._linkedThoughts = h._linkedThoughts || [];
            h._linkedThoughts.push(t);
          }
        }
      }
    }
  }

  for (const t of reviews || []) {
    const key = t.reviewId || t.content;
    if (usedThoughts.has(key)) continue;
    const chName = t.chapterName || (t.chapterUid ? `章节 ${t.chapterUid}` : "想法与点评");
    ensure(chName).thoughts.push(t);
    usedThoughts.add(key);
  }

  // Stable chapter order: first by highlight order appearance, then remaining
  const order = [];
  const seen = new Set();
  for (const h of highlights || []) {
    const n = h.chapterName || "未分类";
    if (!seen.has(n)) {
      seen.add(n);
      order.push(n);
    }
  }
  for (const name of byChapter.keys()) {
    if (!seen.has(name)) order.push(name);
  }

  for (const ch of order) {
    const bucket = byChapter.get(ch);
    if (!bucket) continue;
    if (bucket.highlights.length === 0 && bucket.thoughts.length === 0) continue;
    parts.push(`## ${ch}\n`);
    for (const h of bucket.highlights) {
      if (h.markText) parts.push(`> ${h.markText}\n`);
      for (const t of h._linkedThoughts || []) {
        if (t.content) parts.push(`💡 **想法**: ${t.content}\n`);
      }
      parts.push("");
    }
    for (const t of bucket.thoughts) {
      if (t.abstract) {
        parts.push(`> ${t.abstract}\n`);
      }
      if (t.content) {
        const label = t.chapterName && !t.abstract ? "点评" : "想法";
        parts.push(`💡 **${label}**: ${t.content}\n`);
      }
      if (t.star != null && t.star >= 0) {
        parts.push(`评分: ${t.star}/5\n`);
      }
      parts.push("");
    }
  }

  if ((highlights || []).length === 0 && (reviews || []).length === 0) {
    parts.push("_（暂无划线或想法）_\n");
  }

  return parts.join("\n");
}

export function sanitizeBookTitle(title) {
  const clean = String(title || "").replace(/[\\/:*?"<>|]/gu, "").trim();
  return clean || "未知书名";
}

export function bookTopicName(book, year = new Date().getFullYear()) {
  return `${year}-${sanitizeBookTitle(book.title || book.bookName)}`;
}

/** Seconds → "X小时Y分钟" for UI. */
export function formatReadDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h <= 0 && m <= 0) return s > 0 ? "不足1分钟" : "0分钟";
  if (h <= 0) return `${m}分钟`;
  if (m <= 0) return `${h}小时`;
  return `${h}小时${m}分钟`;
}

/** Slim stats snapshot for cache / hub UI (no full raw payload). */
export function slimStatsSnapshot(raw, mode = "monthly") {
  if (!raw || typeof raw !== "object") return null;
  const topBooks = Array.isArray(raw.readLongest)
    ? raw.readLongest.slice(0, 5).map((item) => {
        const book = item.book || {};
        const album = item.albumInfo || {};
        return {
          title: book.title || album.name || "未知",
          author: book.author || album.authorName || "",
          readTime: item.readTime || 0,
          bookId: book.bookId ? String(book.bookId) : null,
        };
      })
    : [];
  const preferCategories = Array.isArray(raw.preferCategory)
    ? raw.preferCategory.slice(0, 5).map((c) => ({
        title: c.categoryTitle || c.parentCategoryTitle || "",
        readingTime: c.readingTime || 0,
        readingCount: c.readingCount || 0,
      }))
    : [];
  return {
    mode,
    fetchedAt: new Date().toISOString(),
    totalReadTime: raw.totalReadTime ?? 0,
    readDays: raw.readDays ?? 0,
    dayAverageReadTime: raw.dayAverageReadTime ?? 0,
    compare: raw.compare ?? null,
    preferCategoryWord: raw.preferCategoryWord || "",
    preferTimeWord: raw.preferTimeWord || "",
    readStat: Array.isArray(raw.readStat)
      ? raw.readStat.map((s) => ({ stat: s.stat, counts: s.counts }))
      : [],
    topBooks,
    preferCategories,
  };
}
