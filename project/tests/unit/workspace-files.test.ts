import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkspaceFiles,isWithinWorkspace } from '../../src/modules/workspace/files.ts';
import { writeAtomic } from '../../src/modules/storage/io.ts';

async function fixture(t: test.TestContext) {
  const base = fileURLToPath(new URL('../../../.local/test-artifacts/', import.meta.url)); await mkdir(base, { recursive: true });
  const own = await mkdtemp(join(base, 'workspace-')), root = join(own, 'root'), state = join(own, 'state'); await mkdir(root);
  t.after(async () => { assert.equal(resolve(dirname(own)), resolve(base)); await rm(own, { recursive: true, force: true }); });
  return { own, root, state };
}
test('a different drive or network share is never inside the selected Windows root',()=>{
  if(process.platform!=='win32')return;
  assert.equal(isWithinWorkspace('D:\\资料','C:\\资料\\file.txt'),false);assert.equal(isWithinWorkspace('D:\\资料','\\\\server\\share\\file.txt'),false);assert.equal(isWithinWorkspace('D:\\资料','D:\\资料\\主题\\file.txt'),true);
});
test('workspace retains chosen root and manages actual files without copying originals', async t => {
  const f=await fixture(t); await writeFile(join(f.root, '原文.txt'), '原文'); const service=new WorkspaceFiles(f.state);
  const root=await service.choose('source',f.root); const before=await service.list('source',root.id); const file=before.entries.find(x=>x.name==='原文.txt')!;
  const folder=await service.createDirectory('source',root.id,'分类'); await service.move('source',file.id,folder.id);
  assert.equal(await readFile(join(f.root,'分类','原文.txt'),'utf8'),'原文'); const again=await new WorkspaceFiles(f.state).root('source'); assert.equal(again?.path,f.root);
});
test('workspace rejects traversal, links, name collisions and outside IDs', async t => {
  const f=await fixture(t); await mkdir(join(f.own,'outside')); await symlink(join(f.own,'outside'),join(f.root,'escape'),'junction'); await writeFile(join(f.root,'a.md'),'old');
  const service=new WorkspaceFiles(f.state), root=await service.choose('notes',f.root); const list=await service.list('notes',root.id);
  assert.ok(!list.entries.some(x=>x.name==='escape')); await assert.rejects(service.createDirectory('notes',root.id,'../escape'));
  await assert.rejects(service.createNote(root.id,'a.md')); await assert.rejects(service.list('notes','outside'));
});
test('editing checks external changes and never overwrites conflicting content', async t => {
  const f=await fixture(t); await writeFile(join(f.root,'a.md'),'原文'); const service=new WorkspaceFiles(f.state), root=await service.choose('notes',f.root);
  const file=(await service.list('notes',root.id)).entries.find(x=>x.name==='a.md')!; const opened=await service.readNote(file.id);
  await writeFile(join(f.root,'a.md'),'外部修改'); await assert.rejects(service.saveNote(file.id,opened.checksum,'自己的修改'),{code:'CONFLICT'});
  assert.equal(await readFile(join(f.root,'a.md'),'utf8'),'外部修改'); const fresh=await service.readNote(file.id); await service.saveNote(file.id,fresh.checksum,'保存后的笔记');
  assert.equal(await readFile(join(f.root,'a.md'),'utf8'),'保存后的笔记');
});
test('rename keeps a stable entry and rejects existing names', async t => {
  const f=await fixture(t); await writeFile(join(f.root,'one.md'),'1'); await writeFile(join(f.root,'two.md'),'2');
  const service=new WorkspaceFiles(f.state), root=await service.choose('notes',f.root); const file=(await service.list('notes',root.id)).entries.find(x=>x.name==='one.md')!;
  await assert.rejects(service.rename('notes',file.id,'two.md'),{code:'CONFLICT'}); await service.rename('notes',file.id,'renamed.md');
  assert.equal((await service.readNote(file.id)).text,'1'); assert.equal(await readFile(join(f.root,'two.md'),'utf8'),'2');
});
test('a large directory is returned in pages without dropping entries', async t => {
  const f=await fixture(t); await Promise.all(Array.from({length: 115}, (_, i) => writeFile(join(f.root, `${String(i).padStart(3,'0')}.md`), 'x')));
  const service=new WorkspaceFiles(f.state), root=await service.choose('notes',f.root), first=await service.list('notes',root.id), next=await service.list('notes',root.id,100);
  assert.equal(first.total,115); assert.equal(first.entries.length,100); assert.equal(next.entries.length,15); assert.equal(new Set([...first.entries,...next.entries].map(e=>e.name)).size,115);
});
test('trash uses only the selected known item and refuses to trash the root', async t => {
  const f=await fixture(t); await writeFile(join(f.root,'one.md'),'1'); const service=new WorkspaceFiles(f.state), root=await service.choose('notes',f.root);
  const file=(await service.list('notes',root.id)).entries[0]; const paths: string[] = [];
  await assert.rejects(service.trash('notes',root.id,async p => { paths.push(p); }),{code:'INVALID_REQUEST'});
  await service.trash('notes',file.id,async p => { paths.push(p); }); assert.deepEqual(paths,[join(f.root,'one.md')]); await assert.rejects(service.readNote(file.id),{code:'INVALID_REQUEST'});
});
test('generated output rejects unrelated names and detects changes before confirmed replacement', async t => {
  const f=await fixture(t), notes=join(f.own,'notes'); await mkdir(notes); await writeFile(join(f.root,'资料.txt'),'合成'); await writeFile(join(notes,'资料.md'),'用户笔记');
  const service=new WorkspaceFiles(f.state), sources=await service.choose('source',f.root), target=await service.choose('notes',notes);
  const id=(await service.list('source',sources.id)).entries[0].id;
  await assert.rejects(service.previewOutput(id,target.id),{code:'CONFLICT'}); assert.equal(await readFile(join(notes,'资料.md'),'utf8'),'用户笔记');
  await rm(join(notes,'资料.md')); const first=await service.previewOutput(id,target.id); assert.equal(first.exists,false);
  await service.writeOutput(id,target.id,first,'# 第一版'); const second=await service.previewOutput(id,target.id); assert.equal(second.exists,true);
  await writeFile(join(notes,'资料.md'),'人工修改'); await assert.rejects(service.writeOutput(id,target.id,second,'# 新版'),{code:'CONFLICT'}); assert.equal(await readFile(join(notes,'资料.md'),'utf8'),'人工修改');
  const note=(await service.list('notes',target.id)).entries.find(entry=>entry.name==='资料.md')!; await service.rename('notes',note.id,'新名称.md');
  const moved=await service.previewOutput(id,target.id); assert.equal(moved.name,'新名称.md'); assert.equal(moved.exists,true);
  await service.rename('source',id,'新资料.txt'); const renamed=await service.previewOutput(id,target.id); assert.equal(renamed.name,'新名称.md');
});
test('search finds nested matching files but does not follow junctions', async t => {
  const f=await fixture(t); await mkdir(join(f.root,'分类')); await writeFile(join(f.root,'分类','目标.txt'),'x'); await mkdir(join(f.own,'outside')); await writeFile(join(f.own,'outside','目标秘密.txt'),'x'); await symlink(join(f.own,'outside'),join(f.root,'escape'),'junction');
  const service=new WorkspaceFiles(f.state); await service.choose('source',f.root); const results=await service.search('source','目标');
  assert.equal(results.entries.length,1); assert.equal(results.entries[0].name,'目标.txt'); assert.match(results.entries[0].relativePath,/分类/);
});
test('explicit relinking handles externally moved notes without guessing ownership', async t => {
  const f=await fixture(t), notes=join(f.own,'notes'); await mkdir(notes); await writeFile(join(f.root,'资料.txt'),'合成'); await writeFile(join(notes,'已有.md'),'人工内容');
  const service=new WorkspaceFiles(f.state), sourceRoot=await service.choose('source',f.root), noteRoot=await service.choose('notes',notes);
  const source=(await service.list('source',sourceRoot.id)).entries[0], note=(await service.list('notes',noteRoot.id)).entries[0];
  await service.associate(source.id,note.id); const plan=await service.previewOutput(source.id,noteRoot.id); assert.equal(plan.name,'已有.md'); assert.equal(plan.exists,true);
  assert.equal(await readFile(join(notes,'已有.md'),'utf8'),'人工内容');
});

