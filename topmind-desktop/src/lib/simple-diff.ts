import i18n from "../locales";

/**
 * Lightweight line-oriented diff for inline AI preview (no external dep).
 * Marks lines as same / removed (original only) / added (preview only).
 */
export type DiffLine = {
  kind: "same" | "removed" | "added";
  text: string;
};

export function lineDiff(original: string, next: string, maxLines = 200): DiffLine[] {
  const a = String(original || "").split("\n");
  const b = String(next || "").split("\n");
  // LCS DP (bounded for UI)
  const n = Math.min(a.length, maxLines);
  const m = Math.min(b.length, maxLines);
  const aa = a.slice(0, n);
  const bb = b.slice(0, m);
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        aa[i] === bb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aa[i] === bb[j]) {
      out.push({ kind: "same", text: aa[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "removed", text: aa[i] });
      i++;
    } else {
      out.push({ kind: "added", text: bb[j] });
      j++;
    }
  }
  while (i < n) {
    out.push({ kind: "removed", text: aa[i++] });
  }
  while (j < m) {
    out.push({ kind: "added", text: bb[j++] });
  }
  if (a.length > n || b.length > m) {
    out.push({ kind: "same", text: i18n.t("editor:diff.truncated") });
  }
  return out;
}
