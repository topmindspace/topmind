/**
 * Review policy engine.
 * All policy data comes from the contract's per-command risk_level and review_policy.
 */

import { t } from "./i18n-strings.mjs";

const POLICY_LABELS = {
  auto:                  "review.auto",
  preview_or_auto:       "review.preview_or_auto",
  confirm:               "review.confirm",
};

/**
 * Resolve review policy for a command from its contract definition.
 *
 * @param {object} command - Command definition from contract
 * @param {object} [overrides] - Per-command review overrides from contract
 * @param {string} [commandName] - Explicit command key (preferred over command.name/command.label for override lookup)
 */
export function resolveReviewPolicy(command, overrides, commandName) {
  const riskLevel = command.risk_level || "medium";
  const reviewPolicy = command.review_policy || "preview_or_auto";

  const requiresConfirmation = reviewPolicy !== "auto";
  const requiresPreview = reviewPolicy === "preview_or_auto";

  // Only apply override when the command key matches exactly — no fallback
  const lookupKey = commandName || command.name || "";
  const override = lookupKey && overrides ? overrides[lookupKey] : undefined;

  return {
    requiresConfirmation,
    requiresPreview,
    policyId: reviewPolicy,
    policyLabel: POLICY_LABELS[reviewPolicy] ? t(POLICY_LABELS[reviewPolicy]) : reviewPolicy,
    riskLevel,
    idempotent: command.idempotent !== false,
    destructive: command.destructive === true,
    ...(override?.confirmation_template ? { confirmationTemplate: override.confirmation_template } : {}),
    ...(override?.preview_strategy ? { previewStrategy: override.preview_strategy } : {}),
  };
}

/**
 * Check whether a tool call needs a review session before execution.
 * Returns null if safe to execute, or a policy object if review is needed.
 */
export function checkReviewRequired(command, commandName) {
  const policy = resolveReviewPolicy(command, null, commandName);
  if (policy.requiresConfirmation) {
    return policy;
  }
  return null;
}
