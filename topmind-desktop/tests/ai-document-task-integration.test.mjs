import test from 'node:test';
import './helpers/electron-stub-loader.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AiService } from '../electron/ai-service.mjs';
import { resolveWorkspaceStatePaths } from '../electron/lib/workspace-home.mjs';
import { listPendingWrites, acceptPendingWrite, rejectPendingWrite } from '../electron/lib/pending-writes.mjs';

async function fixture(t, respond, aiSettings = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tm-document-agent-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  const engineRoot = fileURLToPath(new URL('../../', import.meta.url));
  const workspaceStatePaths = resolveWorkspaceStatePaths(path.join(root, 'state'), workspace);
  await mkdir(path.dirname(workspaceStatePaths.settingsFilePath), { recursive: true });
  await mkdir(path.join(workspace, 'memory'), { recursive: true });
  await writeFile(path.join(workspace, 'topmind.yaml'), 'schema_version: 4\nlocale: en-US\nwriteback:\n  mode: auto\n');
  await writeFile(path.join(workspace, 'A.md'), '# Article A\n\nOriginal content.\n');
  await writeFile(path.join(workspace, 'B.md'), 'UNRELATED_ARTICLE_CANARY');
  await writeFile(path.join(workspace, 'memory/profile.md'), '# Profile\n\nUNRELATED_PROFILE_CANARY\n');
  await writeFile(workspaceStatePaths.settingsFilePath, JSON.stringify({ ui: { locale: 'en-US' }, ai: {
    sourcePreference: 'custom', defaultModel: 'task-fixture', maxAgentSteps: 80, skillsEnabled: true,
    ...aiSettings,
    manual: { customBaseUrl: 'https://task-fixture.invalid/v1', customKey: 'offline-fixture-only' },
  } }));
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(new URL(String(url)).hostname, 'task-fixture.invalid');
    requests.push(JSON.parse(init.body));
    const reply = await respond(requests.length, workspace);
    const delta = typeof reply === 'string' ? { content: reply } : { tool_calls: (Array.isArray(reply) ? reply : [reply]).map((call, index) => ({ index, id: `call_${requests.length}_${index}`, type: 'function', function: { name: call.tool, arguments: JSON.stringify(call.args || {}) } })) };
    const chunk = (data, finish_reason = null) => ({ id: 'task-fixture', object: 'chat.completion.chunk', created: 1, model: 'task-fixture', choices: [{ index: 0, delta: data, finish_reason }] });
    return new Response([chunk({ role: 'assistant' }), chunk(delta), chunk({}, typeof reply === 'string' ? 'stop' : 'tool_calls')].map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  });
  const ctx = { engineRoot, workspaceRoot: { engineRoot, userWorkspaceRoot: workspace }, workspaceStatePaths };
  const invoke = (extra = {}) => AiService.invoke({ messages: [{ role: 'user', content: 'revise this article' }], sessionId: 'document-fixture', focusPath: 'A.md', ...extra }, ctx);
  return { workspace, requests, invoke };
}

