/**
 * Shared AI polish for stream composer + QuickCapture.
 * Drives the real Desktop `ai.complete` polish entry (`action: "polish"`).
 * Optional `documentText` supplies whole-file / surrounding format context so
 * polish matches structure (not selection/snippet isolation).
 */

export type PolishCompleteFn = (args: {
  text: string;
  action: "polish";
  mode: "rewrite";
  requestId: string;
  documentText?: string;
}) => Promise<{ text?: string | null }>;

/**
 * Polish free-form composer text. Returns polished string or null if empty/no text.
 * Caller owns empty/AI-not-ready UX; this only invokes the complete path.
 */
export async function polishComposerText(
  complete: PolishCompleteFn,
  rawText: string,
  requestIdPrefix = "ai-polish",
  options?: { documentText?: string },
): Promise<string | null> {
  const text = String(rawText || "").trim();
  if (!text) return null;
  const documentText =
    typeof options?.documentText === "string" && options.documentText.trim()
      ? options.documentText.trim().slice(0, 28_000)
      : undefined;
  const res = await complete({
    text,
    action: "polish",
    mode: "rewrite",
    requestId: `${requestIdPrefix}-${Date.now()}`,
    ...(documentText ? { documentText } : {}),
  });
  const polished = String(res?.text || "").trim();
  return polished || null;
}
