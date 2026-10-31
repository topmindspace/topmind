/** Portable JSON rule-set loader and deterministic length report. No platform rules ship here. */
import { sha256 } from './content-sha256.mjs';
import { evaluateLengthRules } from './length-rules.mjs';

export const LENGTH_RULESET_PROVIDER = Object.freeze({ id: 'topmind-writing-skills/length-ruleset', version: '1.1.0' });
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_RULES = 1000;
const SCOPE = ['platform', 'format', 'entrypoint', 'account_capability'];
const FORBIDDEN_KEY = /(?:token|secret|password|credential|authorization|cookie|api[_-]?key)/iu;

export class LengthRuleSetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LengthRuleSetError';
    this.code = code;
  }
}

function fail(code, message) { throw new LengthRuleSetError(code, message); }
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function safeJson(value, depth = 0, budget = { nodes: 0 }) {
  if (++budget.nodes > 100_000 || depth > 32) fail('ruleset-too-complex', 'Rule set exceeds the supported JSON complexity.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object') fail('invalid-ruleset-json', 'Rule set must contain finite JSON data.');
  for (const key of Object.keys(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key) || FORBIDDEN_KEY.test(key)) {
      fail('forbidden-ruleset-field', 'Rule set contains a forbidden field.');
    }
    safeJson(value[key], depth + 1, budget);
  }
}
function label(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/u.test(value);
}
function ruleShape(rule) {
  if (!exactKeys(rule, ['id', 'category', 'status', 'applies_to', 'check', 'outcome', 'evidence']) || !label(rule.id)) return false;
  if (!['active', 'proposed_unconfirmed'].includes(rule.status)) return false;
  if (!exactKeys(rule.applies_to, SCOPE) || SCOPE.some(key => typeof rule.applies_to[key] !== 'string'
    || !rule.applies_to[key].trim() || rule.applies_to[key] === 'unknown')) return false;
  if (!exactKeys(rule.check, ['field', 'operation', 'counter', 'max'])
    || !['title', 'body'].includes(rule.check.field) || rule.check.operation !== 'max_characters'
    || rule.check.counter !== 'unicode_code_points' || !Number.isSafeInteger(rule.check.max) || rule.check.max < 0) return false;
  if (!exactKeys(rule.outcome, ['exceeded'])) return false;
  if (rule.category === 'platform_limit') {
    if (rule.applies_to.platform === 'any' || rule.outcome.exceeded !== 'block'
      || !exactKeys(rule.evidence, ['tier', 'url', 'checked_at', 'review_after'])
      || rule.evidence.tier !== 'official_primary' || !validDate(rule.evidence.checked_at)
      || !validDate(rule.evidence.review_after) || rule.evidence.review_after < rule.evidence.checked_at) return false;
    try {
      const url = new URL(rule.evidence.url);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch { return false; }
  }
  if (rule.category !== 'creator_preference' || rule.outcome.exceeded !== 'warn') return false;
  if (rule.status === 'active') {
    return exactKeys(rule.evidence, ['tier', 'confirmed_at'])
      && rule.evidence.tier === 'user_confirmed' && validDate(rule.evidence.confirmed_at);
  }
  return exactKeys(rule.evidence, ['tier']) && rule.evidence.tier === 'user_preference_pending_confirmation';
}

/** Parse a reviewed JSON document. The caller must verify source claims before activation. */
export function parseLengthRuleSet(jsonText) {
  if (typeof jsonText !== 'string' || new TextEncoder().encode(jsonText).length > MAX_JSON_BYTES) {
    fail('invalid-ruleset-json', 'Rule set must be JSON text no larger than 1 MiB.');
  }
  let value;
  try { value = JSON.parse(jsonText); }
  catch { fail('invalid-ruleset-json', 'Rule set is not valid JSON.'); }
  safeJson(value);
  if (!exactKeys(value, ['schemaVersion', 'id', 'version', 'rules']) || value.schemaVersion !== 1
    || !label(value.id) || !label(value.version) || !Array.isArray(value.rules) || value.rules.length > MAX_RULES) {
    fail('invalid-ruleset', 'Rule set needs schemaVersion 1, id, version and a bounded rules array.');
  }
  const ids = new Set();
  for (const rule of value.rules) {
    if (!ruleShape(rule)) fail('invalid-ruleset-rule', 'Rule set contains an unsupported or incomplete length rule.');
    if (ids.has(rule.id)) fail('duplicate-ruleset-rule', 'Rule IDs must be unique within a rule set.');
    ids.add(rule.id);
  }
  return value;
}

function invalidResult(code, message) {
  return { schemaVersion: 1, capabilityId: 'platform.validate.length-ruleset', provider: LENGTH_RULESET_PROVIDER,
    status: 'error', verdict: 'invalid', input: { fingerprint: null }, artifacts: [], checks: [],
    effectiveLimits: [], diagnostics: [{ code, severity: 'error', message }] };
}

/** Evaluate one explicit target and date; the result's rulesDigest matches Kernel ruleset.rules. */
export async function evaluateLengthRuleSet({ ruleSetJson, target, document, asOf, creationSnapshotFingerprint } = {}) {
  if (!validDate(asOf)) return invalidResult('invalid-evaluation-date', 'Evaluation date must be an ISO calendar date.');
  if (creationSnapshotFingerprint !== undefined &&
      (typeof creationSnapshotFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(creationSnapshotFingerprint))) {
    return invalidResult('invalid-snapshot-fingerprint', 'Creation snapshot fingerprint must be SHA-256.');
  }
  let ruleSet;
  try { ruleSet = parseLengthRuleSet(ruleSetJson); }
  catch (error) {
    if (error instanceof LengthRuleSetError) return invalidResult(error.code, error.message);
    throw error;
  }
  const evaluated = await evaluateLengthRules({ target, document, rules: ruleSet.rules, asOf });
  const input = { ...evaluated.input, ruleSet: { id: ruleSet.id, version: ruleSet.version },
    ...(creationSnapshotFingerprint === undefined ? {} : { creationSnapshotFingerprint }) };
  if (input.fingerprint) input.fingerprint = await sha256(JSON.stringify({
    evaluationFingerprint: input.fingerprint, rulesDigest: input.rulesDigest,
    ruleSet: input.ruleSet, provider: LENGTH_RULESET_PROVIDER,
    ...(creationSnapshotFingerprint === undefined ? {} : { creationSnapshotFingerprint }),
  }));
  return { ...evaluated, capabilityId: 'platform.validate.length-ruleset', provider: LENGTH_RULESET_PROVIDER, input };
}
