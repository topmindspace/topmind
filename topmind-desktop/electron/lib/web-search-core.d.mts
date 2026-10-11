/** Web-search core — pure parse / score / rank (shared across surfaces). */

export type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
};

export type RankedWebSearchHit = WebSearchHit & {
  host: string;
  score: number;
};

export declare const WEB_SEARCH_MAX_RESULTS: number;
export declare const WEB_SEARCH_SNIPPET_MAX: number;

export declare function isHttpUrl(url: string): boolean;
export declare function unwrapDdgRedirect(href: string): string;
export declare function domainScore(hostname: string): number;
export declare function hostOf(url: string): string;
export declare function rankResults(
  results: WebSearchHit[],
  opts?: { limit?: number; perHost?: number },
): RankedWebSearchHit[];
export declare function parseDdgHtmlLite(html: string): WebSearchHit[];
export declare function ddgSearchUrl(query: string): string;
