import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSource} from '../../src/modules/source/parser.ts';
import {analyzeSubscription} from '../../src/modules/subscription/analyze.ts';

test('subscription analysis validates references and generates a note',async()=>{
 const source=parseSource(Buffer.from('合成资料'),'example.txt');let calls=0;
 const client={getSession:async()=>({status:'connected',sharing:true,profileId:'account'}),streamResponse:async()=>{calls++;const segment=source.segments[0];const refs=[{segmentId:segment.segmentId,startOffset:0,endOffset:segment.text.length}];return {text:JSON.stringify({title:'笔记',sections:[{heading:'主题',refs,items:[{kind:'point',text:'要点',refs,children:[]}]}]})};}};
 const result=await analyzeSubscription(source,client,'account','model');assert.match(result.markdown,/要点/);assert.equal(calls,1);
});

test('subscription analysis preserves quota failure for actionable feedback',async()=>{
 const source=parseSource(Buffer.from('合成资料'),'example.txt');const client={getSession:async()=>({status:'connected',sharing:true,profileId:'account'}),streamResponse:async()=>{throw Object.assign(new Error('private'),{code:'subscription_sharing_usage_limit_exceeded'});}};
 await assert.rejects(analyzeSubscription(source,client,'account','model'),(error:any)=>error.code==='subscription_sharing_usage_limit_exceeded');
});