test('real Desktop service + Pi + Kernel stops successful repeated reads before any auto-continue', async t => {
  const { requests, invoke } = await fixture(t, async () => ({ tool: 'read_file', args: {} }));
  const result = await invoke();
  assert.equal(result.goal.blockReason, 'repeated-result');
  assert.equal(requests.length, 3);
  assert.equal(result.autoContinues, 0);
  assert.doesNotMatch(JSON.stringify(requests), /UNRELATED_ARTICLE_CANARY/);
  assert.match(JSON.stringify(requests[0]), /UNRELATED_PROFILE_CANARY/);
  assert.match(JSON.stringify(requests[0]), /User memory.*read-only/);
  assert.doesNotMatch(requests[0].messages.map(m => String(m.content)).join('\n'), /<available_skills>|list_categories|Use `list_categories`/);
  assert.ok(requests[0].tools.some(t => t.function.name === 'read_file'));
  assert.ok(!requests[0].tools.some(t => ['workspace_overview', 'list_files', 'web_search'].includes(t.function.name)));
});
test('missing article and unavailable image generation never reach the provider', async t => {
  const { invoke, requests } = await fixture(t, async () => assert.fail('provider must not run'));
  assert.equal((await invoke({ focusPath: null })).goal.blockReason, 'needs-target');
  assert.equal((await invoke({ messages: [{ role: 'user', content: '为当前文章生成封面' }] })).goal.blockReason, 'image-generation-unavailable');
  assert.equal(requests.length, 0);
});
test('model DONE claims cannot mark an article edit complete without a real write', async t => {
  const { invoke, workspace, requests } = await fixture(t, async () => 'Revised successfully. [DONE]');
  const result = await invoke();
  assert.equal(result.goal.status, 'incomplete');
  assert.equal(result.goal.blockReason, 'no-write-evidence');
  assert.equal(requests.length, 1, 'no judge or automatic continuation after prose');
  assert.match(await readFile(path.join(workspace, 'A.md'), 'utf8'), /Original content/);
  assert.deepEqual(result.memoryDistillHint.modifiedFiles, []);
});
test('real writeback changes the bound article and leaves unrelated articles intact', async t => {
  const { invoke, workspace, requests } = await fixture(t, async n => n === 1 ? { tool: 'edit_file', args: { relativePath: 'A.md', oldText: 'Original content.', newText: 'Revised content.' } } : 'Updated A.md, preserving the facts.');
  const result = await invoke();
  assert.equal(result.goal.status, 'done', result.text);
  assert.equal(requests.length, 2);
  assert.match(await readFile(path.join(workspace, 'A.md'), 'utf8'), /Revised content/);
  assert.ok(result.memoryDistillHint.modifiedFiles.includes('A.md'));
  assert.deepEqual(result.goal.modifiedPaths, ['A.md']);
  assert.equal(await readFile(path.join(workspace, 'B.md'), 'utf8'), 'UNRELATED_ARTICLE_CANARY');
});
test('article changes while the model runs stop a stale write at the service boundary', async t => {
  const { invoke, workspace } = await fixture(t, async (_n, root) => {
    await writeFile(path.join(root, 'A.md'), '# Article A\n\nExternal change.\nOriginal content.\n');
    return { tool: 'edit_file', args: { relativePath: 'A.md', oldText: 'Original content.', newText: 'Stale AI content.' } };
  });
  const result = await invoke();
  assert.equal(result.goal.blockReason, 'source-changed');
  assert.doesNotMatch(await readFile(path.join(workspace, 'A.md'), 'utf8'), /Stale AI content/);
});
test('a bounded prompt window is never mistaken for the full source version of a long article', async t => {
  const { invoke, workspace } = await fixture(t, async n => n === 1 ? { tool: 'edit_file', args: { relativePath: 'A.md', oldText: 'Original content.', newText: 'Revised ending.' } } : 'Updated the ending of A.md.');
  const prefix = 'A preserved paragraph in a long article.\n'.repeat(1600);
  await writeFile(path.join(workspace, 'A.md'), prefix + '\nOriginal content.\n');
  const result = await invoke();
  assert.equal(result.goal.status, 'done', result.text);
  assert.equal(await readFile(path.join(workspace, 'A.md'), 'utf8'), prefix + '\nRevised ending.\n');
});
test('clarification stops a same-step queued write; the answer resumes the original article after focus changes', async t => {
  const edit = { tool: 'edit_file', args: { relativePath: 'A.md', oldText: 'Original content.', newText: 'Shortened content.' } };
  const { invoke, workspace, requests } = await fixture(t, async n => n === 1 ? [{ tool: 'request_clarification', args: { question: 'Should the article be shorter or more detailed?', choices: ['Shorter', 'More detailed'] } }, edit] : n === 2 ? edit : 'Updated A.md.');
  const first = await invoke();
  assert.equal(first.goal.blockReason, 'needs-clarification');
  assert.match(first.text, /Shorter/);
  assert.equal(requests.length, 1);
  assert.match(await readFile(path.join(workspace, 'A.md'), 'utf8'), /Original content/);
  const second = await invoke({ focusPath: 'B.md', messages: [{ role: 'user', content: 'Make it shorter, preserving the facts.' }] });
  assert.equal(second.goal.status, 'done', second.text);
  assert.match(requests[1].messages.map(m => String(m.content)).join('\n'), /"targetPath":"A.md"/);
  assert.match(await readFile(path.join(workspace, 'A.md'), 'utf8'), /Shortened content/);
  assert.equal(await readFile(path.join(workspace, 'B.md'), 'utf8'), 'UNRELATED_ARTICLE_CANARY');
});

