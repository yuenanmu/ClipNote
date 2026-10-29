import test from 'node:test';
import assert from 'node:assert/strict';
import {createSmartSubTaskHandlers} from '../../src/main/smartsub-task-controller.ts';

test('task bridge rejects untrusted callers and arbitrary arguments',async()=>{
  const calls:unknown[]=[];
  const handlers=createSmartSubTaskHandlers({isTrustedSender:(event:unknown)=>event==='trusted',prepare:async (url:string)=>{calls.push(url);return {requestId:'id'};},submit:async()=>({}),refresh:async()=>({}),cancel:async()=>({}),importSubtitle:async()=>({})} as any);
  assert.equal((await handlers.prepare('other','https://example.com')).status,'error');
  assert.equal((await handlers.prepare('trusted','https://example.com','extra')).status,'error');
  assert.equal((await handlers.prepare('trusted',{})).status,'error');
  assert.deepEqual(calls,[]);
  assert.equal((await handlers.prepare('trusted','https://example.com')).status,'ok');
  assert.deepEqual(calls,['https://example.com']);
});
