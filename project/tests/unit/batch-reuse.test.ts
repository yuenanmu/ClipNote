import test from 'node:test';
import assert from 'node:assert/strict';
import { BatchReuse } from '../../src/modules/api/batch-reuse.ts';
import { parseSource } from '../../src/modules/source/parser.ts';
const config={baseUrl:'https://fixture.invalid',model:'fixture',contextWindow:8192,maxTokens:2048,apiKey:'synthetic'};
const signal=new AbortController().signal;
test('three identical copies share generation while content, format, configuration and instructions isolate results',async()=>{
  const reuse=new BatchReuse(); let calls=0;
  const run=(text='same',name='a.txt',settings=config,instructions='')=>reuse.run(parseSource(Buffer.from(text),name),settings,instructions,signal,async()=>{calls++;return '# result';});
  assert.equal((await run()).reused,false);
  assert.equal((await run('same','copy.txt')).reused,true);
  assert.equal((await run('same','third.txt')).reused,true);
  assert.equal(calls,1);
  await run('changed');await run('same','a.md');await run('same','a.txt',{...config,model:'other'});
  await run('same','a.txt',{...config,maxTokens:4096});await run('same','a.txt',config,'more detail');
  assert.equal(calls,6);reuse.clear();await run();assert.equal(calls,7);
});
test('failures and aborted work cannot become cached success',async()=>{
  const reuse=new BatchReuse(),source=parseSource(Buffer.from('same'),'a.txt');let calls=0;
  await assert.rejects(reuse.run(source,config,'',signal,async()=>{throw new Error('failed');}));
  const abort=new AbortController();
  await assert.rejects(reuse.run(source,config,'',abort.signal,async()=>{abort.abort();return '# late';}));
  const result=await reuse.run(source,config,'',signal,async()=>{calls++;return '# good';});
  assert.equal(result.reused,false);assert.equal(calls,1);assert.equal(result.markdown,'# good');
});
test('failed analysis resumes completed checkpoints only for the same batch and input',async()=>{
  const reuse=new BatchReuse(), source=parseSource(Buffer.from('same'),'a.txt');
  const checkpoint={planId:'plan',chunkId:'chunk',outline:{title:'completed',sections:[]}};
  await assert.rejects(reuse.run(source,config,'',signal,async()=>{throw Object.assign(new Error('interrupted'),{checkpoints:[checkpoint]});}));
  await reuse.run(source,config,'',signal,async checkpoints=>{assert.deepEqual(checkpoints,[checkpoint]);return '# complete';});
  reuse.clear();await reuse.run(source,config,'',signal,async checkpoints=>{assert.deepEqual(checkpoints,[]);return '# fresh';});
});
