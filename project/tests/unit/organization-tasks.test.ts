import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createOrganizationTasks, classifyDiagnosticError } from '../../src/main/organization-tasks.ts';

test('both services retain comparable wait, reception and local processing durations', () => {
  for (const service of ['api', 'subscription'] as const) {
    let now = 100;
    const tasks = createOrganizationTasks(() => now);
    const id = tasks.start(service);
    now = 110; tasks.event(id, {phase:'request'});
    now = 120; tasks.event(id, {phase:'headers'});
    now = 170; tasks.event(id, {phase:'first_text'});
    now = 190; tasks.event(id, {phase:'received'});
    now = 200; tasks.event(id, {phase:'validating'});
    now = 240; tasks.event(id, {phase:'saving'});
    now = 300; tasks.event(id, {phase:'saved'});
    tasks.finish(id, 'succeeded');
    const events = tasks.get(id)!.events;
    const time = (phase:string) => events.find(event => event.phase === phase)!.elapsedMs;
    assert.equal(time('first_text') - time('headers'), 50);
    assert.equal(time('received') - time('first_text'), 20);
    assert.equal(time('saving') - time('validating'), 40);
    assert.equal(time('saved') - time('saving'), 60);
  }
});

test('records timings without text and rejects late events after terminal state', () => {
  let now = 100;
  const tasks = createOrganizationTasks(() => now);
  const id = tasks.start('api');
  now = 120;
  tasks.event(id, { phase: 'headers' });
  now = 150;
  tasks.event(id, { phase: 'first_text' });
  now = 210;
  tasks.finish(id, 'failed', 'network');
  tasks.event(id, { phase: 'saved' });
  tasks.finish(id, 'succeeded');
  const result = tasks.get(id)!;
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.events.map(event => event.phase), ['preparing', 'headers', 'first_text', 'failed']);
  assert.deepEqual(result.events.map(event => event.elapsedMs), [0, 20, 50, 110]);
  assert.equal(tasks.list().length, 1);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('diagnostics reject untrusted data and bound retained history', () => {
  const tasks = createOrganizationTasks(() => 100);
  const id = tasks.start('api');
  for (let i = 0; i < 2000; i++) tasks.event(id, { phase: 'last_text', secret: 'private-text' } as any);
  tasks.event(id, { phase: 'private-text' } as any);
  tasks.finish(id, 'failed', 'private-text');
  const value = tasks.get(id)!;
  assert.ok(value.events.length <= 128);
  assert.ok(!JSON.stringify(value).includes('private-text'));
  assert.equal(value.events.at(-1)?.phase, 'failed');
});

test('snapshot copies cannot mutate stored diagnostics', () => {
  const tasks = createOrganizationTasks(() => 100);
  const id = tasks.start('subscription');
  const first = tasks.get(id)!;
  first.events[0].elapsedMs = 999;
  tasks.list()[0].events.length = 0;
  assert.equal(tasks.get(id)?.events[0].elapsedMs, 0);
});

test('a staged subscription result is pending until its actual save completes', () => {
  let now = 0;
  const tasks = createOrganizationTasks(() => now);
  const id = tasks.start('subscription');
  tasks.pending(id, 'result-id');
  assert.equal(tasks.get(id)?.status, 'awaiting_save');
  now = 10;
  tasks.saveStarted('result-id');
  now = 30;
  tasks.saveFinished('result-id');
  const result = tasks.get(id)!;
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.events.map(event => event.phase), ['preparing', 'awaiting_save', 'saving', 'saved', 'succeeded']);
  assert.equal(result.events.at(-2)?.elapsedMs, 30);
});

test('failed save remains pending and a later save may succeed', () => {
  const tasks = createOrganizationTasks(() => 10);
  const id = tasks.start('subscription');
  tasks.pending(id, 'result-id');
  tasks.saveStarted('result-id');
  tasks.saveFailed('result-id');
  assert.equal(tasks.get(id)?.status, 'awaiting_save');
  assert.equal(tasks.get(id)?.error, 'saving');
  tasks.saveStarted('result-id');
  tasks.saveFinished('result-id');
  assert.equal(tasks.get(id)?.status, 'succeeded');
  assert.equal(tasks.get(id)?.error, undefined);
});

