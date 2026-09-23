/**
 * Page/selection extract for clip payloads.
 *
 * Uses Mozilla Readability (same engine as Desktop / Firefox Reader Mode)
 * on the live DOM — best path for hydrated SPA pages the user is viewing.
 * Falls back to a cleaned main/article heuristic when Readability finds little.
 *
 * Prefer sending content_html so Desktop Clip Bridge can convert with the
 * shared html-to-markdown pipeline (no second converter to maintain).
 *
 * Performance: inject Readability once per tab session (sessionStorage flag);
 * prefer article/main subtree clone before full document.
 */

const READABILITY_FILE = "lib/vendor/Readability.js";

/**
 * @param {number} tabId
 * @returns {Promise<{
 *   title: string,
 *   url: string,
 *   content: string,
 *   content_html?: string,
 *   selection?: string,
 *   mode: 'selection' | 'readability' | 'heuristic',
 *   author?: string,
 *   site_name?: string,
 *   excerpt?: string,
 * } | null>}
 */
export async function extractFromTab(tabId) {
  // Restricted chrome:// / edge:// / about: — fail fast (no inject thrash)
  try {
    const tab = await chrome.tabs.get(tabId);
    const u = String(tab?.url || "");
    if (/^(chrome|edge|about|devtools|chrome-extension|moz-extension):/i.test(u)) {
      return {
        title: tab?.title || chrome.i18n.getMessage("restricted_page") || "Restricted page",
        url: u,
        content: "",
        mode: "heuristic",
        error: "restricted_url",
      };
    }
  } catch {
    /* continue — tab may still be extractable */
  }

  // Skip re-inject when already present in this document
  let needInject = true;
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(globalThis.Readability),
    });
    needInject = !result;
  } catch {
    needInject = true;
  }

  if (needInject) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [READABILITY_FILE],
    });
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractInPage,
  });
  return results?.[0]?.result || null;
}

/**
 * Runs in the tab's isolated world (has Readability global from vendor file).
 * Must be self-contained — chrome.scripting serializes this function.
 */
