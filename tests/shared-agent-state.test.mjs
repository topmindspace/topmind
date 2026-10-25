import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as kernel from '../lib/kernel-api.mjs';
import { buildAgentToolCatalog, normalizeAgentToolCall } from '../lib/agent-tool-catalog.mjs';
function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tm-shared-state-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'00-Inbox'),{recursive:true});
 fs.mkdirSync(path.join(root,'memory'),{recursive:true});
 fs.writeFileSync(path.join(root,'topmind.yaml'),'contract_version: 4\nwriteback:\n  mode: confirm\n');
 return root;
}
test('Desktop tool snapshot is identical to the canonical Kernel catalog',()=>{
 assert.equal(fs.readFileSync(new URL('../lib/agent-tool-catalog.mjs',import.meta.url),'utf8'),fs.readFileSync(new URL('../topmind-desktop/electron/lib/ai-tool-names.mjs',import.meta.url),'utf8'));
 const desktop=buildAgentToolCatalog({host:'desktop',locale:'en-US'});
 const obsidian=buildAgentToolCatalog({host:'obsidian',locale:'en-US'});
 for(const name of Object.keys(obsidian)) {
  if(name==='propose_memory_change')continue;
  assert.ok(desktop[name],name);
  for(const key of Object.keys(obsidian[name].inputSchema.properties||{})) assert.deepEqual(obsidian[name].inputSchema.properties[key],desktop[name].inputSchema.properties[key],`${name}.${key}`);
 }
 assert.equal(normalizeAgentToolCall({tool:'capture',target:'inbox'}).forceInbox,true);
 assert.equal(normalizeAgentToolCall({tool:'toggle_todo',id:'a'}).idOrText,'a');
});
test('pending entries are isolated per workspace and visible to fresh readers',t=>{
 const a=fixture(t),b=fixture(t);
 const entry=kernel.stashPendingWrite({workspaceRoot:a,relativePath:'00-Inbox/note.md',content:'body'});
 assert.equal(kernel.listPendingWrites(b).length,0);
 assert.equal(kernel.listPendingWrites(a)[0].id,entry.id);
 assert.equal(kernel.rejectPendingWrite(b,entry.id),false);
 assert.equal(kernel.listPendingWrites(a).length,1);
});
test('review conflicts retain the proposal and never overwrite external edits',t=>{
 const root=fixture(t),file=path.join(root,'00-Inbox/note.md');
 fs.writeFileSync(file,'original');
 const entry=kernel.stashPendingWrite({workspaceRoot:root,relativePath:'00-Inbox/note.md',content:'proposed'});
 fs.writeFileSync(file,'external edit');
 assert.equal(kernel.acceptPendingWrite(root,entry.id).error,'pending-write-conflict');
 assert.equal(fs.readFileSync(file,'utf8'),'external edit');
 assert.equal(kernel.listPendingWrites(root).length,1);
 fs.writeFileSync(file,'original');
 assert.equal(kernel.acceptPendingWrite(root,entry.id).ok,true);
 assert.equal(fs.readFileSync(file,'utf8'),'proposed');
 assert.equal(kernel.listPendingWrites(root).length,0);
});
test('a confirmed delete executes deletion instead of saving an empty body',t=>{
 const root=fixture(t),file=path.join(root,'00-Inbox/delete.md');fs.writeFileSync(file,'keep until accepted');
 const entry=kernel.stashPendingWrite({workspaceRoot:root,relativePath:'00-Inbox/delete.md',toolName:'delete_path'});
 assert.equal(fs.existsSync(file),true);
 assert.equal(kernel.acceptPendingWrite(root,entry.id).ok,true);
 assert.equal(fs.existsSync(file),false);
 assert.equal(kernel.listPendingWrites(root).length,0);
});
test('a failed confirmed write remains available for retry',t=>{
 const root=fixture(t);fs.writeFileSync(path.join(root,'00-Inbox/blocked'),'not a directory');
 const entry=kernel.stashPendingWrite({workspaceRoot:root,relativePath:'00-Inbox/blocked/file.md',content:'body'});
 assert.throws(()=>kernel.acceptPendingWrite(root,entry.id));
 assert.equal(kernel.listPendingWrites(root)[0].id,entry.id);
});
test('corrupt queue files are preserved and mutations fail visibly',t=>{
 const root=fixture(t);fs.mkdirSync(path.join(root,'.topmind'));
 const file=path.join(root,'.topmind/pending-writes.json');fs.writeFileSync(file,'{corrupt');
 assert.throws(()=>kernel.stashPendingWrite({workspaceRoot:root,relativePath:'a.md',content:'body'}),/invalid-state-json/);
 assert.equal(fs.readFileSync(file,'utf8'),'{corrupt');
});
test('shared memory policy follows aliases and allows ordinary reads',t=>{
 const root=fixture(t);fs.symlinkSync(path.join(root,'memory'),path.join(root,'alias'));
 for(const name of ['save_file','save_note','move_to_topic','create_topic']) {
  assert.equal(kernel.memoryFence(name,{relativePath:'alias/new.md'},{workspaceRoot:root})?.error,'write-blocked:memory-plane',name);
 }
 assert.equal(kernel.memoryFence('read_file',{relativePath:'memory/profile.md'},{workspaceRoot:root}),null);
 assert.equal(kernel.memoryFence('save_file',{relativePath:'memory/ledgers/item.md'},{workspaceRoot:root}),null);
 const outside=fixture(t);fs.symlinkSync(outside,path.join(root,'escape'));
 assert.equal(kernel.memoryFence('save_file',{relativePath:'escape/file.md'},{workspaceRoot:root})?.error,'path-outside-workspace');
});
test('system-state storage refuses escaping .topmind links before mkdir/write',t=>{
 const root=fixture(t),outside=fixture(t);fs.symlinkSync(outside,path.join(root,'.topmind'));
 assert.throws(()=>kernel.writeWorkspaceState(root,'pending-writes.json',{items:[]}),/outside-workspace/);
 assert.equal(fs.existsSync(path.join(outside,'pending-writes.json')),false);
});

test('short edit commands retain write tools while lookup questions stay read-only',async()=>{
 const {classifyTurn}=await import('../lib/agent-goal-protocol.mjs');
 for(const text of ['Replace the unique middle paragraph.','替换标题','继续编辑']) assert.equal(classifyTurn(text),'task',text);
 assert.equal(classifyTurn('What are my current todos?'),'query');
});
