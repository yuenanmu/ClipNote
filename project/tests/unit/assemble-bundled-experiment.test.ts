import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assembleBundledExperiment} from '../../tools/assemble-bundled-experiment.mjs';

test('assembles an internal candidate with runtime, notices and marked sources',async()=>{
  const root=await mkdtemp(join(tmpdir(),'clipnote-assemble-'));
  const runtime=join(root,'runtime'),build=join(root,'build'),project=join(root,'project'),output=join(root,'candidate');
  for(const p of [runtime,join(build,'dist','main'),join(build,'npm-notices'),join(project,'vendor','siwc','src'),join(project,'licenses'),join(root,'docs')])await mkdir(p,{recursive:true});
  for(const [p,data] of [[join(runtime,'electron.exe'),'runtime'],[join(runtime,'LICENSE'),'electron license'],[join(build,'dist','main','index.cjs'),'app'],[join(build,'npm-notices','inventory.json'),'{}'],[join(project,'vendor','siwc','LICENSE'),'siwc'],[join(project,'vendor','siwc','THIRD_PARTY_NOTICES.md'),'third party'],[join(project,'vendor','siwc','src','changes.ts'),'marked'],[join(project,'licenses','SIWC-CHANGES.md'),'changes'],[join(root,'docs','Windows候选使用说明.md'),'guide']])await writeFile(p,data);
  await assembleBundledExperiment({runtimeDir:runtime,buildDir:build,projectRoot:project,outputDir:output});
  assert.equal(await readFile(join(output,'ClipNote.exe'),'utf8'),'runtime');
  assert.equal(await readFile(join(output,'resources','app','dist','main','index.cjs'),'utf8'),'app');
  assert.equal(await readFile(join(output,'licenses','npm','inventory.json'),'utf8'),'{}');
  assert.equal(await readFile(join(output,'licenses','siwc-modified-source','changes.ts'),'utf8'),'marked');
  assert.equal(await readFile(join(output,'使用说明.md'),'utf8'),'guide');
  await access(join(output,'内部候选-不可分发.txt'));
  await assert.rejects(assembleBundledExperiment({runtimeDir:runtime,buildDir:build,projectRoot:project,outputDir:output}),/exist/i);
});
