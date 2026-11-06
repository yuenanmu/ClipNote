import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WorkspaceFiles} from '../../src/modules/workspace/files.ts';
import {NoteResults} from '../../src/modules/workspace/results.ts';
import {writeAtomic} from '../../src/modules/storage/io.ts';

test('generated results survive restart and can be saved elsewhere after a conflict without inference',async t=>{
  const base=fileURLToPath(new URL('../../../.local/test-artifacts/',import.meta.url)); await mkdir(base,{recursive:true}); const own=await mkdtemp(join(base,'results-'));
  t.after(async()=>{assert.equal(resolve(dirname(own)),resolve(base));await rm(own,{recursive:true,force:true});});
  const sources=join(own,'sources'),notes=join(own,'notes'); await mkdir(sources);await mkdir(notes);await writeFile(join(sources,'a.txt'),'fixture');
  const ws=new WorkspaceFiles(join(own,'state')),sr=await ws.choose('source',sources),nr=await ws.choose('notes',notes),source=(await ws.list('source',sr.id)).entries[0];
  const plan=await ws.previewOutput(source.id,nr.id), results=new NoteResults(join(own,'results'),ws),id=await results.add(plan,'# 生成结果');
  await writeFile(join(notes,'a.md'),'# 其他笔记'); const restarted=new NoteResults(join(own,'results'),ws); assert.equal((await restarted.list())[0].id,id);
  await assert.rejects(restarted.prepare(id,nr.id)); const dest=await ws.createDirectory('notes',nr.id,'新主题'),preview=await restarted.prepare(id,dest.id,'a.md');
  assert.equal(await readFile(join(notes,'a.md'),'utf8'),'# 其他笔记'); await restarted.save(preview.token);
  assert.equal(await readFile(join(notes,'新主题','a.md'),'utf8'),'# 生成结果'); assert.equal((await restarted.list()).length,0);
});

test('an old save confirmation cannot reactivate a failed move association',async t=>{
  const base=fileURLToPath(new URL('../../../.local/test-artifacts/',import.meta.url));await mkdir(base,{recursive:true});const own=await mkdtemp(join(base,'stale-result-'));t.after(async()=>{assert.equal(resolve(dirname(own)),resolve(base));await rm(own,{recursive:true,force:true});});
  const sources=join(own,'sources'),notes=join(own,'notes');await mkdir(sources);await mkdir(notes);await writeFile(join(sources,'a.txt'),'a');let fail=false,count=0;
  const files=new WorkspaceFiles(join(own,'state'),{writeJson:async(path,data)=>{if(fail && path.endsWith('associations.json') && ++count===2)throw new Error('full');await writeAtomic(path,data);}}),sr=await files.choose('source',sources),nr=await files.choose('notes',notes),source=(await files.list('source',sr.id)).entries[0];await files.writeOutput(source.id,nr.id,await files.previewOutput(source.id,nr.id),'old');
  const result=new NoteResults(join(own,'results'),files),id=await result.add(await files.previewOutput(source.id,nr.id),'new result'),token=(await result.prepare(id)).token,note=(await files.list('notes',nr.id)).entries[0],folder=await files.createDirectory('notes',nr.id,'category');fail=true;await assert.rejects(files.move('notes',note.id,folder.id));await writeFile(join(notes,'a.md'),'old');
  await assert.rejects(result.save(token));assert.equal(await readFile(join(notes,'a.md'),'utf8'),'old');assert.equal((await result.list()).length,1);
});

test('a pending result keeps the originally confirmed subfolder after restart',async t=>{
 const base=fileURLToPath(new URL('../../../.local/test-artifacts/',import.meta.url));await mkdir(base,{recursive:true});const own=await mkdtemp(join(base,'results-folder-'));t.after(async()=>{assert.equal(resolve(dirname(own)),resolve(base));await rm(own,{recursive:true,force:true});});
 const sources=join(own,'sources'),notes=join(own,'notes');await mkdir(sources);await mkdir(notes);await writeFile(join(sources,'a.txt'),'fixture');const ws=new WorkspaceFiles(join(own,'state')),sr=await ws.choose('source',sources),nr=await ws.choose('notes',notes),folder=await ws.createDirectory('notes',nr.id,'主题'),source=(await ws.list('source',sr.id)).entries[0];
 const results=new NoteResults(join(own,'results'),ws),id=await results.add(await ws.previewOutput(source.id,folder.id),'# 生成结果');const restarted=new NoteResults(join(own,'results'),ws),preview=await restarted.prepare(id);assert.equal(preview.path,join(notes,'主题','a.md'));await restarted.save(preview.token);assert.equal(await readFile(join(notes,'主题','a.md'),'utf8'),'# 生成结果');
});

test('staged result never overwrites a file created after the original confirmation',async t=>{
 const base=fileURLToPath(new URL('../../../.local/test-artifacts/',import.meta.url));await mkdir(base,{recursive:true});const own=await mkdtemp(join(base,'results-conflict-'));t.after(async()=>{assert.equal(resolve(dirname(own)),resolve(base));await rm(own,{recursive:true,force:true});});
 const sources=join(own,'sources'),notes=join(own,'notes');await mkdir(sources);await mkdir(notes);await writeFile(join(sources,'a.txt'),'fixture');const ws=new WorkspaceFiles(join(own,'state')),sr=await ws.choose('source',sources),nr=await ws.choose('notes',notes),folder=await ws.createDirectory('notes',nr.id,'主题'),source=(await ws.list('source',sr.id)).entries[0],results=new NoteResults(join(own,'results'),ws);
 const id=await results.add(await ws.previewOutput(source.id,folder.id),'# generated');await writeFile(join(notes,'主题','a.md'),'# human');const preview=await results.prepare(id);await assert.rejects(results.save(preview.token));assert.equal(await readFile(join(notes,'主题','a.md'),'utf8'),'# human');assert.equal((await results.list()).length,1);
});
