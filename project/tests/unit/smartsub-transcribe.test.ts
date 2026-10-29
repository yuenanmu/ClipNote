import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectTranscription} from '../../src/modules/smartsub/transcription.ts';
import {TranscriptionTasks} from '../../src/modules/smartsub/transcription-tasks.ts';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

test('checks configured local engine and model before transcribing',async()=>{
  const calls:string[]=[];const result=await inspectTranscription(async op=>{calls.push(op);if(op==='settings.get')return {defaults:{transcriptionEngine:'builtin',model:'small'}};if(op==='engines.list')return {builtin:{state:'ready'}};return {modelsInstalled:['small']};});
  assert.deepEqual(result,{ready:true,engine:'builtin',model:'small'});assert.deepEqual(calls,['settings.get','engines.list','models.list']);
});
test('only transcribes a task-owned media after consent and resumes the same request',async t=>{
  const root=await mkdtemp(join(tmpdir(),'clipnote-transcribe-'));t.after(()=>rm(root,{recursive:true,force:true}));const parent=randomUUID(),video=join(root,'sample.mp4');await writeFile(video,'synthetic');
  let count=0;const invoke=async(op:string,input:any):Promise<any>=>{if(op==='settings.get')return {defaults:{transcriptionEngine:'builtin',model:'small'}};if(op==='engines.list')return {builtin:{state:'ready'}};if(op==='models.list')return {modelsInstalled:['small']};if(op==='transcribe'){count++;assert.deepEqual(input.files,[video]);assert.equal(input.engine,'builtin');return {id:'transcription-job',status:'running'};}if(op==='tasks.get')return {id:'transcription-job',status:'running'};throw Error('unexpected');};
  const source=async()=>({id:'download-job',status:'completed' as const,subtitlePaths:[],mediaPaths:[video],hasSubtitles:false});
  const tasks=new TranscriptionTasks(root,invoke,source);const preview=await tasks.preview(parent);assert.equal(preview.ready,true);assert.equal(count,0);
  const submitted=await tasks.submit(parent,'builtin','small');assert.equal(submitted.status,'running');assert.equal(count,1);
  const resumed=await new TranscriptionTasks(root,invoke,source).submit(parent,'builtin','small');assert.equal(resumed.status,'running');assert.equal(count,1);
  await assert.rejects(tasks.submit(parent,'builtin','other'));
});
test('never silently selects cloud or downloads missing models',async()=>{
  const cloud=await inspectTranscription(async op=>op==='settings.get'?{defaults:{transcriptionEngine:'cloud',model:'m'}}:{});assert.equal(cloud.ready,false);
  const missing=await inspectTranscription(async op=>op==='settings.get'?{defaults:{transcriptionEngine:'builtin',model:'small'}}:op==='engines.list'?{builtin:{state:'ready'}}:{modelsInstalled:[]});assert.equal(missing.ready,false);
});
test('does not transcribe when the download already has an unsupported subtitle',async t=>{
  const root=await mkdtemp(join(tmpdir(),'clipnote-existing-sub-'));t.after(()=>rm(root,{recursive:true,force:true}));let calls=0;
  const tasks=new TranscriptionTasks(root,async()=>{calls++;return {};},async()=>({id:'job',status:'completed',subtitlePaths:[],mediaPaths:[join(root,'video.mp4')],hasSubtitles:true}));
  const result=await tasks.preview(randomUUID());assert.equal(result.ready,false);assert.equal(calls,0);
});
test('a terminal failure can be retried on the same media with a new request ID',async t=>{
  const root=await mkdtemp(join(tmpdir(),'clipnote-retry-'));t.after(()=>rm(root,{recursive:true,force:true}));const parent=randomUUID(),video=join(root,'sample.mp4');await writeFile(video,'synthetic');const ids:string[]=[];
  const invoke=async(op:string,input:any):Promise<any>=>{if(op==='settings.get')return {defaults:{transcriptionEngine:'builtin',model:'small'}};if(op==='engines.list')return {builtin:{state:'ready'}};if(op==='models.list')return {modelsInstalled:['small']};if(op==='transcribe'){ids.push(input.requestId);return {id:'job-'+ids.length,status:'running'};}if(op==='tasks.get')return {id:input.id,status:'failed'};throw Error('unexpected');};
  const source=async()=>({id:'download-job',status:'completed' as const,subtitlePaths:[],mediaPaths:[video],hasSubtitles:false});const tasks=new TranscriptionTasks(root,invoke,source);
  await tasks.submit(parent,'builtin','small');await tasks.refresh(parent);await tasks.retry(parent,'builtin','small');assert.equal(ids.length,2);assert.notEqual(ids[0],ids[1]);
});
test('a lost retry receipt resumes the new request without creating another one',async t=>{
  const root=await mkdtemp(join(tmpdir(),'clipnote-retry-lost-'));t.after(()=>rm(root,{recursive:true,force:true}));const parent=randomUUID(),video=join(root,'sample.mp4');await writeFile(video,'synthetic');const ids:string[]=[];
  const invoke=async(op:string,input:any):Promise<any>=>{if(op==='settings.get')return {defaults:{transcriptionEngine:'builtin',model:'small'}};if(op==='engines.list')return {builtin:{state:'ready'}};if(op==='models.list')return {modelsInstalled:['small']};if(op==='transcribe'){ids.push(input.requestId);if(ids.length===2)throw Error('connection lost');return {id:'job-'+ids.length,status:'running'};}if(op==='tasks.get')return {id:input.id,status:'failed'};throw Error('unexpected');};
  const tasks=new TranscriptionTasks(root,invoke,async()=>({id:'download',status:'completed',subtitlePaths:[],mediaPaths:[video],hasSubtitles:false}));
  await tasks.submit(parent,'builtin','small');await tasks.refresh(parent);await assert.rejects(tasks.retry(parent,'builtin','small'));await tasks.submit(parent,'builtin','small');assert.equal(ids.length,3);assert.equal(ids[1],ids[2]);assert.notEqual(ids[0],ids[1]);
});
