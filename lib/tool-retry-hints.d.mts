/**
 * Tool retry hints — adaptive, actionable recovery guidance.
 * Returns a single next-step hint for the model, or undefined when no special case.
 */
export declare function buildRetryHint(
  toolName: string,
  message: string,
  opts?: { relativePath?: string; args?: Record<string, unknown>; locale?: string },
): string | undefined;
