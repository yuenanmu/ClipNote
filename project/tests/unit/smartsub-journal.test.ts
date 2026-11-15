import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SmartSubJournal} from '../../src/modules/smartsub/journal.ts';

test('persist submission identity before calling CLI and resume without storing the private URL',async t=>{
  const own=await mkdtemp(join(tmpdir(),'clipnote-journal-'));t.after(()=>rm(own,{recursive:true,force:true}));
  const url='https://example.invalid/private?token=synthetic-secret',cache=join(own,'cache'),journal=new SmartSubJournal(join(own,'state'));
  const prepared=await journal.prepare(url,cache);assert.equal(prepared.status,'prepared');
  const bytes=await readFile(join(own,'state',prepared.requestId+'.json'),'utf8');assert.ok(!bytes.includes('synthetic-secret'));
  const reopened=await new SmartSubJournal(join(own,'state')).reopen(prepared.requestId);assert.deepEqual(reopened,prepared);
  const retry=await journal.request(prepared.requestId,url,cache);assert.equal(retry.requestId,prepared.requestId);
  await assert.rejects(journal.request(prepared.requestId,url+'x',cache));
  await assert.rejects(journal.request(prepared.requestId,url,cache+'other'));
  await journal.submitted(prepared.requestId,'external-123');const running=await journal.observe(prepared.requestId,'running');
  assert.equal(running.taskId,'external-123');assert.equal(running.status,'running');
  await assert.rejects(journal.submitted(prepared.requestId,'other-task'));
  await assert.rejects(journal.observe(prepared.requestId,'invented'));
  assert.equal((await journal.reopen(prepared.requestId)).status,'running');
});
