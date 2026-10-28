import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WorkspaceFiles} from '../../src/modules/workspace/files.ts';
import {NoteResults} from '../../src/modules/workspace/results.ts';

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
