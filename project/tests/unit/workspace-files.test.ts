import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkspaceFiles } from '../../src/modules/workspace/files.ts';

async function fixture(t: test.TestContext) {
  const base = fileURLToPath(new URL('../../../.local/test-artifacts/', import.meta.url)); await mkdir(base, { recursive: true });
  const own = await mkdtemp(join(base, 'workspace-')), root = join(own, 'root'), state = join(own, 'state'); await mkdir(root);
  t.after(async () => { assert.equal(resolve(dirname(own)), resolve(base)); await rm(own, { recursive: true, force: true }); });
  return { own, root, state };
}
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
