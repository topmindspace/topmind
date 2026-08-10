/**
 * Shared note frontmatter helpers — status columns, due/priority, display titles.
 * Single source for Kanban, FrontmatterBar, Home "today", list labels.
 *
 * Uses the i18n instance directly so non-React modules get locale-aware labels.
 *
 * IMPORTANT: `value` fields are canonical frontmatter data values (always Chinese
 * because they are written to user files). `label` fields are UI display labels
 * resolved via i18n. `match` arrays accept both languages for backward compat.
 */
import i18n from "../locales/index";

/**
 * Prefer frontmatter title over filename; strip .md and light site-suffix noise.
 * Generic names (topic / README / index) fall back to parent folder so tabs
 * don't show three identical "topic" chips.
 */
export function displayNoteTitle(
  nameOrPath: string,
  title?: string | null,
): string {
  const path = String(nameOrPath || "").replace(/\\/g, "/");
  const parts = path.split("/").filter(Boolean);
  const file = parts[parts.length - 1] || "";
  const base = file.replace(/\.md$/iu, "") || "";
  let t = (title && String(title).trim()) || base;
  if (!t) return i18n.t("common:noteMeta.untitled");

  // Generic index names → parent directory (topic name)
  if (!title?.trim() && /^(topic|project|readme|index|overview|home)$/iu.test(base) && parts.length >= 2) {
    const parent = parts[parts.length - 2] || "";
    // Strip YYYY- prefix noise lightly for display
    t = parent.replace(/^\d{4}-/u, "") || parent || t;
  }

  // Light brand-suffix strip (aligned with capture cleanCaptureTitle)
  const sepRe = /\s*[|»›·•]\s*|\s+[-–—]\s+/u;
  if (sepRe.test(t)) {
    const segs = t.split(sepRe).map((p) => p.trim()).filter(Boolean);
    if (segs.length >= 2) {
      const left = segs[0];
      const right = segs[segs.length - 1];
      if (left.length >= 8 && right.length <= 36 && left.length >= right.length) {
        t = left;
      }
    }
  }
  return t;
}

/** True when list should show filename as secondary under a different title. */
export function noteTitleDiffersFromFile(name: string, title?: string | null): boolean {
  if (!title?.trim()) return false;
  const base = String(name || "").replace(/\.md$/iu, "").trim().toLowerCase();
  const t = displayNoteTitle(name, title).trim().toLowerCase();
  return Boolean(base && t && base !== t);
}

export type StatusColumnKey = "draft" | "in-progress" | "done" | "archived";

export interface StatusColumn {
  key: StatusColumnKey;
  label: string;
  /** Canonical value written to frontmatter.status (always Chinese — data, not UI) */
  value: string;
  match: string[];
}

export function getStatusColumns(): StatusColumn[] {
  return [
    {
      key: "draft",
      label: i18n.t("editor:frontmatterBar.statusDraft"),
      value: "草稿",
      match: ["草稿", "todo", "draft"],
    },
    {
      key: "in-progress",
      label: i18n.t("editor:frontmatterBar.statusInProgress"),
      value: "进行中",
      match: ["进行中", "in-progress", "in_progress", "reading", "doing"],
    },
    {
      key: "done",
      label: i18n.t("editor:frontmatterBar.statusDone"),
      value: "已完成",
      match: ["已完成", "done", "已确认知识", "可交付输出", "complete"],
    },
    {
      key: "archived",
      label: i18n.t("editor:frontmatterBar.statusArchived"),
      value: "已归档",
      match: ["已归档", "archived", "archive"],
    },
  ];
}

export function getPriorityOptions() {
  return [
    { value: "", label: i18n.t("common:noteMeta.priorityNone") },
    { value: "high", label: i18n.t("editor:frontmatterBar.priorityHigh") },
    { value: "med", label: i18n.t("editor:frontmatterBar.priorityMedium") },
    { value: "low", label: i18n.t("editor:frontmatterBar.priorityLow") },
  ] as const;
}

export function resolveStatusColumn(status: string | null | undefined): StatusColumnKey {
  if (!status) return "draft";
  const lower = String(status).toLowerCase().trim();
  for (const col of getStatusColumns()) {
    if (col.match.some((m) => m.toLowerCase() === lower)) return col.key;
  }
  return "draft";
}

export function statusValueForColumn(key: StatusColumnKey): string {
  return getStatusColumns().find((c) => c.key === key)?.value ?? "草稿";
}