test('regeneration follows the associated note after moving it to a theme folder', async t => {
  const f=await fixture(t), notes=join(f.own,'notes'); await mkdir(notes); await writeFile(join(f.root,'资料.txt'),'合成');
  const service=new WorkspaceFiles(f.state), sourceRoot=await service.choose('source',f.root), noteRoot=await service.choose('notes',notes);
  const source=(await service.list('source',sourceRoot.id)).entries[0]; const plan=await service.previewOutput(source.id,noteRoot.id); await service.writeOutput(source.id,noteRoot.id,plan,'# 第一版');
  const note=(await service.list('notes',noteRoot.id)).entries[0], theme=await service.createDirectory('notes',noteRoot.id,'主题 A'); await service.move('notes',note.id,theme.id);
  const again=await service.previewOutput(source.id,noteRoot.id); assert.equal(again.notePath,join(notes,'主题 A','资料.md')); await service.writeOutput(source.id,noteRoot.id,again,'# 第二版');
  assert.equal(await readFile(join(notes,'主题 A','资料.md'),'utf8'),'# 第二版');
});

test('an explicitly opened source can be analyzed without granting its parent directory', async t => {
  const f=await fixture(t), service=new WorkspaceFiles(f.state); await writeFile(join(f.root,'outside.txt'),'原文');
  const entry=await service.registerSource(join(f.root,'outside.txt')); assert.equal(await service.filePath('source',entry.id),join(f.root,'outside.txt'));
  assert.equal(await service.root('source'),undefined); await assert.rejects(service.list('source',entry.id)); await assert.rejects(service.rename('source',entry.id,'changed.txt'));
});

