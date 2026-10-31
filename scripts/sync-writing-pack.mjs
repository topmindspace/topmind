#!/usr/bin/env node
/** Explicit refresh only. Builds consume the committed independent writing release snapshot. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(process.env.TOPMIND_WRITING_SRC || path.join(root, '../topmind-writing-skills'));
const { buildHostPack } = createRequire(import.meta.url)(path.join(source, 'lib/host-pack.cjs'));
const { snapshot } = buildHostPack(source);
const runtimeModules = Object.keys(snapshot.resources).filter(key => /^runtime\/[^/]+\.(?:mjs|mts)$/u.test(key)).sort();
const outputs = new Map([
  ['topmind-desktop/electron/data/writing-pack.json', JSON.stringify(snapshot) + '\n'],
]);
for (const key of runtimeModules) {
  const name = key.slice('runtime/'.length);
  outputs.set(`topmind-desktop/electron/writing/${name}`, snapshot.resources[key]);
  outputs.set(`topmind-desktop/src/generated/writing/${name}`, snapshot.resources[key]);
}
for (const [relative, content] of outputs) {
  const target = path.join(root, relative);
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) throw new Error(`Writing snapshot drift: ${relative}`);
  } else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); }
}
console.log(`Writing snapshot ${snapshot.version}, ${snapshot.skills.length} skills, ${snapshot.digest}`);