test('memory off prevents automatic profile injection and the document memory tool', async t => {
  const { requests, invoke } = await fixture(t, async () => 'Suggestions.', {useMemory:false});
  await invoke({taskIntent:{targetPath:'A.md',output:'review'}});
  assert.equal(requests.length,1);
  assert.doesNotMatch(JSON.stringify(requests), /UNRELATED_PROFILE_CANARY/);
  assert.ok(!requests[0].tools.some(t => t.function.name === 'list_recent_memories'));
});

test('workspace completion distinguishes read references from writes', async t => {
  const file = '00-Inbox/source.md';
  const { invoke, workspace } = await fixture(t, async n => n === 1
    ? { tool: 'read_file', args: { relativePath: file } }
    : `Saved the result to ${file}. [DONE]`);
  await mkdir(path.dirname(path.join(workspace, file)), { recursive: true });
  await writeFile(path.join(workspace, file), 'Source only.');
  const result = await invoke({ focusPath: null, messages: [{ role: 'user', content: 'Save the result to a workspace file.' }] });
  assert.equal(result.goal.status, 'incomplete');
  assert.equal(result.goal.blockReason, 'no-write-evidence');
  assert.deepEqual(result.goal.modifiedPaths, []);
  assert.equal(await readFile(path.join(workspace, file), 'utf8'), 'Source only.');
});

test('a read-only workspace answer completes with references and no modifications', async t => {
  const file = '00-Inbox/source.md';
  const { invoke, workspace } = await fixture(t, async n => n === 1
    ? { tool: 'read_file', args: { relativePath: file } }
    : `The source is ${file}.`);
  await mkdir(path.dirname(path.join(workspace, file)), { recursive: true });
  await writeFile(path.join(workspace, file), 'Source only.');
  const result = await invoke({ focusPath: null, messages: [{ role: 'user', content: 'Summarize the source.' }] });
  assert.equal(result.goal.status, 'done');
  assert.ok(result.goal.pathReceipts.includes(file));
  assert.deepEqual(result.goal.modifiedPaths, []);
});

test('a failed workspace edit cannot use its target path as a write receipt', async t => {
  const file = '00-Inbox/source.md';
  const { invoke, workspace } = await fixture(t, async n => n === 1
    ? { tool: 'edit_file', args: { relativePath: file, oldText: 'Missing text', newText: 'New text' } }
    : `Edited ${file}. [DONE]`);
  await mkdir(path.dirname(path.join(workspace, file)), { recursive: true });
  await writeFile(path.join(workspace, file), 'Source only.');
  const result = await invoke({ focusPath: null, messages: [{ role: 'user', content: 'Replace the text in the source file.' }] });
  assert.equal(result.goal.status, 'incomplete');
  assert.deepEqual(result.goal.modifiedPaths, []);
  assert.equal(await readFile(path.join(workspace, file), 'utf8'), 'Source only.');
});