test('multi-item moves report collisions separately and only active files are locked', async t => {
  const f=await fixture(t); await writeFile(join(f.root,'a.md'),'a'); await writeFile(join(f.root,'b.md'),'b');
  const service=new WorkspaceFiles(f.state), root=await service.choose('notes',f.root), list=await service.list('notes',root.id), folder=await service.createDirectory('notes',root.id,'分类');
  await writeFile(join(f.root,'分类','a.md'),'keep'); const moved=await service.moveMany('notes',list.entries.map(x=>x.id),folder.id);
  assert.deepEqual(moved.map(x=>x.status),['error','ok']); assert.equal(await readFile(join(f.root,'分类','a.md'),'utf8'),'keep');
  const release=service.lockPaths([join(f.root,'a.md')]); await assert.rejects(service.rename('notes',list.entries[0].id,'locked.md'),{code:'BUSY'});
  await service.createNote(root.id,'unrelated.md'); await assert.rejects(service.choose('notes',f.root),{code:'BUSY'}); release(); await service.rename('notes',list.entries[0].id,'free.md');
});

test('only a verified legacy library is hidden, never an ordinary folder named ClipNote', async t => {
  const f=await fixture(t); await mkdir(join(f.root,'ClipNote')); const service=new WorkspaceFiles(f.state), root=await service.choose('notes',f.root);
  assert.ok((await service.list('notes',root.id)).entries.some(x=>x.name==='ClipNote'));
  await writeFile(join(f.root,'ClipNote','.clipnote-library.json'),JSON.stringify({schemaVersion:1,app:'ClipNote',libraryId:'11111111-1111-4111-8111-111111111111'}));
  assert.ok(!(await service.list('notes',root.id)).entries.some(x=>x.name==='ClipNote'));
  assert.equal((await service.search('notes','ClipNote')).entries.length,0);
});

