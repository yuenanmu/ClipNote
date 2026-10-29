import test from 'node:test';
import assert from 'node:assert/strict';
import { createBatchHandlers } from '../../src/main/batch-controller.ts';
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
const target='33333333-3333-4333-8333-333333333333', config={baseUrl:'https://fixture.invalid',model:'fixture',instructions:''};
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
test('running and failed items retain live progress and timing from the analyzer',async()=>{
  let fail:()=>void=()=>{};
  const h=createBatchHandlers({isTrustedSender:()=>true,config:async()=>config,preview:async(id:string)=>({sourcePath:id,notePath:id+'.md',name:id+'.md',exists:false}),
    analyze:async(_id:any,_config:any,_signal:any,_plan:any,report:any)=>{report({phase:'receiving',requests:1,chunkIndex:0},{prepareMs:2,apiMs:30,localMs:0,saveMs:0,requests:1});await new Promise<void>(resolve=>{fail=resolve;});throw new Error('synthetic failure');},save:async()=>{}});
  await h.prepare('trusted',[ids[0]],target,config);await h.start('trusted');await tick();
  const running:any=await h.state('trusted');assert.equal(running.value.items[0].progress.phase,'receiving');assert.ok(running.value.items[0].startedAt);
  fail();const done=await until(h,'done');assert.equal(done.items[0].timing.requests,1);assert.equal(done.items[0].timing.apiMs,30);assert.ok(done.items[0].finishedAt);
});
async function until(handlers:any,status:string) { for(let i=0;i<100;i++){ const r=await handlers.state('trusted'); if(r.value?.status===status)return r.value; await tick(); } throw new Error('missing batch status'); }
test('batch asks for explicit confirmation, runs serially and continues after failure', async () => {
  let active=0, max=0; const calls:string[]=[], saved:string[]=[];
  const h=createBatchHandlers({ isTrustedSender:(event:unknown)=>event==='trusted', config:async()=>config,
    preview:async(id:string)=>({sourcePath:id,notePath:id+'.md',name:id+'.md',exists:false}),
    analyze:async(id:string)=>{ calls.push(id); max=Math.max(max,++active); await tick(); active--; if(id===ids[0]) throw new Error('fixture'); return {markdown:'# 笔记'}; },
    save:async(id:string)=>{ saved.push(id); } });
  assert.equal((await h.prepare('trusted',ids,target,config)).status,'ok'); assert.deepEqual(calls,[]);
  assert.equal((await h.start('trusted')).status,'ok'); const state=await until(h,'done'); assert.equal(max,1); assert.deepEqual(calls,ids); assert.deepEqual(saved,[ids[1]]); assert.deepEqual(state.items.map((x:any)=>x.status),['failed','succeeded']);
});
test('batch cancel stops queued files and late results are not saved', async () => {
  let saved=0, calls=0; let release:()=>void=()=>{};
  const h=createBatchHandlers({ isTrustedSender:()=>true, config:async()=>config, preview:async(id:string)=>({sourcePath:id,notePath:id+'.md',name:id+'.md',exists:false}),
    analyze:async()=>{ calls++; await new Promise<void>(resolve=>{release=resolve;}); return {markdown:'# 笔记'}; }, save:async()=>{saved++;} });
  await h.prepare('trusted',ids,target,config); await h.start('trusted'); await until(h,'running'); await h.cancel('trusted'); release(); const state=await until(h,'cancelled');
  assert.equal(calls,1); assert.equal(saved,0); assert.equal(state.items[1].status,'cancelled');
});
test('retrying a failed save reuses generated Markdown without another request', async () => {
  let calls=0, saves=0; const h=createBatchHandlers({ isTrustedSender:()=>true, config:async()=>config, preview:async(id:string)=>({sourcePath:id,notePath:id+'.md',name:id+'.md',exists:false}),
    analyze:async()=>{calls++; return {markdown:'# 保存结果'};}, save:async(_id:string,_target:string,_plan:any,text:string)=>{ assert.equal(text,'# 保存结果'); if(++saves===1) throw new Error('disk full'); } });
  await h.prepare('trusted',[ids[0]],target,config); await h.start('trusted'); const failed=await until(h,'done'); assert.equal(failed.items[0].canRetrySave,true); assert.equal(calls,1);
  await h.retry('trusted',[ids[0]]); const done=await until(h,'done'); assert.equal(done.items[0].status,'succeeded'); assert.equal(calls,1); assert.equal(saves,2);
});
test('a target changed after preview is rejected before any model request', async () => {
  let version='old', calls=0; const h=createBatchHandlers({ isTrustedSender:()=>true, config:async()=>config, preview:async(id:string)=>({sourcePath:id,notePath:id+'.md',name:id+'.md',exists:true,checksum:version}), analyze:async()=>{calls++;return {markdown:'# 笔记'};}, save:async()=>{} });
  await h.prepare('trusted',[ids[0]],target,config); version='new'; assert.equal((await h.start('trusted')).status,'error'); assert.equal(calls,0);
});

test('batch retains generated results before saving and releases only its own locks',async()=>{
  let staged=0,completed=0,locked=0,released=0;const h=createBatchHandlers({isTrustedSender:()=>true,config:async()=>config,
    preview:async(id:string)=>({sourcePath:id,notePath:id+'.md',name:'a.md',exists:false}),analyze:async()=>({markdown:'# durable',timing:{prepareMs:5,apiMs:50,localMs:3,requests:2,saveMs:0}}),
    lock:plans=>{assert.equal(plans.length,1);locked++;return()=>{released++;};},stage:async(_plan,text)=>{assert.equal(text,'# durable');staged++;return ids[1];},complete:async id=>{assert.equal(id,ids[1]);completed++;},
    save:async()=>{assert.equal(staged,1);}});
  await h.prepare('trusted',[ids[0]],target,config);await h.start('trusted');const done=await until(h,'done');assert.equal(done.items[0].timing.requests,2);assert.equal(done.items[0].timing.apiMs,50);assert.equal(staged,1);assert.equal(completed,1);assert.equal(locked,1);assert.equal(released,1);
});

test('saving a retained result updates the queue without repeating the model request',async()=>{
  let requests=0;const h=createBatchHandlers({isTrustedSender:()=>true,config:async()=>config,preview:async(id:string)=>({sourcePath:id,notePath:id+'.md',name:'a.md',exists:false}),analyze:async()=>{requests++;return {markdown:'# done'};},stage:async()=>ids[1],save:async()=>{throw new Error('full');}});
  await h.prepare('trusted',[ids[0]],target,config);await h.start('trusted');await until(h,'done');await h.saved('trusted',ids[1],'new.md');const state=await until(h,'done');assert.equal(state.items[0].status,'succeeded');assert.equal(state.items[0].outputPath,'new.md');assert.equal(requests,1);
});
