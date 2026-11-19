import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {VideoQueue} from '../../src/modules/smartsub/video-queue.ts';
import type {SmartSubTaskView} from '../../src/contracts/smartsub.ts';

test('a download overlaps exactly one transcription and restart waits before new work',async t=>{
  const base=fileURLToPath(new URL('../../../.local/test-artifacts/',import.meta.url));
  await mkdir(base,{recursive:true});const own=await mkdtemp(join(base,'video-queue-'));
  t.after(()=>rm(own,{recursive:true,force:true}));
  const path=join(own,'queue.json');
  const active=(requestId:string,status:SmartSubTaskView['status'], subtitleCount=0)=>({requestId,status,subtitleCount,hasSubtitles:subtitleCount>0});
  const submitted:string[]=[], transcribed:string[]=[], queried:string[]=[];
  const deps={
    encrypt:async (value:string)=>Buffer.from(value).toString('base64'),
    decrypt:async (value:string)=>Buffer.from(value,'base64').toString('utf8'),
    prepare:async()=>{},
    download:async (id:string,url:string)=>{submitted.push(url);return url.endsWith('/a') ? active(id,'completed') : active(id,'running');},
    downloadStatus:async(id:string)=>{queried.push(id);return active(id,'completed',1);},
    transcriptionReady:async()=>({ready:true as const,engine:'builtin',model:'medium'}),
    transcribe:async(id:string)=>{transcribed.push(id);return active(id,'running');},
    transcriptionStatus:async(id:string)=>active(id,'running'),
    cancelDownload:async(id:string)=>active(id,'cancelled'),
    cancelTranscription:async(id:string)=>active(id,'cancelled'),
    selection:async()=>({engine:'builtin', model:'medium'}),
  };
  const links=['https://example.invalid/a','https://example.invalid/b','https://example.invalid/c'];
  const queue=new VideoQueue(path,deps);
  await queue.add(links.join('\n'),true);
  await queue.tick();await queue.tick();
  const before=await queue.state();
  assert.deepEqual(before.items.map(row=>row.stage),['transcribing','downloading','queued']);
  assert.deepEqual(submitted,links.slice(0,2));assert.equal(transcribed.length,1);
  assert.doesNotMatch(await readFile(path,'utf8'),/https:\/\/example\.invalid/);
  const restarted=new VideoQueue(path,deps);
  await restarted.tick();await restarted.tick();
  assert.deepEqual(submitted,links.slice(0,2));assert.equal(queried.length,1);assert.equal(transcribed.length,1);
  assert.equal((await restarted.state()).paused,true);
  await restarted.resume();await restarted.tick();
  assert.deepEqual(submitted,links);
  assert.equal((await restarted.state()).items[1].stage,'ready');
});

test('cancel of a confirmed task can proceed when querying its status fails',async t=>{
  const base=fileURLToPath(new URL('../../../.local/test-artifacts/',import.meta.url));
  await mkdir(base,{recursive:true});const own=await mkdtemp(join(base,'queue-cancel-'));
  t.after(()=>rm(own,{recursive:true,force:true}));
  const task=(requestId:string,status:SmartSubTaskView['status'])=>({requestId,status,subtitleCount:0,hasSubtitles:false});
  const queue=new VideoQueue(join(own,'queue.json'),{
    encrypt:async link=>Buffer.from(link).toString('base64'),
    decrypt:async link=>Buffer.from(link,'base64').toString('utf8'),
    selection:async()=>undefined,
    prepare:async()=>{},
    download:async id=>task(id,'running'),
    downloadStatus:async()=>{throw new Error('synthetic query failure');},
    cancelDownload:async id=>task(id,'cancelled'),
    transcriptionReady:async()=>({ready:false,reason:'fixture'}),
    transcribe:async id=>task(id,'running'),
    transcriptionStatus:async id=>task(id,'running'),
    cancelTranscription:async id=>task(id,'cancelled'),
  });
  await queue.add('https://example.invalid/link',true);
  await queue.tick();
  await queue.tick();
  const [active]=(await queue.state()).items;
  assert.equal(active.stage,'downloading');
  assert.match(active.message??'',/无法确认/);
  await queue.cancel(active.id);
  await queue.tick();
  assert.equal((await queue.state()).items[0].stage,'cancelled');
});

test('a failed transcription leaves other results usable and can retry after the model becomes available',async t=>{
  const base=fileURLToPath(new URL('../../../.local/test-artifacts/',import.meta.url));
  await mkdir(base,{recursive:true});const own=await mkdtemp(join(base,'queue-retry-'));
  t.after(()=>rm(own,{recursive:true,force:true}));
  const task=(requestId:string,status:SmartSubTaskView['status'],subtitleCount=0)=>({requestId,status,subtitleCount,hasSubtitles:subtitleCount>0});
  const selection={engine:'builtin',model:'medium'};
  const attempts:{id:string;retry:boolean}[]=[];
  let modelAvailable=true;
  const queue=new VideoQueue(join(own,'queue.json'),{
    encrypt:async link=>Buffer.from(link).toString('base64'),
    decrypt:async link=>Buffer.from(link,'base64').toString('utf8'),
    selection:async()=>selection,
    prepare:async()=>{},
    download:async(id,url)=>task(id,'completed',url.endsWith('/second')?1:0),
    downloadStatus:async id=>task(id,'completed'),
    cancelDownload:async id=>task(id,'cancelled'),
    transcriptionReady:async()=>modelAvailable?{ready:true,...selection}:{ready:false,reason:'模型未安装'},
    transcribe:async(id,_selection,attemptId,retry)=>{
      attempts.push({id:attemptId,retry});
      return retry?task(id,'completed',1):task(id,'failed');
    },
    transcriptionStatus:async id=>task(id,'failed'),
    cancelTranscription:async id=>task(id,'cancelled'),
  });
  await queue.add('https://example.invalid/first\nhttps://example.invalid/second',true);
  await queue.tick();await queue.tick();
  const first=(await queue.state()).items[0];
  const afterFailure=(await queue.state()).items;
  assert.deepEqual(afterFailure.map(item=>item.stage),['failed','ready'],JSON.stringify(afterFailure.map(item=>item.message)));
  modelAvailable=false;
  await queue.retry(first.id);await queue.tick();
  assert.equal((await queue.state()).items[0].stage,'blocked');
  modelAvailable=true;
  await queue.retry(first.id);await queue.tick();
  assert.deepEqual((await queue.state()).items.map(item=>item.stage),['ready','ready']);
  assert.deepEqual(attempts.map(attempt=>attempt.retry),[false,true]);
  assert.notEqual(attempts[0].id,attempts[1].id);
});
