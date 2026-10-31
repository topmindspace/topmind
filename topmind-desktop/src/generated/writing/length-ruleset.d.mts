import type { LengthRule, LengthRuleResult, LengthTarget } from './length-rules.mjs';

export type LengthRuleSet = { schemaVersion: 1; id: string; version: string; rules: LengthRule[] };
export type LengthRuleSetResult = Omit<LengthRuleResult, 'capabilityId' | 'input'> & {
  capabilityId: 'platform.validate.length-ruleset';
  input: LengthRuleResult['input'] & { ruleSet?: { id: string; version: string }; creationSnapshotFingerprint?: string };
};
export class LengthRuleSetError extends Error { code: string; }
export const LENGTH_RULESET_PROVIDER: Readonly<{ id: string; version: string }>;
export function parseLengthRuleSet(jsonText: string): LengthRuleSet;
export function evaluateLengthRuleSet(input: { ruleSetJson: string; target: LengthTarget;
  document: { text_kind: 'platform_text'; title?: string; body?: string }; asOf: string;
  creationSnapshotFingerprint?: string }): Promise<LengthRuleSetResult>;