test('5,000 supported files are paged without rendering or losing all entries at once', async t => {
  const f=await fixture(t); for(let n=0;n<5000;n+=100) await Promise.all(Array.from({length:100},(_,i)=>writeFile(join(f.root,`${String(n+i).padStart(5,'0')}.md`),'x')));
  const service=new WorkspaceFiles(f.state), root=await service.choose('notes',f.root); const first=await service.list('notes',root.id), last=await service.list('notes',root.id,4900);
  assert.equal(first.total,5000); assert.equal(first.entries.length,100); assert.equal(last.entries.length,100); assert.equal(last.entries.at(-1)?.name,'04999.md');
});

test('a published note whose association write failed can resume across service restart', async t => {
  const f=await fixture(t), notes=join(f.own,'notes'); await mkdir(notes); await writeFile(join(f.root,'资料.txt'),'合成'); let fail=false;
  const service=new WorkspaceFiles(f.state,{writeJson:async(path,data)=>{ if(fail && path.endsWith('associations.json')) throw Object.assign(new Error('disk'),{code:'ENOSPC'}); await writeAtomic(path,data); }});
  const s=await service.choose('source',f.root), n=await service.choose('notes',notes), source=(await service.list('source',s.id)).entries[0], plan=await service.previewOutput(source.id,n.id);
  fail=true; await assert.rejects(service.writeOutput(source.id,n.id,plan,'# 生成结果')); assert.equal(await readFile(join(notes,'资料.md'),'utf8'),'# 生成结果');
  const restarted=new WorkspaceFiles(f.state), sr=await restarted.root('source'), nr=await restarted.root('notes'), reopened=(await restarted.list('source',sr!.id)).entries[0];
  await restarted.writeOutput(reopened.id,nr!.id,plan,'# 生成结果'); assert.equal((await restarted.previewOutput(reopened.id,nr!.id)).exists,true);
});

