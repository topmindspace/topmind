// Native Electron smoke with synthetic notes, temporary app state and a loopback provider.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { parseArgs } = require('node:util');

const { values } = parseArgs({ options: { playwright: { type: 'string' } } });
const load = values.playwright ? createRequire(path.resolve(values.playwright, 'package.json')) : require;
const { _electron } = load('playwright');
const desktop = path.resolve(__dirname, '../topmind-desktop');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'topmind-desktop-host-replay-'));
const state = path.join(root, 'state');
const workspace = path.join(root, 'workspace');
fs.mkdirSync(state);
fs.mkdirSync(workspace);

const longPath = '00-Inbox/Long-article.md';
const oldPath = '00-Inbox/Old.md';
const outcomePath = '00-Inbox/Resume-result.md';
const original = '# Offline index\n\n> “Search stays on this device.”\n\nThe vendor measured 0.3 seconds on 10,000 notes.\n\n'
  + 'An untouched body paragraph keeps its wording and reference.\n\n'.repeat(290)
  + '![Index diagram](missing-index.png)\n\nDraft closing sentence.\n';
const edited = original.replace('Draft closing sentence.', 'Only the closing sentence changed.');
const modelId = 'isolated-replay';
const replies = [];
const requests = [];

function serve(req, res) {
  if (req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: modelId }] }));
    return;
  }
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    let body;
    try { body = JSON.parse(raw); } catch { res.writeHead(400); res.end(); return; }
    requests.push(body);
    const next = replies.shift();
    if (next === undefined || body.model !== modelId) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Unexpected synthetic model call' } }));
      return;
    }
    const text = typeof next === 'string' ? next : next.text;
    const delta = text !== undefined ? { content: text } : { tool_calls: [{
      index: 0, id: 'synthetic-' + requests.length, type: 'function',
      function: { name: next.tool, arguments: JSON.stringify(next.args) },
    }] };
    const frame = (data, finish_reason = null) => 'data: ' + JSON.stringify({
      id: 'synthetic', object: 'chat.completion.chunk', created: 1, model: modelId,
      choices: [{ index: 0, delta: data, finish_reason }],
      ...(finish_reason && next.usage ? { usage: next.usage } : {}),
    }) + '\n\n';
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(frame({ role: 'assistant' }) + frame(delta) + frame({}, next.finish || (text !== undefined ? 'stop' : 'tool_calls')) + 'data: [DONE]\n\n');
  });
}

