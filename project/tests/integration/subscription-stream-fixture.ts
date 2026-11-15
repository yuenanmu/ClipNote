import test from 'node:test';
import assert from 'node:assert/strict';
import {streamResponse} from '../../vendor/siwc/src/responses.ts';
import {setSubscriptionTransport} from '../../vendor/siwc/src/transport.ts';
const sse=(events:unknown[])=>new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{status:200,headers:{'Content-Type':'text/event-stream'}});
test('only a completed stream returns text and uses the nonstored streaming request',async()=>{
 let body:any;setSubscriptionTransport(async (_input,init)=>{body=JSON.parse(String(init?.body));return sse([{type:'response.output_text.delta',delta:'合成'}, {type:'response.completed',response:{status:'completed'}}]);});
 const result=await streamResponse('synthetic-token',{model:'fixture',input:'source'},new AbortController().signal);assert.equal(result.text,'合成');assert.equal(body.store,false);assert.equal(body.stream,true);assert.equal(body.model,'fixture');
});
test('partial or explicitly incomplete streams never return partial text',async()=>{
 for(const events of [[{type:'response.output_text.delta',delta:'partial'}],[{type:'response.output_text.delta',delta:'partial'},{type:'response.incomplete',response:{status:'incomplete'}}]]){
  setSubscriptionTransport(async()=>sse(events));await assert.rejects(streamResponse('synthetic-token',{model:'fixture',input:'source'},new AbortController().signal),(error:any)=>['stream_interrupted','response_incomplete'].includes(error.code));
 }
});