test('workspace delete awaiting confirmation cannot close as done', async t => {
  const file = '00-Inbox/source.md';
  const { invoke, workspace, requests } = await fixture(t, async n => n === 1
    ? { tool: 'delete_path', args: { relativePath: file } }
    : `Deleted ${file}. [DONE]`);
  await mkdir(path.dirname(path.join(workspace, file)), { recursive: true });
  await writeFile(path.join(workspace, file), 'Still present.');
  const result = await invoke({ focusPath: null, writebackMode: 'confirm', messages: [{ role: 'user', content: 'Delete the saved source file.' }] });
  assert.equal(result.goal.status, 'blocked');
  assert.equal(result.goal.blockReason, 'awaiting_confirmation');
  assert.deepEqual(result.goal.modifiedPaths, []);
  assert.equal(result.autoContinues, 0);
  assert.equal(requests.length, 1);
  assert.equal(await readFile(path.join(workspace, file), 'utf8'), 'Still present.');
  assert.deepEqual((await listPendingWrites(workspace)).map(item => item.relativePath), [file]);
});

test('workspace deletes inherit YAML policy unless the invocation supplies a valid override', async t => {
  const file = '00-Inbox/source.md';
  for (const mode of [undefined, 'unexpected', 'auto']) {
    await t.test(mode ?? 'unspecified', async subtest => {
      const { invoke, workspace } = await fixture(subtest, async n => n === 1
        ? { tool: 'delete_path', args: { relativePath: file } }
        : `Deleted ${file}. [DONE]`);
      await writeFile(path.join(workspace, 'topmind.yaml'), 'schema_version: 4\nlocale: en-US\nwriteback:\n  mode: confirm\n');
      await mkdir(path.dirname(path.join(workspace, file)), { recursive: true });
      await writeFile(path.join(workspace, file), 'Original note.');

      const result = await invoke({ focusPath: null, writebackMode: mode, messages: [{ role: 'user', content: 'Delete the saved source file.' }] });
      const pending = await listPendingWrites(workspace);
      if (mode === 'auto') {
        assert.equal(result.goal.status, 'done');
        assert.deepEqual(pending, []);
        await assert.rejects(readFile(path.join(workspace, file), 'utf8'), { code: 'ENOENT' });
      } else {
        assert.equal(result.goal.blockReason, 'awaiting_confirmation');
        assert.deepEqual(pending.map(item => item.relativePath), [file]);
        assert.equal(await readFile(path.join(workspace, file), 'utf8'), 'Original note.');
      }
    });
  }
});

test('a multi-file task keeps successful changes and reports an unresolved failed write', async t => {
  const saved = '00-Inbox/result.md', source = '00-Inbox/source.md';
  const script = [
    { tool: 'save_file', args: { relativePath: saved, content: 'Result' } },
    { tool: 'edit_file', args: { relativePath: source, oldText: 'Missing text', newText: 'Replacement' } },
    `Saved ${saved} and edited ${source}. [DONE]`,
  ];
  const { invoke, workspace } = await fixture(t, async n => script[n - 1]);
  await mkdir(path.dirname(path.join(workspace, source)), { recursive: true });
  await writeFile(path.join(workspace, source), 'Source only.');
  const result = await invoke({ focusPath: null, messages: [{ role: 'user', content: 'Save a result and replace text in the source file.' }] });
  assert.equal(result.goal.status, 'incomplete');
  assert.equal(result.goal.blockReason, 'partial-write');
  assert.deepEqual(result.goal.modifiedPaths, [saved]);
  assert.equal(await readFile(path.join(workspace, source), 'utf8'), 'Source only.');
  assert.equal(await readFile(path.join(workspace, saved), 'utf8'), 'Result');
});

test('a read-only workspace lookup returns its answer after an unavailable write attempt', async t => {
  const unwanted = '00-Inbox/unrequested.md';
  const source = '# Todos\n\n- [ ] Review the index.\n';
  const script = [
    { tool: 'save_file', args: { relativePath: unwanted, content: 'Unrequested write.' } },
    { tool: 'list_todos', args: {} },
    'Review the index. Source: memory/todo.md.',
  ];
  const { invoke, workspace, requests } = await fixture(t, async n => script[n - 1]);
  await writeFile(path.join(workspace, 'memory/todo.md'), source);
  const result = await invoke({ focusPath: null, messages: [{ role: 'user', content: 'What are my current todos?' }] });
  assert.equal(result.text, 'Review the index. Source: memory/todo.md.');
  assert.deepEqual(result.goal.modifiedPaths, []);
  assert.ok(!requests[0].tools.some(item => item.function.name === 'save_file'));
  await assert.rejects(readFile(path.join(workspace, unwanted), 'utf8'), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(workspace, 'memory/todo.md'), 'utf8'), source);
});

