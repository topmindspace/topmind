import test from 'node:test';
import './helpers/electron-stub-loader.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AiService } from '../electron/ai-service.mjs';
import { resolveWorkspaceStatePaths } from '../electron/lib/workspace-home.mjs';

async function fixture(t, respond) {
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
  assert.doesNotMatch(JSON.stringify(requests), /UNRELATED_ARTICLE_CANARY|UNRELATED_PROFILE_CANARY/);
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
