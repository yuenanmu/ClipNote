import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SmartSubTasks} from '../../src/modules/smartsub/tasks.ts';

test('submits once, observes real status and reads task-owned subtitles',async t=>{
  const root=await mkdtemp(join(tmpdir(),'clipnote-task-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const calls:string[]=[];let taskPath='';
  const service=new SmartSubTasks(root,async(op,input:any)=>{calls.push(op);
    if(op==='downloads.start'){taskPath=input.config.savePath;await writeFile(join(taskPath,'字幕.srt'),'1\n00:00:01,000 --> 00:00:02,000\n合成资料\n');return {id:'task-1',status:'running'};}
    if(op==='tasks.get')return {id:'task-1',status:'completed',result:{downloadEntries:[{subtitlePaths:[join(taskPath,'字幕.srt')]}]}};
    if(op==='subtitles.read')return {filePath:input.filePath,version:'v1',format:'srt',total:1,offset:0,cues:[{startMs:1000,endMs:2000,text:'合成资料'}]};
    throw Error('unexpected operation');
  });
  const started=await service.start('https://example.com/video');assert.equal(started.status,'running');
  const observed=await service.refresh(started.requestId);assert.equal(observed.status,'completed');assert.equal(observed.subtitleCount,1);
  const subtitle=await service.subtitle(started.requestId,0);assert.equal(subtitle.document.segments[0].text,'合成资料');
  assert.deepEqual(calls,['downloads.start','tasks.get','tasks.get','subtitles.read']);
});

test('cancel targets only the recorded task and does not invent a terminal state',async t=>{
  const root=await mkdtemp(join(tmpdir(),'clipnote-task-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const calls:any[]=[];const service=new SmartSubTasks(root,async(op,input)=>{calls.push([op,input]);if(op==='downloads.start')return {id:'target',status:'running'};if(op==='tasks.cancel')return {id:'target',status:'cancelling'};throw Error('unexpected');});
  const task=await service.start('https://example.com/video');const cancelled=await service.cancel(task.requestId);assert.equal(cancelled.status,'cancelling');assert.deepEqual(calls[1],['tasks.cancel',{id:'target'}]);
});
test('an unknown submission outcome is retried with the original request identity',async t=>{
  const root=await mkdtemp(join(tmpdir(),'clipnote-resume-'));t.after(()=>rm(root,{recursive:true,force:true}));const ids:string[]=[];
  const invoke=async(op:string,input:any)=>{assert.equal(op,'downloads.start');ids.push(input.requestId);if(ids.length===1)throw new Error('connection lost');return {id:'same-external-task',status:'queued'};};
  const service=new SmartSubTasks(root,invoke),prepared=await service.prepare('https://example.com/video');
  await assert.rejects(service.submit(prepared.requestId,'https://example.com/video'));
  const resumed=await new SmartSubTasks(root,invoke).submit(prepared.requestId,'https://example.com/video');assert.equal(resumed.status,'queued');assert.deepEqual(ids,[prepared.requestId,prepared.requestId]);
  await assert.rejects(service.submit(prepared.requestId,'https://example.com/other'),/链接或保存位置/);
});
test('refuses recovery and cancellation against a different SmartSub installation or profile',async t=>{
  const root=await mkdtemp(join(tmpdir(),'clipnote-binding-'));t.after(()=>rm(root,{recursive:true,force:true}));let identity='a'.repeat(64),calls=0;
  const service=new SmartSubTasks(root,async()=>{calls++;return {id:'job',status:'running'};},async()=>identity);
  const prepared=await service.prepare('https://example.com/video');identity='b'.repeat(64);
  await assert.rejects(service.submit(prepared.requestId,'https://example.com/video'),/SmartSub.*变化/);assert.equal(calls,0);
  identity='a'.repeat(64);await service.submit(prepared.requestId,'https://example.com/video');identity='b'.repeat(64);
  await assert.rejects(service.refresh(prepared.requestId),/SmartSub.*变化/);await assert.rejects(service.cancel(prepared.requestId),/SmartSub.*变化/);assert.equal(calls,1);
});