export function isInProgressStatus(status: string | null | undefined): boolean {
  return resolveStatusColumn(status) === "in-progress";
}

export type DueBucket = "overdue" | "today" | "week" | "later" | "none";

/** Parse frontmatter due/deadline to local Date at start of day, or null. */
export function parseDueDate(due: string | null | undefined): Date | null {
  if (!due) return null;
  const m = String(due).trim().match(/^(\d{4})-(\d{2})-(\d{2})/u);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfLocalDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function dueBucket(due: string | null | undefined, now = new Date()): DueBucket {
  const d = parseDueDate(due);
  if (!d) return "none";
  const today = startOfLocalDay(now).getTime();
  const t = d.getTime();
  if (t < today) return "overdue";
  if (t === today) return "today";
  const weekEnd = today + 7 * 24 * 60 * 60 * 1000;
  if (t <= weekEnd) return "week";
  return "later";
}

export function dueBucketLabel(bucket: DueBucket): string {
  switch (bucket) {
    case "overdue": return i18n.t("common:noteMeta.dueOverdue");
    case "today": return i18n.t("common:noteMeta.dueToday");
    case "week": return i18n.t("common:noteMeta.dueWeek");
    case "later": return i18n.t("common:noteMeta.dueLater");
    default: return i18n.t("common:noteMeta.dueNone");
  }
}

/** Sort notes with due dates: overdue → today → week → later; no-due last. */
export function sortByDueThenMtime<T extends { due?: string | null; mtime?: string }>(notes: T[]): T[] {
  const rank: Record<DueBucket, number> = { overdue: 0, today: 1, week: 2, later: 3, none: 4 };
  return [...notes].sort((a, b) => {
    const ba = dueBucket(a.due);
    const bb = dueBucket(b.due);
    if (rank[ba] !== rank[bb]) return rank[ba] - rank[bb];
    const da = parseDueDate(a.due)?.getTime() ?? 0;
    const db = parseDueDate(b.due)?.getTime() ?? 0;
    if (da !== db) return da - db;
    return String(b.mtime || "").localeCompare(String(a.mtime || ""));
  });
}

/** Extract workspace-relative .md paths from free text (AI tool receipts). */
/**
 * Extract workspace-relative .md paths from free text / tool summaries.
 * Also accepts bare "20-研究/topic/note.md" without leading whitespace.
 */
export function extractWorkspacePaths(text: string): string[] {
  if (!text) return [];
  const re =
    /(?:^|[\s"'`(·:|])((?:(?:\d{2})[ -][^/\s"'`)|]+\/)+[^\s"'`):|]+\.md)/gu;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const p = m[1].replace(/\\/gu, "/").replace(/[,;.]+$/u, "");
    if (p.length < 160 && p.includes("/")) found.add(p);
  }
  return [...found];
}

/**
 * Collect navigable paths from a tool result object + summary text.
 */
export function pathsFromToolResult(output: unknown, summary?: string): string[] {
  const found = new Set<string>(extractWorkspacePaths(summary || ""));
  if (output && typeof output === "object") {
    const o = output as Record<string, unknown>;
    for (const k of ["targetPath", "path", "relativePath", "newPath", "topicId"]) {
      const v = o[k];
      if (typeof v === "string" && v.includes("/") && v.length < 160) {
        // topicId may lack .md — still useful for navigation if it looks like category/topic
        if (v.endsWith(".md") || /^\d{2}[ -]/.test(v)) found.add(v.replace(/\\/gu, "/"));
      }
    }
    if (Array.isArray(o.affectedFiles)) {
      for (const item of o.affectedFiles) {
        if (typeof item === "string" && item.includes("/") && !item.startsWith("99")) {
          found.add(item.replace(/\\/gu, "/"));
        }
      }
    }
    if (Array.isArray(o.results)) {
      for (const row of o.results) {
        if (row && typeof row === "object") {
          const rp = (row as { relativePath?: string }).relativePath;
          if (typeof rp === "string" && rp.includes("/")) found.add(rp.replace(/\\/gu, "/"));
        }
      }
    }
    if (Array.isArray(o.targetPaths)) {
      for (const item of o.targetPaths) {
        if (typeof item === "string" && item.includes("/")) found.add(item.replace(/\\/gu, "/"));
      }
    }
  }
  return [...found].slice(0, 12);
}