async function run() {
  const server = http.createServer(serve);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env, TOPMIND_CHANNEL: 'test', topmind_DESKTOP_HOME: state, topmind_USER_WORKSPACE: workspace };
  delete env.topmind_DESKTOP_DEV_SERVER_URL;
  let electron;
  let page;
  try {
    electron = await _electron.launch({ executablePath: require(path.join(desktop, 'node_modules/electron')), args: [desktop], env, timeout: 30000 });
    page = await electron.firstWindow();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const actual = await electron.evaluate(({ app }) => ({ userData: app.getPath('userData'), version: app.getVersion(), electron: process.versions.electron }));
    assert.equal(fs.realpathSync(actual.userData), fs.realpathSync(state));
    await page.locator('[data-stream-compose-submit]').waitFor();

    const rpc = (method, params) => page.evaluate(([name, args]) => window.topmind.invoke(name, args), [method, params]);
    const invoke = (sessionId, content, extra = {}) => rpc('ai.invoke', {
      sessionId, messages: [{ role: 'user', content }], useTools: true, ...extra,
    });
    const read = relative => fs.readFileSync(path.join(workspace, relative), 'utf8');
    await rpc('system.updateSettings', { patch: {
      writebackMode: 'confirm',
      ai: { sourcePreference: 'custom', defaultModel: modelId, manual: {
        customBaseUrl: 'http://127.0.0.1:' + server.address().port + '/v1', customKey: 'synthetic-only',
      } },
    } });
    for (const [relativePath, content] of [[longPath, original], [oldPath, 'Original note requiring confirmation.\n']]) {
      await rpc('workspace.savePath', { relativePath, content });
      assert.equal(read(relativePath), content);
    }

    const beforeEdit = requests.length;
    replies.push({ tool: 'read_file', args: { relativePath: longPath, around: 'Draft closing sentence.', limit: 30 } },
      { tool: 'edit_file', args: { relativePath: longPath, oldText: 'Draft closing sentence.', newText: 'Only the closing sentence changed.' } },
      'Only the closing sentence changed.');
    const edit = await invoke('host-replay-edit', 'Only edit the final sentence and preserve the quotation and source numbers.', {
      focusPath: longPath, taskIntent: { targetPath: longPath, skillId: 'topmind-revise', output: 'edit' },
    });
    assert.equal(edit.goal?.status, 'done', edit.text);
    assert.deepEqual(edit.goal.modifiedPaths, [longPath]);
    assert.equal(read(longPath), edited);
    assert.ok(requests[beforeEdit + 1].messages.some(message => message.role === 'tool' && /\d+\|Draft closing sentence\./u.test(JSON.stringify(message.content))));
    assert.equal(replies.length, 0);
    console.log(JSON.stringify({ stage: 'long-edit', source: longPath, modifiedPaths: edit.goal.modifiedPaths }));

    const beforePreview = requests.length;
    await page.locator('[data-wechat-open]').click();
    const writing = page.locator('[data-writing-app]');
    await writing.getByRole('button', { name: /选择笔记|Choose note/u }).click();
    await page.getByText(longPath, { exact: true }).click();
    await writing.getByRole('tab', { name: /排版预览|Layout preview/u }).click();
    await writing.getByRole('button', { name: /生成预览|Generate preview/u }).click();
    const frame = writing.locator('iframe');
    await frame.waitFor();
    const html = await frame.getAttribute('srcdoc');
    assert.match(html, /\[Index diagram\]/u);
    const imageDetails = writing.locator('[data-writing-images]');
    assert.ok(await imageDetails.evaluate(details => details.open));
    assert.match(await imageDetails.innerText(), /缺失或无法读取|Missing or unreadable/u);
    assert.ok(await imageDetails.getByText('missing-index.png', { exact: true }).isVisible());
    const exportButton = writing.getByRole('button', { name: /导出文件|Export file/u });
    assert.ok(await writing.locator('[data-writing-checks]').evaluate((section, button) =>
      !!(section.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING), await exportButton.elementHandle()));
    const exportPath = '00-Inbox/out/Long-article-wechat.html';
    const checklistPath = '00-Inbox/out/Long-article-wechat-images.md';
    await exportButton.click();
    await writing.getByRole('status').filter({ hasText: exportPath }).waitFor();
    assert.equal(read(exportPath), html);
    assert.match(read(checklistPath), /missing · missing-index\.png/u);
    assert.equal(read(longPath), edited);
    assert.equal(requests.length, beforePreview);
    await page.screenshot({ path: path.join(root, 'missing-image-export.png') });
    fs.renameSync(path.join(workspace, checklistPath), path.join(root, 'initial-checklist.md'));
    fs.mkdirSync(path.join(workspace, checklistPath));
    await exportButton.click();
    const partial = writing.getByRole('alert');
    await partial.waitFor();
    assert.match(await partial.innerText(), /正文已导出|Article exported/u);
    assert.ok((await partial.innerText()).includes(exportPath));
    assert.ok((await partial.innerText()).includes(checklistPath));
    assert.equal(read(exportPath), html);
    assert.equal(read(longPath), edited);
    await page.screenshot({ path: path.join(root, 'partial-export.png') });
    fs.rmdirSync(path.join(workspace, checklistPath));
    fs.writeFileSync(path.join(workspace, '00-Inbox/missing-index.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lfsAAAAASUVORK5CYII=', 'base64'));
    await exportButton.click();
    await writing.getByRole('alert').filter({ hasText: /图片已变化|images changed/u }).waitFor();
    assert.equal(await exportButton.isDisabled(), true);
    assert.equal(await frame.count(), 0);
    assert.equal(read(exportPath), html);
    await writing.getByRole('button', { name: /生成预览|Generate preview/u }).click();
    await frame.waitFor();
    assert.match(await frame.getAttribute('srcdoc'), /src="data:image\/png;base64,/u);
    assert.equal(await writing.locator('[data-writing-checks]').count(), 0);
    await writing.getByRole('button', { name: /^(关闭|Close)$/u }).click();
    console.log(JSON.stringify({ stage: 'missing-image-export', exportPath, checklistPath }));

    replies.push({ tool: 'read_file', args: { relativePath: longPath, offset: 1, limit: 12 } },
      'The vendor measured 0.3 seconds on 10,000 notes. Source: ' + longPath);
    const beforeLookup = requests.length;
    const lookup = await invoke('host-replay-lookup', 'Read this article and quote the measured result and its path. Do not edit anything.', {
      focusPath: longPath, taskIntent: { targetPath: longPath, output: 'review' },
    });
    assert.match(lookup.text, /0\.3 seconds/u);
    assert.deepEqual(lookup.goal?.modifiedPaths || [], []);
    assert.equal(read(longPath), edited);
    assert.ok(!requests[beforeLookup].tools.some(item => item.function.name === 'save_file'));
    assert.equal(replies.length, 0);

    const deleteCall = { tool: 'delete_path', args: { relativePath: oldPath } };
    replies.push(deleteCall);
    const session = 'host-replay-resume';
    const waiting = await invoke(session, 'Delete the old note, then save a new result.');
    assert.equal(waiting.goal?.blockReason, 'awaiting_confirmation', waiting.text);
    assert.equal(read(oldPath), 'Original note requiring confirmation.\n');
    const count = requests.length;
    assert.equal((await invoke(session, '继续')).goal?.blockReason, 'awaiting_confirmation');
    assert.equal(requests.length, count);
    const { pending } = await rpc('workspace.listPendingWrites', {});
    assert.deepEqual(pending.map(item => item.relativePath), [oldPath]);
    const confirmation = await rpc('workspace.confirmPendingWrite', { id: pending[0].id });
    assert.equal(confirmation.ok, true);
    assert.equal(fs.existsSync(path.join(workspace, oldPath)), false);
    await rpc('workspace.savePath', { relativePath: oldPath, content: 'Replacement note at the same path.\n' });
    replies.push(deleteCall, { tool: 'save_file', args: { relativePath: outcomePath, content: 'Continued after confirmation.' } }, 'Result saved. [DONE]');
    const resumed = await invoke(session, '继续');
    assert.equal(resumed.goal?.status, 'done', resumed.text);
    assert.deepEqual(resumed.goal.modifiedPaths, [outcomePath]);
    assert.equal(read(oldPath), 'Replacement note at the same path.\n');
    assert.equal(read(outcomePath), 'Continued after confirmation.');
    assert.equal(replies.length, 0);

    replies.push({ text: 'Partial deliverable', finish: 'length', usage: { prompt_tokens: 21, completion_tokens: 3, total_tokens: 24 } });
    const limited = await invoke('host-replay-output-limit', 'Draft the requested report.');
    assert.equal(limited.ok, false);
    assert.match(limited.text, /Partial deliverable/u);
    assert.match(limited.error, /输出上限|output limit/u);
    assert.deepEqual(limited.usage, { promptTokens: 21, completionTokens: 3, totalTokens: 24 });
    assert.equal(replies.length, 0);

    await rpc('system.updateSettings', { patch: { ai: { enabledSkillIds: ['topmind-write'] } } });
    await page.locator('[data-activity="settings"]').click();
    const settings = page.locator('[data-settings-dialog]');
    await settings.getByRole('tab', { name: /^(技能|Skills)$/u }).click();
    await settings.locator('summary').filter({ hasText: /管理扩展与技能清单|Extensions and skill list/u }).click();
    const writer = settings.getByRole('checkbox', { name: /^write\b/iu });
    assert.equal(await writer.isChecked(), true);
    assert.notEqual(await writer.evaluate(el => getComputedStyle(el).accentColor), 'auto');
    await writer.focus();
    await writer.press('Space');
    await settings.getByRole('status').filter({ hasText: /· 0\//u }).waitFor();
    assert.equal(await writer.isChecked(), false);
    await page.waitForFunction(async () => {
      const status = await window.topmind.invoke('system.getSkillsStatus', {});
      return Array.isArray(status.enabledSkillIds) && status.enabledSkillIds.length === 0 && status.slash.length === 0;
    });
    await settings.getByRole('button', { name: /启用全部|Enable all/u }).click();
    await page.waitForFunction(async () => {
      const status = await window.topmind.invoke('system.getSkillsStatus', {});
      return status.enabledSkillIds === null && status.slash.some(row => row.command === '/write');
    });
    assert.equal(await writer.isChecked(), true);
    await page.screenshot({ path: path.join(root, 'skill-selection.png') });
    assert.deepEqual(errors, []);
    const verification = { host: 'Desktop', ...actual, requests: requests.length,
      checks: { longEdit: longPath, missingImageExport: exportPath, checklistPath, partialExport: true, staleImagePreview: true, readOnly: true, confirmedResume: outcomePath, outputLimit: true, skillSelection: true }, errors };
    fs.writeFileSync(path.join(root, 'verification.json'), JSON.stringify(verification, null, 2) + '\n');
    console.log(JSON.stringify({ stage: 'validated', root, ...verification }));
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {});
    console.error(JSON.stringify({ stage: 'failure', root }));
    throw error;
  } finally {
    if (electron) await electron.close();
    server.closeAllConnections();
    server.close();
  }
}

run().catch(error => { console.error(error.stack); process.exitCode = 1; });
