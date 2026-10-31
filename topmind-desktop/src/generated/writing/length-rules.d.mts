export type LengthTarget = { platform: string; format: string; entrypoint: string; account_capability: string };
export type LengthRule = {
  id: string;
  category: 'platform_limit' | 'creator_preference';
  status: string;
  applies_to: LengthTarget;
  check: { field: 'title' | 'body'; operation: 'max_characters'; counter: 'unicode_code_points'; max: number };
  outcome: { exceeded: 'block' | 'warn' };
  evidence: { tier: string; url?: string; checked_at?: string; review_after?: string; confirmed_at?: string };
};
export interface LengthRuleResult {
  schemaVersion: 1;
  capabilityId: 'platform.validate.length';
  provider: Readonly<{ id: string; version: string }>;
  status: 'ok' | 'warning' | 'error';
  verdict: 'pass' | 'review' | 'block' | 'invalid';
  input: { fingerprint: string | null; rulesDigest?: string; documentDigest?: string; target?: LengthTarget; asOf?: string };
  artifacts: [];
  checks: Array<{ ruleId: string; category: string; field: 'title' | 'body'; observed: number; max: number; unit: 'unicode_code_points'; exceeded: boolean }>;
  effectiveLimits: Array<{ field: 'title' | 'body'; unit: 'unicode_code_points'; hardMax: number | null; preferenceMax: number | null; effectiveMax: number }>;
  diagnostics: Array<{ code: string; severity: 'warning' | 'error'; message: string; ruleId?: string; dimension?: string; location?: { field: string }; observed?: number; max?: number; unit?: string; hardMax?: number; preferenceMax?: number }>;
}
export const LENGTH_RULE_PROVIDER: Readonly<{ id: string; version: string }>;
export function evaluateLengthRules(input: { target: LengthTarget; document: { text_kind: 'platform_text'; title?: string; body?: string }; rules: LengthRule[]; asOf?: string }): Promise<LengthRuleResult>;