test('retains first and latest text timestamps when rapid chunks exceed event limit', () => {
  let now = 0;
  const tasks = createOrganizationTasks(() => now);
  const id = tasks.start('api');
  tasks.event(id, {phase:'request'});
  tasks.event(id, {phase:'headers'});
  now = 5; tasks.event(id, {phase:'first_text'});
  for (let i=0;i<2000;i++) { now++; tasks.event(id, {phase:'last_text'}); }
  tasks.finish(id,'failed','network');
  const events=tasks.get(id)!.events;
  assert.ok(events.some(event=>event.phase==='request'));
  assert.ok(events.some(event=>event.phase==='headers'));
  assert.ok(events.some(event=>event.phase==='first_text' && event.elapsedMs===5));
  assert.equal(events.filter(event=>event.phase==='last_text').at(-1)?.elapsedMs,2005);
  assert.ok(events.length<=128);
});

test('classifies known errors without retaining untrusted error details', () => {
  assert.equal(classifyDiagnosticError({code:'TIMEOUT',message:'private'}), 'timeout');
  assert.equal(classifyDiagnosticError({code:'stream_interrupted',message:'private'}), 'network');
  assert.equal(classifyDiagnosticError({code:'AUTH_FAILED'}), 'authentication');
  assert.equal(classifyDiagnosticError({code:'INVALID_REFERENCE'}), 'validation');
  assert.equal(classifyDiagnosticError({code:'private'}), 'unknown');
});

test('completed tasks are evicted while active and pending tasks remain queryable', () => {
  const tasks=createOrganizationTasks(()=>0);
  const active=tasks.start('api');
  const awaiting=tasks.start('subscription');tasks.pending(awaiting,'pending-result');
  for(let i=0;i<300;i++){const id=tasks.start('api');tasks.finish(id,'succeeded');}
  assert.ok(tasks.list().length<=256);
  assert.ok(tasks.get(active));assert.ok(tasks.get(awaiting));
  tasks.saveFinished('pending-result');assert.equal(tasks.get(awaiting)?.status,'succeeded');
});

test('pending diagnostics are bounded even when results are never saved', () => {
  const tasks=createOrganizationTasks(()=>0);
  for(let i=0;i<300;i++){const id=tasks.start('subscription');tasks.pending(id,`pending-${i}`);}
  assert.ok(tasks.list().length<=256);
  tasks.saveFinished('pending-0');
  assert.equal(tasks.list().length,256);
});

test('snapshots identify the selected source and change revision as events arrive',()=>{
 const tasks=createOrganizationTasks(()=>0);
 const sourceId='12345678-1234-4234-8234-123456789abc';
 const id=tasks.start('api',sourceId);
 assert.equal(tasks.get(id)?.sourceId,sourceId);
 const initial=tasks.get(id)!.revision;
 tasks.event(id,{phase:'headers'});
 assert.ok(tasks.get(id)!.revision>initial);
});
test('legacy source hashes are retained without accepting arbitrary labels',()=>{
 const tasks=createOrganizationTasks(()=>0),hash='a'.repeat(64);
 assert.equal(tasks.get(tasks.start('api',hash))?.sourceId,hash);
 assert.equal(tasks.get(tasks.start('api','private source'))?.sourceId,undefined);
});
test('coalesced output age is subtracted from the arrival time',()=>{
 let now=100;const tasks=createOrganizationTasks(()=>now);const id=tasks.start('api');
 now=400;tasks.event(id,{phase:'last_text',ageMs:150});
 assert.equal(tasks.get(id)!.events.at(-1)?.elapsedMs,150);
});
test('request count and valid chunk progress remain available in the snapshot',()=>{
 const tasks=createOrganizationTasks(()=>0);const id=tasks.start('api');
 tasks.event(id,{phase:'request'});tasks.event(id,{phase:'request'});
 tasks.progress(id,{requests:2,chunkIndex:1,totalChunks:4});
 const snapshot=tasks.get(id)!;
 assert.equal(snapshot.requests,2);assert.deepEqual(snapshot.chunk,{index:1,total:4});
});
