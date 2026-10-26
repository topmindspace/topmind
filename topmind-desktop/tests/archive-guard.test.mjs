import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import JSZip from 'jszip';
import { unpackArchive } from '../electron/lib/install-swap.mjs';
test('archive traversal and symlinks are rejected before any extractor is invoked', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-archive-guard-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [name, options] of [['../escape.txt', {}], ['link', { unixPermissions: 0xa1ff }]]) {
    const zip = new JSZip(); zip.file(name, 'outside', options);
    const file = path.join(root, 'bad.zip'); await fs.writeFile(file, await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }));
    let invoked = false;
    const result = await unpackArchive(file, path.join(root, 'out'), { spawnImpl: () => { invoked = true; return true; } });
    assert.equal(result.ok, false); assert.equal(invoked, false);
  }
});
