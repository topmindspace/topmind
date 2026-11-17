import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreCase } from '../scripts/skill-benchmark.mjs';

test('skill benchmark permits whitespace changes while enforcing original text and links', () => {
  const fixture = { replyWithoutSpace: '✅原文 https://example.test/link。', replyIncludes: ['https://example.test/link'] };
  assert.equal(scoreCase(fixture, { reply: '✅原文\n\nhttps://example.test/link。', actions: [] }).passed, true);
  assert.equal(scoreCase(fixture, { reply: '```text\n✅原文\n\nhttps://example.test/link。\n```', actions: [] }).passed, true);
  assert.equal(scoreCase(fixture, { reply: '仅调整了空白。\n```text\n✅原文 https://example.test/link。\n```', actions: [] }).passed, true);
  assert.equal(scoreCase(fixture, { reply: '```text\n✅原文 https://example.test/link。\n```\n\n```text\n另一个版本。\n```', actions: [] }).passed, false);
  assert.equal(scoreCase(fixture, { reply: '✅改写\n\nhttps://example.test/link。', actions: [] }).passed, false);
  assert.equal(scoreCase(fixture, { reply: '✅原文\n\nhttps://example.test/\nlink。', actions: [] }).passed, false);
  assert.equal(scoreCase({ replyLines: 2 }, { reply: '```text\n第一行\n第二行\n```', actions: [] }).passed, true);
});

test('skill benchmark fails any extra mutation even with a correct deliverable', () => {
  const target = { type: 'write', path: 'out.md', text: '保留原文' };
  const fixture = { actions: [['write', 'out.md']], artifactIncludes: ['保留原文'] };
  assert.equal(scoreCase(fixture, { reply: '', actions: [target] }).passed, true);
  const overreach = scoreCase(fixture, { reply: '', actions: [target, { type: 'append', path: 'memory/profile.md', text: '无需保存' }] });
  assert.equal(overreach.passed, false);
  assert.deepEqual(overreach.unexpectedActions, [['append', 'memory/profile.md']]);
  assert.equal(scoreCase(fixture, { reply: '', actions: [target, target] }).passed, false);
});

test('skill benchmark checks move destinations and source order per deliverable', () => {
  const move = { type: 'move', path: 'in/a.md', text: 'topic/b.md' };
  const fixture = { actions: [['move', 'in/a.md']], artifactEquals: { 'in/a.md': 'topic/a.md' } };
  assert.equal(scoreCase(fixture, { reply: '', actions: [move] }).passed, false);
  const write = { type: 'write', path: 'out.html', text: '<h1>标题</h1><p>周二</p><p>周一</p>' };
  assert.equal(scoreCase({ actions: [['write', 'out.html']], artifactInOrder: ['标题', '周一', '周二'] }, { reply: '', actions: [write] }).passed, false);
});

test('skill benchmark rejects a false publication claim without a publish action', () => {
  assert.equal(scoreCase({}, { reply: '已发布到 X。', actions: [] }).passed, false);
  assert.equal(scoreCase({}, { reply: '本次未发布。', actions: [] }).passed, true);
  assert.equal(scoreCase({}, null).passed, false);
});
