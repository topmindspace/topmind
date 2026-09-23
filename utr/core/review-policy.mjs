/**
 * Review / risk **metadata** for contract commands (preview labels only).
 *
 * Authorization is **not** here. Graded confirm lives in Kernel
 * `evaluateWritePermission` + `tool-executor` (content writes land; lifecycle
 * under confirm returns needsConfirm+planned; `confirmed: true` accepts).
 * This module only shapes what `previewTool` shows the operator.
 *
 * Contract fields: `review_policy` (auto | preview_or_auto | confirm) and
 * `risk_level`. They describe intent/risk for humans and tool listings —
 * they do not create a second review-session gate.
 */

import { t } from "./i18n-strings.mjs";

const POLICY_LABELS = {
  auto: "review.auto",
  preview_or_auto: "review.preview_or_auto",
  confirm: "review.confirm",
};

/**
 * Resolve review/risk metadata for a command from its contract definition.
 * Preview/label shape only — authorization is Kernel graded confirm.
 *
 * @param {object} command - Command definition from contract
 * @returns {{
 *   policyId: string,
 *   policyLabel: string,
 *   riskLevel: string,
 *   idempotent: boolean,
 *   destructive: boolean,
 * }}
 */
export function resolveReviewPolicy(command) {
  const riskLevel = command.risk_level || "medium";
  const reviewPolicy = command.review_policy || "preview_or_auto";

  return {
    policyId: reviewPolicy,
    policyLabel: POLICY_LABELS[reviewPolicy] ? t(POLICY_LABELS[reviewPolicy]) : reviewPolicy,
    riskLevel,
    idempotent: command.idempotent !== false,
    destructive: command.destructive === true,
  };
}
