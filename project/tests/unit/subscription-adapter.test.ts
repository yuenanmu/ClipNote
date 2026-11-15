import test from 'node:test';
import assert from 'node:assert/strict';
import {createSubscriptionAdapter} from '../../src/modules/subscription/adapter.ts';

const request = {chunk:{chunkId:'c',index:0,core:[],context:[],request:'合成来源'},profile:{provider:'subscription',model:'model-a',promptVersion:'v1',inputCharBudget:2000,outputCharBudget:1000,overlapChars:0},repair:false};
test('subscription adapter binds account and model and forwards cancellation', async()=>{
  const signal=new AbortController().signal; let sent:any;
  const client={getSession:async()=>({status:'connected',sharing:true,profileId:'p1'}),streamResponse:async(options:any)=>{sent=options;return {text:'{"title":"ok"}'};}};
  const result=await createSubscriptionAdapter(client,'p1','model-a')({...request,signal});
  assert.equal(sent.model,'model-a'); assert.equal(sent.signal,signal); assert.match(sent.input,/合成来源/); assert.deepEqual(result,{status:'completed',value:'{"title":"ok"}'});
});
test('subscription adapter rejects account changes before and after a response',async()=>{
  let calls=0;const client={getSession:async()=>({status:'connected',sharing:true,profileId:++calls===1?'p1':'p2'}),streamResponse:async()=>({text:'{}'})};
  await assert.rejects(createSubscriptionAdapter(client,'p1','model-a')(request),/账户/);
  calls=1;await assert.rejects(createSubscriptionAdapter(client,'p1','model-a')(request),/账户/);
});
