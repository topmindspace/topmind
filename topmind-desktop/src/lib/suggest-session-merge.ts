/**
 * Pure merge for ActionStore soft refresh — prevents appear-then-vanish thrash.
 *
 * Kernel generateSuggestions often returns a different (or empty) set on the next
 * poll because activity fingerprints skip re-analysis. Soft refresh must keep
 * session-visible, non-dismissed suggestions until the user applies/dismisses them.
 */

export type SessionSuggestionSeed = {
  id: string;
  kind?: string;
  title: string;
  summary: string;
  targetPath?: string;
  impact?: "low" | "medium" | "high";
  payload?: Record<string, unknown>;
};

export type MergePendingWrite = {
  id: string;
  relativePath: string;
  content?: string;
  toolName?: string;
};

export type MergedActionItem = {
  id: string;
  source: "suggestion" | "pending_write";
  priority: "low" | "medium" | "high";
  title: string;
  summary: string;
  targetPath?: string;
  suggestionKind?: string;
  suggestionPayload?: Record<string, unknown>;
  writeContent?: string;
  toolName?: string;
  createdAt: string;
};

function impactToPriority(impact?: string): "low" | "medium" | "high" {
  if (impact === "high") return "high";
  if (impact === "medium") return "medium";
  return "low";
}

/**
 * Rebuild visible action items for a soft or hard refresh.
 *
 * @param soft — when true, empty kernel regenerate keeps prior session suggestions
 */
export function mergeSuggestRefreshItems(opts: {
  pending: MergePendingWrite[];
  kernelSuggestions: SessionSuggestionSeed[];
  /** Session cache of all suggestions ever shown this session (mutated in place when seeds applied) */
  sessionCache: Map<string, SessionSuggestionSeed>;
  /** Activity-ops cache (memory_organize / topic_classify) */
  opCache: Map<string, SessionSuggestionSeed>;
  dismissed: Set<string>;
  applied: Set<string>;
  /** Previous UI items (for soft empty preserve) */
  previousItems?: Array<{
    id: string;
    source: string;
    title: string;
    summary: string;
    targetPath?: string;
    suggestionKind?: string;
    suggestionPayload?: Record<string, unknown>;
    priority?: string;
  }>;
  soft?: boolean;
  pendingTitle?: string;
  nowIso?: string;
  limit?: number;
}): MergedActionItem[] {
  const {
    pending,
    kernelSuggestions,
    sessionCache,
    opCache,
    dismissed,
    applied,
    previousItems = [],
    soft = true,
    pendingTitle = "Pending write",
    nowIso = new Date().toISOString(),
    limit = 12,
  } = opts;

  // Update session cache from fresh kernel results
  for (const s of kernelSuggestions) {
    if (!s?.id || dismissed.has(s.id) || applied.has(s.id)) continue;
    sessionCache.set(s.id, {
      id: s.id,
      kind: s.kind,
      title: s.title || s.kind || "suggestion",
      summary: s.summary || "",
      targetPath: s.targetPath,
      impact: s.impact,
      payload: s.payload,
    });
  }

  // Soft empty: kernel returned nothing — keep previously visible suggestions in session cache
  if (
    soft &&
    kernelSuggestions.length === 0 &&
    previousItems.some((i) => i.source === "suggestion")
  ) {
    for (const p of previousItems) {
      if (p.source !== "suggestion") continue;
      if (dismissed.has(p.id) || applied.has(p.id)) continue;
      if (sessionCache.has(p.id)) continue;
      sessionCache.set(p.id, {
        id: p.id,
        kind: p.suggestionKind,
        title: p.title,
        summary: p.summary,
        targetPath: p.targetPath,
        impact: (p.priority as "low" | "medium" | "high") || "low",
        payload: p.suggestionPayload,
      });
    }
  }

  /** @type {MergedActionItem[]} */
  const newItems: MergedActionItem[] = [];

  for (const p of pending) {
    newItems.push({
      id: p.id,
      source: "pending_write",
      priority: "high",
      title: pendingTitle,
      summary: p.relativePath,
      targetPath: p.relativePath,
      writeContent: p.content,
      toolName: p.toolName,
      createdAt: nowIso,
    });
  }

  const seen = new Set(newItems.map((i) => i.id));

  const pushSeed = (s: SessionSuggestionSeed) => {
    if (!s?.id || dismissed.has(s.id) || applied.has(s.id) || seen.has(s.id)) return;
    seen.add(s.id);
    newItems.push({
      id: s.id,
      source: "suggestion",
      priority: impactToPriority(s.impact),
      title: s.title,
      summary: s.summary,
      targetPath: s.targetPath,
      suggestionKind: s.kind,
      suggestionPayload: s.payload,
      createdAt: nowIso,
    });
  };

  // Prefer kernel order first, then full session cache, then ops
  for (const s of kernelSuggestions) pushSeed(s);
  for (const s of sessionCache.values()) pushSeed(s);
  for (const s of opCache.values()) pushSeed(s);

  newItems.sort((a, b) => {
    const pMap = { high: 3, medium: 2, low: 1 };
    const pDiff = pMap[b.priority] - pMap[a.priority];
    if (pDiff !== 0) return pDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return newItems.slice(0, limit);
}
