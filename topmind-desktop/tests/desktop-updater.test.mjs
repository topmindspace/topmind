import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createDesktopUpdater } from '../electron/lib/desktop-updater.mjs';
test('updater downloads separately, waits for explicit install and never claims a running update applied', async () => {
  const updater = new EventEmitter(); let installs = 0;
  updater.checkForUpdates = async () => { updater.emit('update-available', { version: '9.0.0' }); };
  updater.downloadUpdate = async () => { updater.emit('download-progress', { percent: 42 }); updater.emit('update-downloaded', { version: '9.0.0' }); };
  updater.quitAndInstall = () => { installs++; };
  const service = createDesktopUpdater(updater, { packaged: true });
  assert.equal((await service.run('check')).phase, 'available'); assert.equal(installs, 0);
  assert.equal((await service.run('download')).phase, 'ready'); assert.equal(installs, 0);
  assert.equal((await service.run('install')).phase, 'restarting'); assert.equal(installs, 1);
  assert.equal(updater.autoInstallOnAppQuit, false);
});
test('development installs do not fetch; download failures remain failures', async () => {
  assert.equal((await createDesktopUpdater(null).run('download')).supported, false);
  const updater = new EventEmitter(); updater.checkForUpdates = async () => { throw new Error('secret-in-network-error'); };
  const state = await createDesktopUpdater(updater, { packaged: true }).run('download');
  assert.equal(state.phase, 'error'); assert.doesNotMatch(state.error, /secret/);
});
