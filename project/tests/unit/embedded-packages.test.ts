import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {collectEmbeddedPackages} from '../../tools/embedded-packages.mjs';

test('identifies nested package versions and merges entry groups',async()=>{
  const root=await mkdtemp(join(tmpdir(),'clipnote-embedded-'));
  const a=join(root,'node_modules','demo'),b=join(a,'node_modules','demo');
  await mkdir(b,{recursive:true});
  await writeFile(join(a,'package.json'),JSON.stringify({name:'demo',version:'1'}));
  await writeFile(join(b,'package.json'),JSON.stringify({name:'demo',version:'2'}));
  await writeFile(join(a,'index.js'),'');await writeFile(join(b,'index.js'),'');
  const rows=await collectEmbeddedPackages({projectRoot:root,files:[
    {path:join(a,'index.js'),group:'main'}, {path:join(b,'index.js'),group:'main'},
    {path:join(a,'index.js'),group:'renderer'},
  ]});
  assert.equal(rows.length,2);assert.deepEqual(rows.find(x=>x.version==='1')?.groups,['main','renderer']);
  assert.deepEqual(rows.find(x=>x.version==='2')?.groups,['main']);
});

test('rejects unresolved package metadata instead of silently omitting it',async()=>{
  const root=await mkdtemp(join(tmpdir(),'clipnote-embedded-'));
  const dir=join(root,'node_modules','missing');await mkdir(dir,{recursive:true});await writeFile(join(dir,'index.js'),'');
  await assert.rejects(collectEmbeddedPackages({projectRoot:root,files:[{path:join(dir,'index.js'),group:'main'}]}),/metadata/i);
});
