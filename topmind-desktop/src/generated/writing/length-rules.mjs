/** Narrow, deterministic Unicode code-point length evaluator. Rules are caller supplied. */
import { sha256 } from './content-sha256.mjs';

export const LENGTH_RULE_PROVIDER = Object.freeze({ id: 'topmind-writing-skills/length-rules', version: '2.1.0' });
const SCOPE_FIELDS = Object.freeze(['platform', 'format', 'entrypoint', 'account_capability']);
const CONTENT_FIELDS = new Set(['title', 'body']);
const SENSITIVE_KEY = /(?:token|secret|password|credential|authorization|cookie|api[_-]?key)/iu;
const UNSAFE_KEY = new Set(['__proto__', 'prototype', 'constructor']);

function diagnostic(code, severity, message, extras = {}) {
  return { code, severity, message, ...extras };
}
function compareId(left, right) {
  const a = String(left?.id ?? '');
  const b = String(right?.id ?? '');
  return a < b ? -1 : a > b ? 1 : 0;
}
function canonical(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || seen.has(value)) throw new TypeError('Rules must be finite JSON data');
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map(item => canonical(item, seen));
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new TypeError('Rules must be plain JSON data');
    const ordered = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      if (UNSAFE_KEY.has(key) || SENSITIVE_KEY.test(key)) throw new TypeError('Rules contain a forbidden field');
      ordered[key] = canonical(value[key], seen);
    }
    return ordered;
  } finally {
    seen.delete(value);
  }
}
function hasScope(scope) {
  return scope && typeof scope === 'object' && !Array.isArray(scope)
    && Object.keys(scope).every(key => SCOPE_FIELDS.includes(key))
    && SCOPE_FIELDS.every(key => typeof scope[key] === 'string' && scope[key].trim());
}
function scopeMatch(scope, target) {
  let unknown = null;
  for (const key of SCOPE_FIELDS) {
    if (scope[key] === 'any') continue;
    if (target[key] === 'unknown') { unknown ??= key; continue; }
    if (scope[key] !== target[key]) return { matches: false };
  }
  return unknown ? { matches: false, unknown } : { matches: true };
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function isOfficialEvidence(evidence) {
  if (evidence?.tier !== 'official_primary' || !validDate(evidence.checked_at)) return false;
  try { return new URL(evidence.url).protocol === 'https:'; }
  catch { return false; }
}
function baseResult() {
  return {
    schemaVersion: 1,
    capabilityId: 'platform.validate.length',
    provider: LENGTH_RULE_PROVIDER,
    status: 'error',
    verdict: 'invalid',
    input: { fingerprint: null },
    artifacts: [],
    checks: [],
    effectiveLimits: [],
    diagnostics: [],
  };
}

/**
 * Evaluate only max_characters + unicode_code_points. This is not X weighted length.
 * A rule must name all four scope dimensions, even when a dimension is `any`.
 */
export async function evaluateLengthRules({ target, document, rules, asOf } = {}) {
  const result = baseResult();
  if (asOf !== undefined && !validDate(asOf)) {
    result.diagnostics.push(diagnostic('invalid-evaluation-date', 'error', 'Evaluation date must be an ISO calendar date.'));
    return result;
  }
  if (!hasScope(target) || Object.values(target).some(value => value === 'any')) {
    result.diagnostics.push(diagnostic('invalid-target-scope', 'error', 'Target must name platform, format, entrypoint and account capability; use unknown when unresolved.'));
    return result;
  }
  if (!document || typeof document !== 'object' || Array.isArray(document) || !Array.isArray(rules)) {
    result.diagnostics.push(diagnostic('invalid-rule-input', 'error', 'Document must be an object and rules must be an array.'));
    return result;
  }
  if (document.text_kind !== 'platform_text') {
    result.diagnostics.push(diagnostic('invalid-content-kind', 'error', 'Length checks require prepared platform text, not raw Markdown.'));
    return result;
  }
  const sortedRules = [...rules].sort(compareId);
  try {
    const preparedDocument = { text_kind: document.text_kind,
      ...(Object.hasOwn(document, 'title') ? { title: document.title } : {}),
      ...(Object.hasOwn(document, 'body') ? { body: document.body } : {}) };
    // Keep the exact caller supplied rule array bound to the validation report.
    // The Kernel snapshot computes the same canonical digest from ruleset.rules.
    result.input.rulesDigest = await sha256(JSON.stringify(canonical(rules)));
    result.input.documentDigest = await sha256(JSON.stringify(canonical(preparedDocument)));
    result.input.fingerprint = await sha256(JSON.stringify(canonical({
      target,
      document: preparedDocument,
      rules: sortedRules,
      ...(asOf === undefined ? {} : { asOf }),
      provider: LENGTH_RULE_PROVIDER,
    })));
  } catch {
    result.input = { fingerprint: null };
    result.diagnostics.push(diagnostic('input-fingerprint-failed', 'error', 'Input snapshot could not be fingerprinted.'));
    return result;
  }
  result.input.target = {
    platform: target.platform,
    format: target.format,
    entrypoint: target.entrypoint,
    account_capability: target.account_capability,
  };
  if (asOf !== undefined) result.input.asOf = asOf;

  let invalid = false;
  let blocked = false;
  let needsReview = false;
  for (const dimension of SCOPE_FIELDS.filter(key => target[key] === 'unknown')) {
    needsReview = true;
    result.diagnostics.push(diagnostic('target-dimension-unknown', 'warning', 'Target dimension needs confirmation before validation can pass.', { dimension }));
  }
  const ids = new Set();
  for (const rule of sortedRules) {
    const ruleId = typeof rule?.id === 'string' && rule.id.trim() ? rule.id : null;
    if (!ruleId || ids.has(ruleId)) {
      invalid = true;
      result.diagnostics.push(diagnostic('invalid-rule-id', 'error', 'Rule ID must be unique and nonempty.', { ...(ruleId ? { ruleId } : {}) }));
      continue;
    }
    ids.add(ruleId);
    if (!hasScope(rule.applies_to) || SCOPE_FIELDS.some(key => rule.applies_to[key] === 'unknown')) {
      invalid = true;
      result.diagnostics.push(diagnostic('invalid-rule-scope', 'error', 'Rule must specify exactly the four supported scope dimensions.', { ruleId }));
      continue;
    }
    const match = scopeMatch(rule.applies_to, target);
    if (!match.matches && !match.unknown) continue;
    if (rule.status !== 'active') {
      needsReview = true;
      result.diagnostics.push(diagnostic('rule-inactive', 'warning', 'Rule is not active and was not applied.', { ruleId }));
      continue;
    }
    if (match.unknown) {
      needsReview = true;
      result.diagnostics.push(diagnostic('target-scope-unknown', 'warning', 'Target capability or entrypoint needs confirmation before this rule can be applied.', { ruleId, dimension: match.unknown }));
      continue;
    }
    if (!match.matches) continue;
    const check = rule.check;
    if (check?.operation !== 'max_characters' || check.counter !== 'unicode_code_points') {
      needsReview = true;
      result.diagnostics.push(diagnostic('unsupported-length-operation', 'warning', 'Length rule needs a supported operation and explicit counter.', { ruleId }));
      continue;
    }
    if (!CONTENT_FIELDS.has(check.field) || !Number.isSafeInteger(check.max) || check.max < 0) {
      invalid = true;
      result.diagnostics.push(diagnostic('invalid-length-check', 'error', 'Length check needs title or body and a nonnegative integer maximum.', { ruleId }));
      continue;
    }
    if (rule.category === 'platform_limit') {
      if (rule.applies_to.platform === 'any' || rule.outcome?.exceeded !== 'block') {
        invalid = true;
        result.diagnostics.push(diagnostic('invalid-hard-rule', 'error', 'Platform hard limit needs a concrete platform and block outcome.', { ruleId }));
        continue;
      }
      if (!isOfficialEvidence(rule.evidence)) {
        needsReview = true;
        result.diagnostics.push(diagnostic('hard-rule-evidence-unverified', 'warning', 'Official source and check date are required before treating a limit as blocking.', { ruleId }));
        continue;
      }
      if (!validDate(rule.evidence.review_after) || rule.evidence.review_after < rule.evidence.checked_at) {
        needsReview = true;
        result.diagnostics.push(diagnostic('hard-rule-review-date-invalid', 'warning', 'Hard rule review date is invalid.', { ruleId }));
        continue;
      }
      if (asOf === undefined) {
        needsReview = true;
        result.diagnostics.push(diagnostic('hard-rule-evaluation-date-required', 'warning', 'Hard rule needs an evaluation date to check its evidence.', { ruleId }));
        continue;
      }
      if (asOf < rule.evidence.checked_at) {
        needsReview = true;
        result.diagnostics.push(diagnostic('hard-rule-evidence-not-yet-checked', 'warning', 'Hard rule evidence was checked after the evaluation date.', { ruleId }));
        continue;
      }
      if (asOf > rule.evidence.review_after) {
        needsReview = true;
        result.diagnostics.push(diagnostic('hard-rule-evidence-expired', 'warning', 'Hard rule evidence needs review before use.', { ruleId }));
        continue;
      }
    } else if (rule.category === 'creator_preference') {
      if (rule.outcome?.exceeded !== 'warn' || rule.evidence?.tier !== 'user_confirmed') {
        needsReview = true;
        result.diagnostics.push(diagnostic('preference-unconfirmed', 'warning', 'Creator preference needs confirmation and a warn outcome before use.', { ruleId }));
        continue;
      }
      if (!validDate(rule.evidence.confirmed_at) || asOf === undefined || asOf < rule.evidence.confirmed_at) {
        needsReview = true;
        result.diagnostics.push(diagnostic('preference-confirmation-date-unverified', 'warning', 'Creator preference confirmation date must precede evaluation.', { ruleId }));
        continue;
      }
    } else {
      needsReview = true;
      result.diagnostics.push(diagnostic('unsupported-rule-category', 'warning', 'Rule category is outside this length evaluator.', { ruleId }));
      continue;
    }
    if (typeof document[check.field] !== 'string') {
      needsReview = true;
      result.diagnostics.push(diagnostic('content-field-missing', 'warning', 'Target content field is unavailable.', { ruleId, location: { field: check.field } }));
      continue;
    }
    const observed = Array.from(document[check.field]).length;
    const exceeded = observed > check.max;
    result.checks.push({ ruleId, category: rule.category, field: check.field, observed, max: check.max, unit: 'unicode_code_points', exceeded });
    if (exceeded) {
      const hard = rule.category === 'platform_limit';
      blocked ||= hard;
      needsReview ||= !hard;
      result.diagnostics.push(diagnostic(hard ? 'hard-length-exceeded' : 'preference-length-exceeded', hard ? 'error' : 'warning', 'Content length exceeds the applicable maximum.', { ruleId, location: { field: check.field }, observed, max: check.max, unit: 'unicode_code_points' }));
    }
  }

  for (const field of ['title', 'body']) {
    const checks = result.checks.filter(check => check.field === field);
    if (!checks.length) continue;
    const hardMax = Math.min(...checks.filter(check => check.category === 'platform_limit').map(check => check.max));
    const preferenceMax = Math.min(...checks.filter(check => check.category === 'creator_preference').map(check => check.max));
    const hard = Number.isFinite(hardMax) ? hardMax : null;
    const preference = Number.isFinite(preferenceMax) ? preferenceMax : null;
    result.effectiveLimits.push({ field, unit: 'unicode_code_points', hardMax: hard, preferenceMax: preference, effectiveMax: Math.min(hard ?? Infinity, preference ?? Infinity) });
    if (hard !== null) {
      for (const check of checks.filter(check => check.category === 'creator_preference' && check.max > hard)) {
        needsReview = true;
        result.diagnostics.push(diagnostic('preference-widens-hard-limit', 'warning', 'Creator preference is wider than an applicable hard limit and cannot relax it.', { ruleId: check.ruleId, location: { field }, hardMax: hard, preferenceMax: check.max }));
      }
    }
  }
  if (!result.checks.length) {
    needsReview = true;
    result.diagnostics.push(diagnostic('no-applicable-length-rule', 'warning', 'No applicable length rule was evaluated for this target.'));
  } else {
    for (const limit of result.effectiveLimits.filter(item => item.preferenceMax !== null && item.hardMax === null)) {
      needsReview = true;
      result.diagnostics.push(diagnostic('no-applicable-platform-limit', 'warning', 'Creator preferences alone cannot confirm a platform length limit.', { location: { field: limit.field } }));
    }
  }
  result.verdict = invalid ? 'invalid' : blocked ? 'block' : needsReview ? 'review' : 'pass';
  result.status = result.verdict === 'pass' ? 'ok' : result.verdict === 'review' ? 'warning' : 'error';
  return result;
}
