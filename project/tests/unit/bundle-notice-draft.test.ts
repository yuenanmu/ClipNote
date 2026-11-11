import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNoticeDraft} from '../../tools/bundle-notice-draft.mjs';

test('retains each embedded version and notice without leaking local paths', async () => {
  const root=await mkdtemp(join(tmpdir(),'clipnote-notices-'));
  const first=join(root,'node_modules','demo'),second=join(root,'node_modules','nested','node_modules','demo');
  await mkdir(first,{recursive:true});await mkdir(second,{recursive:true});
  await writeFile(join(first,'package.json'),JSON.stringify({name:'demo',version:'1.0.0'}));
  await writeFile(join(second,'package.json'),JSON.stringify({name:'demo',version:'2.0.0'}));
  await writeFile(join(first,'LICENSE'),'first notice');await writeFile(join(second,'NOTICE'),'second notice');
  const out=join(root,'out');
  const rows=await createNoticeDraft({projectRoot:root,outputDir:out,packages:[
    {name:'demo',version:'1.0.0',path:first,groups:['main']},
    {name:'demo',version:'2.0.0',path:second,groups:['renderer']},
  ]});
  assert.equal(rows.length,2);assert.notEqual(rows[0].files[0],rows[1].files[0]);
  assert.equal(await readFile(join(out,rows[0].files[0]),'utf8'),'first notice');
  assert.equal(await readFile(join(out,rows[1].files[0]),'utf8'),'second notice');
  assert.ok(!(await readFile(join(out,'inventory.json'),'utf8')).includes(root));
  await assert.rejects(createNoticeDraft({projectRoot:root,outputDir:out,packages:[]}),/exist/i);
});

test('fails closed for missing notices and paths outside project dependencies', async () => {
  const root=await mkdtemp(join(tmpdir(),'clipnote-notices-'));
  const pkg=join(root,'node_modules','missing');await mkdir(pkg,{recursive:true});
  await writeFile(join(pkg,'package.json'),JSON.stringify({name:'missing',version:'1'}));
  await assert.rejects(createNoticeDraft({projectRoot:root,outputDir:join(root,'out1'),packages:[{name:'missing',version:'1',path:pkg}]}),/notice/i);
  await assert.rejects(createNoticeDraft({projectRoot:root,outputDir:join(root,'out2'),packages:[{name:'outside',version:'1',path:tmpdir()}]}),/path/i);
  await assert.rejects(createNoticeDraft({projectRoot:root,outputDir:join(root,'out3'),packages:[{name:'missing',version:'2',path:pkg}]}),/metadata/i);
});

test('uses known version-specific supplemental notices and merges groups', async () => {
  const root=await mkdtemp(join(tmpdir(),'clipnote-notices-'));
  const pkg=join(root,'node_modules','@earendil-works','pi-ai');await mkdir(pkg,{recursive:true});
  await writeFile(join(pkg,'package.json'),JSON.stringify({name:'@earendil-works/pi-ai',version:'1.4.0'}));
  await mkdir(join(root,'licenses'));await writeFile(join(root,'licenses','pi-1.4.0-MIT.txt'),'pi notice');
  const out=join(root,'out'),p={name:'@earendil-works/pi-ai',version:'1.4.0',path:pkg};
  const rows=await createNoticeDraft({projectRoot:root,outputDir:out,packages:[{...p,groups:['main']},{...p,groups:['renderer']}]});
  assert.equal(rows.length,1);assert.deepEqual(rows[0].groups,['main','renderer']);
  assert.equal(rows[0].noticeSource,'supplemental');assert.equal(await readFile(join(out,rows[0].files[0]),'utf8'),'pi notice');
});

test('format supplemental notices include the fixed-version readme and current license', async () => {
  const root=await mkdtemp(join(tmpdir(),'clipnote-notices-'));
  const pkg=join(root,'node_modules','format');await mkdir(pkg,{recursive:true});
  await writeFile(join(pkg,'package.json'),JSON.stringify({name:'format',version:'0.2.2'}));
  await mkdir(join(root,'licenses'));
  await writeFile(join(root,'licenses','format-upstream-MIT.md'),'current license');
  await writeFile(join(root,'licenses','format-0.2.2-README.md'),'version notice');
  const out=join(root,'out'),rows=await createNoticeDraft({projectRoot:root,outputDir:out,packages:[{name:'format',version:'0.2.2',path:pkg}]});
  assert.equal(rows[0].files.length,2);
  const texts=await Promise.all(rows[0].files.map(file=>readFile(join(out,file),'utf8')));
  assert.deepEqual(texts.sort(),['current license','version notice']);
});

test('retains the OpenAI SDK nested third-party notices alongside its license', async () => {
  const root=await mkdtemp(join(tmpdir(),'clipnote-notices-'));
  const pkg=join(root,'node_modules','openai');await mkdir(join(pkg,'src','_vendor','partial-json-parser'),{recursive:true});
  await writeFile(join(pkg,'package.json'),JSON.stringify({name:'openai',version:'7.21.0'}));
  await writeFile(join(pkg,'LICENSE'),'sdk license');
  await writeFile(join(pkg,'src','_vendor','partial-json-parser','LICENSE'),'parser license');
  await mkdir(join(pkg,'src','_vendor','zod-to-json-schema'),{recursive:true});
  await mkdir(join(pkg,'src','internal','qs'),{recursive:true});
  await writeFile(join(pkg,'src','_vendor','zod-to-json-schema','LICENSE'),'zod license');
  await writeFile(join(pkg,'src','internal','qs','LICENSE.md'),'qs license');
  const out=join(root,'out'),rows=await createNoticeDraft({projectRoot:root,outputDir:out,packages:[{name:'openai',version:'7.21.0',path:pkg}]});
  assert.equal(rows[0].files.length,4);
  const texts=await Promise.all(rows[0].files.map(file=>readFile(join(out,file),'utf8')));
  assert.deepEqual(texts.sort(),['parser license','qs license','sdk license','zod license']);
});

test('requires each nested notice for both supported OpenAI versions', async () => {
  for(const version of ['7.19.0','7.21.0']) {
    const paths=['src/_vendor/partial-json-parser/LICENSE','src/_vendor/zod-to-json-schema/LICENSE','src/internal/qs/LICENSE.md'];
    for(const missing of paths) {
      const root=await mkdtemp(join(tmpdir(),'clipnote-notices-')),pkg=join(root,'node_modules','openai');
      await mkdir(pkg,{recursive:true});await writeFile(join(pkg,'package.json'),JSON.stringify({name:'openai',version}));
      await writeFile(join(pkg,'LICENSE'),'sdk license');
      for(const path of paths.filter(x=>x!==missing)){const file=join(pkg,path);await mkdir(join(file,'..'),{recursive:true});await writeFile(file,'notice');}
      await assert.rejects(createNoticeDraft({projectRoot:root,outputDir:join(root,'out'),packages:[{name:'openai',version,path:pkg}]}),/ENOENT/);
    }
  }
});