test('explicit continuation waits for review and does not replay a confirmed deletion or completed write', async t => {
  const old = '00-Inbox/old.md', receipt = '00-Inbox/receipt.md', next = '00-Inbox/next.md';
  const saveReceipt = { tool: 'save_file', args: { relativePath: receipt, content: 'Receipt.' } };
  const removeOld = { tool: 'delete_path', args: { relativePath: old } };
  const { invoke, workspace, requests } = await fixture(t, async n => [
    saveReceipt, removeOld, saveReceipt, removeOld, { tool: 'save_file', args: { relativePath: next, content: 'Continued.' } },
  ][n - 1] ?? `Finished ${next}. [DONE]`);
  await mkdir(path.dirname(path.join(workspace, old)), { recursive: true });
  await writeFile(path.join(workspace, old), 'Old');
  const send = (content, writebackMode) => invoke({ focusPath: null, messages: [{ role: 'user', content }], writebackMode });
  const first = await send('Save a receipt, delete the old note and create the next note.', 'confirm');
  assert.equal(first.goal.blockReason, 'awaiting_confirmation');
  const [pending] = await listPendingWrites(workspace);
  assert.equal((await send('Continue')).goal.blockReason, 'awaiting_confirmation');
  assert.equal(requests.length, 2);
  assert.equal((await acceptPendingWrite(workspace, pending.id)).ok, true);
  await writeFile(path.join(workspace, old), 'A different note at the same path.');
  await writeFile(path.join(workspace, receipt), 'Edited by the user after the first turn.');
  const resumed = await send('Continue');
  assert.equal(resumed.goal.status, 'done', resumed.text);
  assert.deepEqual(resumed.goal.modifiedPaths, [next]);
  assert.equal(await readFile(path.join(workspace, receipt), 'utf8'), 'Edited by the user after the first turn.');
  assert.equal(await readFile(path.join(workspace, old), 'utf8'), 'A different note at the same path.');
  assert.deepEqual(await listPendingWrites(workspace), []);
});

test('a rejected review is not recreated by a bare continuation', async t => {
  const file = '00-Inbox/rejected.md';
  const { invoke, workspace, requests } = await fixture(t, async () => ({ tool: 'delete_path', args: { relativePath: file } }));
  await mkdir(path.dirname(path.join(workspace, file)), { recursive: true });
  await writeFile(path.join(workspace, file), 'Keep me.');
  await invoke({ focusPath: null, writebackMode: 'confirm', messages: [{ role: 'user', content: 'Delete the note.' }] });
  const [pending] = await listPendingWrites(workspace);
  assert.equal(await rejectPendingWrite(workspace, pending.id), true);
  const result = await invoke({ focusPath: null, messages: [{ role: 'user', content: '继续' }] });
  assert.equal(result.goal.blockReason, 'review-rejected');
  assert.equal(requests.length, 1);
  assert.equal(await readFile(path.join(workspace, file), 'utf8'), 'Keep me.');
});
test('a constrained model window reserves output and refuses oversized user input before a model call', async t => {
  const { requests, invoke } = await fixture(t, async () => 'Suggestions.', {contextWindowTokens:16384});
  await invoke({taskIntent:{targetPath:'A.md',output:'review'}});
  assert.equal(requests.length,1);
  assert.ok(requests[0].max_tokens <= 3276);
  const result=await invoke({messages:[{role:'user',content:'revise '+ '完整保留事实。'.repeat(6000)}]});
  assert.equal(result.goal.blockReason,'context-budget');
  assert.equal(requests.length,1);
});
