import test from 'node:test';
import assert from 'node:assert/strict';
import {streamResponse} from '../../vendor/siwc/src/responses.ts';
import {setSubscriptionTransport} from '../../vendor/siwc/src/transport.ts';
import {parseSource} from '../../src/modules/source/parser.ts';
import {analyzeSubscription} from '../../src/modules/subscription/analyze.ts';
const sse=(events:unknown[])=>new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{status:200,headers:{'Content-Type':'text/event-stream'}});
test('subscription rate limit is returned without retry or private response details',async()=>{
 let requests=0;
 setSubscriptionTransport(async()=>{requests++;return Response.json({error:{message:'private server detail'}},{status:429});});
 await assert.rejects(streamResponse('synthetic-token',{model:'fixture',input:'source'},new AbortController().signal),(error:any)=>error.status===429 && !JSON.stringify(error).includes('private server detail'));
 assert.equal(requests,1);
});
test('subscription first output deadline ignores whitespace',async()=>{
 setSubscriptionTransport(async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'response.output_text.delta',delta:' '})+'\n\n'));setTimeout(()=>{try{controller.close();}catch{}},200);}}),{headers:{'Content-Type':'text/event-stream'}}));
 await assert.rejects(streamResponse('synthetic-token',{model:'fixture',input:'source',deadline:{firstOutputMs:50,idleMs:50,requestMs:500}},new AbortController().signal),(error:any)=>error.code==='FIRST_OUTPUT_TIMEOUT');
});
test('subscription distinguishes idle output from the hard request deadline',async()=>{
 for(const scenario of ['idle','request'] as const){
  let timer:ReturnType<typeof setInterval>|undefined;
  setSubscriptionTransport(async()=>new Response(new ReadableStream({start(controller){
   const send=(delta:string)=>controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'response.output_text.delta',delta})+'\n\n'));
   send('text');
   timer=setInterval(()=>{try{send(scenario==='idle'?' ':'text');}catch{}},20);
  },cancel(){if(timer)clearInterval(timer);}}),{headers:{'Content-Type':'text/event-stream'}}));
  try{
   await assert.rejects(streamResponse('synthetic-token',{model:'fixture',input:'source',deadline:{firstOutputMs:200,idleMs:60,requestMs:150}},new AbortController().signal),(error:any)=>error.code===(scenario==='idle'?'STREAM_IDLE_TIMEOUT':'REQUEST_TIMEOUT'));
  }finally{if(timer)clearInterval(timer);}
 }
});
test('subscription analysis reports actual stream headers, nonblank text and validation without leaking content',async()=>{
 const source=parseSource(Buffer.from('private source'),'fixture.txt');const segment=source.segments[0];
 const refs=[{segmentId:segment.segmentId,startOffset:0,endOffset:segment.text.length}];
 const value=JSON.stringify({title:'private title',sections:[{heading:'private heading',refs,items:[{kind:'point',text:'private note',refs,children:[]}]}]});
 setSubscriptionTransport(async()=>sse([{type:'response.output_text.delta',delta:'  '},{type:'response.output_text.delta',delta:value},{type:'response.completed',response:{status:'completed'}}]));
 const client={getSession:async()=>({status:'connected',sharing:true,profileId:'fixture'}),streamResponse:(options:any)=>streamResponse('synthetic-token',options,new AbortController().signal)};
 const phases:string[]=[];
 const result=await analyzeSubscription(source,client,'fixture','fixture',{onDiagnostic:phase=>phases.push(phase)});
 assert.match(result.markdown,/private note/);
 assert.deepEqual(phases,['request','headers','first_text','last_text','received','validating']);
 assert.doesNotMatch(JSON.stringify(phases),/private|token/);
});
test('interrupted subscription stream retains phases and never reports completion',async()=>{
 const source=parseSource(Buffer.from('private source'),'fixture.txt');
 setSubscriptionTransport(async()=>sse([{type:'response.output_text.delta',delta:'partial private'}]));
 const client={getSession:async()=>({status:'connected',sharing:true,profileId:'fixture'}),streamResponse:(options:any)=>streamResponse('synthetic-token',options,new AbortController().signal)};
 const phases:string[]=[];
 await assert.rejects(analyzeSubscription(source,client,'fixture','fixture',{onDiagnostic:phase=>phases.push(phase)}),(error:any)=>error.code==='stream_interrupted');
 assert.deepEqual(phases,['request','headers','first_text','last_text']);
 assert.doesNotMatch(JSON.stringify(phases),/private|token/);
});
test('only a completed stream returns text and uses the nonstored streaming request',async()=>{
 let body:any;setSubscriptionTransport(async (_input,init)=>{body=JSON.parse(String(init?.body));return sse([{type:'response.output_text.delta',delta:'合成'}, {type:'response.completed',response:{status:'completed'}}]);});
 const result=await streamResponse('synthetic-token',{model:'fixture',input:'source'},new AbortController().signal);assert.equal(result.text,'合成');assert.equal(body.store,false);assert.equal(body.stream,true);assert.equal(body.model,'fixture');
});
test('partial or explicitly incomplete streams never return partial text',async()=>{
 for(const events of [[{type:'response.output_text.delta',delta:'partial'}],[{type:'response.output_text.delta',delta:'partial'},{type:'response.incomplete',response:{status:'incomplete'}}]]){
  setSubscriptionTransport(async()=>sse(events));await assert.rejects(streamResponse('synthetic-token',{model:'fixture',input:'source'},new AbortController().signal),(error:any)=>['stream_interrupted','response_incomplete'].includes(error.code));
 }
});
