import test from 'node:test';
import assert from 'node:assert/strict';
import {observeSmartSubTask} from '../../src/renderer/smartsub-observer.ts';

test('task observer waits for each response, continues after errors and stops at real terminal state',async()=>{
  let scheduled:(()=>void)|undefined, calls=0;const received:string[]=[],errors:string[]=[];
  const stop=observeSmartSubTask(async()=>{calls++;if(calls===1)throw Error('offline');return {status:calls===2?'running':'completed'};},value=>received.push(value.status),e=>errors.push(e.message),{schedule:fn=>{scheduled=fn;return ()=>{scheduled=undefined;};}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);assert.deepEqual(errors,['offline']);assert.equal(received.length,0);
  const next=scheduled!;scheduled=undefined;next();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(received,['running']);
  scheduled!();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(received,['running','completed']);assert.equal(calls,3);stop();
});

test('a slow poll schedules no second query until it finishes, and terminal replies leave no timer',async()=>{
  let release!:(value:{status:string})=>void,calls=0,scheduled=0;
  observeSmartSubTask(()=>{calls++;return new Promise<{status:string}>(resolve=>{release=resolve;});},()=>{},()=>{}, {schedule:()=>{scheduled++;return ()=>{};}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);assert.equal(scheduled,0);
  release({status:'completed'});await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);assert.equal(scheduled,0);
});
test('stopping an observer suppresses an in-flight reply without cancelling the shared task',async()=>{
  let finish!:(value:{status:string})=>void;let notifications=0,schedules=0;
  const stop=observeSmartSubTask(()=>new Promise<{status:string}>(resolve=>{finish=resolve;}),()=>notifications++,()=>notifications++,{schedule:()=>{schedules++;return ()=>{};}});
  stop();finish({status:'running'});await new Promise(resolve=>setImmediate(resolve));assert.equal(notifications,0);assert.equal(schedules,0);
});

test('manual refresh shares the pending query and replaces a delayed poll without overlap',async()=>{
  let release!:(value:{status:string})=>void,calls=0,timer:(()=>void)|undefined;
  const stop=observeSmartSubTask(()=>{calls++;return new Promise<{status:string}>(resolve=>{release=resolve;});},()=>{},()=>{}, {schedule:fn=>{timer=fn;return()=>{timer=undefined;};}});
  try{stop.refresh();stop.refresh();assert.equal(calls,1);release({status:'running'});await new Promise(resolve=>setImmediate(resolve));assert.ok(timer);stop.refresh();assert.equal(timer,undefined);assert.equal(calls,2);stop.refresh();assert.equal(calls,2);release({status:'completed'});await new Promise(resolve=>setImmediate(resolve));assert.equal(timer,undefined);}finally{stop();}
});
