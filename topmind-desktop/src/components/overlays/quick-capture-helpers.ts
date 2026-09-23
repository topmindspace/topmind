/**
 * Pure helpers for QuickCapture (no React).
 * Keep URL title cleaning + attachment path utils testable and out of the UI file.
 */

export type CaptureAttachment = {
  id: string;
  absolutePath: string;
  name: string;
  size?: number;
};

export type CaptureMode = "auto" | "note" | "docs";

export type FetchMeta = {
  method?: string;
  wordCount?: number;
  truncated?: boolean;
  maxLen?: number;
  likelySpa?: boolean;
  warning?: string;
  canEnhance?: boolean;
  enhanced?: boolean;
};

export const FETCH_DEFAULT = 40_000;
export const FETCH_FULL = 200_000;

/** Staged URL-fetch progress labels (reads → extract → markdown). */
export const FETCH_STEP_KEYS = [
  { id: 1, key: "overlays:capture.fetchStep1" as const },
  { id: 2, key: "overlays:capture.fetchStep2" as const },
  { id: 3, key: "overlays:capture.fetchStep3" as const },
];

/** Split a topicId ("10 分类/2024-主题") into its category + topic parts. */
export function splitTopicId(topicId: string): { category: string; topic: string } {
  const slash = topicId.indexOf("/");
  if (slash < 0) return { category: "", topic: topicId };
  return { category: topicId.slice(0, slash), topic: topicId.slice(slash + 1) };
}

/** Returns an i18n key for the fetch method label. Caller translates via t(). */
export function methodLabelKey(method?: string): string {
  if (method === "readability") return "overlays:capture.methodReadability";
  if (method === "render") return "overlays:capture.methodRender";
  return "overlays:capture.methodHeuristic";
}

export function cleanCaptureTitle(raw: string, siteName?: string): string {
  let t = String(raw || "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!t) return "";
  const sn = siteName?.trim() || "";
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

export function deriveTitleFromContent(content: string): string | undefined {
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith(">")) continue;
    if (/^https?:\/\/\S+$/iu.test(line)) continue;
    if (/^---+$/u.test(line)) continue;
    const t = cleanCaptureTitle(line.replace(/^#+\s+/u, ""));
    if (t.length >= 2) return t.slice(0, 120);
  }
  return undefined;
}

export function isCaptureSurface(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get("surface") === "capture") return true;
    const hash = String(window.location.hash || "").replace(/^#/u, "");
    return hash === "surface=capture" || hash.includes("surface=capture");
  } catch {
    return false;
  }
}

export function attachId(): string {
  return `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function pathToAttachment(absolutePath: string): CaptureAttachment {
  const name = absolutePath.split(/[/\\]/u).pop() || absolutePath;
  return { id: attachId(), absolutePath, name };
}

