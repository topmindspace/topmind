/** Small host-neutral system-state I/O. Atomic replacement; no module-global workspace or cache. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveWorkspacePath } from './model-core.mjs';

function statePath(root, name) {
  if (!/^[a-z0-9][a-z0-9_.-]*\.json$/iu.test(name) || name.includes('..')) throw new Error('invalid-state-name');
  return resolveWorkspacePath(root, `.topmind/${name}`).absolute;
}

export function readWorkspaceState(root, name, fallback = null, validate) {
  const file = statePath(root, name);
  if (!fs.existsSync(file)) return fallback;
  if (fs.statSync(file).size > 8 * 1024 * 1024) throw new Error(`state-file-too-large:${name}`);
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error(`invalid-state-json:${name}`); }
  if (validate && !validate(value)) throw new Error(`invalid-state-schema:${name}`);
  return value;
}

export function writeWorkspaceState(root, name, value) {
  const file = statePath(root, name);
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(payload, 'utf8') > 8 * 1024 * 1024) throw new Error(`state-file-too-large:${name}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, payload, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    if (statePath(root, name) !== file) throw new Error('state-path-changed');
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return value;
}
