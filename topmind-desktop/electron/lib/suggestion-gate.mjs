/**
 * Pure high-impact suggestion confirm gate (no Electron / Kernel).
 * WorkspaceService.applySuggestion calls this before durable writes.
 */

/**
 * @param {{ impact?: string } | null | undefined} suggestion
 * @param {unknown} confirmed
 * @returns {{ ok: false, needsConfirm: true, pending: true, suggestion: object, note: string } | null}
 *   null means "not blocked — proceed to apply"
 */
export function blockUnconfirmedHighImpact(suggestion, confirmed) {
  if (!suggestion) {
    throw new Error("suggestion required");
  }
  if (confirmed !== true && suggestion.impact === "high") {
    return {
      ok: false,
      needsConfirm: true,
      pending: true,
      suggestion,
      note: "high-impact suggestion requires confirmed:true",
    };
  }
  return null;
}