test('external directory changes notify the correct region without exposing raw paths',async t=>{
  const f=await fixture(t),service=new WorkspaceFiles(f.state),root=await service.choose('notes',f.root);const changes:unknown[]=[];
  const stop=service.subscribe(change=>changes.push(change));t.after(stop);await service.list('notes',root.id);await writeFile(join(f.root,'external.md'),'# external');
  for(let n=0;n<50 && !changes.length;n++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(changes.length);assert.deepEqual(Object.keys(changes[0] as object).sort(),['kind','revision']);assert.equal((changes[0] as {kind:string}).kind,'notes');
});

test('simultaneous publication and unrelated file moves preserve every association',async t=>{
  const f=await fixture(t),notes=join(f.own,'notes');await mkdir(notes);await writeFile(join(f.root,'a.txt'),'a');await writeFile(join(f.root,'b.txt'),'b');
  const files=new WorkspaceFiles(f.state),sr=await files.choose('source',f.root),nr=await files.choose('notes',notes),sources=(await files.list('source',sr.id)).entries;
  const plans=await Promise.all(sources.map(entry=>files.previewOutput(entry.id,nr.id)));await Promise.all(sources.map((entry,index)=>files.writeOutput(entry.id,nr.id,plans[index],'# '+entry.name)));
  const mappings=JSON.parse(await readFile(join(f.state,'associations.json'),'utf8'));assert.equal(mappings.entries.length,2);
});

test('moving a folder and its selected descendant moves the descendant only once',async t=>{
  const f=await fixture(t),files=new WorkspaceFiles(f.state),root=await files.choose('notes',f.root),parent=await files.createDirectory('notes',root.id,'主题'),dest=await files.createDirectory('notes',root.id,'目标'),child=await files.createNote(parent.id,'笔记.md');
  const result=await files.moveMany('notes',[parent.id,child.id],dest.id);assert.deepEqual(result.map(item=>item.status),['ok','ok']);assert.equal(await readFile(join(f.root,'目标','主题','笔记.md'),'utf8'),'');await assert.rejects(readFile(join(f.root,'目标','笔记.md')));
});

test('association failure during a move cannot authorize overwriting an unrelated file at the old path',async t=>{
  const f=await fixture(t),notes=join(f.own,'notes');await mkdir(notes);await writeFile(join(f.root,'a.txt'),'a');let failures=false,writes=0;
  const files=new WorkspaceFiles(f.state,{writeJson:async(path,data)=>{if(failures && path.endsWith('associations.json') && ++writes===2)throw Object.assign(new Error('full'),{code:'ENOSPC'});await writeAtomic(path,data);}}),sr=await files.choose('source',f.root),nr=await files.choose('notes',notes),source=(await files.list('source',sr.id)).entries[0];
  await files.writeOutput(source.id,nr.id,await files.previewOutput(source.id,nr.id),'# generated');const note=(await files.list('notes',nr.id)).entries[0],folder=await files.createDirectory('notes',nr.id,'分类');failures=true;
  await assert.rejects(files.move('notes',note.id,folder.id));await writeFile(join(notes,'a.md'),'unrelated');await assert.rejects(files.previewOutput(source.id,nr.id));assert.equal(await readFile(join(notes,'a.md'),'utf8'),'unrelated');
});

test('overlapping roots keep both capabilities and both association paths aligned',async t=>{
  const f=await fixture(t),notes=join(f.root,'notes');await mkdir(notes);await writeFile(join(f.root,'a.txt'),'a');const files=new WorkspaceFiles(f.state),sr=await files.choose('source',f.root),nr=await files.choose('notes',notes),source=(await files.list('source',sr.id)).entries.find(entry=>entry.name==='a.txt')!;
  await files.writeOutput(source.id,nr.id,await files.previewOutput(source.id,nr.id),'# note');const note=(await files.list('notes',nr.id)).entries[0],asSource=(await files.list('source',(await files.list('source',sr.id)).entries.find(entry=>entry.name==='notes')!.id)).entries[0];await files.rename('source',asSource.id,'renamed.md');
  assert.equal((await files.previewOutput(source.id,nr.id)).name,'renamed.md');assert.equal(await files.filePath('notes',note.id),join(notes,'renamed.md'));
});

test('a drive root cannot be switched while a descendant is locked',()=>{
  if(process.platform!=='win32')return;const files=new WorkspaceFiles('D:\\unused');const release=files.lockPaths(['D:\\notes\\a.md']);assert.throws(()=>files.lockPaths(['D:\\']),{code:'BUSY'});release();
});

test('failed parent deletion reports its selected descendant as failed too',async t=>{
  const f=await fixture(t),files=new WorkspaceFiles(f.state),root=await files.choose('notes',f.root),parent=await files.createDirectory('notes',root.id,'parent'),child=await files.createNote(parent.id,'child.md');
  const results=await files.trashMany('notes',[parent.id,child.id],async()=>{throw Object.assign(new Error('denied'),{code:'EPERM'});});assert.deepEqual(results.map(item=>item.status),['error','error']);
});

test('opening a search hit observes its unexpanded parent for external changes',async t=>{
  const f=await fixture(t);await mkdir(join(f.root,'nested'));await writeFile(join(f.root,'nested','searchable.md'),'# initial');const files=new WorkspaceFiles(f.state),root=await files.choose('notes',f.root),changes:unknown[]=[];const stop=files.subscribe(change=>changes.push(change));t.after(stop);await files.list('notes',root.id);
  const hit=(await files.search('notes','searchable')).entries[0];await files.filePath('notes',hit.id);await new Promise(resolve=>setTimeout(resolve,100));changes.length=0;await writeFile(join(f.root,'nested','searchable.md'),'# external');for(let n=0;n<30 && !changes.length;n++)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(changes.length);
});
