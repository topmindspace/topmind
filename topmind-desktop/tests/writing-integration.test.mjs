import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { listSkillCatalog, loadSkillBody, loadSkillResource } from '../electron/lib/skills-runtime.mjs';
import { installSkillsPackLocal, readSkillsExtraReceipt, restoreBundledWriting } from '../electron/lib/skills-extra.mjs';
import { checkWritingUpdate } from '../electron/lib/update-check.mjs';
import { renderArticle, resolveArticleImage } from '../src/generated/writing/article-renderer.mjs';
test('writing is bundled without a sibling checkout; activation resources belong to the selected pack', async () => {
  const engine = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-writing-'));
  const catalog = listSkillCatalog({ engineRoot: engine });
  for (const id of ['topmind-revise', 'topmind-wechat-post', 'topmind-x-article', 'topmind-cover']) {
    assert.ok(catalog.some(s => s.id === id));
    assert.match(loadSkillBody(id, { engineRoot: engine }).raw, /name:/);
  }
  assert.match(loadSkillResource('references/workspace.md', { skillId: 'topmind-wechat-post', engineRoot: engine }).content, /源稿/);
  assert.throws(() => loadSkillResource('../../../../etc/passwd', { skillId: 'topmind-wechat-post', engineRoot: engine }));
  assert.equal(resolveArticleImage('a/b/note.md', '../images/a.png'), 'a/images/a.png');
  assert.throws(() => resolveArticleImage('a.md', '../secret.png'));
  assert.doesNotMatch(renderArticle({ markdown: '<script>x</script>' }).body, /<script/);
});
test('managed pack upgrade commits a complete tree, rejects modified sources and keeps prior content on copy failure', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-managed-'));
  const source = path.join(root, 'source'); await fs.mkdir(path.join(source, 'demo'), { recursive: true });
  const skill = '---\nname: demo\ndescription: demo\n---\nbody';
  await fs.writeFile(path.join(source, 'demo/SKILL.md'), skill);
  const manifest = { name: 'demo-writing', version: '1.0.0', entry_files: ['demo/SKILL.md'], files: { 'demo/SKILL.md': createHash('sha256').update(skill).digest('hex') } };
  await fs.writeFile(path.join(source, 'topmind-pack.json'), JSON.stringify(manifest));
  const first = await installSkillsPackLocal(source, { managedRoot: root }); assert.equal(first.ok, true, first.error);
  const prior = await fs.readFile(path.join(first.dest, 'demo/SKILL.md'), 'utf8');
  const failed = await installSkillsPackLocal(source, { managedRoot: root, copyImpl: async () => { throw new Error('disk-full'); } });
  assert.equal(failed.ok, false); assert.equal(await fs.readFile(path.join(first.dest, 'demo/SKILL.md'), 'utf8'), prior);
  await fs.writeFile(path.join(first.dest, 'demo/SKILL.md'), 'user customization');
  assert.equal((await installSkillsPackLocal(source, { managedRoot: root })).ok, false);
  assert.equal((await installSkillsPackLocal(source, { managedRoot: root, expectedVersion: '2.0.0' })).ok, false);
});
test('writing update uses its own release identity and lists only a published pack', async () => {
  const result = await checkWritingUpdate({ writingVersion: '0.0.1', fetchImpl: async () => ({ ok: true, json: async () => ({ version: '9.0.0', assets: [{ name: 'topmind-writing-skills-9.0.0.zip', browser_download_url: 'https://github.com/topmindspace/topmind-writing-skills/releases/download/v9.0.0/topmind-writing-skills-9.0.0.zip' }] }) }) });
  assert.equal(result.updateAvailable, true); assert.equal(result.tagName, 'v9.0.0'); assert.equal(result.repo, 'topmindspace/topmind-writing-skills');
});
test('new activation keeps previous version bytes and restoring bundled leaves both versions recoverable', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-versioned-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'); await fs.mkdir(path.join(source, 'demo'), { recursive: true });
  const install = async (version, body) => {
    const raw = `---\nname: demo\ndescription: test\n---\n${body}`;
    await fs.writeFile(path.join(source, 'demo/SKILL.md'), raw);
    await fs.writeFile(path.join(source, 'topmind-pack.json'), JSON.stringify({ name: 'topmind-writing-skills', version, entry_files: ['demo/SKILL.md'], files: { 'demo/SKILL.md': createHash('sha256').update(raw).digest('hex') } }));
    const result = await installSkillsPackLocal(source, { managedRoot: root }); assert.equal(result.ok, true, result.error); return result;
  };
  const old = await install('1.0.0', 'old'); const next = await install('1.0.1', 'new');
  assert.notEqual(old.dest, next.dest); assert.match(await fs.readFile(path.join(old.dest, 'demo/SKILL.md'), 'utf8'), /old$/);
  assert.equal((await readSkillsExtraReceipt(path.join(root, 'packs/topmind-writing-skills'))).version, '1.0.1');
  assert.equal((await restoreBundledWriting({ managedRoot: root })).ok, true);
  assert.equal(await readSkillsExtraReceipt(path.join(root, 'packs/topmind-writing-skills')), null);
  assert.match(await fs.readFile(path.join(next.dest, 'demo/SKILL.md'), 'utf8'), /new$/);
});
