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
