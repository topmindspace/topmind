import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTaskContract, createTaskExecutionGuard, taskAllowsTool, documentTaskOutcome } from '../lib/agent-task-contract.mjs';

test('revise without an article asks for a target instead of guessing from references', () => {
  const task = resolveTaskContract({ userText: '调用技能 revise', referencePaths: ['reference.md'] });
  assert.equal(task.blockReason, 'needs-target');
  assert.equal(createTaskExecutionGuard(task).beforeModel(), false);
});
test('a clarification binds the original task, while an unrelated new request starts fresh', () => {
  const priorTask = resolveTaskContract({ userText: '调用 revise' });
  const reply = resolveTaskContract({ userText: '就是这篇', focusPath: 'A.md', priorTask });
  assert.equal(reply.targetPath, 'A.md'); assert.equal(reply.skillId, 'topmind-revise'); assert.equal(reply.blockReason, null);
  assert.equal(resolveTaskContract({ userText: '文章/完整路径.md', priorTask }).targetPath, '文章/完整路径.md');
  const newTask = resolveTaskContract({ userText: '看看最近的待办', priorTask });
  assert.equal(newTask.kind, 'workspace'); assert.equal(newTask.skillId, null);
});
test('explicitly pasted draft is an inline target and never authorizes disk writes', () => {
  const task = resolveTaskContract({ userText: '请 revise 原文：' + '这是一段用户直接提供的原文。'.repeat(8) });
  assert.equal(task.targetKind, 'inline'); assert.equal(task.blockReason, null);
  assert.equal(taskAllowsTool(task, 'save_file'), false);
});
test('core skill pinning keeps workspace scope, and write completion requires real receipts', () => {
  assert.equal(resolveTaskContract({ userText: '整理工作区', skillId: 'topmind-organize' }).kind, 'workspace');
  const task = resolveTaskContract({ userText: 'revise', focusPath: 'A.md' });
  const guard = createTaskExecutionGuard(task);
  assert.equal(documentTaskOutcome(task, guard, { text: '修改完成 [DONE]' }).status, 'incomplete');
  guard.afterTool('edit_file', { relativePath: 'A.md' }, { ok: true });
  assert.equal(documentTaskOutcome(task, guard, { text: '已修改 A.md' }).status, 'done');
});
test('explicit target wins over ambient focus; references remain read-only', () => {
  const task = resolveTaskContract({ userText: 'revise `A.md`', focusPath: 'B.md', referencePaths: ['R.md'] });
  assert.equal(task.targetPath, 'A.md');
  const guard = createTaskExecutionGuard(task);
  assert.equal(guard.beforeTool('read_file', { relativePath: 'R.md' }).ok, true);
  assert.equal(guard.beforeTool('edit_file', { relativePath: 'R.md' }).ok, false);
  assert.equal(guard.reason, 'scope-mismatch');
});
test('target-bound tasks exclude global discovery and unsolicited web search', () => {
  const task = resolveTaskContract({ userText: 'revise', focusPath: '稿子.md' });
  assert.equal(taskAllowsTool(task, 'web_search'), false);
  assert.equal(taskAllowsTool(task, 'list_files'), false);
  const guard = createTaskExecutionGuard(task);
  assert.equal(guard.beforeTool('read_file', {}).args.relativePath, '稿子.md');
  assert.equal(guard.beforeTool('search', { query: '原句' }).args.scope, '稿子.md');
  assert.equal(guard.beforeTool('load_skill_resource', { path: 'references/fact-check.md' }).ok, true);
});
test('review-only refuses writes, including alternate write tools', () => {
  for (const name of ['edit_file', 'save_file', 'save_note', 'append_stream_entry']) {
    const task = resolveTaskContract({ userText: 'revise', intent: { targetPath: 'a.md', output: 'review' } });
    assert.equal(createTaskExecutionGuard(task).beforeTool(name, { relativePath: 'a.md' }).error, 'review-only');
  }
});
test('vision does not imply image generation; prompt and HTML alternatives are explicit', () => {
  assert.equal(resolveTaskContract({ userText: '为当前文章生成封面', focusPath: 'a.md', capabilities: { vision: true } }).blockReason, 'image-generation-unavailable');
  assert.equal(resolveTaskContract({ userText: '按 topmind-cover，只准备封面提示词和构图方案，不生成图片。', focusPath: 'a.md' }).blockReason, null);
  assert.equal(resolveTaskContract({ userText: '按 topmind-poster，只提供 HTML 排版方案，不生成 PNG。', focusPath: 'a.md' }).blockReason, null);
});
test('successful identical reads stop after three outcomes; changed evidence is progress', () => {
  const task = resolveTaskContract({ userText: 'revise', focusPath: 'a.md' });
  const guard = createTaskExecutionGuard(task);
  for (let i = 0; i < 3; i++) {
    assert.equal(guard.beforeTool('read_file', { relativePath: 'a.md' }).ok, true);
    guard.afterTool('read_file', { relativePath: 'a.md' }, { ok: true, content: 'unchanged' });
  }
  assert.equal(guard.reason, 'repeated-result');
  assert.equal(guard.beforeModel(), false);
  const progressing = createTaskExecutionGuard(task);
  for (let i = 0; i < 4; i++) progressing.afterTool('read_file', {}, { ok: true, content: String(i) });
  assert.equal(progressing.reason, null);
});
test('total budget spans retries and runtimes; a stop rejects every later tool and model call', () => {
  const guard = createTaskExecutionGuard(resolveTaskContract({ userText: 'organize files' }), { maxCalls: 2 });
  assert.equal(guard.beforeTool('list_files', {}).ok, true);
  assert.equal(guard.beforeTool('search', {}).ok, true);
  assert.equal(guard.beforeTool('save_file', {}).ok, false);
  assert.equal(guard.calls, 2);
  assert.equal(guard.beforeModel(), false);
});
test('failures and elapsed time are terminal independently of model completion markers', () => {
  const task = resolveTaskContract({ userText: 'organize files' });
  const guard = createTaskExecutionGuard(task);
  for (let i = 0; i < 3; i++) guard.afterTool('read_file', { path: String(i) }, { ok: false, error: 'missing' });
  assert.equal(guard.reason, 'tool-failures');
  let time = 0;
  const timed = createTaskExecutionGuard(task, { now: () => time, timeoutMs: 100 });
  time = 100;
  assert.equal(timed.beforeModel(), false);
  assert.equal(timed.reason, 'time-budget');
});
test('explicit research still has a shared finite search budget', () => {
  const guard = createTaskExecutionGuard(resolveTaskContract({ userText: 'research the latest material' }));
  for (let i = 0; i < 3; i++) assert.equal(guard.beforeTool('web_search', { query: String(i) }).ok, true);
  assert.equal(guard.beforeTool('web_search', { query: 'another query' }).error, 'research-limit');
});
test('clarification references never become edit targets and refused web permission stays refused', () => {
  const priorTask = { ...resolveTaskContract({ userText: 'revise', focusPath: 'A.md' }), blockReason: 'needs-clarification', question: '是否联网核查？或者提供一个参考文件。' };
  const reference = resolveTaskContract({ userText: 'B.md', focusPath: 'C.md', priorTask });
  assert.equal(reference.targetPath, 'A.md'); assert.ok(reference.referencePaths.includes('B.md'));
  assert.equal(resolveTaskContract({ userText: '不用联网，只改措辞', priorTask }).allowWeb, false);
  assert.equal(resolveTaskContract({ userText: '可以', priorTask }).allowWeb, true);
  assert.equal(resolveTaskContract({ userText: '无需联网，事实核查只看原文', focusPath: 'A.md' }).allowWeb, false);
});
test('source content cannot grant web or image capabilities and duplicate writes are blocked before execution', () => {
  const task = resolveTaskContract({ userText: 'revise 原文：' + '文中介绍联网研究和生成图片，不是用户的执行要求。'.repeat(5) });
  assert.equal(task.allowWeb, false); assert.equal(task.blockReason, null);
  const bound = resolveTaskContract({ userText: 'revise', focusPath: 'A.md' });
  const guard = createTaskExecutionGuard(bound);
  const checked = guard.beforeTool('append_stream_entry', { content: 'one addition' });
  guard.afterTool('append_stream_entry', checked.args, { ok: true });
  assert.equal(guard.beforeTool('append_stream_entry', { content: 'one addition' }).error, 'duplicate-write');
  const review = resolveTaskContract({ userText: 'revise', intent: { targetPath: 'A.md', output: 'review' } });
  assert.deepEqual(documentTaskOutcome(review, createTaskExecutionGuard(review), { text: 'suggestions' }).pathReceipts, []);
});
