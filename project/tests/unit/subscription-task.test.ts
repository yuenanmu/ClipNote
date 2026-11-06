import test from 'node:test';
import assert from 'node:assert/strict';
import {createSubscriptionTask} from '../../src/main/subscription-task.ts';
const id='12345678-1234-4234-8234-123456789abc';
test('confirmation rejects changed source and only stages completed output',async()=>{
 let checksum='one',staged=0,analyzed=0;
 const task=createSubscriptionTask({trusted:()=>true,session:async()=>({status:'connected',sharing:true,profileId:'account'}),models:async()=>[{slug:'model'}],preview:async()=>({sourcePath:'source',notePath:'note',name:'note',exists:false,sourceChecksum:checksum}),analyze:async()=>{analyzed++;return 'generated';},stage:async()=>{staged++;return id;}});
 assert.equal((await task.prepare(null,id,id,'model','')).status,'ok');checksum='two';assert.equal((await task.start(null)).status,'error');assert.equal(analyzed,0);
 await task.prepare(null,id,id,'model','');assert.equal((await task.start(null)).status,'ok');await new Promise(resolve=>setTimeout(resolve,0));assert.equal((await task.state(null) as any).value.status,'done');assert.equal(staged,1);
});

test('cancelling a confirmation invalidates it and prevents sending',async()=>{
 let analyzed=0;const task=createSubscriptionTask({trusted:()=>true,session:async()=>({status:'connected',sharing:true,profileId:'account'}),models:async()=>[{slug:'model'}],preview:async()=>({sourcePath:'source',notePath:'note',name:'note',exists:false}),analyze:async()=>{analyzed++;return 'x';},stage:async()=>id});
 await task.prepare(null,id,id,'model','');await task.cancel(null);assert.equal((await task.start(null)).status,'error');assert.equal(analyzed,0);
});

test('cancellation during preflight prevents the request from starting',async()=>{
 let release!:()=>void;let checking=false,analyzed=0;const task=createSubscriptionTask({trusted:()=>true,session:async()=>({status:'connected',sharing:true,profileId:'account'}),models:async()=>{if(checking)await new Promise<void>(resolve=>{release=resolve;});return [{slug:'model'}];},preview:async()=>({sourcePath:'source',notePath:'note',name:'note',exists:false}),analyze:async()=>{analyzed++;return 'x';},stage:async()=>id});
 await task.prepare(null,id,id,'model','');checking=true;const pending=task.start(null);await new Promise(resolve=>setTimeout(resolve,0));await task.cancel(null);release();assert.equal((await pending).status,'error');assert.equal(analyzed,0);
});

test('cancelling preparation prevents an old confirmation appearing later',async()=>{
 let release!:()=>void;const task=createSubscriptionTask({trusted:()=>true,session:async()=>({status:'connected',sharing:true,profileId:'account'}),models:async()=>[{slug:'model'}],preview:async()=>{await new Promise<void>(resolve=>{release=resolve;});return {sourcePath:'source',notePath:'note',name:'note',exists:false};},analyze:async()=> 'x',stage:async()=>id});
 const preparing=task.prepare(null,id,id,'model','');await new Promise(resolve=>setTimeout(resolve,0));await task.cancel(null);release();assert.equal((await preparing).status,'error');assert.equal((await task.start(null)).status,'error');
});

test('quota failures show a safe message and never stage output',async()=>{
 let staged=0;const task=createSubscriptionTask({trusted:()=>true,session:async()=>({status:'connected',sharing:true,profileId:'account'}),models:async()=>[{slug:'model'}],preview:async()=>({sourcePath:'source',notePath:'note',name:'note',exists:false}),analyze:async()=>{throw Object.assign(new Error('private detail'),{code:'subscription_sharing_usage_limit_exceeded'});},stage:async()=>{staged++;return id;}});
 await task.prepare(null,id,id,'model','');await task.start(null);await new Promise(resolve=>setTimeout(resolve,0));const result=await task.state(null);assert.equal(result.status,'ok');if(result.status!=='ok')throw new Error('state failed');assert.equal(result.value.status,'failed');assert.match(result.value.error,/额度/);assert.doesNotMatch(JSON.stringify(result),/private detail/);assert.equal(staged,0);
});

test('confirmation presents the verified account label without exposing extra identity fields',async()=>{
 const task=createSubscriptionTask({trusted:()=>true,session:async()=>({status:'connected',sharing:true,profileId:'account',identity:{email:'person@example.test',secret:'private'}}),models:async()=>[{slug:'model'}],preview:async()=>({sourcePath:'source',notePath:'note',name:'note',exists:false}),analyze:async()=> 'x',stage:async()=>id});
 const result=await task.prepare(null,id,id,'model','');assert.equal(result.status,'ok');if(result.status!=='ok')throw new Error('prepare failed');assert.equal(result.value.accountLabel,'person@example.test');assert.doesNotMatch(JSON.stringify(result),/private/);
});
