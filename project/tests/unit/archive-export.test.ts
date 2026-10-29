import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {StorageService} from '../../src/modules/storage/service.ts';
import {parseSource} from '../../src/modules/source/parser.ts';
import {WorkspaceFiles} from '../../src/modules/workspace/files.ts';
import {ArchiveExporter} from '../../src/modules/workspace/archive-export.ts';

test('archive export picks the latest readable generated version, keeps manual edits and never overwrites',async t=>{
  const base=fileURLToPath(new URL('../../../.local/test-artifacts/',import.meta.url));await mkdir(base,{recursive:true});const own=await mkdtemp(join(base,'export-'));
  t.after(async()=>{assert.equal(resolve(dirname(own)),resolve(base));await rm(own,{recursive:true,force:true});});
  const notes=join(own,'notes');await mkdir(notes);const store=new StorageService(join(own,'archive-state'));await store.chooseDirectory(notes);
  const bytes=Buffer.from('合成原文'),snapshot={bytes,document:parseSource(bytes,join(own,'资料.txt'))},metadata={kind:'generated-note' as const,model:'fixture',promptVersion:'fixture'};
  await store.save(snapshot,'# 第一版',metadata);const latest=await store.save(snapshot,'# 第二版',metadata);await writeFile(latest.notePath,'# 人工修改\n\n保留字节');
  const files=new WorkspaceFiles(join(own,'workspace')),root=await files.choose('notes',notes),exporter=new ArchiveExporter(files,()=>store.state());
  const preview=await exporter.preview(root.id);assert.equal(preview.items.length,1);assert.equal(preview.items[0].modified,true);
  const item=preview.items[0];await writeFile(join(notes,item.name),'existing');const failed=await exporter.export(root.id,[{id:item.id,name:item.name}]);assert.equal(failed[0].status,'error');
  const result=await exporter.export(root.id,[{id:item.id,name:'导出.md'}]);assert.equal(result[0].status,'ok');assert.equal(await readFile(join(notes,'导出.md'),'utf8'),'# 人工修改\n\n保留字节');assert.equal(await readFile(latest.notePath,'utf8'),'# 人工修改\n\n保留字节');
});
