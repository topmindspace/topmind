import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveContextWindow, resolveContextBudget, estimateTokens, clipContext, compactPromptBlocks, articleHistory, fitSdkContext, boundToolResult } from '../lib/agent-context-policy.mjs';

test('a configured ceiling cannot invent model capacity and invalid values use automatic', () => {
  assert.equal(resolveContextWindow(8192, 131072), 8192);
  assert.equal(resolveContextWindow(131072, 16384), 16384);
  assert.equal(resolveContextWindow(8192, -1), 8192);
  assert.equal(resolveContextWindow(undefined), 32768);
});
test('small windows account for fixed prompt and response without a large character floor', () => {
  for (const window of [4096, 8192, 16384, 128000]) {
    const budget = resolveContextBudget(window, { fixedTokens: 1200 });
    assert.ok(budget.maxTokens + budget.responseTokens + 1200 <= window);
    if (window <= 8192) assert.ok(budget.maxChars < 16000);
  }
  assert.equal(resolveContextBudget(4096, { fixedTokens: 5000 }).maxTokens, 0);
});
test('CJK windows and per-step tool growth have a real token ceiling', () => {
  assert.ok(estimateTokens(clipContext('中文稿件。'.repeat(10000), 500)) <= 500);
  const request = 'Current request: edit A.md only';
  const fitted = compactPromptBlocks([request, 'Old result ' + '中文'.repeat(10000), 'Latest result ' + '证据'.repeat(10000)], 1000);
  assert.equal(fitted.overflow, false);
  assert.equal(fitted.blocks[0], request);
  assert.match(fitted.blocks.at(-1), /Latest result/);
  assert.ok(estimateTokens(fitted.blocks.join('\n\n')) <= 1000);
  assert.equal(compactPromptBlocks(['中文'.repeat(1000)], 200).overflow, true);
});
test('only recent exchanges bound to the same article enter its writing context', () => {
  const history = articleHistory([
    {role:'user', content:'A requirement', focusPath:'A.md'}, {role:'assistant',content:'A response'},
    {role:'user',content:'B private request',focus:{path:'B.md'}}, {role:'assistant',content:'B private response'},
    {role:'user',content:'A refinement',focus:{path:'A.md'}}, {role:'assistant',content:'A updated'},
  ], 'A.md');
  assert.equal(history.length, 4);
  assert.doesNotMatch(JSON.stringify(history), /B private/);
});
test('SDK compaction retains matched newest tool ids and never truncates current requirements', () => {
  const cycle = (id, body) => [{role:'assistant',content:[{type:'tool-call',toolCallId:id,toolName:'read_file',input:{relativePath:'A.md'}}]}, {role:'tool',content:[{type:'tool-result',toolCallId:id,toolName:'read_file',output:{type:'text',value:body}}]}];
  const fitted = fitSdkContext([{role:'user',content:'Edit A, preserve all facts'}, ...cycle('old', 'x'.repeat(16000)), ...cycle('latest', 'latest source')], 1000);
  assert.equal(fitted.overflow, false);
  assert.equal(fitted.compacted, true);
  assert.match(fitted.messages[0].content, /Edit A, preserve all facts/);
  assert.doesNotMatch(JSON.stringify(fitted.messages), /"old"/);
  assert.equal(fitted.messages.at(-1).content[0].toolCallId, 'latest');
  assert.equal(fitSdkContext([{role:'user',content:'中'.repeat(1000)}], 100).overflow, true);
});
test('oversized model-facing results preserve status and hashes without altering host evidence', () => {
  const original = {ok:true,relativePath:'A.md',contentHash:'version-a',content:'中文'.repeat(10000)};
  const bound = boundToolResult(original, 600);
  assert.equal(bound.truncated, true); assert.equal(bound.contentHash, 'version-a');
  assert.equal(original.content.length, 20000);
  assert.ok(estimateTokens(JSON.stringify(bound)) < 650);
});