function extractInPage() {
  const MAX = 1_800_000;
  const url = cleanUrl(location.href);
  const selection = String(window.getSelection?.()?.toString() || "").trim();
  const siteName =
    document.querySelector('meta[property="og:site_name"]')?.getAttribute("content") ||
    undefined;
  const pageTitle = resolvePageTitle(siteName);

  // Prefer non-trivial selection (user intent) — keep *page* title cleaned
  if (selection.length >= 20) {
    return {
      title: pageTitle,
      url,
      selection,
      content: selection.slice(0, MAX),
      mode: "selection",
      site_name: siteName ? String(siteName).trim() : undefined,
    };
  }

  // ── Mozilla Readability (prefer main/article subtree, then full doc) ──
  // Perf: avoid full-document clone when article/main already yields enough text.
  let readabilityResult = null;
  try {
    const ReadabilityCtor = globalThis.Readability;
    if (typeof ReadabilityCtor === "function") {
      const roots = [];
      const main =
        document.querySelector("article") ||
        document.querySelector("main") ||
        document.querySelector("[role=main]");
      if (main) roots.push(main);
      // Only fall back to full document if no main, or main is tiny
      const mainTextLen = main ? String(main.innerText || "").trim().length : 0;
      if (!main || mainTextLen < 200) {
        roots.push(document.documentElement);
      }

      for (const rootEl of roots) {
        try {
          const clone =
            rootEl === document.documentElement
              ? document.cloneNode(true)
              : (() => {
                  const html = document.implementation.createHTMLDocument("");
                  const base = html.createElement("base");
                  base.setAttribute("href", location.href);
                  html.head.appendChild(base);
                  html.body.appendChild(rootEl.cloneNode(true));
                  return html;
                })();
          if (rootEl === document.documentElement) {
            try {
              const base = clone.createElement("base");
              base.setAttribute("href", location.href);
              const head = clone.querySelector("head");
              if (head) head.insertBefore(base, head.firstChild);
            } catch {
              /* ignore */
            }
          }
          const article = new ReadabilityCtor(clone, {
            charThreshold: 80,
            keepClasses: false,
          }).parse();
          if (article && String(article.textContent || "").trim().length >= 80) {
            readabilityResult = article;
            break;
          }
        } catch {
          /* try next root */
        }
      }
    }
  } catch {
    readabilityResult = null;
  }

  if (readabilityResult) {
    const contentHtml = String(readabilityResult.content || "").slice(0, MAX);
    const plain = normalizePlain(readabilityResult.textContent || "");
    const sn = (readabilityResult.siteName || siteName || "").trim() || undefined;
    const title = cleanTitle(
      (readabilityResult.title || pageTitle || "").trim() || pageTitle,
      sn,
    );
    return {
      title,
      url,
      content: plain.slice(0, MAX),
      content_html: contentHtml || undefined,
      mode: "readability",
      author: (readabilityResult.byline || "").trim() || resolveAuthor() || undefined,
      site_name: sn,
      excerpt: (readabilityResult.excerpt || "").trim() || undefined,
      selection: selection || undefined,
      published: resolvePublished() || undefined,
    };
  }

  // ── Heuristic fallback (main/article + chrome strip) ──────────────────
  const root =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.querySelector("[role=main]") ||
    document.querySelector(".post-content, .entry-content, .article-body, .markdown-body, #content") ||
    document.body;

  const clone = root.cloneNode(true);
  for (const sel of [
    "script",
    "style",
    "nav",
    "footer",
    "header",
    "aside",
    "noscript",
    "iframe",
    "form",
    "svg",
    "template",
    "[hidden]",
    "[aria-hidden='true']",
    ".ads",
    ".advert",
    ".adsbygoogle",
    ".sidebar",
    ".comment",
    ".comments",
    ".related",
    ".recommend",
    ".share",
    ".social",
    ".newsletter",
    ".cookie",
    ".popup",
    ".modal",
    ".promo",
    ".banner",
  ]) {
    try {
      clone.querySelectorAll(sel).forEach((n) => n.remove());
    } catch {
      /* ignore invalid selectors in older pages */
    }
  }

  const contentHtml = (clone.innerHTML || "").slice(0, MAX);
  let text = normalizePlain(clone.innerText || clone.textContent || "");

  const metaDesc =
    document.querySelector('meta[name="description"]')?.getAttribute("content") ||
    document.querySelector('meta[property="og:description"]')?.getAttribute("content") ||
    "";
  if (metaDesc && text.length < 80) {
    text = metaDesc.trim() + (text ? `\n\n${text}` : "");
  }

  return {
    title: pageTitle,
    url,
    content: text.slice(0, MAX),
    content_html: contentHtml || undefined,
    mode: "heuristic",
    author: resolveAuthor() || undefined,
    site_name: siteName ? String(siteName).trim() : undefined,
    excerpt: metaDesc ? String(metaDesc).trim() : undefined,
    selection: selection || undefined,
    published: resolvePublished() || undefined,
  };

  function resolveAuthor() {
    return (
      document.querySelector('meta[name="author"]')?.getAttribute("content") ||
      document.querySelector('meta[property="article:author"]')?.getAttribute("content") ||
      document.querySelector('meta[property="og:article:author"]')?.getAttribute("content") ||
      document.querySelector('[rel="author"]')?.textContent ||
      ""
    ).trim() || undefined;
  }

  function resolvePublished() {
    const raw =
      document.querySelector('meta[property="article:published_time"]')?.getAttribute("content") ||
      document.querySelector('meta[name="publishdate"]')?.getAttribute("content") ||
      document.querySelector('meta[name="pubdate"]')?.getAttribute("content") ||
      document.querySelector("time[datetime]")?.getAttribute("datetime") ||
      document.querySelector('meta[itemprop="datePublished"]')?.getAttribute("content") ||
      "";
    return String(raw || "").trim() || undefined;
  }

  /** Prefer og/twitter/h1, then document.title; strip site brand suffix. */
  function resolvePageTitle(site) {
    const og =
      document.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
      document.querySelector('meta[name="twitter:title"]')?.getAttribute("content") ||
      "";
    const h1 = document.querySelector("h1")?.textContent || "";
    const raw = String(og || document.title || h1 || "").trim();
    return cleanTitle(raw, site) || raw || chrome.i18n.getMessage("no_title") || "(Untitled)";
  }

  function cleanTitle(raw, site) {
    let t = String(raw || "")
      .replace(/\s+/gu, " ")
      .replace(/[\u200b-\u200d\ufeff]/gu, "")
      .trim();
    if (!t) return "";
    t = t
      .replace(/&amp;/giu, "&")
      .replace(/&quot;/giu, '"')
      .replace(/&#39;|&apos;/giu, "'");
    const sn = site ? String(site).trim() : "";
    const sepRe = /\s*[|»›·•]\s*|\s+[-–—]\s+/u;
    if (sepRe.test(t)) {
      const parts = t.split(sepRe).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const left = parts[0];
        const right = parts[parts.length - 1];
        const rightIsSite =
          (sn &&
            (right.toLowerCase().includes(sn.toLowerCase().slice(0, 12)) ||
              sn.toLowerCase().includes(right.toLowerCase().slice(0, 12)))) ||
          (right.length <= 36 && left.length >= 8 && left.length >= right.length);
        if (rightIsSite && left.length >= 4) t = left;
        else if (parts.length === 2 && left.length >= 12 && right.length <= 28) t = left;
      }
    }
    t = t.replace(/^(Home|首页|主页)\s*[>|/›»-]+\s*/iu, "").trim();
    if (t.length > 120) t = `${t.slice(0, 119).trim()}…`;
    return t;
  }

  function normalizePlain(raw) {
    return String(raw || "")
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  /** Strip common tracking query params (aligned with Desktop cleanCaptureUrl). */
  function cleanUrl(raw) {
    try {
      const u = new URL(String(raw));
      const drop = [];
      for (const key of u.searchParams.keys()) {
        if (/^(utm_|fbclid|gclid|mc_|ref$|ref_|spm|from$|source$|ic_|ved$|si$|sclid)/iu.test(key)) {
          drop.push(key);
        }
      }
      for (const k of drop) u.searchParams.delete(k);
      u.hash = "";
      return u.toString();
    } catch {
      return String(raw || "").trim();
    }
  }
}
