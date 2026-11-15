import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {runAnalysisWorker} from '../../src/main/analysis-task.ts';
import {parseSource} from '../../src/modules/source/parser.ts';
test('cancelling an unresponsive analysis worker terminates it promptly',async t=>{
  const own=await mkdtemp(join(tmpdir(),'clipnote-worker-'));t.after(()=>rm(own,{recursive:true,force:true}));
  const file=join(own,'unresponsive.cjs');await writeFile(file,"setTimeout(()=>process.exit(0),1500);");
  const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),50);t.after(()=>clearTimeout(timer));
  const started=performance.now();
  await assert.rejects(runAnalysisWorker(file,parseSource(Buffer.from('synthetic'),'a.txt'),{baseUrl:'https://fixture.invalid',model:'fixture',apiKey:'synthetic',contextWindow:8192,maxTokens:2048},{signal:abort.signal}), (error:any)=>error.code==='CANCELLED');
  assert.ok(performance.now()-started<500);
});
test('worker failures carry completed chunks back for a same-batch retry',async t=>{
  const own=await mkdtemp(join(tmpdir(),'clipnote-checkpoint-'));t.after(()=>rm(own,{recursive:true,force:true}));
  const file=join(own,'partial.cjs'),checkpoint={planId:'plan',chunkId:'first',outline:{title:'partial',sections:[]}};
  await writeFile(file,`const {parentPort}=require('node:worker_threads');parentPort.postMessage({type:'progress',value:${JSON.stringify(checkpoint)}});parentPort.postMessage({type:'error',domain:'analysis',code:'INVALID_STRUCTURE'});`);
  await assert.rejects(runAnalysisWorker(file,parseSource(Buffer.from('synthetic'),'a.txt'),{baseUrl:'https://fixture.invalid',model:'fixture',apiKey:'synthetic',contextWindow:8192,maxTokens:2048},{}),(error:any)=>{assert.deepEqual(error.checkpoints,[checkpoint]);return error.code==='INVALID_STRUCTURE';});
});
test('real analysis worker resumes validated chunks without requesting the first chunk again',async t=>{
  let fail=true;const starts:number[]=[];
  const server=createServer(async(req,res)=>{
    const parts:Buffer[]=[];for await(const part of req)parts.push(part);
    const input=JSON.parse(JSON.parse(Buffer.concat(parts).toString()).messages.at(-1).content.split('\n')[1]);
    const start=input.core[0].startOffset;starts.push(start);
    if(fail && start>0){res.writeHead(503);res.end();return;}
    const refs=input.core.map((ref:any)=>ref.refId);
    const content=JSON.stringify({title:'合成',sections:[{heading:'章节',refs,items:[{kind:'point',text:'已验证内容',refs,children:[]}]}]});
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.end(`data: ${JSON.stringify({id:'test',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{role:'assistant',content},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());}));
  const credentials={baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,model:'fixture',apiKey:'synthetic',contextWindow:4096,maxTokens:2048};
  const source=parseSource(Buffer.from('中'.repeat(2000)),'long.txt');
  const worker=fileURLToPath(new URL('../../src/main/analysis-worker.ts',import.meta.url));let checkpoints:any[]=[];
  await assert.rejects(runAnalysisWorker(worker,source,credentials,{}),(error:any)=>{checkpoints=error.checkpoints;return error.code==='SERVER_ERROR';});
  assert.equal(checkpoints.length,1);fail=false;
  const result=await runAnalysisWorker(worker,source,credentials,{checkpoints});
  assert.ok(result.markdown.includes('已验证内容'));assert.equal(starts.filter(start=>start===0).length,1);assert.ok(result.checkpoints.length>1);
});
